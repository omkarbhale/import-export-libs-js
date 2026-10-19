<#
Export-modes probe (ticket 66). Windows PowerShell 5.1. It runs, offline, the two pieces of the engine builds that choose what an
export covers:

  - the engine's own ImportExportManager.GenerateHashtableFromManifest, against a scripted connection that answers the
    GetSolutions2Xml request from a document the scenario gives;
  - ConsoleUpgrade.exe's own ProcessExport (internal, driven by reflection), which builds the package -> items table in one of
    its three ways and then calls ExportSolutions. ProcessExport is handed ModesProbe.CapturingManager, which forwards everything
    to the engine's manager except ExportSolutions, so the loops run unchanged and the table they build is recorded instead of
    exported.

Every table is recorded in the order a .NET Hashtable enumerates it (the order the engine exports in). No server, user or
password is involved: the connection never touches a network. The result is one JSON document, which is the evidence
spec/export-modes.md cites and the fixture src/cli/console-modes.test.ts replays (fixtures/export-modes/).

-Bin is a staged, hash-checked copy of oracle/native/<engine> with the toolset's ConsoleUpgrade.exe copied in beside Libs.dll.
#>
param(
    [Parameter(Mandatory)][string] $Bin,
    [Parameter(Mandatory)][string] $Inputs,
    [Parameter(Mandatory)][string] $Blob,
    [Parameter(Mandatory)][string] $Work,
    [Parameter(Mandatory)][string] $Out,
    [Parameter(Mandatory)][string] $ProbeDir,
    [Parameter(Mandatory)][ValidateSet('12.0', '14.0.7', '14.35')][string] $Engine,
    [Parameter(Mandatory)][string] $ConsoleSha256
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$iomPath = Join-Path $Bin 'IOM.dll'
$libsPath = Join-Path $Bin 'Libs.dll'
$consolePath = Join-Path $Bin 'ConsoleUpgrade.exe'
$consoleActual = (Get-FileHash -Algorithm SHA256 -LiteralPath $consolePath).Hash.ToLowerInvariant()
if ($consoleActual -ne $ConsoleSha256) { throw "ConsoleUpgrade.exe sha256 $consoleActual is not the pinned $ConsoleSha256" }
[void][Reflection.Assembly]::LoadFrom($iomPath)
$libs = [Reflection.Assembly]::LoadFrom($libsPath)
$console = [Reflection.Assembly]::LoadFrom($consolePath)
$expectedVersion = @{ '12.0' = '12.0.0.13341'; '14.0.7' = '14.0.7.35492'; '14.35' = '14.35.0.43890' }[$Engine]
if ($libs.GetName().Version.ToString() -ne $expectedVersion) { throw "Libs.dll is $($libs.GetName().Version), not $expectedVersion" }
$refs = @($iomPath, $libsPath, 'System.Xml', 'System.Core')
$stubSource = Get-Content -Raw -LiteralPath (Join-Path $ProbeDir 'Stub.cs')
Add-Type -TypeDefinition $stubSource -ReferencedAssemblies $refs
$cp = New-Object System.CodeDom.Compiler.CompilerParameters
foreach ($r in $refs) { if ($r -notmatch '[\\/]' -and $r -notmatch '\.dll$') { $r = $r + '.dll' }; [void]$cp.ReferencedAssemblies.Add($r) }
if ($Engine -eq '14.35') { $cp.CompilerOptions = '/define:V1435' }
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $ProbeDir 'Probe.cs')) -CompilerParameters $cp

$T = 'Aras.Tools.SolutionUpgrade.'
$bf = [Reflection.BindingFlags]'Public,NonPublic,Instance,Static'
$utf8 = New-Object Text.UTF8Encoding($false)
$results = [ordered]@{
    engine = $Engine
    assemblyVersion = $libs.GetName().Version.ToString()
    libsMvid = $libs.ManifestModule.ModuleVersionId.ToString()
    consoleMvid = $console.ManifestModule.ModuleVersionId.ToString()
    consoleSha256 = $consoleActual
    solutionSets = [ordered]@{}
    scenarios = [ordered]@{}
}

function Unwrap($ex) {
    while (($ex -is [Management.Automation.MethodInvocationException] -or $ex -is [Reflection.TargetInvocationException]) -and $ex.InnerException) { $ex = $ex.InnerException }
    return $ex
}
function Scrub([string] $text, [string[]] $roots) {
    if ($null -eq $text) { return $null }
    foreach ($root in $roots) { if ($root) { $text = $text.Replace($root, '<DIR>') } }
    # every other local path the engine names: the work folder the scenarios live in, and the inputs folder
    $text = $text.Replace($Work.TrimEnd('\'), '<WORK>').Replace($Inputs.TrimEnd('\'), '<INPUTS>').Replace($Bin.TrimEnd('\'), '<BIN>')
    if ($text -match '(?i)\\Users\\') { throw "a local user path is left in: $text" }
    return $text
}
function Describe-Error($ex, [string[]] $roots) {
    $e = Unwrap $ex
    $message = $e.Message
    if ($message.Length -gt 600) { $message = $message.Substring(0, 600) }
    return [ordered]@{ type = $e.GetType().FullName; message = (Scrub $message $roots) }
}
function Sha256Hex([string] $text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($text))) -replace '-', '').ToLowerInvariant()
}
# The table as recorded: packages in enumeration order. Small tables list every item; for a large one each package keeps its count
# and the sha256 of its items' lines, which is as exact and keeps the fixture small.
function Describe-Table($packages) {
    if ($null -eq $packages) { return $null }
    $total = 0
    foreach ($p in $packages) { $total += $p.Items.Count }
    $full = $total -le 400
    $list = New-Object System.Collections.ArrayList
    foreach ($p in $packages) {
        $lines = New-Object System.Collections.ArrayList
        foreach ($i in $p.Items) { [void]$lines.Add(($i.Key + '|' + $i.IdName + '|' + $i.TypeName + '|' + $i.KeyedName)) }
        $entry = [ordered]@{ name = $p.Name; count = $p.Items.Count; digest = (Sha256Hex ($lines -join "`n")) }
        if ($full) { $entry.items = @($lines | ForEach-Object { $_ }) }
        [void]$list.Add($entry)
    }
    return , @($list)
}

# ---- documents the scenarios use -----------------------------------------------------------------------------------------------
function Esc-Xml([string] $s) { return [Security.SecurityElement]::Escape($s) }
function El([string] $type, [string] $id, [string] $name) {
    return '<Item type="PackageElement"><element_id>' + (Esc-Xml $id) + '</element_id><element_type>' + (Esc-Xml $type) + '</element_type><name>' + (Esc-Xml $name) + '</name></Item>'
}
function Pd([string] $name, [string[]] $elements, [string[]] $groups = @()) {
    $inner = ''
    if ($groups.Count -gt 0) { foreach ($g in $groups) { $inner += $g } }
    elseif ($elements.Count -gt 0) { $inner = '<Item type="PackageGroup"><name>g</name><Relationships>' + ($elements -join '') + '</Relationships></Item>' }
    $rel = ''; if ($inner) { $rel = '<Relationships>' + $inner + '</Relationships>' }
    return '<Item type="PackageDefinition" id="PD-' + (Esc-Xml $name) + '"><name>' + (Esc-Xml $name) + '</name><generation>1</generation>' + $rel + '</Item>'
}
function Pg([string[]] $elements) { return '<Item type="PackageGroup"><name>g</name><Relationships>' + ($elements -join '') + '</Relationships></Item>' }
function Manifest-Xml([string[]] $names) {
    $p = ($names | ForEach-Object { '<package name="' + (Esc-Xml $_) + '" path=".\"/>' }) -join ''
    return '<imports>' + $p + '</imports>'
}
function Many([string] $prefix, [int] $n) { $a = @(); for ($i = 1; $i -le $n; $i++) { $a += (El 'List' ('{0}{1:D3}' -f $prefix, $i) ('{0} item {1}' -f $prefix, $i)) }; return $a }

$blobText = [IO.File]::ReadAllText($Blob)
$blobInner = [regex]::Match($blobText, '<Result>(.*)</Result>', 'Singleline').Groups[1].Value
$blobDoc = New-Object Xml.XmlDocument
$blobDoc.LoadXml($blobText)
$blobPackages = @($blobDoc.SelectNodes("//Item[@type='PackageDefinition']/name") | ForEach-Object { $_.InnerText })


# The answer to the package-definition request, as a name: the recorded dev answer is "blob" (fixtures/14.0.7/export/_blobs), every
# other document is kept once in solutionSets, so a scenario's input is in the fixture.
function Reg-Solutions($xml) {
    if ($null -eq $xml) { return $null }
    if ($xml -eq $blobInner) { return 'blob' }
    $key = (Sha256Hex $xml).Substring(0, 12)
    $script:results.solutionSets[$key] = $xml
    return $key
}

# ---- a run ---------------------------------------------------------------------------------------------------------------------
# $solutions: the inner XML of the GetSolutions2Xml answer, or $null for "no package definitions" (faultcode 0).
function New-Engine([string] $dir, $solutions, [string] $manifestPath, [bool] $useImport = $false) {
    $conn = New-Object Probe.ScriptedConnection
    # PowerShell turns a $null into "" for a string member; [NullString] keeps the null that means "no package definitions"
    $conn.SolutionsXml = $(if ($null -eq $solutions) { [NullString]::Value } else { $solutions })
    $helper = New-Object ($libs.GetType($T + 'CItemHelper')) -ArgumentList @($conn)
    $ctx = New-Object ($libs.GetType($T + 'SolutionUpgradeContext'))
    $ctx.Action = [Enum]::ToObject($libs.GetType($T + 'ImportExport'), 1)
    $ctx.WorkingDirectory = Join-Path $dir 'out'
    $ctx.LogFilePath = Join-Path $dir 'engine.log'
    $ctx.ManifestFile = $manifestPath
    $ctx.Url = 'http://stub/'; $ctx.DataBase = 'db'; $ctx.UserName = 'u'
    $msgs = New-Object Probe.ProbeMessages
    $exportCtx = New-Object ($libs.GetType($T + 'SUExportContext'))
    $exportCtx.sLevel = '1'
    $exportCtx.UseImport = $useImport
    $manager = $null; $ctorError = $null
    try { $manager = New-Object ($libs.GetType($T + 'ImportExportManager')) -ArgumentList @($ctx, $msgs, $helper) }
    catch { $ctorError = Describe-Error $_.Exception @($dir) }
    return @{ conn = $conn; ctx = $ctx; msgs = $msgs; exportCtx = $exportCtx; manager = $manager; ctorError = $ctorError }
}
function Message-Log($msgs, [string[]] $roots) {
    return , @($msgs.Log | ForEach-Object { $f = $_.Split('|', 4); [ordered]@{ channel = $f[2]; text = (Scrub $f[3] $roots) } })
}
function New-Dir([string] $name) {
    $dir = Join-Path $Work $name
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    New-Item -ItemType Directory -Path $dir | Out-Null
    return $dir
}

# GenerateHashtableFromManifest(path) on the real manager.
function Run-Generate([string] $name, $solutions, $manifestText, $pathOverride = $null, [bool] $manifestAsDirectory = $false) {
    $dir = New-Dir $name
    $manifestPath = Join-Path $dir 'imports.mf'
    if ($manifestAsDirectory) { New-Item -ItemType Directory -Path $manifestPath | Out-Null }
    elseif ($null -ne $manifestText) { [IO.File]::WriteAllText($manifestPath, $manifestText, $utf8) }
    $path = $manifestPath
    if ($PSBoundParameters.ContainsKey('pathOverride')) { $path = $pathOverride }
    $run = New-Engine $dir $solutions $null
    $record = [ordered]@{ kind = 'generate' }
    $manifestInput = if ($manifestAsDirectory) { [ordered]@{ directory = $true } } elseif ($null -eq $manifestText) { [ordered]@{ absent = $true } } else { [ordered]@{ text = $manifestText } }
    $pathInput = if ($PSBoundParameters.ContainsKey('pathOverride')) { [ordered]@{ raw = $pathOverride } } else { [ordered]@{ manifest = $true } }
    $record.input = [ordered]@{ solutions = (Reg-Solutions $solutions); manifest = $manifestInput; path = $pathInput }
    $roots = @($dir)
    try {
        $table = $run.manager.GenerateHashtableFromManifest($path)
        $record.returned = if ($null -eq $table) { 'null' } else { 'table' }
        if ($null -ne $table) { $record.table = Describe-Table ([ModesProbe.CapturingManager]::Snapshot($table)) }
    } catch { $record.thrown = Describe-Error $_.Exception $roots }
    $record.requests = @($run.conn.Requests).Count
    if ($env:PROBE_DEBUG) { $record.debugResponses = @($run.conn.Responses | ForEach-Object { $_.Substring(0, [Math]::Min(300, $_.Length)) }) }
    $record.messages = Message-Log $run.msgs $roots
    $script:results.scenarios[$name] = $record
}

# ConsoleUpgrade.ProcessExport on the real manager behind the capturing wrapper.
$cuType = $console.GetType('Aras.Tools.SolutionUpgrade.ConsoleUpgrade.ConsoleUpgrade')
function Set-CuField($cu, [string] $field, $value) {
    $f = $cuType.GetField($field, $bf)
    if ($null -ne $f) { $f.SetValue($cu, $(if ($null -ne $value) { $value.psobject.BaseObject } else { $null })) }
}
function Run-Console([string] $name, $solutions, [string] $manifestPath, [bool] $useImport, [string] $inputRoot = '') {
    $dir = New-Dir $name
    $run = New-Engine $dir $solutions $manifestPath $useImport
    $roots = @($dir); if ($inputRoot) { $roots = @($inputRoot, $dir) }
    $record = [ordered]@{ kind = 'console'; useImport = $useImport }
    $manifestInput = $null
    if ($manifestPath -eq '') { $manifestInput = 'empty' }
    elseif (-not (Test-Path -LiteralPath $manifestPath)) { $manifestInput = [ordered]@{ absent = (Split-Path $manifestPath -Leaf) } }
    else {
        $mdir = Split-Path $manifestPath
        if ($mdir.StartsWith($Inputs, [StringComparison]::OrdinalIgnoreCase)) {
            $manifestInput = [ordered]@{ fixtureInput = $mdir.Substring($Inputs.TrimEnd('\').Length + 1).Replace('\', '/'); name = (Split-Path $manifestPath -Leaf) }
        } else {
            $files = [ordered]@{}
            Get-ChildItem -Recurse -File -LiteralPath $mdir | Sort-Object FullName | ForEach-Object { $files[$_.FullName.Substring($mdir.TrimEnd('\').Length + 1).Replace('\', '/')] = [IO.File]::ReadAllText($_.FullName) }
            $manifestInput = [ordered]@{ files = $files; name = (Split-Path $manifestPath -Leaf) }
        }
    }
    $record.input = [ordered]@{ solutions = (Reg-Solutions $solutions); manifest = $manifestInput }
    if ($null -ne $run.ctorError) {
        # ConsoleUpgrade.Main builds the manager before ProcessExport, and its constructor loads the manifest the context names
        $record.constructorThrown = $run.ctorError
        $script:results.scenarios[$name] = $record
        return
    }
    try {
        $wrapper = New-Object ModesProbe.CapturingManager -ArgumentList @($run.manager.psobject.BaseObject)
        $cu = [Activator]::CreateInstance($cuType, $true)
        Set-CuField $cu 'Context' $run.ctx
        Set-CuField $cu '_exportContext' $run.exportCtx
        Set-CuField $cu 'ImportExportManager' $wrapper
        if ($null -ne $cuType.GetField('iOWrapper', $bf)) { Set-CuField $cu 'iOWrapper' (New-Object ($libs.GetType($T + 'IOWrapper'))) }
        try { [void]$cuType.GetMethod('ProcessExport', $bf).Invoke($cu, [object[]]@($wrapper.psobject.BaseObject)) }
        catch { $record.thrown = Describe-Error $_.Exception $roots }
        $record.exportCalls = $wrapper.ExportCalls
        $record.generateCalls = $wrapper.GenerateCalls
        $record.solutionsCalls = $wrapper.SolutionsCalls
        if ($wrapper.ExportCalls -gt 0) {
            $record.table = Describe-Table $wrapper.Table
            $record.useImportInContext = $wrapper.Context.UseImport
        }
    } catch { $record.setupFailed = Describe-Error $_.Exception $roots }
    $record.requests = @($run.conn.Requests).Count
    if (Test-Path $run.ctx.LogFilePath) {
        $record.log = Scrub ([IO.File]::ReadAllText($run.ctx.LogFilePath)) $roots
    }
    $record.messages = Message-Log $run.msgs $roots
    $script:results.scenarios[$name] = $record
}

# ================================ GenerateHashtableFromManifest ================================
$six = 1..6 | ForEach-Object { Pd "pkg.p$_" (Many "P$_" 5) }
$sixXml = $six -join ''

Run-Generate 'gm-no-file' $sixXml $null
Run-Generate 'gm-path-is-directory' $sixXml $null -manifestAsDirectory $true
Run-Generate 'gm-path-empty' $sixXml $null -pathOverride ''
Run-Generate 'gm-path-null' $sixXml $null -pathOverride $null
Run-Generate 'gm-path-illegal-character' $sixXml $null -pathOverride 'C:\no|such\imports.mf'
Run-Generate 'gm-subset-out-of-document-order' $sixXml (Manifest-Xml @('pkg.p5', 'pkg.p2', 'pkg.p3'))
Run-Generate 'gm-none-selected' $sixXml (Manifest-Xml @('pkg.other'))
Run-Generate 'gm-empty-manifest' $sixXml '<imports/>'
Run-Generate 'gm-all-selected-grown-tables' ((1..6 | ForEach-Object { Pd "pkg.g$_" (Many "G$_" (7 * $_)) }) -join '') (Manifest-Xml @(1..6 | ForEach-Object { "pkg.g$_" }))
Run-Generate 'gm-real-three-packages' $blobInner (Manifest-Xml @('com.aras.innovator.core', 'com.aras.innovator.admin', 'com.aras.innovator.cui'))
Run-Generate 'gm-real-reverse-manifest-order' $blobInner (Manifest-Xml @($blobPackages | Sort-Object -Descending | Select-Object -First 12))
Run-Generate 'gm-not-xml' $sixXml 'this is not xml'
Run-Generate 'gm-empty-file' $sixXml ''
Run-Generate 'gm-no-package-definitions' $null (Manifest-Xml @('pkg.p1'))
Run-Generate 'gm-name-with-quote' ((Pd "it's" (Many 'Q' 2)) + (Pd 'pkg.p1' (Many 'P' 2))) (Manifest-Xml @('pkg.p1'))
Run-Generate 'gm-quote-name-not-selected-still-fails' ((Pd 'pkg.p1' (Many 'P' 2)) + (Pd "o'k" (Many 'Q' 2))) (Manifest-Xml @('pkg.p1'))
Run-Generate 'gm-name-with-ampersand' ((Pd 'a&b' (Many 'A' 2)) + (Pd 'pkg.p1' (Many 'P' 2))) (Manifest-Xml @('a&b'))
Run-Generate 'gm-name-with-double-quote' ((Pd 'say "hi"' (Many 'A' 2)) + (Pd 'pkg.p1' (Many 'P' 2))) (Manifest-Xml @('say "hi"'))
Run-Generate 'gm-name-with-surrounding-space' ((Pd ' padded ' (Many 'A' 2)) + (Pd 'pkg.p1' (Many 'P' 2))) (Manifest-Xml @(' padded ', 'pkg.p1'))
Run-Generate 'gm-name-empty' ((Pd '' (Many 'E' 2)) + (Pd 'pkg.p1' (Many 'P' 2))) '<imports><package name="" path=".\"/></imports>'
Run-Generate 'gm-manifest-name-case-differs' $sixXml (Manifest-Xml @('PKG.P2'))
Run-Generate 'gm-nested-package-element' $sixXml '<imports><sub><package name="pkg.p4" path=".\"/></sub></imports>'
Run-Generate 'gm-duplicate-package-definition' ((Pd 'pkg.p1' (Many 'A' 2)) + (Pd 'pkg.p2' (Many 'B' 2)) + (Pd 'pkg.p1' (Many 'C' 2))) (Manifest-Xml @('pkg.p2'))
Run-Generate 'gm-duplicate-definition-selected' ((Pd 'pkg.p1' (Many 'A' 2)) + (Pd 'pkg.p1' (Many 'C' 2))) (Manifest-Xml @('pkg.p1'))
Run-Generate 'gm-duplicate-element-id' (Pd 'pkg.p1' @((El 'List' 'DUP1' 'first'), (El 'Form' 'X1' 'x'), (El 'Method' 'DUP1' 'second'))) (Manifest-Xml @('pkg.p1'))
Run-Generate 'gm-duplicate-element-id-package-not-selected' ((Pd 'pkg.p1' @((El 'List' 'DUP1' 'first'), (El 'Method' 'DUP1' 'second'))) + (Pd 'pkg.p2' (Many 'B' 2))) (Manifest-Xml @('pkg.p2'))
Run-Generate 'gm-duplicate-element-id-across-groups' (Pd 'pkg.p1' @() @((Pg @((El 'List' 'DUP1' 'a'))), (Pg @((El 'Form' 'DUP1' 'b'))))) (Manifest-Xml @('pkg.p1'))
Run-Generate 'gm-elements-in-two-groups' (Pd 'pkg.p1' @() @((Pg @((El 'List' 'ID-B' 'b'), (El 'List' 'ID-A' 'a'))), (Pg @((El 'Form' 'ID-C' 'c'))))) (Manifest-Xml @('pkg.p1'))
Run-Generate 'gm-element-without-name' (Pd 'pkg.p1' @('<Item type="PackageElement"><element_id>E1</element_id><element_type>List</element_type></Item>')) (Manifest-Xml @('pkg.p1'))
Run-Generate 'gm-element-without-id' (Pd 'pkg.p1' @('<Item type="PackageElement"><element_type>List</element_type><name>n</name></Item>')) (Manifest-Xml @('pkg.p1'))
Run-Generate 'gm-element-without-type' (Pd 'pkg.p1' @('<Item type="PackageElement"><element_id>E1</element_id><name>n</name></Item>')) (Manifest-Xml @('pkg.p1'))
Run-Generate 'gm-element-empty-values' (Pd 'pkg.p1' @('<Item type="PackageElement"><element_id/><element_type/><name/></Item>')) (Manifest-Xml @('pkg.p1'))
Run-Generate 'gm-element-not-selected-bad-element' ((Pd 'pkg.p1' @('<Item type="PackageElement"><element_type>List</element_type></Item>')) + (Pd 'pkg.p2' (Many 'B' 2))) (Manifest-Xml @('pkg.p2'))
Run-Generate 'gm-package-without-groups' ((Pd 'pkg.p1' @()) + (Pd 'pkg.p2' (Many 'B' 2))) (Manifest-Xml @('pkg.p1', 'pkg.p2'))
Run-Generate 'gm-element-name-needs-escaping' (Pd 'pkg.p1' @((El 'List' 'E1' 'a < b & "c"'))) (Manifest-Xml @('pkg.p1'))

# ================================ ProcessExport: the all-packages loop and from-manifest ================================
$noManifest = Join-Path $Work 'no-such-manifest.mf'
Run-Console 'ca-small-all-packages' $sixXml $noManifest $false
Run-Console 'ca-empty-manifest-path' $sixXml '' $false
Run-Console 'ca-real-all-packages' $blobInner $noManifest $false
Run-Console 'ca-no-package-definitions' $null $noManifest $false
Run-Console 'ca-name-with-quote' ((Pd "it's" (Many 'Q' 2)) + (Pd 'pkg.p1' (Many 'P' 2))) $noManifest $false
Run-Console 'ca-duplicate-package-definition' ((Pd 'pkg.p1' (Many 'A' 2)) + (Pd 'pkg.p1' (Many 'C' 2))) $noManifest $false
Run-Console 'ca-duplicate-element-id' (Pd 'pkg.p1' @((El 'List' 'DUP1' 'first'), (El 'Method' 'DUP1' 'second'))) $noManifest $false
Run-Console 'ca-element-without-name' (Pd 'pkg.p1' @('<Item type="PackageElement"><element_id>E1</element_id><element_type>List</element_type></Item>')) $noManifest $false
Run-Console 'ca-elements-in-two-groups' (Pd 'pkg.p1' @() @((Pg @((El 'List' 'ID-B' 'b'), (El 'List' 'ID-A' 'a'))), (Pg @((El 'Form' 'ID-C' 'c'))))) $noManifest $false
Run-Console 'ca-grown-tables' ((1..6 | ForEach-Object { Pd "pkg.g$_" (Many "G$_" (7 * $_)) }) -join '') $noManifest $false

$cfDir = New-Dir 'cf-manifests'
$cfThree = Join-Path $cfDir 'three.mf'
[IO.File]::WriteAllText($cfThree, (Manifest-Xml @('com.aras.innovator.core', 'com.aras.innovator.admin', 'com.aras.innovator.cui')), $utf8)
$cfBad = Join-Path $cfDir 'bad.mf'
[IO.File]::WriteAllText($cfBad, 'not xml', $utf8)
Run-Console 'cf-real-three-packages' $blobInner $cfThree $false -inputRoot $cfDir
Run-Console 'cf-small-subset' $sixXml $cfThree $false -inputRoot $cfDir
Run-Console 'cf-bad-manifest' $sixXml $cfBad $false -inputRoot $cfDir

# ================================ ProcessExport: --use-import over the recorded import input folders ================================
$inputDirs = Get-ChildItem -Directory -Recurse -LiteralPath $Inputs | Where-Object { $_.Name -eq 'input' } | Sort-Object FullName
foreach ($d in $inputDirs) {
    $rel = $d.FullName.Substring($Inputs.TrimEnd('\').Length + 1).Replace('\', '/')
    $mf = Join-Path $d.FullName 'imports.mf'
    Run-Console ('ui-' + ($rel -replace '[\\/]', '--')) $sixXml $mf $true -inputRoot $d.FullName
}

# Package folders of the use-import loop's own: conflicts, non-add actions, non-importable types, missing attributes.
$uiRoot = New-Dir 'ui-own'
function Write-Item-File([string] $path, [string] $aml) { New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null; [IO.File]::WriteAllText($path, $aml, $utf8) }
$pk = Join-Path $uiRoot 'own\Import'
Write-Item-File (Join-Path $pk 'List\one.xml') '<AML><Item type="List" id="L1" action="add"><name>one</name></Item><Item type="List" id="L1" action="add"><name>one again</name></Item><Item type="List" id="L2" action="edit"><name>edited</name></Item><Item type="List" id="L3" action="merge"><name>merged</name></Item><Item type="List" action="add"><name>no id</name></Item><Item type="List" action="add"><name>no id again</name></Item></AML>'
Write-Item-File (Join-Path $pk 'Member\m.xml') '<AML><Item type="Member" id="M1" action="add"><name>m</name></Item><Item type="Member" id="M1" action="add"><name>m again</name></Item><Item type="Server Event" id="S1" action="add"/><Item type="Form" id="L1" action="add"><name>same id other type</name></Item></AML>'
Write-Item-File (Join-Path $pk 'Empty\e.xml') '<AML><Other/></AML>'
Write-Item-File (Join-Path $pk 'Nested\n.xml') '<AML><Item type="ItemType" id="N1" action="add"><name>n</name><Relationships><Item type="Property" id="N2" action="add"><name>p</name></Item></Relationships></Item><Item id="N3" action="add"/></AML>'
[IO.File]::WriteAllText((Join-Path $uiRoot 'own\imports.mf'), '<imports><package name="own" path="Import"/></imports>', $utf8)
Run-Console 'ui-own-conflicts-and-filters' $sixXml (Join-Path $uiRoot 'own\imports.mf') $true -inputRoot (Join-Path $uiRoot 'own')

$uiDup = New-Dir 'ui-dup'
[IO.File]::WriteAllText((Join-Path $uiDup 'imports.mf'), '<imports><package name="own" path="Import"/><package name="own" path="Import"/></imports>', $utf8)
Write-Item-File (Join-Path $uiDup 'Import\List\one.xml') '<AML><Item type="List" id="L1" action="add"><name>one</name></Item></AML>'
Run-Console 'ui-duplicate-package-in-manifest' $sixXml (Join-Path $uiDup 'imports.mf') $true -inputRoot $uiDup

$uiMissing = New-Dir 'ui-missing'
[IO.File]::WriteAllText((Join-Path $uiMissing 'imports.mf'), '<imports><package name="gone" path="NoSuchFolder"/></imports>', $utf8)
Run-Console 'ui-missing-package-folder' $sixXml (Join-Path $uiMissing 'imports.mf') $true -inputRoot $uiMissing
Run-Console 'ui-missing-manifest' $sixXml (Join-Path $uiMissing 'absent.mf') $true -inputRoot $uiMissing
$uiNoPath = New-Dir 'ui-no-path'
[IO.File]::WriteAllText((Join-Path $uiNoPath 'imports.mf'), '<imports><package name="nopath"/></imports>', $utf8)
Run-Console 'ui-package-without-path-attribute' $sixXml (Join-Path $uiNoPath 'imports.mf') $true -inputRoot $uiNoPath
$uiEmpty = New-Dir 'ui-empty'
[IO.File]::WriteAllText((Join-Path $uiEmpty 'imports.mf'), '<imports/>', $utf8)
Run-Console 'ui-manifest-without-packages' $sixXml (Join-Path $uiEmpty 'imports.mf') $true -inputRoot $uiEmpty

# Six packages with enough items to make both levels reorder: the enumeration order is not the insertion order.
$uiOrder = New-Dir 'ui-order'
$names = @('com.x.alpha', 'com.x.bravo', 'com.x.charlie', 'com.x.delta', 'com.x.echo', 'com.x.foxtrot')
$mfText = '<imports>' + (($names | ForEach-Object { '<package name="' + $_ + '" path="' + $_.Split('.')[-1] + '"/>' }) -join '') + '</imports>'
[IO.File]::WriteAllText((Join-Path $uiOrder 'imports.mf'), $mfText, $utf8)
$k = 0
foreach ($n in $names) {
    $short = $n.Split('.')[-1]
    for ($f = 1; $f -le 2; $f++) {
        $items = ''
        for ($i = 1; $i -le 9; $i++) { $k++; $items += ('<Item type="List" id="{0:X32}" action="add"><name>n{1}</name></Item>' -f ($k * 7919), $k) }
        Write-Item-File (Join-Path $uiOrder "$short\List\f$f.xml") "<AML>$items</AML>"
    }
}
Run-Console 'ui-order-six-packages' $sixXml (Join-Path $uiOrder 'imports.mf') $true -inputRoot $uiOrder

$json = $results | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText($Out, $json, $utf8)
"scenarios: $($results.scenarios.Count)"
