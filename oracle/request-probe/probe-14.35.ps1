<#
Request probe for engine 14.35 (ticket 51). Windows PowerShell 5.1. It loads the
staged 14.35 toolset (IOM 15 and Libs.dll, hash-checked by the caller) and runs
the engine's own CExportItems and CItemHelper against Stub.cs's StubConnection,
which never touches a network: it records what the engine hands to IOM and
answers from a script. The result is a JSON document of the requests each
scenario produced and how the engine's lookups behaved, which is the evidence
spec/export-requests.md cites for [14.35] (fixtures/export-requests/14.35-probe/).

No server, no credential and no password is involved.
#>
param(
    [Parameter(Mandatory)][string] $ToolsetDir,
    [Parameter(Mandatory)][string] $Out
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$iomPath = Join-Path $ToolsetDir 'IOM.dll'
$libsPath = Join-Path $ToolsetDir 'Libs.dll'
[void][System.Reflection.Assembly]::LoadFrom($iomPath)
$libs = [System.Reflection.Assembly]::LoadFrom($libsPath)
if ($libs.GetName().Version.ToString() -ne '14.35.0.43890') { throw "Libs.dll is $($libs.GetName().Version), not 14.35.0.43890" }
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'Stub.cs')) -ReferencedAssemblies @($iomPath, $libsPath, 'System.Xml')

$log = [ordered]@{ engine = '14.35'; assemblyVersion = $libs.GetName().Version.ToString(); scenarios = [ordered]@{} }
function Note([string] $key, $value) { $log.scenarios[$key] = $value }

# CItemHelper starts with no server version (Login sets it), so the probe sets it as Login would.
function New-Helper($conn, [int] $major, [int] $sp) {
    $helper = New-Object Aras.Tools.SolutionUpgrade.CItemHelper($conn)
    $version = New-Object Aras.Tools.SolutionUpgrade.ArasVersion($major, 0, $sp, 1, 0)
    $helper.GetType().GetProperty('InnovatorVersion').GetSetMethod($true).Invoke($helper, [object[]]@($version.psobject.BaseObject)) | Out-Null
    $helper.Folder = 'C:\probe-out'
    return $helper
}
function New-Stub($script) { $c = New-Object Probe.StubConnection; $c.Respond = $script; return $c }
function Unwrap($ex) {
    while ($ex -is [System.Management.Automation.MethodInvocationException] -or $ex -is [System.Reflection.TargetInvocationException]) { $ex = $ex.InnerException }
    return $ex
}
function Clip([string] $s, [int] $n) { if ($s.Length -gt $n) { return $s.Substring(0, $n) } else { return $s } }
# The stub refuses any request a scenario does not script, and IOM then hands the engine an empty
# response, which the engine reports as "Root element is missing". That ends the run; it is the
# probe stopping, not engine behaviour, so it is recorded as stoppedByStub and not as `thrown`.
function Is-StubStop($d) { return ($d -ne $null) -and ($d.message -like 'Root element is missing*') }
function Desc($ex) {
    $x = Unwrap $ex
    $o = [ordered]@{ type = $x.GetType().FullName }
    if ($x -is [Aras.Tools.SolutionUpgrade.CItemException]) { $o.faultcode = $x.faultcode; $o.faultdetail = Clip $x.faultdetail 300 }
    $o.message = Clip $x.Message 300
    return $o
}

$ActionExport = [Aras.Tools.SolutionUpgrade.ImportExport]::Export
function New-Dict { return (New-Object 'System.Collections.Concurrent.ConcurrentDictionary[string,System.Lazy[Aras.IOM.Item]]') }
function New-Elements { return (New-Object 'System.Collections.Generic.Dictionary[string,System.Collections.Generic.HashSet[string]]') }

# A tiny fictional schema the stub answers the tree lookups from. `rels` maps an ItemType name to
# the names of the RelationshipTypes whose source it is; `related` maps a RelationshipType name to
# the ItemType its related_id points at ('' = a related_id property with no data_source).
function Schema-Response([string] $req, $schema) {
    if ($req -match '^<Item [^>]*type="ItemType"[^>]*><name>([^<]*)</name><Relationships><Item [^>]*type="Property"[^>]*><name>related_id</name>') {
        $n = $matches[1]
        if (-not $schema.related.Contains($n)) { return [Probe.Env]::Fault('0', 'No items of type ItemType found.') }
        $ds = $schema.related[$n]
        $dsXml = if ($ds -eq '') { '<data_source />' } else { '<data_source keyed_name="' + $ds + '" type="ItemType" name="' + $ds + '">DS-' + $ds + '</data_source>' }
        return [Probe.Env]::Result('<Item type="ItemType" id="IT-' + $n + '"><Relationships><Item type="Property" id="P-' + $n + '">' + $dsXml + '</Item></Relationships></Item>')
    }
    if ($req -match '^<Item [^>]*type="RelationshipType"[^>]*><source_id><Item [^>]*type="ItemType"[^>]*><name>([^<]*)</name></Item></source_id></Item>$') {
        $n = $matches[1]
        if (-not $schema.rels.Contains($n) -or $schema.rels[$n].Count -eq 0) { return [Probe.Env]::Fault('0', 'No items of type RelationshipType found.') }
        $items = ''
        foreach ($r in $schema.rels[$n]) { $items += '<Item type="RelationshipType" id="RT-' + $r + '"><name>' + $r + '</name></Item>' }
        return [Probe.Env]::Result($items)
    }
    return $null
}
$noSchema = @{ rels = @{}; related = @{} }

# --- A, B, C, D: the main fetch CExportItems.Export builds ------------------------------------
# The stub answers the lookups of the schema, the is_versionable lookup and the current-id lookup,
# and refuses everything else, so the run stops right after the main fetch.
function Run-Export([string] $type, $level, [bool] $versionable, [int] $major, [int] $sp, $schema = $noSchema, $dict = $null, [string] $id = 'A1B2C3D4E5F60718293A4B5C6D7E8F90', [string] $keyed = 'k', $action = $ActionExport) {
    $c = New-Object Probe.StubConnection
    $c.Respond = {
        param($req)
        if ($req -like '*select="is_versionable"*') {
            return [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>' + $(if ($versionable) { '1' } else { '0' }) + '</is_versionable></Item>')
        }
        if ($req -like '*select="config_id, is_current"*') {
            return [Probe.Env]::Result('<Item type="' + $type + '" id="' + $id + '"><config_id>CFG</config_id><is_current>1</is_current></Item>')
        }
        return (Schema-Response $req $schema)
    }.GetNewClosure()
    if ($dict -eq $null) { $dict = New-Dict }
    $helper = New-Helper $c $major $sp
    $exporter = New-Object Aras.Tools.SolutionUpgrade.CExportItems($helper)
    $item = New-Object Aras.Tools.SolutionUpgrade.ExportItem($keyed, $id, $type)
    $thrown = $null
    try { $exporter.Export($item, 'pkg', $level, $null, $action, $null, $dict, (New-Elements)) } catch { $thrown = Desc $_.Exception }
    $stopped = Is-StubStop $thrown
    if ($stopped) { $thrown = $null }
    return [ordered]@{ type = $type; level = $level; versionable = $versionable; serverMajor = $major; serverServicePack = $sp; id = $id; requests = @($c.Requests); actions = @($c.Actions); stoppedByStub = $stopped; thrown = $thrown }
}

$types = 'Item Report', 'Action', 'Identity', 'List', 'Method', 'Permission', 'RelationshipType', 'Sequence', 'UserMessage', 'Workflow Promotion', 'Grid', 'User', 'Preference', 'Form', 'Life Cycle Map', 'Workflow Map', 'ItemType', 'cmf_ContentType', 'cmf_TabularView', 'qry_QueryDefinition', 'rb_TreeGridViewDefinition', 'xClassificationTree', 'dac_DomainDefinition', 'ac_PolicyAccessItemAttribute', 'dr_RelationshipFamily', 'Part', 'item report', 'ITEM REPORT', 'Pa"rt', "O'Brien", 'Part & Co', 'Part<Co'
$a = @(); foreach ($t in $types) { $a += , (Run-Export $t '' $false 14 9) }
Note 'A.typeTableNoSchema' $a

# A fictional schema: TA has two relationship types, R1 points at TB (which has two of its own),
# R2 has no related type; R1 itself has a relationship type R5.
$tree = @{ rels = @{ 'TA' = @('R1', 'R2'); 'TB' = @('R3', 'R4'); 'R1' = @('R5'); 'R3' = @('R6') }; related = @{ 'TA' = ''; 'TB' = ''; 'R1' = 'TB'; 'R2' = ''; 'R3' = ''; 'R4' = ''; 'R5' = ''; 'R6' = '' } }
$a = @()
foreach ($t in 'TA', 'List', 'Form', 'User', 'Item Report') { $a += , (Run-Export $t '' $false 14 9 $tree) }
foreach ($lv in '1', '2', '3', '0') { $a += , (Run-Export 'TA' $lv $false 14 9 $tree) }
Note 'A.typeTableTree' $a

$b = @()
foreach ($lv in '', ' ', '1', '2', ' 3 ', '0', 'abc', '-1', '+2', '1.5', '2147483648', '0x10', '<&"', "a`tb", "caf$([char]0xE9) $([char]0x20AC)", "$([char]0x0663)", "1$([char]0x00A0)", "$([char]0x00A0)", "$([char]0x2003)", "`t2`r`n", "- 1", "2147483647", "-2147483648", "00002", "1e1", "1,0") { $b += , (Run-Export 'TA' $lv $false 14 9 $tree) }
foreach ($lv in '', '2') { $b += , (Run-Export 'Form' $lv $false 14 9 $tree) }
$b += , (Run-Export 'TA' $null $false 14 9 $tree)
Note 'B.levels' $b

$c1 = @()
foreach ($mv in @(@(14, 0), @(12, 0), @(11, 12), @(11, 11), @(11, 0), @(10, 0), @(9, 0))) { $c1 += , (Run-Export 'Part' '' $false $mv[0] $mv[1]) }
foreach ($mv in @(@(14, 0), @(12, 0), @(11, 12), @(11, 11), @(10, 0), @(9, 0))) { $c1 += , (Run-Export 'ItemType' '' $false $mv[0] $mv[1]) }
Note 'C.serverVersion' $c1

$d = @()
$d += , (Run-Export 'TA' '' $true 14 9 $tree)
$d += , (Run-Export 'TA' '' $false 14 9 $tree $null 'idwith&amp;<x>"')
Note 'D.versionable' $d


# --- E, F, G: the per-type request template and its cache (the requestDictionary) ------------------
# One helper and one dictionary make one ExportSolutions call. Each step is (type, level).
function S([string] $t, [string] $l) { return [pscustomobject]@{ t = $t; l = $l } }
function Run-Items($steps, $schema = $noSchema, $dict = $null, [bool] $withVersion = $true, $respond = $null) {
    $c = New-Object Probe.StubConnection
    $c.Respond = {
        param($req)
        if ($req -like '*select="is_versionable"*') { return [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>') }
        if ($respond -ne $null) { $r = & $respond $req; if ($r -ne $null) { return $r } }
        return (Schema-Response $req $schema)
    }.GetNewClosure()
    if ($dict -eq $null) { $dict = New-Dict }
    $helper = New-Helper $c 14 9
    if (-not $withVersion) { $helper.GetType().GetProperty('InnovatorVersion').GetSetMethod($true).Invoke($helper, [object[]]@($null)) | Out-Null }
    $out = @()
    foreach ($step in $steps) {
        $before = $c.Requests.Count
        $exporter = New-Object Aras.Tools.SolutionUpgrade.CExportItems($helper)
        $item = New-Object Aras.Tools.SolutionUpgrade.ExportItem('k', 'A1B2C3D4E5F60718293A4B5C6D7E8F90', $step.t)
        $thrown = $null
        try { $exporter.Export($item, 'pkg', $step.l, $null, $ActionExport, $null, $dict, (New-Elements)) } catch { $thrown = Desc $_.Exception }
        $stopped = Is-StubStop $thrown
        if ($stopped) { $thrown = $null }
        $new = @(); for ($i = $before; $i -lt $c.Requests.Count; $i++) { $new += $c.Requests[$i] }
        $out += , ([ordered]@{ type = $step.t; level = $step.l; requests = $new; stoppedByStub = $stopped; thrown = $thrown })
    }
    return ,$out
}
$e = [ordered]@{}
$e['sameDictionary'] = Run-Items @((S 'TA' '1'), (S 'TA' '3'), (S 'TA' ''), (S 'TB' '1'), (S 'TB' '2')) $tree
$e['ownDictionaryRun1'] = Run-Items @((S 'TA' '1')) $tree
$e['ownDictionaryRun2'] = Run-Items @((S 'TA' '3')) $tree
$d1 = New-Dict
$e['sharedDictionaryHelper1'] = Run-Items @((S 'TA' '2')) $tree $d1
$e['sharedDictionaryHelper2'] = Run-Items @((S 'TA' '3')) $tree $d1
$e['dictionaryKeys'] = [ordered]@{ keys = @($d1.Keys); count = $d1.Count }
Note 'E.templateCache' $e

$f = [ordered]@{}
$f['badLevelThenGoodLevel'] = Run-Items @((S 'TA' 'abc'), (S 'TA' '1'), (S 'TB' '1')) $tree
$f['goodLevelThenBadLevel'] = Run-Items @((S 'TA' '1'), (S 'TA' 'abc')) $tree
$f['overflowThenOk'] = Run-Items @((S 'TA' '99999999999'), (S 'TA' '1')) $tree
$f['namedTypeIgnoresBadLevel'] = Run-Items @((S 'Form' 'abc')) $tree
$f['noServerVersion'] = Run-Items @((S 'TA' '1'), (S 'TA' '1'), (S 'Form' '1')) $tree $null $false
$f['itemTypeNoServerVersion'] = Run-Items @((S 'ItemType' '1'), (S 'ItemType' '1')) $tree $null $false
Note 'F.templateFaults' $f

$g = [ordered]@{}
$mkResp = {
    param($mode)
    return ({
        param($req)
        if ($mode -eq 'itemTypeFault999' -and $req -like '*<name>related_id</name>*') { return [Probe.Env]::Fault('999', 'boom') }
        if ($mode -eq 'relTypeFault999' -and $req -like '*type="RelationshipType"*') { return [Probe.Env]::Fault('999', 'boom') }
        if ($mode -eq 'twoPropertyRows' -and $req -like '*<name>related_id</name>*') { return [Probe.Env]::Result('<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><data_source keyed_name="TB" type="ItemType" name="TB">X</data_source></Item><Item type="Property" id="P2"><data_source keyed_name="TB" type="ItemType" name="TB">X</data_source></Item></Relationships></Item>') }
        if ($mode -eq 'noNameAttribute' -and $req -like '*<name>related_id</name>*') { return [Probe.Env]::Result('<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><data_source keyed_name="TB" type="ItemType">X</data_source></Item></Relationships></Item>') }
        if ($mode -eq 'listDataSource' -and $req -like '*<name>R1</name>*<name>related_id</name>*') { return [Probe.Env]::Result('<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><data_source keyed_name="Colors" type="List" name="Colors">X</data_source></Item></Relationships></Item>') }
        if ($mode -eq 'relTypeNoName' -and $req -like '*type="RelationshipType"*') { return [Probe.Env]::Result('<Item type="RelationshipType" id="RT1" /><Item type="RelationshipType" id="RT2"><name>R2</name></Item>') }
        return $null
    }.GetNewClosure())
}
foreach ($mode in 'itemTypeFault999', 'relTypeFault999', 'twoPropertyRows', 'noNameAttribute', 'listDataSource', 'relTypeNoName') {
    $g[$mode + '.level1'] = Run-Items @((S 'TA' '1')) $tree $null $true (& $mkResp $mode)
    $g[$mode + '.level2'] = Run-Items @((S 'TA' '2')) $tree $null $true (& $mkResp $mode)
}
Note 'G.treeLookupAnswers' $g

$a2 = @()
foreach ($t in 'TA', 'ItemType') {
    foreach ($bad in @($null, 'dict', 'elements', 'item')) {
        $c = New-Stub { param($r) $null }
        $h = New-Helper $c 14 9
        $x = New-Object Aras.Tools.SolutionUpgrade.CExportItems($h)
        $dd = New-Dict; $ee = New-Elements; $ii = New-Object Aras.Tools.SolutionUpgrade.ExportItem('k', 'ID', $t)
        if ($bad -eq 'dict') { $dd = $null }; if ($bad -eq 'elements') { $ee = $null }; if ($bad -eq 'item') { $ii = $null }
        if ($bad -eq $null) { continue }
        $thrown = $null; try { $x.Export($ii, 'pkg', '1', $null, $ActionExport, $null, $dd, $ee) } catch { $thrown = Desc $_.Exception }
        $a2 += , ([ordered]@{ type = $t; nullArgument = $bad; thrown = $thrown; requestCount = $c.Requests.Count })
    }
}
Note 'F.nullArguments' $a2

# --- H: the CItemHelper lookups and the _requestedItems cache (Lazy values, ConcurrentDictionary) -----------
$c = New-Stub { param($r) [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>1</is_versionable></Item>') }
$h = New-Helper $c 14 9
$results = @($h.IsVersionable('Part'), $h.IsVersionable('Part'), $h.IsVersionable('Document'))
Note 'H.isVersionableCache' ([ordered]@{ results = $results; requests = @($c.Requests) })

foreach ($code in '0', '999') {
    $c = New-Stub ({ param($r) [Probe.Env]::Fault($code, 'No items of type ItemType found.') }.GetNewClosure())
    $h = New-Helper $c 14 9
    $errors = @(); foreach ($i in 1..2) { try { [void]$h.IsVersionable('Nope') } catch { $errors += , (Desc $_.Exception) } }
    Note ('H.isVersionableFault' + $code) ([ordered]@{ errors = $errors; requests = @($c.Requests) })
}

$c = New-Stub { param($r) if ($r -like '*>Nope<*') { [Probe.Env]::Fault('0', 'No items') } elseif ($r -like '*>Boom<*') { [Probe.Env]::Fault('999', 'boom') } else { [Probe.Env]::Result('<Item type="ItemType" id="X"><id>X</id><is_relationship>0</is_relationship></Item>') } }
$h = New-Helper $c 14 9
$results = @(); foreach ($n in 'Part', 'Part', 'Nope', 'Nope', 'Boom', 'Boom') { $x = $h.GetItemType($n); $results += $(if ($x -eq $null) { 'null' } else { 'doc' }) }
Note 'H.getItemTypeCache' ([ordered]@{ results = $results; requests = @($c.Requests) })

$doc = New-Object System.Xml.XmlDocument
$c = New-Stub { param($r) [Probe.Env]::Fault('0', 'No items of type ItemType found.') }
$h = New-Helper $c 14 9
$doc.LoadXml('<Item type="List" id="L"><Relationships><Item type="Value" id="V1" /><Item type="Value" id="V2" /><Item type="Value" id="V3" /></Relationships></Item>')
$h.ProcessPropertiesOfTypeItem($doc.DocumentElement)
$names = @($c.Requests | ForEach-Object { [regex]::Match($_, '<name>([^<]*)</name>').Groups[1].Value })
Note 'H.floatPropertiesFault0Cached' ([ordered]@{ requestCount = $c.Requests.Count; typeNames = $names })

$c = New-Stub { param($r) [Probe.Env]::Fault('999', 'boom') }
$h = New-Helper $c 14 9
$doc.LoadXml('<Item type="List" id="L" />')
$first = $null; try { $h.ProcessPropertiesOfTypeItem($doc.DocumentElement) } catch { $first = Desc $_.Exception }
$second = $null; try { $h.ProcessPropertiesOfTypeItem($doc.DocumentElement) } catch { $second = Desc $_.Exception }
Note 'H.floatPropertiesServerErrorCached' ([ordered]@{ first = $first; second = $second; requestCount = $c.Requests.Count })

$c = New-Stub { param($r) [Probe.Env]::Result('<Item type="ItemType" id="IT"><Relationships /></Item>') }
$h = New-Helper $c 14 9
$doc.LoadXml('<Item type="List" id="L"><Relationships><Item type="Value" id="V1" /><Item type="Value" id="V2" /><Item type="Value" id="V3" /></Relationships></Item>')
$h.ProcessPropertiesOfTypeItem($doc.DocumentElement)
Note 'H.floatPropertiesSuccessCached' ([ordered]@{ requestCount = $c.Requests.Count })

$docKey = New-Object System.Xml.XmlDocument
$docKey.LoadXml('<Item type="Part" id="X"><item_number>P1</item_number></Item>')
$u = [ordered]@{}
foreach ($m in 'propertiesError', 'propertiesFault0', 'ok') {
    $c = New-Stub ({
        param($r)
        if ($r -like '*is_keyed*') {
            if ($m -eq 'propertiesError') { return [Probe.Env]::Fault('999', 'boom') }
            if ($m -eq 'propertiesFault0') { return [Probe.Env]::Fault('0', 'No items of type ItemType found.') }
            return [Probe.Env]::Result('<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><name>item_number</name></Item></Relationships></Item>')
        }
        return [Probe.Env]::Result('<Item type="Part" id="CUR"><id>CUR</id></Item>')
    }.GetNewClosure())
    $h = New-Helper $c 14 9
    $results = @()
    foreach ($i in 1..2) { $res = $null; $thrown = $null; try { $res = $h.GetCurrentIdByUniqueKey($docKey.DocumentElement, $true) } catch { $thrown = Desc $_.Exception }; $results += , ([ordered]@{ result = $res; thrown = $thrown }) }
    $u[$m] = [ordered]@{ calls = $results; requests = @($c.Requests) }
}
Note 'H.uniquePropertiesCached' $u

# polytype names are a static latch per helper, and the lookups of the follow-up chain, unchanged from 14.0.7
$c = New-Stub { param($r) [Probe.Env]::Fault('999', 'boom') }
$h = New-Helper $c 14 9
$doc.LoadXml('<AML><Item type="ItemType"><Relationships><Item type="Property"><data_type>list</data_type><data_source keyed_name="Z">Z</data_source></Item></Relationships></Item></AML>')
$first = $null; try { $h.ReplaceReferencesToPolyLists($doc) } catch { $first = Desc $_.Exception }
$second = $null; try { $h.ReplaceReferencesToPolyLists($doc) } catch { $second = Desc $_.Exception }
Note 'H.polytypeNamesLatch' ([ordered]@{ first = $first; second = $second; requestsAfterTwoCalls = $c.Requests.Count })

# --- N: the follow-up lookups Export chains after the main fetch ----------------------------------
function Run-Seq([string] $type, [string[]] $responses, $schema = $noSchema) {
    $c = New-Object Probe.StubConnection
    $state = @{ i = 0 }
    $c.Respond = {
        param($req)
        $r = Schema-Response $req $schema
        if ($r -ne $null) { return $r }
        $n = $state.i; $state.i = $n + 1
        if ($n -lt $responses.Count) { return $responses[$n] }
        return $null
    }.GetNewClosure()
    $h = New-Helper $c 14 9
    $e = New-Object Aras.Tools.SolutionUpgrade.CExportItems($h)
    $item = New-Object Aras.Tools.SolutionUpgrade.ExportItem('k', 'ID1', $type)
    $thrown = $null
    try { $e.Export($item, 'pkg', '', $null, $ActionExport, $null, (New-Dict), (New-Elements)) } catch { $thrown = Desc $_.Exception }
    $stopped = Is-StubStop $thrown
    if ($stopped) { $thrown = $null }
    return [ordered]@{ type = $type; requests = @($c.Requests); actions = @($c.Actions); stoppedByStub = $stopped; thrown = $thrown }
}
$notV = [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>')
$yesV = [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>1</is_versionable></Item>')
$cur = [Probe.Env]::Result('<Item type="X" id="ID1"><config_id>CFG1</config_id><is_current>1</is_current></Item>')
Note 'N.itemType' (Run-Seq 'ItemType' @($notV, [Probe.Env]::Result('<Item type="ItemType" id="ID1"><id keyed_name="Part" type="ItemType">ID1</id><name>Part</name></Item>')))
Note 'N.relationshipType' (Run-Seq 'RelationshipType' @($notV,
    [Probe.Env]::Result('<Item type="RelationshipType" id="ID1"><relationship_id keyed_name="X" type="ItemType">REL1</relationship_id><source_id keyed_name="S" type="ItemType">SRC1</source_id></Item>'),
    [Probe.Env]::Result('<Item type="ItemType" id="REL1"><name>X</name></Item>'),
    [Probe.Env]::Result('<Item type="RelationshipType" id="R9"><source_id>SRC2</source_id></Item>')))
Note 'N.form' (Run-Seq 'Form' @($notV, [Probe.Env]::Result('<Item type="Form" id="ID1"><Relationships><Item type="Field" id="F1"><name>fld</name><propertytype_id keyed_name="p" type="Property">PT1</propertytype_id></Item></Relationships></Item>')))
$noFloat = [Probe.Env]::Fault('0', 'No items of type ItemType found.')
$drRel = [Probe.Env]::Result('<Item type="dr_Relationship" id="DRID1"><implementation_query>&lt;a&gt;&lt;b/&gt;&lt;/a&gt;</implementation_query></Item>')
Note 'N.drRelationshipFamily' (Run-Seq 'dr_RelationshipFamily' @($notV, [Probe.Env]::Result('<Item type="dr_RelationshipFamily" id="ID1"><Relationships><Item type="dr_RelationshipFamily_Relationship" id="Q"><dr_relationship_id>DRID1</dr_relationship_id></Item></Relationships></Item>'), $noFloat, $noFloat, $drRel))
Note 'N.acPolicyAccessItemAttribute' (Run-Seq 'ac_PolicyAccessItemAttribute' @($notV, [Probe.Env]::Result('<Item type="ac_PolicyAccessItemAttribute" id="ID1"><Relationships><Item type="X" id="Q"><dr_relationship_id>DRID1</dr_relationship_id></Item></Relationships></Item>'), $noFloat, $noFloat, $drRel))
Note 'N.versionablePart' (Run-Seq 'Part' @($yesV, $cur, [Probe.Env]::Result('<Item type="Part" id="ID1"><config_id>CFG1</config_id></Item>')))


# --- I: the file name and folder are joined with Path.Combine before any request -------------------
$i = @()
foreach ($case in @(
    @('Part', 'plain', 'ID1'), @('Part', 'a:b', 'ID1'), @('Part', 'a:b', 'I"D'), @('Part', 'a/b', 'I<D'), @('Part', 'ok', 'ID1'), @('Part', "t$([char]9)ab", 'ID1'),
    @('C:\elsewhere', 'plain', 'ID1'), @('..\up', 'plain', 'ID1'), @('Part|X', 'plain', 'ID1'), @('Part*X', 'plain', 'ID1'), @('Part:X', 'plain', 'ID1'), @('', 'plain', 'ID1'), @("Pa$([char]1)rt", 'plain', 'ID1'), @('Part', '', 'I|D'))) {
    $c = New-Object Probe.StubConnection
    $c.Respond = { param($req) if ($req -like '*select="is_versionable"*') { return [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>') }; return (Schema-Response $req $noSchema) }
    $h = New-Helper $c 14 9
    $x = New-Object Aras.Tools.SolutionUpgrade.CExportItems($h)
    $it = New-Object Aras.Tools.SolutionUpgrade.ExportItem($case[1], $case[2], $case[0])
    $thrown = $null; try { $x.Export($it, 'pkg', '1', $null, $ActionExport, $null, (New-Dict), (New-Elements)) } catch { $thrown = Desc $_.Exception }
    $stopped = Is-StubStop $thrown; if ($stopped) { $thrown = $null }
    $i += , ([ordered]@{ typeName = $case[0]; keyedName = $case[1]; idName = $case[2]; requestCount = $c.Requests.Count; stoppedByStub = $stopped; thrown = $thrown })
}
Note 'I.fileNameAndFolder' $i


# --- Lookups whose text and reactions are unchanged from 14.0.7 (same scenarios as probe-14.0.7.ps1) -----
$values = [ordered]@{}
foreach ($v in '1', '0', '', 'true', ' 1') {
    $c = New-Stub ({ param($r) [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>' + $v + '</is_versionable></Item>') }.GetNewClosure())
    $values["[$v]"] = (New-Helper $c 14 9).IsVersionable('Part')
}
$c = New-Stub { param($r) [Probe.Env]::Result('<Item type="ItemType" id="X"><name>Part</name></Item>') }
try { [void](New-Helper $c 14 9).IsVersionable('Part') } catch { $values['absent'] = Desc $_.Exception }
$c = New-Stub { param($r) [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>1</is_versionable></Item><Item type="ItemType" id="Y"><is_versionable>0</is_versionable></Item>') }
$values['twoItems'] = (New-Helper $c 14 9).IsVersionable('Part')
Note 'E.isVersionableValues' $values


$mk = {
    param($mode)
    New-Stub ({
        param($r)
        if ($r -like '*select="config_id, is_current"*') {
            if ($mode -eq 'current') { return [Probe.Env]::Result('<Item type="Part" id="OLD"><config_id>CFG</config_id><is_current>1</is_current></Item>') }
            if ($mode -eq 'old') { return [Probe.Env]::Result('<Item type="Part" id="OLD"><config_id>CFG</config_id><is_current>0</is_current></Item>') }
            if ($mode -eq 'missing') { return [Probe.Env]::Fault('0', 'No items of type Part found.') }
            if ($mode -eq 'error') { return [Probe.Env]::Fault('999', 'boom') }
            if ($mode -eq 'nocfg') { return [Probe.Env]::Result('<Item type="Part" id="OLD"><is_current>0</is_current></Item>') }
            if ($mode -eq 'noflag') { return [Probe.Env]::Result('<Item type="Part" id="OLD"><config_id>CFG</config_id></Item>') }
            if ($mode -eq 'spaced') { return [Probe.Env]::Result('<Item type="Part" id="OLD"><config_id>CFG</config_id><is_current> 1</is_current></Item>') }
        }
        if ($r -like '*select="id"*config_id*') {
            if ($mode -eq 'missing') { return [Probe.Env]::Fault('0', 'No items of type Part found.') }
            return [Probe.Env]::Result('<Item type="Part" id="NEW"><id>NEW</id></Item>')
        }
        return $null
    }.GetNewClosure())
}
$f = [ordered]@{}
foreach ($mode in 'current', 'old', 'missing', 'error', 'nocfg', 'noflag', 'spaced') {
    $c = & $mk $mode; $h = New-Helper $c 14 9
    $result = $null; $thrown = $null
    try { $result = $h.GetCurrentIdOfVersion('OLD', 'Part') } catch { $thrown = Desc $_.Exception }
    $f[$mode] = [ordered]@{ result = $result; thrown = $thrown; requests = @($c.Requests) }
}
Note 'F.getCurrentIdOfVersion' $f


# --- H, I: the ItemType-body lookups of the follow-up steps ------------------------------------
$c = New-Stub { param($r) if ($r -like '*>T1<*') { [Probe.Env]::Result('<Item type="RelationshipType" id="R1"><source_id>T2</source_id></Item>') } elseif ($r -like '*>T2<*') { [Probe.Env]::Result('<Item type="RelationshipType" id="R2"><source_id>T3</source_id></Item>') } else { [Probe.Env]::Fault('0', 'No items') } }
$h = New-Helper $c 14 9
Note 'H.getDepencyLevel' ([ordered]@{ level = $h.getDepencyLevel('T1', 0); requests = @($c.Requests) })
$c = New-Stub { param($r) [Probe.Env]::Fault('999', 'boom') }
$h = New-Helper $c 14 9
Note 'H.getDepencyLevelError' ([ordered]@{ level = $h.getDepencyLevel('T1', 5); requests = @($c.Requests) })

$c = New-Stub { param($r)
    if ($r -like '*<is_keyed>1</is_keyed>*') { [Probe.Env]::Result('<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><name>item_number</name></Item><Item type="Property" id="P2"><name>major_rev</name></Item></Relationships></Item>') }
    else { [Probe.Env]::Result('<Item type="Part" id="CUR"><id>CUR</id></Item>') } }
$h = New-Helper $c 14 9
$doc = New-Object System.Xml.XmlDocument
$doc.LoadXml('<Item type="Part" id="X"><item_number>P1</item_number><major_rev>A</major_rev></Item>')
$results = @($h.GetCurrentIdByUniqueKey($doc.DocumentElement, $true), $h.GetCurrentIdByUniqueKey($doc.DocumentElement, $true))
Note 'I.getCurrentIdByUniqueKey' ([ordered]@{ results = $results; requests = @($c.Requests) })


# --- P: PackageDefinitionManager's lookups (rows 2 and 3) ----------------------------------------
function Run-Pdm([string] $name, [string[]] $responses, [string] $dependency, [bool] $create = $false) {
    $c = New-Object Probe.StubConnection
    $state = @{ i = 0 }
    $c.Respond = {
        param($req)
        $n = $state.i; $state.i = $n + 1
        if ($n -lt $responses.Count) { return $responses[$n] }
        return $null
    }.GetNewClosure()
    $h = New-Helper $c 14 9
    $out = [ordered]@{ package = $name; dependency = $dependency; thrown = $null; found = $null }
    try {
        $pdm = New-Object Aras.Tools.SolutionUpgrade.PackageDefinitionManager($h, $name, $create)
        if ($dependency) {
            $found = $pdm.FindReferencedElements($dependency)
            $out.found = @($found | ForEach-Object { [ordered]@{ keyedName = $_.keyedName; idName = $_.idName; typeName = $_.typeName } })
        }
    } catch { $out.thrown = Desc $_.Exception }
    $stopped = Is-StubStop $out.thrown
    if ($stopped) { $out.thrown = $null }
    $out.stoppedByStub = $stopped
    $out.requests = @($c.Requests)
    return $out
}
$pd = [Probe.Env]::Result('<Item type="PackageDefinition" id="PD1"><id keyed_name="pkg" type="PackageDefinition">PD1</id><name>pkg</name></Item>')
$noItems = [Probe.Env]::Fault('0', 'No items of type PackageDefinition found.')
$boom = [Probe.Env]::Fault('999', 'boom')
$refs = [Probe.Env]::Result('<Item type="PackageDependsOn" id="D1"><Relationships><Item type="PackageReferencedElement" id="E1"><element_id>EID1</element_id><element_type>Method</element_type><element_description>  desc one </element_description></Item><Item type="PackageReferencedElement" id="E2"><element_id>EID2</element_id><element_type>ItemType</element_type><element_description>   </element_description></Item></Relationships></Item>')
$refsNoId = [Probe.Env]::Result('<Item type="PackageDependsOn" id="D1"><Relationships><Item type="PackageReferencedElement" id="E1"><element_id> </element_id><element_type>Method</element_type></Item></Relationships></Item>')
$refsNoType = [Probe.Env]::Result('<Item type="PackageDependsOn" id="D1"><Relationships><Item type="PackageReferencedElement" id="E1"><element_id>EID1</element_id></Item></Relationships></Item>')
$pdmRuns = [ordered]@{}
$pdmRuns['initOk'] = Run-Pdm 'pkg' @($pd) $null
$pdmRuns['initNotFound'] = Run-Pdm 'pkg' @($noItems) $null
$pdmRuns['initServerError'] = Run-Pdm 'pkg' @($boom) $null
$pdmRuns['initNoId'] = Run-Pdm 'pkg' @([Probe.Env]::Result('<Item type="PackageDefinition" id="PD1"><name>pkg</name></Item>')) $null
$pdmRuns['refsOk'] = Run-Pdm 'pkg' @($pd, $refs) 'dep.one'
$pdmRuns['refsNone'] = Run-Pdm 'pkg' @($pd, $noItems) 'dep.one'
$pdmRuns['refsServerError'] = Run-Pdm 'pkg' @($pd, $boom) 'dep.one'
$pdmRuns['refsNoElementId'] = Run-Pdm 'pkg' @($pd, $refsNoId) 'dep.one'
$pdmRuns['refsNoElementType'] = Run-Pdm 'pkg' @($pd, $refsNoType) 'dep.one'
$pdmRuns['refsBadName'] = Run-Pdm 'pkg' @($pd) 'dep&one'
Note 'P.packageDefinitionManager' $pdmRuns


# --- Q: GetConfigId (row 13) and the unique-key lookups (row 12) fault paths --------------------
$q = [ordered]@{}
$modes = [ordered]@{
    ok = { param($r) [Probe.Env]::Result('<Item type="Part" id="I1"><config_id>CFG9</config_id></Item>') }
    noProperty = { param($r) [Probe.Env]::Result('<Item type="Part" id="I1"><id>I1</id></Item>') }
    emptyProperty = { param($r) [Probe.Env]::Result('<Item type="Part" id="I1"><config_id></config_id></Item>') }
    fault0 = { param($r) [Probe.Env]::Fault('0', 'No items of type Part found.') }
    fault999 = { param($r) [Probe.Env]::Fault('999', 'boom') }
}
foreach ($m in $modes.Keys) {
    $c = New-Stub $modes[$m]
    $h = New-Helper $c 14 9
    $result = $null; $thrown = $null
    try { $result = $h.GetConfigId('ID7', 'Part') } catch { $thrown = Desc $_.Exception }
    $q["getConfigId.$m"] = [ordered]@{ result = $result; thrown = $thrown; requests = @($c.Requests) }
}
$doc = New-Object System.Xml.XmlDocument
$doc.LoadXml('<Item type="Part" id="X"><item_number>P1</item_number></Item>')
$uk = [ordered]@{
    noKeyedProperties = { param($r) [Probe.Env]::Fault('0', 'No items of type ItemType found.') }
    propertiesError = { param($r) [Probe.Env]::Fault('999', 'boom') }
    noPropertyRows = { param($r) [Probe.Env]::Result('<Item type="ItemType" id="IT"><id>IT</id></Item>') }
    keyLookupFault = { param($r) if ($r -like '*is_keyed*') { [Probe.Env]::Result('<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><name>item_number</name></Item></Relationships></Item>') } else { [Probe.Env]::Fault('0', 'No items') } }
    keyLookupNoId = { param($r) if ($r -like '*is_keyed*') { [Probe.Env]::Result('<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><name>item_number</name></Item></Relationships></Item>') } else { [Probe.Env]::Result('<Item type="Part"><id>Z</id></Item>') } }
    propertyWithoutName = { param($r) [Probe.Env]::Result('<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1" /></Relationships></Item>') }
}
foreach ($m in $uk.Keys) {
    $c = New-Stub $uk[$m]
    $h = New-Helper $c 14 9
    $result = $null; $thrown = $null
    try { $result = $h.GetCurrentIdByUniqueKey($doc.DocumentElement, $true) } catch { $thrown = Desc $_.Exception }
    $q["uniqueKey.$m"] = [ordered]@{ result = $result; thrown = $thrown; requests = @($c.Requests) }
}
$noType = New-Object System.Xml.XmlDocument
$noType.LoadXml('<Item id="X"><item_number>P1</item_number></Item>')
$h = New-Helper (New-Stub { param($r) [Probe.Env]::Fault('0', 'x') }) 14 9
$thrown = $null; try { [void]$h.GetCurrentIdByUniqueKey($noType.DocumentElement, $true) } catch { $thrown = Desc $_.Exception }
$q['uniqueKey.noTypeAttribute'] = [ordered]@{ thrown = $thrown }
$blankType = New-Object System.Xml.XmlDocument
$blankType.LoadXml('<Item type=" " id="X"><item_number>P1</item_number></Item>')
$thrown = $null; try { [void]$h.GetCurrentIdByUniqueKey($blankType.DocumentElement, $true) } catch { $thrown = Desc $_.Exception }
$q['uniqueKey.blankTypeAttribute'] = [ordered]@{ thrown = $thrown }
Note 'Q.configIdAndUniqueKey' $q


[System.IO.File]::WriteAllText($Out, ($log | ConvertTo-Json -Depth 14), (New-Object System.Text.UTF8Encoding($false)))
'done'
