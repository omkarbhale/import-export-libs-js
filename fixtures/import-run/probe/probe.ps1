<#
Import-run probe for engines 14.0.7 and 14.35 (wayfinder tickets 22 and 53; -Engine names the build the
staged toolset must be). Windows PowerShell 5.1. It loads the staged toolset and runs the engine's own
ImportExportManager.ImportSolutions, CItemHelper and PackageDefinitionManager against Probe.cs's
StubConnection, which never touches a network: it records what the engine hands to IOM and answers from a
small in-memory model of the server. No server, no credential and no password is involved. Package folders
and the log are built under a work folder.
#>
param(
    [Parameter(Mandatory)][string] $ToolsetDir,
    [Parameter(Mandatory)][string] $Work,
    [Parameter(Mandatory)][string] $Out,
    [string] $Only = '',
    [string] $Engine = '14.35'
)
Set-StrictMode -Version 1
$ErrorActionPreference = 'Stop'
$iomPath = Join-Path $ToolsetDir 'IOM.dll'
$libsPath = Join-Path $ToolsetDir 'Libs.dll'
$toolsetBin = $ToolsetDir
$resolver = [System.ResolveEventHandler]{ param($s, $e) $n = ($e.Name -split ',')[0]; $p = Join-Path $toolsetBin ($n + '.dll'); if (Test-Path $p) { return [System.Reflection.Assembly]::LoadFrom($p) }; return $null }
[AppDomain]::CurrentDomain.add_AssemblyResolve($resolver)
[void][System.Reflection.Assembly]::LoadFrom($iomPath)
$libs = [System.Reflection.Assembly]::LoadFrom($libsPath)
$expect = @{ '14.0.7' = '14.0.7.35492'; '14.35' = '14.35.0.43890' }[$Engine]
if ($libs.GetName().Version.ToString() -ne $expect) { throw "Libs.dll is $($libs.GetName().Version), not $expect" }
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'Probe.cs')) -ReferencedAssemblies @($iomPath, $libsPath, 'System.Xml')
$SU = 'Aras.Tools.SolutionUpgrade'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$sb = New-Object System.Text.StringBuilder
function W([string] $s) { [void]$sb.AppendLine($s) }
function Esc([string] $s) { if ($null -eq $s) { return '<null>' }; return $s.Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t') }
function Scrub([string] $s, [string] $root) {
    if ($null -eq $s) { return $s }
    $s = $s.Replace($root, '<ROOT>').Replace($me, '<WINUSER>').Replace([Environment]::UserName, '<USERNAME>')
    return $s
}
function Unwrap($ex) {
    while ($ex -is [System.Management.Automation.MethodInvocationException] -or $ex -is [System.Reflection.TargetInvocationException]) { $ex = $ex.InnerException }
    return $ex
}
function DescEx($ex, [string] $root) {
    $x = Unwrap $ex
    $o = $x.GetType().FullName + ' :: ' + (Scrub (Esc $x.Message) $root)
    if ($x -is [Aras.Tools.SolutionUpgrade.CItemException]) {
        $o += "`n    faultcode=$($x.faultcode) faultstring=" + (Scrub (Esc $x.faultstring) $root) + ' faultdetail=' + (Scrub (Esc $x.faultdetail) $root) + " bInnError=$($x.bInnError)"
    }
    if ($x.InnerException) { $o += "`n    inner=" + $x.InnerException.GetType().FullName + ' :: ' + (Scrub (Esc $x.InnerException.Message) $root) }
    return $o
}
function Fault($code, $text) { return [Probe.Env]::Fault([string]$code, $text) }
function Res($inner) { return [Probe.Env]::Result($inner) }

# ---------------------------------------------------------------------------------------------
# A small server model. $w is a hashtable the scenario fills in; $w.rules are tried first (each a
# scriptblock taking the request and returning an envelope or $null), then the model below.
# ---------------------------------------------------------------------------------------------
function New-World {
    return @{
        rules = @()             # scenario overrides
        packages = @()          # PackageDefinition names the server lists (getSolutions)
        du = @{}                # DatabaseUpgrade name -> @{id; locked}
        dupSeq = 0
        pkgdefs = @{}           # name -> id
        groups = @{}            # name -> id
        elements = @{}          # element id -> @{source; type}
        existing = @{}          # id -> $true for items that exist (ItemExistById, DoesItemAlreadyExist)
        versionable = @{}       # type -> $true
        labels = @{}            # type -> label
        deps = @{}
        missingTypes = @{}
        onRequest = $null
        getMissing = $true      # an unscripted get by id finds nothing
        cnt = @{}
    }
}
function Get-Attr([string] $req, [string] $name) {
    $m = [regex]::Match($req, '^<Item[^>]*?\b' + $name + '="([^"]*)"'); if ($m.Success) { return $m.Groups[1].Value }; return $null
}
function Get-Child([string] $req, [string] $name) {
    $m = [regex]::Match($req, '<' + $name + '>([^<]*)</' + $name + '>'); if ($m.Success) { return $m.Groups[1].Value }; return $null
}
function Model-Respond($w, [string] $req) {
    $type = Get-Attr $req 'type'; $action = Get-Attr $req 'action'
    if ($req -like '*select="name,generation"*') {
        $s = ''
        foreach ($p in $w.packages) { $s += '<Item type="PackageDefinition" id="PD-' + $p.name + '"><name>' + $p.name + '</name>'; if ($p.deps) { $s += '<Relationships>'; foreach ($d in $p.deps) { $s += '<Item type="PackageDependsOn"><name>' + $d + '</name></Item>' }; $s += '</Relationships>' }; $s += '</Item>' }
        if ($w.packages.Count -eq 0) { return (Fault 0 'No items of type PackageDefinition found.') }
        return (Res $s)
    }
    if ($type -eq 'PackageDefinition') {
        $n = Get-Child $req 'name'
        if ($action -eq 'get') { if ($w.pkgdefs.ContainsKey($n)) { return (Res ('<Item type="PackageDefinition" id="' + $w.pkgdefs[$n] + '"><id>' + $w.pkgdefs[$n] + '</id><name>' + $n + '</name></Item>')) }; return (Fault 0 'No items of type PackageDefinition found.') }
        if ($action -eq 'add') { $id = 'PD-' + $n; $w.pkgdefs[$n] = $id; return (Res ('<Item type="PackageDefinition" id="' + $id + '"><id>' + $id + '</id><name>' + $n + '</name></Item>')) }
    }
    if ($type -eq 'DatabaseUpgrade') {
        if ($req -like '*select="locked_by_id"*') {
            $id = Get-Child $req 'id'
            $locked = $false; foreach ($k in $w.du.Keys) { if ($w.du[$k].id -eq $id -and $w.du[$k].locked) { $locked = $true } }
            if ($locked) { return (Res ('<Item type="DatabaseUpgrade" id="' + $id + '"><id>' + $id + '</id><locked_by_id keyed_name="admin">U1</locked_by_id></Item>')) }
            return (Res ('<Item type="DatabaseUpgrade" id="' + $id + '"><id>' + $id + '</id><locked_by_id/></Item>'))
        }
        if ($action -eq 'get') {
            $n = Get-Child $req 'name'
            if ($w.du.ContainsKey($n)) { return (Res ('<Item type="DatabaseUpgrade" id="' + $w.du[$n].id + '"><name>' + $n + '</name></Item>')) }
            return (Fault 0 'No items of type DatabaseUpgrade found.')
        }
        if ($action -eq 'add') { $w.dupSeq++; $n = Get-Child $req 'name'; $id = 'DU' + $w.dupSeq; $w.du[$n] = @{ id = $id; locked = $false }; return (Res ('<Item type="DatabaseUpgrade" id="' + $id + '"/>')) }
        if ($action -eq 'unlock') { return (Res ('<Item type="DatabaseUpgrade" id="' + (Get-Attr $req 'id') + '"/>')) }
        if ($action -eq 'edit') { return (Res ('<Item type="DatabaseUpgrade" id="' + (Get-Attr $req 'id') + '"/>')) }
    }
    if ($type -eq 'PackageDependsOn') {
        if ($action -eq 'get') { $n = Get-Child $req 'name'; $k = (Get-Child $req 'source_id') + '/' + $n; if ($w.deps.ContainsKey($k)) { return (Res ('<Item type="PackageDependsOn" id="' + $w.deps[$k] + '"/>')) }; return (Fault 0 'No items of type PackageDependsOn found.') }
        if ($action -eq 'add') { $n = Get-Child $req 'name'; $k = (Get-Child $req 'source_id') + '/' + $n; $id = 'DEP-' + $n; $w.deps[$k] = $id; return (Res ('<Item type="PackageDependsOn" id="' + $id + '"/>')) }
    }
    if ($type -eq 'PackageReferencedElement') {
        if ($action -eq 'get') { return (Fault 0 'No items of type PackageReferencedElement found.') }
        if ($action -eq 'add') { return (Res '<Item type="PackageReferencedElement" id="PRE1"/>') }
    }
    if ($type -eq 'PackageGroup') {
        $n = Get-Child $req 'name'
        if ($action -eq 'get') { if ($w.groups.ContainsKey($n)) { return (Res ('<Item type="PackageGroup" id="' + $w.groups[$n] + '"/>')) }; return (Fault 0 'No items of type PackageGroup found.') }
        if ($action -eq 'add') { $id = 'PG-' + $n; $w.groups[$n] = $id; return (Res ('<Item type="PackageGroup" id="' + $id + '"/>')) }
    }
    if ($type -eq 'PackageElement') {
        if ($action -eq 'get') { $e = Get-Child $req 'element_id'; if ($w.elements.ContainsKey($e)) { return (Res ('<Item type="PackageElement" id="PE1"><source_id>' + $w.elements[$e].source + '</source_id><element_type>' + $w.elements[$e].type + '</element_type></Item>')) }; return (Fault 0 'No items of type PackageElement found.') }
        if ($action -eq 'add') { return (Res '<Item type="PackageElement" id="PE-new"/>') }
    }
    if ($type -eq 'ItemType' -and $req -like '*select="label"*') {
        $n = Get-Child $req 'name'
        if ($w.labels.ContainsKey($n)) { if ($w.labelShape -eq 'plain') { return (Res ('<Item type="ItemType" id="IT"><label xml:lang="en">' + $w.labels[$n] + '</label></Item>')) }
        if ($w.labelShape -eq 'noLang') { return (Res ('<Item type="ItemType" id="IT"><label>' + $w.labels[$n] + '</label></Item>')) }
        return (Res ('<Item type="ItemType" id="IT"><i18n:label xmlns:i18n="http://www.aras.com/I18N" xml:lang="en">' + $w.labels[$n] + '</i18n:label></Item>')) }
        return (Res '<Item type="ItemType" id="IT"><name>x</name></Item>')
    }
    if ($type -eq 'ItemType' -and $req -like '*select="is_versionable"*') {
        $n = Get-Child $req 'name'
        return (Res ('<Item type="ItemType" id="IT"><is_versionable>' + $(if ($w.versionable.ContainsKey($n)) { '1' } else { '0' }) + '</is_versionable></Item>'))
    }
    if ($req -like '*select="config_id"*') { return (Res ('<Item type="' + $type + '" id="' + (Get-Child $req 'id') + '"><config_id>CFG-' + (Get-Child $req 'id') + '</config_id></Item>')) }
    if ($action -eq 'get') {
        $id = Get-Child $req 'id'
        if ($id) {
            if ($w.existing.ContainsKey($id)) { return (Res ('<Item type="' + $type + '" id="' + $id + '"><id>' + $id + '</id></Item>')) }
            if ($w.getMissing) { return (Fault 0 ('No items of type ' + $type + ' found.')) }
        }
    }
    return (Res ('<Item type="' + $type + '" id="GEN"/>'))
}

# ---------------------------------------------------------------------------------------------
# One run: builds the manifest and package folders, runs ImportSolutions, and records everything.
# $c: name, packages (name -> @{ files = @(@{dir; name; xml}) ; deps ; refs}), list (names to import),
#     merge, verbose, release, description, world (scenario world), logPrefill, cancelOn (predicate)
# ---------------------------------------------------------------------------------------------
function Run-Import($c) {
    $root = Join-Path $Work $c.name
    if (Test-Path $root) { Remove-Item -Recurse -Force $root }
    New-Item -ItemType Directory -Path $root | Out-Null
    $w = $c.world; if ($null -eq $w) { $w = New-World }
    $mf = '<imports>'
    foreach ($pn in $c.packages.Keys) {
        $p = $c.packages[$pn]
        $mf += '<package name="' + $pn + '" path="' + $pn + '\Import">'
        foreach ($d in @($p.deps)) { if ($d) { $mf += '<dependson name="' + $d.name + '">'; foreach ($r in @($d.refs)) { if ($r) { $mf += '<referenced_element id="' + $r.id + '" type="' + $r.type + '" descr="' + $r.descr + '" />' } }; $mf += '</dependson>' } }
        $mf += '</package>'
        foreach ($f in @($p.files)) {
            $dir = Join-Path (Join-Path (Join-Path $root $pn) 'Import') $f.dir
            [void][System.IO.Directory]::CreateDirectory($dir)
            [System.IO.File]::WriteAllText((Join-Path $dir ($f.name + '.xml')), '<AML>' + $f.xml + '</AML>', $utf8)
        }
    }
    $mf += '</imports>'
    $mfPath = Join-Path $root 'imports.mf'
    if (-not $c.noManifest) { [System.IO.File]::WriteAllText($mfPath, $mf, $utf8) }
    $logPath = Join-Path $root 'engine.log'
    if ($c.logSub) { $logPath = Join-Path $root $c.logSub }
    if ($c.logPrefill) { [System.IO.File]::WriteAllText($logPath, $c.logPrefill, $utf8) }

    $conn = New-Object Probe.StubConnection
    $mgrRef = @{ m = $null; n = 0 }
    $conn.Respond = {
        param($req)
        $mgrRef.n++
        if ($c.onReq) { & $c.onReq $req $mgrRef.n $logPath }
        if ($c.cancelOn -and (& $c.cancelOn $req $mgrRef.n)) { $mgrRef.m.Cancel() }
        foreach ($r in $w.rules) { $x = & $r $req $mgrRef.n; if ($null -ne $x) { return $x } }
        return (Model-Respond $w $req)
    }.GetNewClosure()
    $helper = New-Object Aras.Tools.SolutionUpgrade.CItemHelper($conn)
    if (-not $c.noVersion) {
        $version = New-Object Aras.Tools.SolutionUpgrade.ArasVersion(12, 0, 9, 24090, 0)
        $helper.GetType().GetProperty('InnovatorVersion').GetSetMethod($true).Invoke($helper, [object[]]@($version.psobject.BaseObject)) | Out-Null
    }
    $ctx = New-Object Aras.Tools.SolutionUpgrade.SolutionUpgradeContext
    $ctx.Action = [Aras.Tools.SolutionUpgrade.ImportExport]::Import
    $ctx.ManifestFile = $mfPath; $ctx.WorkingDirectory = $root; $ctx.LogFilePath = $logPath
    $ctx.Url = 'http://stub/'; $ctx.DataBase = 'db'; $ctx.UserName = 'admin'
    $ctx.Verbose = [bool]$c.verbose
    $imp = New-Object Aras.Tools.SolutionUpgrade.SUImportContext
    $imp.bMerge = [bool]$c.merge; $imp.Release = $c.release; $imp.Description = $c.description
    $fac = New-Object Probe.RecFactory
    $oldOut = [Console]::Out
    $con = New-Object System.IO.StringWriter
    [Console]::SetOut($con)
    $result = $null; $thrown = $null; $ctorThrown = $null; $mgr = $null
    try {
        try { $mgr = New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($ctx, $fac, $helper); $mgrRef.m = $mgr } catch { $ctorThrown = DescEx $_.Exception $root }
        if ($mgr) {
            $list = New-Object System.Collections.ArrayList
            foreach ($n in $c.list) { [void]$list.Add($n) }
            if ($c.preCancel) { $mgr.Cancel() }
            try { $result = $mgr.ImportSolutions($list, $imp) } catch { $thrown = DescEx $_.Exception $root }
        }
    } finally { [Console]::SetOut($oldOut) }
    W ('=== ' + $c.name)
    if ($c.note) { W ('NOTE: ' + $c.note) }
    if ($ctorThrown) { W ('CTOR-EXC: ' + $ctorThrown) } else { W ('RESULT: ' + $result) }
    if ($thrown) { W ('EXC: ' + $thrown) }
    W 'REQUESTS:'
    if ($c.quiet) { W ('  (' + $conn.Requests.Count + ' requests, not listed)') } else { $i = 0; foreach ($r in $conn.Requests) { $i++; W ('  ' + $i + ' ' + (Scrub (Esc $r) $root)) } }
    W 'MESSAGES:'
    foreach ($m in $fac.Sink) { W ('  ' + (Scrub (Esc $m) $root)) }
    W ('CONSOLE: ' + (Scrub (Esc $con.ToString()) $root))
    $logText = ''; if (Test-Path $logPath) { $logText = [System.IO.File]::ReadAllText($logPath, $utf8) }
    $logText = [regex]::Replace($logText, '\d\d/\d\d/\d{4} \d\d:\d\d:\d\d', '<DATETIME>')
    if ($c.quiet) { W ('LOG: (' + $logText.Length + ' characters, not shown)') } else { W ('LOG: ' + (Scrub (Esc $logText) $root)) }
    W ''
}


function New-StubHelper($w) {
    $conn = New-Object Probe.StubConnection
    $conn.Respond = {
        param($req)
        $w.cnt.n = 1 + [int]$w.cnt.n
        foreach ($r in $w.rules) { $x = & $r $req $w.cnt.n; if ($null -ne $x) { return $x } }
        return (Model-Respond $w $req)
    }.GetNewClosure()
    $helper = New-Object Aras.Tools.SolutionUpgrade.CItemHelper($conn)
    $version = New-Object Aras.Tools.SolutionUpgrade.ArasVersion(12, 0, 9, 24090, 0)
    $helper.GetType().GetProperty('InnovatorVersion').GetSetMethod($true).Invoke($helper, [object[]]@($version.psobject.BaseObject)) | Out-Null
    return @{ conn = $conn; helper = $helper }
}
# Direct calls on CItemHelper / PackageDefinitionManager: $calls is a list of @{ label; run = scriptblock taking $helper }.
function Run-Direct($name, $note, $w, $calls) {
    $root = Join-Path $Work $name
    W ('=== ' + $name)
    if ($note) { W ('NOTE: ' + $note) }
    foreach ($call in $calls) {
        $sh = New-StubHelper $w
        $before = $sh.conn.Requests.Count
        $res = $null; $thrown = $null
        try { $res = & $call.run $sh.helper } catch { $thrown = DescEx $_.Exception $root }
        W ('CALL: ' + $call.label)
        if ($thrown) { W ('  EXC: ' + $thrown) } else { W ('  RESULT: ' + (Scrub (Esc ([string]$res)) $root)) }
        $i = 0; foreach ($r in $sh.conn.Requests) { $i++; W ('  ' + $i + ' ' + (Scrub (Esc $r) $root)) }
    }
    W ''
}
function Item-Xml($type, $id, $action, $name) { return '<Item type="' + $type + '" id="' + $id + '" action="' + $action + '"><name>' + $name + '</name></Item>' }
function F($dir, $name, $xml) { return @{ dir = $dir; name = $name; xml = $xml } }
function Fault-On([string] $pattern, $code, $text, [int] $times = 0) {
    $st = @{ left = $times }
    return { param($req, $n) if ($req -like $pattern) { if ($st.left -gt 0 -or $times -eq 0) { if ($times -gt 0) { $st.left-- }; return (Fault $code $text) } }; return $null }.GetNewClosure()
}
$A = 'LIBSJS-SCRATCH-A'; $B = 'LIBSJS-SCRATCH-B'; $C = 'LIBSJS-SCRATCH-C'
$l1 = F 'List' 'Colors' (Item-Xml 'List' 'L0000000000000000000000000000001' 'add' 'LIBSJS-SCRATCH-Colors')
$m1 = F 'Method' 'DoIt' (Item-Xml 'Method' 'M0000000000000000000000000000001' 'add' 'LIBSJS-SCRATCH-DoIt')
$scenarios = [ordered]@{}
function Def($name, [scriptblock] $body) { $script:scenarios[$name] = $body }

Def 's01-basic' {
    $w = New-World; $w.packages = @(@{ name = $A })
    Run-Import @{ name = 's01-basic'; packages = [ordered]@{ $A = @{ files = @($l1, $m1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's02-merge-verbose' {
    $w = New-World; $w.packages = @(@{ name = $A })
    Run-Import @{ name = 's02-merge-verbose'; note = 'merge on, verbose on'; packages = [ordered]@{ $A = @{ files = @($l1, $m1) } }; list = @($A); merge = $true; verbose = $true; release = 'R1'; description = 'D1'; world = $w }
}
Def 's03-skip-existing' {
    $w = New-World; $w.packages = @(@{ name = $A }); $w.existing['L0000000000000000000000000000001'] = $true
    Run-Import @{ name = 's03-skip-existing'; note = 'not merge; the List already exists, so its add is skipped but still registered'; packages = [ordered]@{ $A = @{ files = @($l1, $m1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's04-post-actions' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $e1 = F 'Method' 'Edit1' (Item-Xml 'Method' 'M0000000000000000000000000000002' 'edit' 'LIBSJS-SCRATCH-Edit')
    $mem = F 'Member' 'Mem1' (Item-Xml 'Member' 'N0000000000000000000000000000001' 'add' 'LIBSJS-SCRATCH-Mem')
    $sev = F 'Server Event' 'Ev1' (Item-Xml 'Server Event' 'S0000000000000000000000000000001' 'add' 'LIBSJS-SCRATCH-Ev')
    Run-Import @{ name = 's04-post-actions'; note = 'edit item, plus Member and Server Event adds (not importable types)'; packages = [ordered]@{ $A = @{ files = @($l1, $e1, $mem, $sev) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w; verbose = $true }
}
Def 's05-delete-retry-ok' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $w.rules += (Fault-On '<Item type="View" id="V0000000000000000000000000000009" action="delete"*' 5 'boom' 1)
    $d1 = F 'View' 'Gone' '<Item type="View" id="V0000000000000000000000000000009" action="delete"/>'
    Run-Import @{ name = 's05-delete-retry-ok'; note = 'the delete is refused once, then accepted on the retry'; packages = [ordered]@{ $A = @{ files = @($d1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's06-delete-retry-fails' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $w.rules += (Fault-On '<Item type="View" id="V0000000000000000000000000000009" action="delete"*' 5 'boom')
    $d1 = F 'View' 'Gone' '<Item type="View" id="V0000000000000000000000000000009" action="delete"/>'
    Run-Import @{ name = 's06-delete-retry-fails'; note = 'the delete is refused every time'; packages = [ordered]@{ $A = @{ files = @($d1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's07-fail-second-package' {
    $w = New-World; $w.packages = @(@{ name = $A }, @{ name = $B }, @{ name = $C })
    $w.rules += (Fault-On '<Item type="Method" id="M0000000000000000000000000000001" action="add"*' 5 'boom')
    Run-Import @{ name = 's07-fail-second-package'; note = 'A imports; B fails on its Method; C is never started'; packages = [ordered]@{ $A = @{ files = @($l1) }; $B = @{ files = @($l1, $m1) }; $C = @{ files = @($l1) } }; list = @($A, $B, $C); release = 'R1'; description = 'D1'; world = $w }
}
Def 's08-fail-and-release-write-fails' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $w.rules += (Fault-On '<Item type="Method" id="M0000000000000000000000000000001" action="add"*' 5 'boom')
    $w.rules += { param($req, $n) if ($req -like '*upgrade_status>2*') { return (Fault 9 'release write refused') }; return $null }
    Run-Import @{ name = 's08-fail-and-release-write-fails'; note = 'the item fails, then the status-2 write also fails: the second error replaces the first'; packages = [ordered]@{ $A = @{ files = @($l1, $m1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's09-cancel' {
    $w = New-World; $w.packages = @(@{ name = $A }, @{ name = $B })
    Run-Import @{ name = 's09-cancel-first-item'; note = 'Cancel() is called while the first item of A (the List add) is being sent; A has a second item and B is also listed'; packages = [ordered]@{ $A = @{ files = @($l1, $m1) }; $B = @{ files = @($l1) } }; list = @($A, $B); release = 'R1'; description = 'D1'; world = $w
        cancelOn = { param($req, $n) $req -like '<Item type="List" id="L0000000000000000000000000000001" action="add"*' } }
    $w = New-World; $w.packages = @(@{ name = $A }, @{ name = $B })
    Run-Import @{ name = 's09b-cancel-last-item'; note = 'Cancel() is called while the last item of A is being sent; B is also listed'; packages = [ordered]@{ $A = @{ files = @($l1, $m1) }; $B = @{ files = @($l1) } }; list = @($A, $B); release = 'R1'; description = 'D1'; world = $w
        cancelOn = { param($req, $n) $req -like '<Item type="Method" id="M0000000000000000000000000000001" action="add"*' } }
}
Def 's10-cancel-before-start' {
    $w = New-World; $w.packages = @(@{ name = $A })
    Run-Import @{ name = 's10-cancel-before-start'; note = 'Cancel() is called before ImportSolutions starts; ImportSolutions resets the state'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w; preCancel = $true }
}
Def 's11-empty-list' {
    $w = New-World; $w.packages = @(@{ name = $A })
    Run-Import @{ name = 's11-empty-list'; note = 'no package is requested'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @(); release = 'R1'; description = 'D1'; world = $w }
}
Def 's12-unknown-package' {
    $w = New-World; $w.packages = @(@{ name = $A })
    Run-Import @{ name = 's12-unknown-package'; note = 'the requested package is not in the manifest'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @('LIBSJS-SCRATCH-Nope'); release = 'R1'; description = 'D1'; world = $w }
}
Def 's13-no-package-definitions' {
    $w = New-World
    Run-Import @{ name = 's13-no-package-definitions'; note = 'the server has no PackageDefinition (fault 0 on the list)'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's14-package-list-fault' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $w.rules += (Fault-On '*select="name,generation"*' 7 'list refused')
    Run-Import @{ name = 's14-package-list-fault'; note = 'the package list fails with a non-zero fault'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's15-ordering-warnings' {
    $w = New-World; $w.packages = @(@{ name = $A })
    Run-Import @{ name = 's15-ordering-warnings'; note = 'B depends on a package that is neither imported nor in the database'; packages = [ordered]@{ $A = @{ files = @($l1) }; $B = @{ files = @($m1); deps = @(@{ name = 'LIBSJS-SCRATCH-Missing' }) } }; list = @($A, $B); release = 'R1'; description = 'D1'; world = $w }
}
Def 's16-dependencies' {
    $w = New-World; $w.packages = @(@{ name = $A }, @{ name = 'LIBSJS-SCRATCH-Dep' })
    $w.existing['E0000000000000000000000000000001'] = $true
    $refs = @(@{ id = 'E0000000000000000000000000000001'; type = 'List'; descr = 'Present' }, @{ id = 'E0000000000000000000000000000002'; type = 'List'; descr = 'Absent' })
    Run-Import @{ name = 's16-dependencies'; note = 'dependson with two referenced elements, one of which is not in the database'; packages = [ordered]@{ $A = @{ files = @($l1); deps = @(@{ name = 'LIBSJS-SCRATCH-Dep'; refs = $refs }) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's17-dependency-get-fault' {
    $w = New-World; $w.packages = @(@{ name = $A }, @{ name = 'LIBSJS-SCRATCH-Dep' })
    $w.rules += (Fault-On '<Item type="PackageDependsOn" select="id" action="get"*' 7 'dep refused')
    $refs = @(@{ id = 'E0000000000000000000000000000001'; type = 'List'; descr = 'Present' })
    $w.existing['E0000000000000000000000000000001'] = $true
    Run-Import @{ name = 's17-dependency-get-fault'; note = 'the PackageDependsOn get fails with a non-zero fault: it is swallowed and the dependency id is empty'; packages = [ordered]@{ $A = @{ files = @($l1); deps = @(@{ name = 'LIBSJS-SCRATCH-Dep'; refs = $refs }) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's18-pkgdef-fault' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $w.rules += (Fault-On '<Item type="PackageDefinition" select="id,name,generation"*' 7 'pkgdef refused')
    Run-Import @{ name = 's18-pkgdef-fault'; note = 'the PackageDefinition lookup fails with a non-zero fault'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's19-element-exists-same' {
    $w = New-World; $w.packages = @(@{ name = $A }); $w.elements['L0000000000000000000000000000001'] = @{ source = 'PG-List'; type = 'List' }
    Run-Import @{ name = 's19-element-exists-same'; note = 'the element is already in the same group with the same type'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's20-element-exists-other' {
    $w = New-World; $w.packages = @(@{ name = $A }); $w.elements['L0000000000000000000000000000001'] = @{ source = 'PG-Other'; type = 'List' }
    Run-Import @{ name = 's20-element-exists-other'; note = 'the element is registered in another package'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's21-label' {
    foreach ($shape in 'i18n', 'plain', 'noLang') {
        $w = New-World; $w.packages = @(@{ name = $A }); $w.labels['List'] = 'List Label'; $w.labelShape = $shape
        Run-Import @{ name = ('s21-label-' + $shape); note = ('the ItemType answers with a label in the shape: ' + $shape); packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
    }
}
Def 's22-versionable' {
    $w = New-World; $w.packages = @(@{ name = $A }); $w.versionable['Part'] = $true
    $w.rules += { param($req, $n) if ($req -like '*select="config_id, is_current"*') { return (Res '<Item type="Part" id="P0000000000000000000000000000001"><config_id>CFGP1</config_id><is_current>1</is_current></Item>') }; if ($req -like '*select="config_id"*') { return (Res '<Item type="Part" id="P0000000000000000000000000000001"><config_id>CFGP1</config_id></Item>') }; return $null }
    $p1 = F 'Part' 'Bolt' (Item-Xml 'Part' 'P0000000000000000000000000000001' 'add' 'LIBSJS-SCRATCH-Bolt')
    Run-Import @{ name = 's22-versionable'; note = 'a versionable type: the element is registered under its config_id (here the add is skipped as existing)'; packages = [ordered]@{ $A = @{ files = @($p1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's23-sql' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $s1 = F 'SQL' 'Proc1' '<Item type="SQL" id="Q0000000000000000000000000000001" action="add"><name>LIBSJS-SCRATCH-Proc1</name></Item>'
    $s2 = F 'SQL' 'Proc2' '<Item type="sql" action="add"><id>Q0000000000000000000000000000002</id><name>LIBSJS-SCRATCH-Proc2</name></Item>'
    Run-Import @{ name = 's23-sql'; note = 'two SQL items, one with id as a child element only'; packages = [ordered]@{ $A = @{ files = @($s1, $s2, $l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's24-sql-no-id' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $s3 = F 'SQL' 'Proc3' '<Item type="SQL" action="add"><name>LIBSJS-SCRATCH-Proc3</name></Item>'
    Run-Import @{ name = 's24-sql-no-id'; note = 'a SQL item with no id at all'; packages = [ordered]@{ $A = @{ files = @($s3, $l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's25-manifest-missing' {
    $w = New-World
    Run-Import @{ name = 's25-manifest-missing'; note = 'the manifest file does not exist (Action = Import)'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); noManifest = $true; world = $w }
}
Def 's26-log-appends' {
    $w = New-World; $w.packages = @(@{ name = $A })
    Run-Import @{ name = 's26-log-appends'; note = 'the log already holds text'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w; logPrefill = "earlier run`r`n" }
}
Def 's27-log-dir-missing' {
    $w = New-World
    Run-Import @{ name = 's27-log-dir-missing'; note = 'the log directory does not exist'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); world = $w; logSub = 'nodir\x.log' }
}
Def 's28-dots' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $files = @(); for ($i = 1; $i -le 61; $i++) { $files += (F 'List' ('L' + $i) (Item-Xml 'List' ('L{0:D31}' -f $i) 'add' ('LIBSJS-SCRATCH-L' + $i))) }
    Run-Import @{ name = 's28-dots'; note = '61 importable items: the console gets a line break after every 60th dot'; packages = [ordered]@{ $A = @{ files = $files } }; list = @($A); release = 'R1'; description = 'D1'; world = $w; quiet = $true }
}
Def 's29-null-release' {
    $w = New-World; $w.packages = @(@{ name = $A })
    Run-Import @{ name = 's29-null-release'; note = 'Release and Description are not set'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); world = $w }
}
Def 's30-release-first-fails' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $w.rules += { param($req, $n) if ($req -like '*<Item type="DatabaseUpgrade" action="add"*') { return (Fault 7 'cannot add') }; return $null }
    Run-Import @{ name = 's30-release-first-fails'; note = 'the DatabaseUpgrade add of the in-progress write fails'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's31-bfast' {
    $imp = New-Object Aras.Tools.SolutionUpgrade.SUImportContext
    $imp.bFast = $true
    W '=== s31-bfast'
    W ('NOTE: bFast is set to true; the getter returns ' + $imp.bFast)
    W ('Defaults: bMerge=' + $imp.bMerge + ' bVault=' + $imp.bVault + ' Release=' + (Esc $imp.Release) + ' Description=' + (Esc $imp.Description))
    $imp.bVault = $true; W ('After bVault=true: ' + $imp.bVault)
    W ''
}
Def 's32-null-context' {
    $w = New-World
    $root = Join-Path $Work 's32'; New-Item -ItemType Directory -Force -Path $root | Out-Null
    $mfPath = Join-Path $root 'imports.mf'; [System.IO.File]::WriteAllText($mfPath, '<imports/>', $utf8)
    $sh = New-StubHelper $w
    $ctx = New-Object Aras.Tools.SolutionUpgrade.SolutionUpgradeContext
    $ctx.Action = [Aras.Tools.SolutionUpgrade.ImportExport]::Import; $ctx.ManifestFile = $mfPath; $ctx.WorkingDirectory = $root; $ctx.LogFilePath = (Join-Path $root 'l.log')
    $fac = New-Object Probe.RecFactory
    W '=== s32-null-context'
    $mgr = New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($ctx, $fac, $sh.helper)
    try { [void]$mgr.ImportSolutions((New-Object System.Collections.ArrayList), $null) } catch { W ('ImportSolutions(list, null): ' + (DescEx $_.Exception $root)) }
    try { $r = $mgr.ImportSolutions($null, (New-Object Aras.Tools.SolutionUpgrade.SUImportContext)); W ('ImportSolutions(null, ctx) returned ' + $r + '; messages: ' + (($fac.Sink | ForEach-Object { Scrub (Esc $_) $root }) -join ' || ')) } catch { W ('ImportSolutions(null, ctx): ' + (DescEx $_.Exception $root)) }
    W ('log: ' + (Scrub (Esc ([System.IO.File]::ReadAllText((Join-Path $root 'l.log'), $utf8))) $root))
    try { [void](New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($ctx, $fac, $null)) } catch { W ('ctor(null helper): ' + (DescEx $_.Exception $root)) }
    try { [void](New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($null, $fac, $sh.helper)) } catch { W ('ctor(null context): ' + (DescEx $_.Exception $root)) }
    W ('Requests sent: ' + $sh.conn.Requests.Count)
    W ''
}
Def 's40-release-direct' {
    foreach ($st in 0, 1, 2) {
        Run-Direct ('s40-release-direct-new-st' + $st) 'DatabaseUpgrade row absent' (New-World) @(@{ label = "WriteReleaseData('P', $st, 'R', 'D') - no row yet"; run = ({ param($h) $h.WriteReleaseData('P', $st, 'R', 'D') }.GetNewClosure()) })
    }
    foreach ($case in @(@{ st = 0; locked = $false }, @{ st = 1; locked = $false }, @{ st = 2; locked = $false }, @{ st = 1; locked = $true }, @{ st = 0; locked = $true })) {
        $w2 = New-World; $w2.du['P'] = @{ id = 'DU9'; locked = $case.locked }
        Run-Direct ('s41-release-direct-found-st' + $case.st + '-locked' + $case.locked) 'DatabaseUpgrade row present' $w2 @(@{ label = ("WriteReleaseData('P', " + $case.st + ", 'R', 'D')"); run = ({ param($h) $h.WriteReleaseData('P', $case.st, 'R', 'D') }.GetNewClosure()) })
    }
    $w3 = New-World; $w3.du["O'Brien"] = @{ id = 'DU8'; locked = $false }
    Run-Direct 's42-release-direct-quote' 'unescaped values: apostrophe in the name, null release and description, markup in the description' $w3 @(
        @{ label = "WriteReleaseData(""O'Brien"", 1, `$null, `$null)"; run = { param($h) $h.WriteReleaseData("O'Brien", 1, $null, $null) } },
        @{ label = "WriteReleaseData('New<&>', 0, 'R&1', 'a<b>&c')"; run = { param($h) $h.WriteReleaseData('New<&>', 0, 'R&1', 'a<b>&c') } },
        @{ label = "WriteReleaseData('P', 3, 'R', 'D')"; run = { param($h) $h.WriteReleaseData('P', 3, 'R', 'D') } },
        @{ label = "WriteReleaseData('P', -1, 'R', 'D')"; run = { param($h) $h.WriteReleaseData('P', -1, 'R', 'D') } })
    $w4 = New-World; $w4.du['P'] = @{ id = 'DU7'; locked = $false }
    $w4.rules += { param($req, $n) if ($req -like '*action="edit"*where=*') { return (Fault 8 'clear refused') }; return $null }
    Run-Direct 's43-release-direct-faults' 'faults inside WriteReleaseData' $w4 @(
        @{ label = "WriteReleaseData('P', 1, 'R', 'D') - the is_latest clearing edit fails"; run = { param($h) $h.WriteReleaseData('P', 1, 'R', 'D') } })
    $w5 = New-World; $w5.rules += { param($req, $n) if ($req -like '*action="add"*') { return (Fault 8 'add refused') }; return $null }
    Run-Direct 's44-release-direct-add-fault' 'the add fails' $w5 @(@{ label = "WriteReleaseData('P', 0, 'R', 'D') - the add fails"; run = { param($h) $h.WriteReleaseData('P', 0, 'R', 'D') } })
    $w6 = New-World; $w6.rules += { param($req, $n) if ($req -like '*action="get"*') { return (Fault 8 'get refused') }; return $null }
    Run-Direct 's45-release-direct-get-fault' 'the first get fails with a non-zero fault' $w6 @(@{ label = "WriteReleaseData('P', 0, 'R', 'D')"; run = { param($h) $h.WriteReleaseData('P', 0, 'R', 'D') } })
}
Def 's50-pdm-direct' {
    $mk = { param($h, $name, $create) New-Object Aras.Tools.SolutionUpgrade.PackageDefinitionManager($h, $name, $create) }
    Run-Direct 's50-pdm-new-create' 'PackageDefinition absent, doCreate true' (New-World) @(@{ label = "PackageDefinitionManager(h, 'P', doCreate=true)"; run = { param($h) [void](& $mk $h 'P' $true); 'ok' } })
    Run-Direct 's50-pdm-new-nocreate' 'PackageDefinition absent, doCreate false' (New-World) @(@{ label = "PackageDefinitionManager(h, 'P', doCreate=false)"; run = { param($h) [void](& $mk $h 'P' $false); 'ok' } })
    $wp = New-World; $wp.pkgdefs['P'] = 'PD-P'
    Run-Direct 's50-pdm-present' 'PackageDefinition present' $wp @(@{ label = "PackageDefinitionManager(h, 'P', doCreate=true)"; run = { param($h) [void](& $mk $h 'P' $true); 'ok' } })
    $w2 = New-World; $w2.pkgdefs['P'] = 'PD-P'; $w2.groups['G'] = 'PG-G'
    $calls = @(
        @{ label = "AddElement2Group('K', 'List', 'G', 'EID') - new element in an existing group"; run = { param($h) $m = & $mk $h 'P' $true; $m.AddElement2Group('K', 'List', 'G', 'EID') } },
        @{ label = "AddElement2Group('K', 'List', 'G', 'EID') - element exists elsewhere"; run = { param($h) $w2.elements['EID'] = @{ source = 'PG-X'; type = 'List' }; $m = & $mk $h 'P' $true; $m.AddElement2Group('K', 'List', 'G', 'EID') } },
        @{ label = "AddElement2Group('K', 'List', 'G', 'EID') - element exists in this group with another type"; run = { param($h) $w2.elements['EID'] = @{ source = 'PG-G'; type = 'Other' }; $m = & $mk $h 'P' $true; $m.AddElement2Group('K', 'List', 'G', 'EID') } },
        @{ label = "AddElement2Group(null, 'List', 'G', 'EID') - null keyed name, new element"; run = { param($h) $w2.elements.Clear(); $m = & $mk $h 'P' $true; $m.AddElement2Group($null, 'List', 'G', 'EID') } },
        @{ label = "AddElement2Group('A&B<C ""q"" ''r''', 'List', 'G', 'EID') - markup in the keyed name"; run = { param($h) $w2.elements.Clear(); $m = & $mk $h 'P' $true; $m.AddElement2Group('A&B<C "q" ''r''', 'List', 'G', 'EID') } },
        @{ label = "AddElement2Group('K', 'List', 'G', 'E&ID') - ampersand in the id"; run = { param($h) $w2.elements.Clear(); $m = & $mk $h 'P' $true; $m.AddElement2Group('K', 'List', 'G', 'E&ID') } }
    )
    Run-Direct 's51-pdm-element' 'AddElement2Group' $w2 $calls
}


Def 's33-add-with-where' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $wh = F 'Method' 'ByWhere' '<Item type="Method" where="name=''LIBSJS-SCRATCH-ByWhere''" action="add"><name>LIBSJS-SCRATCH-ByWhere</name></Item>'
    Run-Import @{ name = 's33-add-with-where'; note = 'an add that names its target by where and has no id, not merge'; packages = [ordered]@{ $A = @{ files = @($wh) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's34-merge-nonexisting-where' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $wh = F 'Method' 'ByWhere' '<Item type="Method" where="name=''LIBSJS-SCRATCH-ByWhere''" action="add"><name>LIBSJS-SCRATCH-ByWhere</name></Item>'
    Run-Import @{ name = 's34-merge-where'; note = 'the same add under merge; the element is registered under the (empty) id attribute'; packages = [ordered]@{ $A = @{ files = @($wh) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w; merge = $true }
}
Def 's35-other-actions' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $f1 = F 'LibsjsScratchType' 'Merge1' (Item-Xml 'LibsjsScratchType' 'M0000000000000000000000000000003' 'merge' 'LIBSJS-SCRATCH-Merge')
    $f2 = F 'LibsjsScratchType' 'NoAction' '<Item type="LibsjsScratchType" id="M0000000000000000000000000000004"><name>LIBSJS-SCRATCH-NoAct</name></Item>'
    Run-Import @{ name = 's35-other-actions'; note = 'merge and no-action items are post actions: counted by neither the total nor the registration'; packages = [ordered]@{ $A = @{ files = @($l1, $f1, $f2) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w; verbose = $true }
}
Def 's36-sql-skipped-first' {
    $w = New-World; $w.packages = @(@{ name = $A }); $w.existing['Q0000000000000000000000000000001'] = $true
    $s1 = F 'SQL' 'Proc1' '<Item type="SQL" id="Q0000000000000000000000000000001" action="add"><name>LIBSJS-SCRATCH-Proc1</name></Item>'
    $s2 = F 'SQL' 'Proc2' '<Item type="SQL" id="Q0000000000000000000000000000002" action="add"><name>LIBSJS-SCRATCH-Proc2</name></Item>'
    Run-Import @{ name = 's36-sql-skipped-first'; note = 'the first SQL item exists and is skipped (not merge): the deletes wait for the first SQL item that is not skipped'; packages = [ordered]@{ $A = @{ files = @($s1, $s2) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 's37-not-logged-in' {
    $w = New-World; $w.packages = @(@{ name = $A })
    Run-Import @{ name = 's37-not-logged-in'; note = 'the helper never logged in, so its server version is unset'; packages = [ordered]@{ $A = @{ files = @($l1) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w; noVersion = $true }
}
Def 's60-helper-direct' {
    $w = New-World
    $okR = { param($req, $n) $null }
    $calls = @(
        @{ label = "ItemExistById('X1', 'List') - found"; run = { param($h) $w.rules = @({ param($r, $n) Res '<Item type="List" id="X1"/>' }); $h.ItemExistById('X1', 'List') } },
        @{ label = "ItemExistById('X1', 'List') - fault 0"; run = { param($h) $w.rules = @({ param($r, $n) Fault 0 'none' }); $h.ItemExistById('X1', 'List') } },
        @{ label = "ItemExistById('X1', 'List') - fault 7"; run = { param($h) $w.rules = @({ param($r, $n) Fault 7 'bad' }); $h.ItemExistById('X1', 'List') } },
        @{ label = "ItemExistById('X1', ""O'Hara"") - apostrophe in the type"; run = { param($h) $w.rules = @(); $h.ItemExistById('X1', "O'Hara") } },
        @{ label = "Islocked('X1', 'List') - locked_by_id empty"; run = { param($h) $w.rules = @({ param($r, $n) Res '<Item type="List" id="X1"><id>X1</id><locked_by_id/></Item>' }); $h.Islocked('X1', 'List') } },
        @{ label = "Islocked('X1', 'List') - locked_by_id set"; run = { param($h) $w.rules = @({ param($r, $n) Res '<Item type="List" id="X1"><id>X1</id><locked_by_id>U1</locked_by_id></Item>' }); $h.Islocked('X1', 'List') } },
        @{ label = "Islocked('X1', 'List') - locked_by_id absent"; run = { param($h) $w.rules = @({ param($r, $n) Res '<Item type="List" id="X1"><id>X1</id></Item>' }); $h.Islocked('X1', 'List') } },
        @{ label = "Islocked('X1', 'List') - fault 0"; run = { param($h) $w.rules = @({ param($r, $n) Fault 0 'none' }); $h.Islocked('X1', 'List') } },
        @{ label = "Unlock('X1', 'List')"; run = { param($h) $w.rules = @(); $h.Unlock('X1', 'List'); 'done' } },
        @{ label = "GetConfigId('X1', 'Part') - answered"; run = { param($h) $w.rules = @(); $h.GetConfigId('X1', 'Part') } },
        @{ label = "GetConfigId('X1', 'Part') - fault"; run = { param($h) $w.rules = @({ param($r, $n) Fault 0 'none' }); $h.GetConfigId('X1', 'Part') } },
        @{ label = "GetConfigId('X1', 'Part') - no config_id in the answer"; run = { param($h) $w.rules = @({ param($r, $n) Res '<Item type="Part" id="X1"/>' }); $h.GetConfigId('X1', 'Part') } }
    )
    Run-Direct 's60-helper-direct' 'small CItemHelper methods' $w $calls
    $w = New-World; $w.labels['List'] = 'Lst'; $w.labelShape = 'i18n'
    $calls = @(
        @{ label = "GetLabelOfItemType('List') - labelled"; run = { param($h) $h.GetLabelOfItemType('List') } },
        @{ label = "GetLabelOfItemType('Other') - no label element"; run = { param($h) $h.GetLabelOfItemType('Other') } },
        @{ label = "GetLabelOfItemType('List') twice on one helper"; run = { param($h) [void]$h.GetLabelOfItemType('List'); $h.GetLabelOfItemType('List') } },
        @{ label = "GetLabelOfItemType('List') - fault 7"; run = { param($h) $w.rules = @({ param($r, $n) Fault 7 'bad' }); $h.GetLabelOfItemType('List') } },
        @{ label = "GetLabelOfItemType('List') - fault 0"; run = { param($h) $w.rules = @({ param($r, $n) Fault 0 'none' }); $h.GetLabelOfItemType('List') } },
        @{ label = "GetLabelOfItemType('List') - answer holds no Item"; run = { param($h) $w.rules = @({ param($r, $n) Res '' }); $h.GetLabelOfItemType('List') } },
        @{ label = "GetLabelOfItemType('Ty&pe') - ampersand in the type"; run = { param($h) $w.rules = @(); $h.GetLabelOfItemType('Ty&pe') } }
    )
    Run-Direct 's61-label-direct' 'GetLabelOfItemType' $w $calls
    $w = New-World
    $calls = @(
        @{ label = "GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') - new"; run = { param($h) $h.GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') } },
        @{ label = "GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') twice on one helper"; run = { param($h) [void]$h.GetPackageGroupIdOrCreateIfNotExists('PD1', 'G'); $h.GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') } },
        @{ label = "GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') - fault 7 on the get"; run = { param($h) $w.rules = @({ param($r, $n) Fault 7 'bad' }); $h.GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') } },
        @{ label = "GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') - fault 7 on the add"; run = { param($h) $w.rules = @({ param($r, $n) if ($r -like '*action="add"*') { Fault 7 'bad' } else { Fault 0 'none' } }); $h.GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') } },
        @{ label = "GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') - answer without an Item"; run = { param($h) $w.rules = @({ param($r, $n) Res '' }); $h.GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') } },
        @{ label = "GetPackageGroupIdOrCreateIfNotExists(null, null)"; run = { param($h) $w.rules = @(); $h.GetPackageGroupIdOrCreateIfNotExists($null, $null) } }
    )
    Run-Direct 's62-group-direct' 'GetPackageGroupIdOrCreateIfNotExists' $w $calls
    $w = New-World
    function Nodes([string] $xml) { $d = New-Object System.Xml.XmlDocument; $d.LoadXml($xml); return ,$d.SelectNodes('AML/Item') }
    $calls = @(
        @{ label = 'DeleteSqlItems(null)'; run = { param($h) $h.DeleteSqlItems($null); 'done' } },
        @{ label = 'DeleteSqlItems - no SQL item'; run = { param($h) $h.DeleteSqlItems((Nodes '<AML><Item type="List" id="L1"/></AML>')); 'done' } },
        @{ label = 'DeleteSqlItems - SQL with id attribute, a second with a different case, and one with an id child'; run = { param($h) $h.DeleteSqlItems((Nodes '<AML><Item type="SQL" id="Q1"/><Item type="Sql" id="Q2"/><Item type="sql"><id>Q3</id></Item></AML>')); 'done' } },
        @{ label = 'DeleteSqlItems - SQL with neither'; run = { param($h) $h.DeleteSqlItems((Nodes '<AML><Item type="SQL" id="Q1"/><Item type="SQL"/></AML>')); 'done' } },
        @{ label = 'DeleteSqlItems - an item without type before a SQL item'; run = { param($h) $h.DeleteSqlItems((Nodes '<AML><Item id="Q1"/><Item type="SQL" id="Q2"/></AML>')); 'done' } },
        @{ label = "DeleteSqlItems - id with an apostrophe"; run = { param($h) $h.DeleteSqlItems((Nodes '<AML><Item type="SQL" id="Q&apos;1"/></AML>')); 'done' } },
        @{ label = 'DeleteSqlItems - the delete fails'; run = { param($h) $w.rules = @({ param($r, $n) Fault 7 'bad' }); $h.DeleteSqlItems((Nodes '<AML><Item type="SQL" id="Q1"/><Item type="SQL" id="Q2"/></AML>')); 'done' } }
    )
    Run-Direct 's63-sql-direct' 'DeleteSqlItems' $w $calls
}

# ---------------------------------------------------------------------------------------------
# Wayfinder ticket 53 scenarios: behaviours that differ between 14.0.7 and 14.35.
# ---------------------------------------------------------------------------------------------
$allRels = '<Relationships><Item type="RelationshipType" id="RT1"><name>Part BOM</name></Item><Item type="RelationshipType" id="RT2"><name>Property</name></Item><Item type="RelationshipType" id="RT3"><name>DiscussionTemplate</name></Item><Item type="RelationshipType" id="RT4"><name>FeedTemplate</name></Item><Item type="RelationshipType" id="RT5"><name>Relationship View</name></Item></Relationships>'
function Rule-ItemTypeDef { return { param($req, $n) if ($req -like "<Item type=`"ItemType`" action=`"get`" select=`"id`"><name>*</name><Relationships><Item type=`"Property`" action=`"get`" select=`"name`" /><Item type=`"RelationshipType`"*") { return (Res ('<Item type="ItemType" id="IT-def">' + $allRels + '</Item>')) }; return $null } }
function Pad-Rule($w) { $w.rules = @((Rule-ItemTypeDef)) + $w.rules }
Def 'n01-cache-hits' {
    $w = New-World; $w.packages = @(@{ name = $A }); Pad-Rule $w
    foreach ($e in 'S0000000000000000000000000000001', 'S0000000000000000000000000000002', 'LID1', 'R0000000000000000000000000000001') { $w.existing[$e] = $true }
    $rel = { param($id, $rid) '<Item type="Part" id="' + $id + '" action="add"><name>n' + $id + '</name><Relationships>' +
        '<Item type="Part BOM" id="B' + $id.Substring(1) + '" action="add"><related_id keyed_name="k" type="Part">' + $rid + '</related_id></Item>' +
        '<Item type="Part BOM" id="C' + $id.Substring(1) + '" action="add"><related_id keyed_name="g" type="Part"><Item type="Part" action="get" select="id"><keyed_name>g</keyed_name></Item></related_id></Item>' +
        '</Relationships></Item>' }
    $f1 = F 'Part' 'p1' (& $rel 'P0000000000000000000000000000001' 'R0000000000000000000000000000001')
    $f2 = F 'Part' 'p2' (& $rel 'P0000000000000000000000000000002' 'R0000000000000000000000000000001')
    $f3 = F 'ItemType' 'it1' '<Item type="ItemType" id="I0000000000000000000000000000001" action="edit"><name>X</name><Relationships><Item type="Property" id="Y0000000000000000000000000000001" action="edit"><name>p</name><data_type>list</data_type><data_source keyed_name="LST" type="List">LID1</data_source></Item></Relationships></Item>'
    $f4 = F 'ItemType' 'it2' '<Item type="ItemType" id="I0000000000000000000000000000002" action="edit"><name>Y</name><Relationships><Item type="Property" id="Y0000000000000000000000000000002" action="edit"><name>p</name><data_type>list</data_type><data_source keyed_name="LST" type="List">LID1</data_source></Item></Relationships></Item>'
    $f5 = F 'RelationshipType' 'rt1' '<Item type="RelationshipType" id="T0000000000000000000000000000001" action="add"><name>rt1</name><source_id keyed_name="Part" type="ItemType">S0000000000000000000000000000001</source_id><related_id keyed_name="Part" type="ItemType">S0000000000000000000000000000002</related_id></Item>'
    $f6 = F 'RelationshipType' 'rt2' '<Item type="RelationshipType" id="T0000000000000000000000000000002" action="add"><name>rt2</name><source_id keyed_name="Part" type="ItemType">S0000000000000000000000000000001</source_id><related_id keyed_name="Part" type="ItemType">S0000000000000000000000000000002</related_id></Item>'
    Run-Import @{ name = 'n01-cache-hits'; note = 'items that repeat the same lookups: nested get (CheckGetItems), plain related_id (CheckRelatedItems), data_source list (CheckDataSourceReferences), RelationshipType source_id/related_id; every repeat is a cache hit'; packages = [ordered]@{ $A = @{ files = @($f1, $f2, $f3, $f4, $f5, $f6) } }; list = @($A); merge = $true; release = 'R1'; description = 'D1'; world = $w }
}
Def 'n02-miss-line-before-request' {
    $w = New-World; $w.packages = @(@{ name = $A }); Pad-Rule $w
    $w.rules += (Fault-On '<Item type="Part" action="get" select="id"><keyed_name>g</keyed_name></Item>' 5 'get refused')
    $f1 = F 'Part' 'p1' '<Item type="Part" id="P0000000000000000000000000000001" action="add"><name>n</name><Relationships><Item type="Part BOM" action="add"><related_id keyed_name="g" type="Part"><Item type="Part" action="get" select="id"><keyed_name>g</keyed_name></Item></related_id></Item></Relationships></Item>'
    Run-Import @{ name = 'n02-miss-line-before-request'; note = 'the nested get fails with fault 5: is "-> was obtained from server" logged?'; packages = [ordered]@{ $A = @{ files = @($f1) } }; list = @($A); merge = $true; release = 'R1'; description = 'D1'; world = $w }
    $w = New-World; $w.packages = @(@{ name = $A }); Pad-Rule $w
    $w.rules += (Fault-On '<Item action="get" type="list" select="id"><id>LID1</id></Item>' 5 'list refused')
    $f3 = F 'ItemType' 'it1' '<Item type="ItemType" id="I0000000000000000000000000000001" action="edit"><name>X</name><Relationships><Item type="Property" id="Y0000000000000000000000000000001" action="edit"><name>p</name><data_type>list</data_type><data_source keyed_name="LST" type="List">LID1</data_source></Item></Relationships></Item>'
    Run-Import @{ name = 'n02b-miss-line-datasource'; note = 'the data_source lookup fails with fault 5'; packages = [ordered]@{ $A = @{ files = @($f3) } }; list = @($A); merge = $true; release = 'R1'; description = 'D1'; world = $w }
}
Def 'n03-forced-refresh-not-stored' {
    $w = New-World; $w.packages = @(@{ name = $A }); $w.cnt.def = 0
    $w.rules += { param($req, $n)
        if ($req -like '<Item type="ItemType" action="get" select="id"><name>Part</name><Relationships><Item type="Property" action="get" select="name" />*') {
            $w.cnt.def = 1 + [int]$w.cnt.def
            if ($w.cnt.def -eq 1) { return (Res '<Item type="ItemType" id="IT-def"><Relationships><Item type="RelationshipType" id="RT9"><name>Other</name></Item></Relationships></Item>') }
            return (Res ('<Item type="ItemType" id="IT-def">' + $allRels + '</Item>'))
        }
        if ($req -like '<Item type="ItemType" action="get" select="id"><name>*</name><Relationships><Item type="Property" action="get" select="name" />*') { return (Res ('<Item type="ItemType" id="IT-def">' + $allRels + '</Item>')) }
        return $null }
    $mk = { param($n) F 'Part' ('p' + $n) ('<Item type="Part" id="P000000000000000000000000000000' + $n + '" action="add"><name>n' + $n + '</name><Relationships><Item type="Part BOM" action="add"><related_id keyed_name="k" type="Part">R000000000000000000000000000000' + $n + '</related_id></Item></Relationships></Item>') }
    Run-Import @{ name = 'n03-forced-refresh-not-stored'; note = 'the first definition of Part lacks the relationship type; later answers have it. Three Part items: how many definition requests?'; packages = [ordered]@{ $A = @{ files = @((& $mk 1), (& $mk 2), (& $mk 3)) } }; list = @($A); merge = $true; release = 'R1'; description = 'D1'; world = $w }
}
Def 'n04-discussion-template' {
    $w = New-World; $w.packages = @(@{ name = $A }); Pad-Rule $w
    $w.existing['T0000000000000000000000000000001'] = $true
    $mk = { param($n) F 'Discussion Forum' ('f' + $n) ('<Item type="Discussion Forum" id="F000000000000000000000000000000' + $n + '" action="add"><name>forum' + $n + '</name><Relationships><Item type="DiscussionTemplate" id="T0000000000000000000000000000001" action="add"><name>tpl</name><Relationships><Item type="FeedTemplate" id="G000000000000000000000000000000' + $n + '" action="add"><name>feed' + $n + '</name></Item></Relationships></Item></Relationships></Item>') }
    Run-Import @{ name = 'n04-discussion-template'; note = 'two forums carry a DiscussionTemplate relationship with the same id; the template exists, and each has a nested FeedTemplate'; packages = [ordered]@{ $A = @{ files = @((& $mk 1), (& $mk 2)) } }; list = @($A); merge = $true; release = 'R1'; description = 'D1'; world = $w }
    $w = New-World; $w.packages = @(@{ name = $A }); Pad-Rule $w
    $w.existing['T0000000000000000000000000000001'] = $true
    $mk2 = { param($n) F 'Discussion Forum' ('f' + $n) ('<Item type="Discussion Forum" id="F000000000000000000000000000000' + $n + '" action="add"><name>forum' + $n + '</name><Relationships><Item type="DiscussionTemplate" id="T0000000000000000000000000000001" action="add"><name>tpl</name></Item></Relationships></Item>') }
    $mk3 = { param($n) F 'Discussion Forum' ('f' + $n) ('<Item type="Discussion Forum" id="F000000000000000000000000000000' + $n + '" action="add"><name>forum' + $n + '</name><Relationships><Item type="DiscussionTemplate" id="T0000000000000000000000000000001" action="add"><name>tpl</name><Relationships><Item type="FeedTemplate" id="G000000000000000000000000000000' + $n + '" action="add"><name>feed' + $n + '</name></Item></Relationships></Item></Relationships></Item>') }
    Run-Import @{ name = 'n04b-discussion-template-childless-first'; note = 'the first forum has a childless template (the response stays cached); the second has nested children'; packages = [ordered]@{ $A = @{ files = @((& $mk2 1), (& $mk3 2)) } }; list = @($A); merge = $true; release = 'R1'; description = 'D1'; world = $w }
}
Def 'n05-delayed-dedupe' {
    $w = New-World; $w.packages = @(@{ name = $A }); Pad-Rule $w
    $rel = { param($id, $n) F 'Part' ('p' + $n) ('<Item type="Part" id="' + $id + '" action="add"><name>same</name><Relationships><Item type="Part BOM" action="add"><related_id keyed_name="k" type="Part">MISSING-PART</related_id></Item></Relationships></Item>') }
    Run-Import @{ name = 'n05-delayed-dedupe'; note = 'two files carry the same Part (same id) with the same missing related_id: the queue gets identical entries'; packages = [ordered]@{ $A = @{ files = @((& $rel 'P0000000000000000000000000000001' 1), (& $rel 'P0000000000000000000000000000001' 2)) } }; list = @($A); merge = $true; release = 'R1'; description = 'D1'; world = $w }
    $w = New-World; $w.packages = @(@{ name = $A }); Pad-Rule $w
    $w.rules += (Fault-On '<Item action="get" type="list" select="id"><id>LID1</id></Item>' 0 'No items of type list found.')
    $pw = F 'ItemType' 'itw' '<Item type="ItemType" id="I0000000000000000000000000000001" action="edit"><name>X</name><Relationships><Item type="Property" where="name=&apos;p1&apos; and source_id=&apos;I1&apos;" action="edit"><name>p1</name><data_type>list</data_type><data_source keyed_name="LST" type="List">LID1</data_source></Item></Relationships></Item>'
    $pi = F 'ItemType' 'iti' '<Item type="ItemType" id="I0000000000000000000000000000002" action="edit"><name>Y</name><Relationships><Item type="Property" id="Y0000000000000000000000000000002" action="edit"><name>p2</name><data_type>list</data_type><data_source keyed_name="LST" type="List">LID1</data_source></Item></Relationships></Item>'
    $pn = F 'ItemType' 'itn' '<Item type="ItemType" id="I0000000000000000000000000000003" action="edit"><name>Z</name><Relationships><Item type="Property" action="edit"><name>p3</name><data_type>list</data_type><data_source keyed_name="LST" type="List">LID1</data_source></Item></Relationships></Item>'
    Run-Import @{ name = 'n05b-property-where'; note = 'three Property edits with a missing list: one addressed by where, one by id, one by neither'; packages = [ordered]@{ $A = @{ files = @($pw, $pi, $pn) } }; list = @($A); merge = $true; release = 'R1'; description = 'D1'; world = $w }
}
Def 'n06-versionable-related-skip' {
    $w = New-World; $w.packages = @(@{ name = $A }); $w.versionable['Part'] = $true; Pad-Rule $w
    $w.rules += { param($req, $n) if ($req -like '*select="config_id, is_current"*') { return (Fault 0 'none') }; if ($req -like '*<config_id>*') { return (Fault 0 'none') }; return $null }
    $root = { param($rels) F 'Part' 'pv' ('<Item type="Part" id="P0000000000000000000000000000001" action="add"><name>pv</name><Relationships>' + $rels + '</Relationships></Item>') }
    $get = '<Item type="Part BOM" action="add"><source_id>P0000000000000000000000000000001</source_id><related_id keyed_name="x" type="Part"><Item type="Part" action="get" where="name=&apos;x&apos;"/></related_id></Item>'
    Run-Import @{ name = 'n06-related-item-get-no-id'; note = 'versionable root; a relationship whose related_id holds a get Item with a where and no id'; packages = [ordered]@{ $A = @{ files = @((& $root $get)) } }; list = @($A); merge = $true; release = 'R1'; description = 'D1'; world = $w }
    $w = New-World; $w.packages = @(@{ name = $A }); $w.versionable['Part'] = $true; Pad-Rule $w
    $w.rules += { param($req, $n) if ($req -like '*select="config_id, is_current"*') { return (Fault 0 'none') }; if ($req -like '*<config_id>*') { return (Fault 0 'none') }; return $null }
    $add = '<Item type="Part BOM" id="B0000000000000000000000000000001" action="add"><source_id>P0000000000000000000000000000001</source_id><related_id keyed_name="x" type="Part"><Item type="Part" action="add" where="name=&apos;x&apos;"><name>x</name></Item></related_id></Item>'
    Run-Import @{ name = 'n06b-related-item-add-where'; note = 'versionable root, merge off; the related_id Item has a where, no id, and action add'; packages = [ordered]@{ $A = @{ files = @((& $root $add)) } }; list = @($A); release = 'R1'; description = 'D1'; world = $w }
}
Def 'n07-log-progress' {
    $w = New-World; $w.packages = @(@{ name = $A })
    $files = @(); for ($i = 1; $i -le 30; $i++) { $files += (F 'List' ('L' + $i) (Item-Xml 'List' ('L{0:D31}' -f $i) 'add' ('LIBSJS-SCRATCH-L' + $i))) }
    $trace = New-Object System.Collections.ArrayList
    $hook = { param($req, $n, $lp)
        try { $fs = [System.IO.File]::Open($lp, 'Open', 'Read', 'ReadWrite'); $len = $fs.Length; $fs.Dispose() } catch { $len = -1 }
        [void]$trace.Add([string]$n + ':' + $len) }.GetNewClosure()
    Run-Import @{ name = 'n07-log-progress'; note = 'size of the log file (bytes) read from another handle at each request; 30 List adds'; packages = [ordered]@{ $A = @{ files = $files } }; list = @($A); release = 'R1'; description = 'D1'; world = $w; quiet = $true; onReq = $hook }
    W ('LOG-SIZE-AT-REQUEST: ' + ($trace -join ' '))
    W ''
}
Def 'n08-cancel-in-delayed' {
    $w = New-World; $w.packages = @(@{ name = $A }, @{ name = $B }); Pad-Rule $w
    $rel = { param($id, $n) F 'Part' ('p' + $n) ('<Item type="Part" id="' + $id + '" action="add"><name>same</name><Relationships><Item type="Part BOM" action="add"><related_id keyed_name="k" type="Part">MISSING-PART</related_id></Item></Relationships></Item>') }
    Run-Import @{ name = 'n08-cancel-in-delayed'; note = 'Cancel() is called while the delayed AML of A is being applied (after its last item); B is also listed'; packages = [ordered]@{ $A = @{ files = @((& $rel 'P0000000000000000000000000000001' 1)) }; $B = @{ files = @($l1) } }; list = @($A, $B); merge = $true; release = 'R1'; description = 'D1'; world = $w
        cancelOn = { param($req, $n) $req -like '<Item type="Part" id="P0000000000000000000000000000001" action="edit" doGetItem="0" version="0">*' } }
}
Def 'n09-caches-direct' {
    $w = New-World
    $node = New-Object System.Xml.XmlDocument; $node.LoadXml('<Item type="Part" id="P1" action="add"><item_number>N1</item_number></Item>')
    $calls = @(
        @{ label = 'GetCurrentIdByUniqueKey twice on one helper, the keyed-properties request answers fault 0'; run = { param($h) $w.rules = @({ param($r, $n) Fault 0 'none' }); $a = $h.GetCurrentIdByUniqueKey($node.DocumentElement, $true); $b = $h.GetCurrentIdByUniqueKey($node.DocumentElement, $true); '[' + $a + '][' + $b + ']' } },
        @{ label = 'GetCurrentIdByUniqueKey twice on one helper, the keyed-properties request answers fault 7'; run = { param($h) $w.rules = @({ param($r, $n) Fault 7 'bad' }); try { [void]$h.GetCurrentIdByUniqueKey($node.DocumentElement, $true) } catch { 'first: ' + $_.Exception.InnerException.Message.Substring(0, 30) }; try { [void]$h.GetCurrentIdByUniqueKey($node.DocumentElement, $true) } catch { 'second: ' + $_.Exception.InnerException.Message.Substring(0, 30) } } },
        @{ label = 'GetPackageGroupIdOrCreateIfNotExists twice on one helper, the add fails (fault 7)'; run = { param($h) $w.rules = @({ param($r, $n) if ($r -like '*action="add"*') { Fault 7 'bad' } else { Fault 0 'none' } }); try { [void]$h.GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') } catch { 'first: fault' }; try { [void]$h.GetPackageGroupIdOrCreateIfNotExists('PD1', 'G') } catch { 'second: fault' } } },
        @{ label = 'IsVersionable(Part) twice on one helper, the type is missing (fault 0)'; run = { param($h) $w.rules = @({ param($r, $n) Fault 0 'none' }); try { [void]$h.IsVersionable('Part') } catch { 'first: fault' }; try { [void]$h.IsVersionable('Part') } catch { 'second: fault' } } }
    )
    Run-Direct 'n09-caches-direct' 'what a failed lookup leaves in the helper cache' $w $calls
}
foreach ($k in $scenarios.Keys) { if ($Only -eq '' -or $k -like $Only) { & $scenarios[$k] } }
[System.IO.File]::WriteAllText($Out, $sb.ToString(), $utf8)
