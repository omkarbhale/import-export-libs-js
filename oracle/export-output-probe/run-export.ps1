# Probes engine 14.35's ExportSolutions offline: the parallel item loop, the abort on the first
# failure, the progress logger, the null-packages exception and the output layout
# (spec/export-run.md and spec/export-write.md, the [14.35] variants).
# Windows PowerShell 5.1. -Bin is a staged copy of oracle/native/14.35 (see README.md). No server,
# no credential: every request is answered by Stub.cs's ScriptedConnection.
param([Parameter(Mandatory)][string] $Bin, [Parameter(Mandatory)][string] $Work, [string[]] $Only = @())
$ErrorActionPreference = 'Stop'
[void][Reflection.Assembly]::LoadFrom((Join-Path $Bin 'IOM.dll'))
$libs = [Reflection.Assembly]::LoadFrom((Join-Path $Bin 'Libs.dll'))
$ver = $libs.GetName().Version.ToString()
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'Stub.cs')) -ReferencedAssemblies @((Join-Path $Bin 'IOM.dll'), (Join-Path $Bin 'Libs.dll'), 'System.Xml', 'System.Core')
$T = 'Aras.Tools.SolutionUpgrade.'
$flags = [Reflection.BindingFlags]'Public,NonPublic,Instance,Static'
"# engine $ver, $([Environment]::ProcessorCount) logical processors, CLR $([Environment]::Version)"

function Esc([string]$s) { if ($null -eq $s) { return '<null>' }; $sb = New-Object Text.StringBuilder; foreach ($c in $s.ToCharArray()) { $n = [int]$c; if ($c -eq "`r") { [void]$sb.Append('\r') } elseif ($c -eq "`n") { [void]$sb.Append('\n') } elseif ($c -eq "`t") { [void]$sb.Append('\t') } elseif ($n -lt 32 -or $n -gt 126) { [void]$sb.Append(('\u{0:X4}' -f $n)) } else { [void]$sb.Append($c) } }; $sb.ToString() }
function Unwrap($ex) { while (($ex -is [System.Management.Automation.MethodInvocationException] -or $ex -is [Reflection.TargetInvocationException]) -and $ex.InnerException) { $ex = $ex.InnerException }; $ex }
function Norm([string]$s, [string]$wd) { $s = $s.Replace($wd, '<WD>'); $s = [regex]::Replace($s, '\d\d/\d\d/\d{4} \d\d:\d\d:\d\d', '<T>'); $s }

# $pkgs: ordered hashtable of package name -> array of @(id, type) ; each item's keyed name is "k-<id>".
function Run-Export {
    param([string] $Name, $Pkgs, [scriptblock] $Setup = {}, [bool] $Referenced = $false, [bool] $Answer = $true, [string] $UnknownRefs = 'DoNotRemove', [string] $CancelOn = '', [bool] $NullSolutions = $false, $Deps = @{}, $Elements = @(), [string[]] $Show = @(), [string] $WdSuffix = '')
    if ($Only.Count -gt 0 -and -not @($Only | Where-Object { $Name -like $_ })) { return }
    "## $Name"
    $wd = Join-Path $Work $Name
    if (Test-Path $wd) { Remove-Item -Recurse -Force $wd }
    New-Item -ItemType Directory -Path $wd | Out-Null
    $conn = New-Object Probe.ScriptedConnection
    # solutions: one PackageDefinition per package, empty unless the scenario says otherwise
    if (-not $NullSolutions) {
        $sol = ''
        $first = @($Pkgs.Keys)[0]
        foreach ($p in $Pkgs.Keys) {
            $inner = ''
            if ($Elements.Count -gt 0 -and $p -eq $first) {
                $pe = ''; foreach ($e in $Elements) { $pe += '<Item type="PackageElement"><element_type>' + $e[0] + '</element_type><element_id>' + $e[1] + '</element_id><name>x</name></Item>' }
                $inner += '<Item type="PackageGroup"><name>g</name><Relationships>' + $pe + '</Relationships></Item>'
            }
            if ($Deps.ContainsKey($p)) { $inner += '<Item type="PackageDependsOn" id="DEP-' + $p + '"><name>' + $Deps[$p] + '</name></Item>' }
            $rel = ''; if ($inner) { $rel = '<Relationships>' + $inner + '</Relationships>' }
            $sol += '<Item type="PackageDefinition" id="PD-' + $p + '"><name>' + $p + '</name><generation>1</generation>' + $rel + '</Item>'
        }
        $conn.SolutionsXml = $sol
    }
    & $Setup $conn
    $helper = New-Object ($libs.GetType($T + 'CItemHelper')) -ArgumentList @($conn)
    $helper.GetType().GetProperty('InnovatorVersion').GetSetMethod($true).Invoke($helper, [object[]]@((New-Object ($libs.GetType($T + 'ArasVersion')) -ArgumentList @(14, 0, 0, 1, 7)).psobject.BaseObject)) | Out-Null
    $ctx = New-Object ($libs.GetType($T + 'SolutionUpgradeContext'))
    $ctx.Action = [Enum]::ToObject($libs.GetType($T + 'ImportExport'), 1)
    $ctx.WorkingDirectory = $wd + $WdSuffix
    $ctx.LogFilePath = Join-Path $wd 'engine.log'
    $ctx.Url = 'http://stub/'; $ctx.DataBase = 'db'; $ctx.UserName = 'u'
    $msgs = New-Object Probe.ProbeMessages
    $msgs.QuestionAnswer = $Answer
    $mgr = New-Object ($libs.GetType($T + 'ImportExportManager')) -ArgumentList @($ctx, $msgs, $helper)
    if ($CancelOn) { $msgs.Manager = $mgr; $msgs.CancelWhenStatusContains = $CancelOn }
    $ec = New-Object ($libs.GetType($T + 'SUExportContext'))
    $ec.sLevel = '1'
    $ec.RefToUnknownPacks = [Enum]::Parse($libs.GetType($T + 'ReferencesToUnknownPackages'), $UnknownRefs)
    $ec.bExportReferencedItems = $Referenced
    $sel = New-Object System.Collections.Hashtable
    foreach ($p in $Pkgs.Keys) {
        $inner = New-Object System.Collections.Hashtable
        foreach ($it in $Pkgs[$p]) { $kn = if ($it.Count -gt 2) { $it[2] } else { 'k-' + $it[0] }; $inner.Add($it[0], (New-Object ($libs.GetType($T + 'ExportItem')) -ArgumentList @($kn, $it[0], $it[1]))) }
        $sel.Add($p, $inner)
    }
    $thrown = $null
    try { $mgr.ExportSolutions($ec, $sel) } catch { $e = Unwrap $_.Exception; $thrown = $e.GetType().FullName + ': ' + $e.Message }
    "thrown: " + $(if ($thrown) { Esc (Norm $thrown $wd) } else { '<none>' })
    "messages:"
    foreach ($m in $msgs.Log) { '  ' + (Esc (Norm $m $wd)) }
    $texts = @(); foreach ($m in $msgs.Log) { $f = $m.Split('|', 4); if ($f[2] -eq 'status' -and $f[3] -match '^Item \d+ of \d+: .* - (.*)$') { $texts += $Matches[1] } }
    $names = @(); foreach ($p in $Pkgs.Keys) { foreach ($it in $Pkgs[$p]) { $names += $(if ($it.Count -gt 2) { $it[2] } else { 'k-' + $it[0] }) } }
    $started = @($conn.Calls).Count
    "status texts: $($texts.Count) sent, $(@($texts | Select-Object -Unique).Count) distinct keyed names, $(@($names | Select-Object -Unique | Where-Object { $texts -notcontains $_ }).Count) of $(@($names | Select-Object -Unique).Count) keyed names never named"
    "log:"
    if (Test-Path $ctx.LogFilePath) { foreach ($l in ([IO.File]::ReadAllText($ctx.LogFilePath) -split "`r?`n")) { '  | ' + (Esc (Norm $l $wd)) } } else { '  <no log file>' }
    "files:"
    Get-ChildItem -Recurse -Force $wd | Where-Object { $_.Name -ne 'engine.log' } | Sort-Object FullName | ForEach-Object { '  ' + (Norm $_.FullName $wd) + $(if ($_.PSIsContainer) { ' [dir]' } else { '' }) }
    $mf = Join-Path $wd 'imports.mf'
    if (Test-Path $mf) { "imports.mf: " + (Esc (Norm ([IO.File]::ReadAllText($mf)) $wd)) } else { "imports.mf: <absent>" }
    if ($env:PROBE_REQUESTS) { "requests:"; $rs = @($conn.Responses); $i = 0; foreach ($q in $conn.Requests) { '  ' + (Esc $q); '    => ' + (Esc $rs[$i]); $i++ } }
    "main fetches: $($conn.MainFetches), max in flight: $($conn.MaxInFlight)"
    "fetch completion order (id@thread):"
    foreach ($c in $conn.Calls) { $f = $c.Split('|'); '  ' + $f[4] + '@' + $f[1] }
    foreach ($f in $Show) { $fp = Join-Path $wd $f; "file ${f}:"; if (Test-Path $fp) { $b = [IO.File]::ReadAllBytes($fp); $bom = ''; $o = 0; if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $bom = '[BOM]'; $o = 3 }; '  ' + $bom + '"' + (Esc (Norm ([Text.Encoding]::UTF8.GetString($b, $o, $b.Length - $o)) $wd)) + '"' } else { '  <absent>' } }
    '--'
}

function Items($prefix, $n, $type = 'List') { $a = @(); for ($i = 1; $i -le $n; $i++) { $a += , @(('{0}{1:D2}' -f $prefix, $i), $type) }; $a }

# S22 runs first: the race needs the other workers to arrive while the names are being fetched, which they do in a process that has not yet compiled the stylesheet. In a process that has, they all arrive together and the outcome differs.
# ---- S22: the poly-type names are fetched by the first worker that needs them; the others do not wait
$prop = '<Relationships><Item type="Property" id="P1"><name>p</name><data_type>list</data_type><data_source keyed_name="PolyT" type="List">L1</data_source></Item></Relationships>'
Run-Export 'S22-poly-names-race' ([ordered]@{ 'pkg.a' = (Items 'A' 8) }) { param($c) $c.PolyNamesXml = '<Item type="ItemType" id="PT"><name>PolyT</name></Item>'; $c.PolyDelayMs = 3000; $c.Gate = 8; $c.GateTimeoutMs = 3000; $c.ItemBody = $prop } -Show @(1..8 | ForEach-Object { 'a\Import\List\k-A{0:D2}.xml' -f $_ })

# ---- S1: one package, four items, sequential-looking baseline
Run-Export 'S1-basic' ([ordered]@{ 'pkg.a' = (Items 'A' 4) })

# ---- S2: parallel evidence: 24 items, each fetch waits for 6 in flight at once
Run-Export 'S2-parallel' ([ordered]@{ 'pkg.a' = (Items 'A' 24) }) { param($c) $c.Gate = 6; $c.GateTimeoutMs = 4000 }

# ---- S3: one failing item among 12, host answers yes (14.0.7: abort package)
Run-Export 'S3-fail-yes' ([ordered]@{ 'pkg.a' = (Items 'A' 12) }) { param($c) $c.FailIds.Add('A05') | Out-Null; $c.DelayMs = 30 } -Answer $true

# ---- S4: the same failure, host answers no (14.0.7: skip item and go on)
Run-Export 'S4-fail-no' ([ordered]@{ 'pkg.a' = (Items 'A' 12) }) { param($c) $c.FailIds.Add('A05') | Out-Null; $c.DelayMs = 30 } -Answer $false

# ---- S5: a failure in the first package of three; dependency pkg.* -> dep.x with a referenced element
$refs = '<Item type="PackageReferencedElement" id="R1"><element_id>RF01</element_id><element_type>List</element_type><element_description>ref one</element_description></Item>'
$deps = @{ 'pkg.a' = 'dep.x'; 'pkg.b' = 'dep.x'; 'pkg.c' = 'dep.x' }
Run-Export 'S5-fail-multi-package' ([ordered]@{ 'pkg.a' = (Items 'A' 3); 'pkg.b' = (Items 'B' 3); 'pkg.c' = (Items 'C' 6) }) { param($c) $c.FailIds.Add('C02') | Out-Null; $c.DelayMs = 20; $c.ReferencedByPackage['dep.x'] = $refs } -Referenced $true -Deps $deps

# ---- S6: no failure, referenced pass on
Run-Export 'S6-referenced-ok' ([ordered]@{ 'pkg.a' = (Items 'A' 3) }) { param($c) $c.ReferencedByPackage['dep.x'] = $refs } -Referenced $true -Deps @{ 'pkg.a' = 'dep.x' }

# ---- S7: no package definitions at all (getSolutions answers faultcode 0)
Run-Export 'S7-null-packages' ([ordered]@{ 'pkg.a' = (Items 'A' 2) }) -NullSolutions $true
Run-Export 'S7b-null-packages-empty-table' ([ordered]@{}) -NullSolutions $true

# ---- S8: a plain exception (not a CItemException) from one item
Run-Export 'S8-throw' ([ordered]@{ 'pkg.a' = (Items 'A' 12) }) { param($c) $c.ThrowIds.Add('A04') | Out-Null; $c.DelayMs = 30 }

# ---- S9: two failing items at once
Run-Export 'S9-two-fail' ([ordered]@{ 'pkg.a' = (Items 'A' 12) }) { param($c) $c.FailIds.Add('A03') | Out-Null; $c.FailIds.Add('A04') | Out-Null; $c.Gate = 4; $c.GateTimeoutMs = 2000 }

# ---- S10: cancel from a status message while the loop runs (100 items, 15 ms each)
Run-Export 'S10-cancel' ([ordered]@{ 'pkg.a' = (Items 'A' 100); 'pkg.b' = (Items 'B' 2) }) { param($c) $c.DelayMs = 15 } -CancelOn 'Item 1 of 100'

# ---- S11: a late failure: items done before it are logged, items done after it are not
Run-Export 'S11-late-failure' ([ordered]@{ 'pkg.a' = (Items 'A' 12) }) { param($c) $c.FailIds.Add('A05') | Out-Null; $c.DelayById['A05'] = 300; foreach ($i in 6..12) { $c.DelayById[('A{0:D2}' -f $i)] = 900 } }

# ---- S12: cancel with the referenced pass on: does the pass still run?
Run-Export 'S12-cancel-referenced' ([ordered]@{ 'pkg.a' = (Items 'A' 100) }) { param($c) $c.DelayMs = 15; $c.ReferencedByPackage['dep.x'] = $refs } -Referenced $true -Deps @{ 'pkg.a' = 'dep.x' } -CancelOn 'Item 1 of 100'

# ---- S13: a failure in the referenced pass itself
Run-Export 'S13-fail-referenced' ([ordered]@{ 'pkg.a' = (Items 'A' 2) }) { param($c) $c.FailIds.Add('RF01') | Out-Null; $c.ReferencedByPackage['dep.x'] = $refs } -Referenced $true -Deps @{ 'pkg.a' = 'dep.x' }

# ---- S14: two plain exceptions at once (the AggregateException carries both messages)
Run-Export 'S14-two-throw' ([ordered]@{ 'pkg.a' = (Items 'A' 12) }) { param($c) $c.ThrowIds.Add('A03') | Out-Null; $c.ThrowIds.Add('A04') | Out-Null; $c.Gate = 4; $c.GateTimeoutMs = 2000 }

# ---- S15: a type name with an invalid path character fails before any request (Path.Combine)
Run-Export 'S15-type-invalid-char' ([ordered]@{ 'pkg.a' = @(@('A01', 'Li|st'), @('A02', 'List')) })

# ---- S16: a rooted type name replaces the package folder (Path.Combine)
$wdEscape = Join-Path $Work 'S16-type-rooted'
Run-Export 'S16-type-rooted' ([ordered]@{ 'pkg.a' = @(@('A01', ($wdEscape + '\escape')), @('A02', 'List')) }) -Show @('escape\k-A01.xml', 'a\Import\List\k-A02.xml')

# ---- S17: relationships that are package elements are removed from the item file
$body = '<Relationships><Item type="Value" id="V1"><label>one</label></Item><Item type="Value" id="V2"><label>two</label></Item><Item type="Other" id="V1"><label>other</label></Item></Relationships>'
Run-Export 'S17-separately-exported' ([ordered]@{ 'pkg.a' = @(,@('A01', 'List')) }) { param($c) $c.BodyById['A01'] = $body } -Elements @(,@('Value', 'V1')) -Show @(1..8 | ForEach-Object { 'a\Import\List\k-A{0:D2}.xml' -f $_ })

# ---- S18: the same without the package element
Run-Export 'S18-not-separately-exported' ([ordered]@{ 'pkg.a' = @(,@('A01', 'List')) }) { param($c) $c.BodyById['A01'] = $body } -Show @(1..8 | ForEach-Object { 'a\Import\List\k-A{0:D2}.xml' -f $_ })

# ---- S19: a working directory with a trailing backslash
Run-Export 'S19-wd-trailing-backslash' ([ordered]@{ 'pkg.a' = @(,@('A01', 'List')) }) -WdSuffix '\' -Show @(1..8 | ForEach-Object { 'a\Import\List\k-A{0:D2}.xml' -f $_ })

# ---- S20: 40 items with one keyed name write one file; the fetches are released together so the writes overlap
$dups = @(); for ($i = 1; $i -le 40; $i++) { $dups += , @(('D{0:D2}' -f $i), 'List', 'dup') }
Run-Export 'S20-same-file-name' ([ordered]@{ 'pkg.a' = $dups }) { param($c) $c.Gate = 14; $c.GateTimeoutMs = 3000 }

# ---- S21: the status text of 60 items released together: the shared message object races
Run-Export 'S21-status-text-race' ([ordered]@{ 'pkg.a' = (Items 'A' 60) }) { param($c) $c.Gate = 14; $c.GateTimeoutMs = 3000 }

# ---- S23: the default-permission lookup fails once; items of the same type are exported one after another (Gate off)
$perm = '<permission_id keyed_name="p" type="Permission">PERMX</permission_id>'
Run-Export 'S23-permission-lookup-fails-once' ([ordered]@{ 'pkg.a' = (Items 'A' 6) }) { param($c) $c.DefaultPermissionFailures = 1; $c.DelayById['A01'] = 0; foreach ($i in 2..6) { $c.DelayById[('A{0:D2}' -f $i)] = 1200 }; $c.ItemBody = $perm } -Show @(1..6 | ForEach-Object { 'a\Import\List\k-A{0:D2}.xml' -f $_ })
