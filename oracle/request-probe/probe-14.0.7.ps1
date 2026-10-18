<#
Request probe for engine 14.0.7 (ticket 11). Windows PowerShell 5.1. It loads the
staged 14.0.7 toolset (IOM.dll and Libs.dll, hash-checked by the caller) and runs
the engine's own CExportItems and CItemHelper against Stub.cs's StubConnection,
which never touches a network: it records what the engine hands to IOM and
answers from a script. The result is a JSON document of the requests each
scenario produced and how the engine's lookups behaved, which is the evidence
spec/export-requests.md cites (fixtures/export-requests/14.0.7-probe/).

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
if ($libs.GetName().Version.ToString() -ne '14.0.7.35492') { throw "Libs.dll is $($libs.GetName().Version), not 14.0.7.35492" }
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'Stub.cs')) -ReferencedAssemblies @($iomPath, $libsPath, 'System.Xml')

$log = [ordered]@{ engine = '14.0.7'; assemblyVersion = $libs.GetName().Version.ToString(); scenarios = [ordered]@{} }
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

# --- A, B, C, D: the main fetch CExportItems.Export builds ------------------------------------
# The stub answers the is_versionable lookup (and the current-id lookup) and refuses everything
# else, so the run stops right after the main fetch. Only the requests are recorded.
function Run-Export([string] $type, $level, [bool] $versionable, [int] $major, [int] $sp, [string] $id = 'A1B2C3D4E5F60718293A4B5C6D7E8F90', [string] $keyed = 'k') {
    $c = New-Object Probe.StubConnection
    $c.Respond = {
        param($req)
        if ($req -like '*select="is_versionable"*') {
            return [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>' + $(if ($versionable) { '1' } else { '0' }) + '</is_versionable></Item>')
        }
        if ($req -like '*select="config_id, is_current"*') {
            return [Probe.Env]::Result('<Item type="' + $type + '" id="' + $id + '"><config_id>CFG</config_id><is_current>1</is_current></Item>')
        }
        return $null
    }.GetNewClosure()
    $helper = New-Helper $c $major $sp
    $exporter = New-Object Aras.Tools.SolutionUpgrade.CExportItems($helper)
    $item = New-Object Aras.Tools.SolutionUpgrade.ExportItem($keyed, $id, $type)
    $thrown = $null
    try { $exporter.Export($item, 'pkg', $level, $null) } catch { $thrown = Desc $_.Exception }
    $stopped = Is-StubStop $thrown
    if ($stopped) { $thrown = $null }
    return [ordered]@{ type = $type; level = $level; versionable = $versionable; serverMajor = $major; serverServicePack = $sp; id = $id; requests = @($c.Requests); actions = @($c.Actions); stoppedByStub = $stopped; thrown = $thrown }
}

$types = 'Item Report', 'Action', 'Identity', 'List', 'Method', 'Permission', 'RelationshipType', 'Sequence', 'UserMessage', 'Workflow Promotion', 'Grid', 'User', 'Preference', 'Form', 'Life Cycle Map', 'Workflow Map', 'ItemType', 'cmf_ContentType', 'cmf_TabularView', 'qry_QueryDefinition', 'rb_TreeGridViewDefinition', 'xClassificationTree', 'dac_DomainDefinition', 'ac_PolicyAccessItemAttribute', 'dr_RelationshipFamily', 'Part', 'item report', 'ITEM REPORT', 'Pa"rt', "O'Brien", 'Part & Co', 'Part<Co'
$a = @(); foreach ($t in $types) { $a += , (Run-Export $t '' $false 14 9) }
Note 'A.typeTable' $a

$b = @()
foreach ($lv in '', ' ', '1', '2', ' 3 ', '0', 'abc', '<&"', "a`tb", "a`r`nb", "a`nb", "caf$([char]0xE9) $([char]0x20AC)") { $b += , (Run-Export 'Part' $lv $false 14 9) }
foreach ($lv in '', '2') { $b += , (Run-Export 'Form' $lv $false 14 9) }
$b += , (Run-Export 'Part' $null $false 14 9)
Note 'B.levels' $b

$c1 = @()
foreach ($mv in @(@(14, 0), @(12, 0), @(11, 12), @(11, 11), @(11, 0), @(10, 0), @(9, 0))) { $c1 += , (Run-Export 'Part' '' $false $mv[0] $mv[1]) }
foreach ($mv in @(@(14, 0), @(12, 0), @(11, 12), @(11, 11), @(10, 0), @(9, 0))) { $c1 += , (Run-Export 'ItemType' '' $false $mv[0] $mv[1]) }
Note 'C.serverVersion' $c1

$d = @()
$d += , (Run-Export 'Part' '' $true 14 9)
$d += , (Run-Export 'Part' '' $false 14 9 'idwith&amp;<x>"')
Note 'D.versionable' $d

# --- E, F, G: lookups and the _requestedItems cache --------------------------------------------
$c = New-Stub { param($r) [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>1</is_versionable></Item>') }
$h = New-Helper $c 14 9
$results = @($h.IsVersionable('Part'), $h.IsVersionable('Part'), $h.IsVersionable('Document'))
Note 'E.isVersionableCache' ([ordered]@{ results = $results; requests = @($c.Requests) })

$c = New-Stub { param($r) [Probe.Env]::Fault('0', 'No items of type ItemType found.') }
$h = New-Helper $c 14 9
$errors = @(); foreach ($i in 1..2) { try { [void]$h.IsVersionable('Nope') } catch { $errors += , (Desc $_.Exception) } }
Note 'E.isVersionableUnknownType' ([ordered]@{ errors = $errors; requests = @($c.Requests) })

$c = New-Stub { param($r) [Probe.Env]::Fault('999', 'boom') }
$h = New-Helper $c 14 9
$errors = @(); foreach ($i in 1..2) { try { [void]$h.IsVersionable('Nope') } catch { $errors += , (Desc $_.Exception) } }
Note 'E.isVersionableServerError' ([ordered]@{ errors = $errors; requests = @($c.Requests) })

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

$c = New-Stub { param($r) [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>') }
$h1 = New-Helper $c 14 9; $h2 = New-Helper $c 14 9
[void]$h1.IsVersionable('Part'); [void]$h2.IsVersionable('Part'); [void]$h1.IsVersionable('Part')
Note 'E.cachePerHelper' ([ordered]@{ requestCount = $c.Requests.Count })

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

$c = New-Stub { param($r) if ($r -like '*>Nope<*') { [Probe.Env]::Fault('0', 'No items') } elseif ($r -like '*>Boom<*') { [Probe.Env]::Fault('999', 'boom') } else { [Probe.Env]::Result('<Item type="ItemType" id="X"><id>X</id><is_relationship>0</is_relationship></Item>') } }
$h = New-Helper $c 14 9
$results = @(); foreach ($n in 'Part', 'Part', 'Nope', 'Nope', 'Boom', 'Boom') { $x = $h.GetItemType($n); $results += $(if ($x -eq $null) { 'null' } else { 'doc' }) }
Note 'G.getItemTypeCache' ([ordered]@{ results = $results; requests = @($c.Requests) })

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

$c = New-Stub { param($r) [Probe.Env]::Fault('0', 'No items of type ItemType found.') }
$h = New-Helper $c 14 9
$doc.LoadXml('<Item type="List" id="L"><Relationships><Item type="Value" id="V1" /><Item type="Value" id="V2" /><Item type="Value" id="V3" /></Relationships></Item>')
$h.ProcessPropertiesOfTypeItem($doc.DocumentElement)
$names = @($c.Requests | ForEach-Object { [regex]::Match($_, '<name>([^<]*)</name>').Groups[1].Value })
Note 'I.floatPropertiesFault0NotCached' ([ordered]@{ requestCount = $c.Requests.Count; typeNames = $names })

$c = New-Stub { param($r) [Probe.Env]::Fault('999', 'boom') }
$h = New-Helper $c 14 9
$doc.LoadXml('<AML><Item type="ItemType"><Relationships><Item type="Property"><data_type>list</data_type><data_source keyed_name="Z">Z</data_source></Item></Relationships></Item></AML>')
$first = $null; try { $h.ReplaceReferencesToPolyLists($doc) } catch { $first = Desc $_.Exception }
$second = $null; try { $h.ReplaceReferencesToPolyLists($doc) } catch { $second = Desc $_.Exception }
$requestsAfterTwo = $c.Requests.Count
$third = $null; try { (New-Helper $c 14 9).ReplaceReferencesToPolyLists($doc) } catch { $third = Desc $_.Exception }
Note 'I.polytypeNamesLatch' ([ordered]@{ first = $first; second = $second; requestsAfterTwoCalls = $requestsAfterTwo; thirdOnNewHelper = $third; requestsAfterThree = $c.Requests.Count })

# --- O: a fault on the main fetch --------------------------------------------------------------
$o = [ordered]@{}
foreach ($code in '0', '999') {
    $c = New-Stub ({ param($r)
        if ($r -like '*select="is_versionable"*') { return [Probe.Env]::Result('<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>') }
        return [Probe.Env]::Fault($code, 'No items of type Part found.')
    }.GetNewClosure())
    $e = New-Object Aras.Tools.SolutionUpgrade.CExportItems((New-Helper $c 14 9))
    $thrown = $null
    try { $e.Export((New-Object Aras.Tools.SolutionUpgrade.ExportItem('k', 'ID1', 'Part')), 'pkg', '', $null) } catch { $thrown = Desc $_.Exception }
    $o["faultcode$code"] = [ordered]@{ requests = @($c.Requests); thrown = $thrown }
}
Note 'O.mainFetchFault' $o

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

# --- R: the float-property lookup (row 14) fault path and cache ------------------------------------
$r = [ordered]@{}
$c = New-Stub { param($x) [Probe.Env]::Fault('999', 'boom') }
$h = New-Helper $c 14 9
$doc.LoadXml('<Item type="List" id="L" />')
$thrown = $null; try { $h.ProcessPropertiesOfTypeItem($doc.DocumentElement) } catch { $thrown = Desc $_.Exception }
$r['floatPropertiesServerError'] = [ordered]@{ thrown = $thrown; requestCount = $c.Requests.Count }
$c = New-Stub { param($x) [Probe.Env]::Result('<Item type="ItemType" id="IT"><Relationships /></Item>') }
$h = New-Helper $c 14 9
$doc.LoadXml('<Item type="List" id="L"><Relationships><Item type="Value" id="V1" /><Item type="Value" id="V2" /><Item type="Value" id="V3" /></Relationships></Item>')
$h.ProcessPropertiesOfTypeItem($doc.DocumentElement)
$r['floatPropertiesSuccessCached'] = [ordered]@{ requestCount = $c.Requests.Count; typeNames = @($c.Requests | ForEach-Object { [regex]::Match($_, '<name>([^<]*)</name>').Groups[1].Value }) }
Note 'R.floatProperties' $r

# --- N: the follow-up lookups Export chains after the main fetch --------------------------------
function Run-Seq([string] $type, [string[]] $responses) {
    $c = New-Object Probe.StubConnection
    $state = @{ i = 0 }
    $c.Respond = {
        param($req)
        $n = $state.i; $state.i = $n + 1
        if ($n -lt $responses.Count) { return $responses[$n] }
        return $null
    }.GetNewClosure()
    $h = New-Helper $c 14 9
    $e = New-Object Aras.Tools.SolutionUpgrade.CExportItems($h)
    $item = New-Object Aras.Tools.SolutionUpgrade.ExportItem('k', 'ID1', $type)
    $thrown = $null
    try { $e.Export($item, 'pkg', '', $null) } catch { $thrown = Desc $_.Exception }
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

[System.IO.File]::WriteAllText($Out, ($log | ConvertTo-Json -Depth 14), (New-Object System.Text.UTF8Encoding($false)))
'done'
