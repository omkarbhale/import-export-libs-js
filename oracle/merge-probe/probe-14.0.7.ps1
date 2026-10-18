<#
Merge probe for engine 14.0.7 (ticket 21), and with -Engine 12.0 for engine 12.0 (ticket 47). Windows PowerShell 5.1. It loads the staged
toolset (IOM.dll and Libs.dll, hash-checked by the caller) and runs:

  - the engine's own CImportItems against StubHelper.cs's scriptable ICItemHelper, which records
    every call in order and answers from tables the scenario fills;
  - the engine's own CItemHelper (SetItemIdToLastGeneration, DoesItemAlreadyExist, ItemExistById,
    ExistRelItemInCurVer, Unlock) against ../request-probe/Stub.cs's StubConnection, which records
    the document IOM is handed and answers from a script.

Nothing touches a network. No server, user or password is involved. The result is a JSON document
of what each scenario sent and returned, which is the evidence spec/import-merge.md cites
(fixtures/import-merge/14.0.7-probe/).
#>
param(
    [Parameter(Mandatory)][string] $ToolsetDir,
    [Parameter(Mandatory)][string] $RequestProbeDir,
    [Parameter(Mandatory)][string] $Out,
    [ValidateSet('12.0', '14.0.7')][string] $Engine = '14.0.7'
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$iomPath = Join-Path $ToolsetDir 'IOM.dll'
$libsPath = Join-Path $ToolsetDir 'Libs.dll'
[void][System.Reflection.Assembly]::LoadFrom($iomPath)
$libs = [System.Reflection.Assembly]::LoadFrom($libsPath)
$expectedVersion = @{ '12.0' = '12.0.0.13341'; '14.0.7' = '14.0.7.35492' }[$Engine]
if ($libs.GetName().Version.ToString() -ne $expectedVersion) { throw "Libs.dll is $($libs.GetName().Version), not $expectedVersion" }
$refs = @($iomPath, $libsPath, 'System.Xml', 'System.Net')
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $RequestProbeDir 'Stub.cs')) -ReferencedAssemblies $refs
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'StubHelper.cs')) -ReferencedAssemblies $refs

$log = [ordered]@{ engine = $Engine; assemblyVersion = $libs.GetName().Version.ToString(); scenarios = [ordered]@{} }
function Note([string] $key, $value) { $log.scenarios[$key] = $value }
$bf = [Reflection.BindingFlags]'NonPublic,Public,Instance,Static'
function Unwrap($ex) {
    while ($ex -is [System.Management.Automation.MethodInvocationException] -or $ex -is [System.Reflection.TargetInvocationException]) { $ex = $ex.InnerException }
    return $ex
}
function Clip([string] $s, [int] $n) { if ($s.Length -gt $n) { return $s.Substring(0, $n) } else { return $s } }
function Desc($ex) {
    $x = Unwrap $ex
    $o = [ordered]@{ type = $x.GetType().FullName }
    if ($x -is [Aras.Tools.SolutionUpgrade.CItemException]) {
        $o.faultcode = $x.faultcode
        $o.faultstringIsStack = ($x.faultstring -match '^\s+at ')
        if (-not $o.faultstringIsStack) { $o.faultstring = Clip $x.faultstring 300 }
        $o.faultdetail = Clip $x.faultdetail 300
        if ($x.InnerException -ne $null) { $o.inner = $x.InnerException.GetType().FullName }
    }
    $o.message = Clip $x.Message 300
    return $o
}
function Env([string] $inner) { return [Probe.Env]::Result($inner) }

# ---------------------------------------------------------------------------------------------
# Part 1: CImportItems.Import against the scriptable ICItemHelper
# ---------------------------------------------------------------------------------------------
$importT = $libs.GetType('Aras.Tools.SolutionUpgrade.CImportItems')
function Run-Import([string] $xml, [bool] $merge, [scriptblock] $setup = $null) {
    $h = New-Object MergeProbe.StubHelper
    if ($setup) { & $setup $h }
    $doc = New-Object System.Xml.XmlDocument
    $doc.LoadXml($xml)
    $o = $importT.GetConstructors($bf)[0].Invoke([object[]]@($h.psobject.BaseObject))
    $thrown = $null
    try { [void]$importT.GetMethod('Import', $bf).Invoke($o, [object[]]@($doc.psobject.BaseObject, $merge)) } catch { $thrown = Desc $_.Exception }
    return [ordered]@{ merge = $merge; input = $xml; calls = @($h.Calls); thrown = $thrown; documentAfter = $doc.OuterXml }
}
function Get-Response([string] $inner) { return (Env $inner) }

# --- V: the type / id / where validation -------------------------------------------------------
$v = [ordered]@{}
$v['nestedWithoutType'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item action='add' id='B' /></Relationships></Item>" $false
$v['rootWithoutType'] = Run-Import "<Item id='A' action='add' />" $false
$v['rootEmptyType'] = Run-Import "<Item type='' id='A' action='add' />" $false
$v['plainAddNoId'] = Run-Import "<Item type='Part' action='add' />" $false
$v['plainEditNoId'] = Run-Import "<Item type='Part' action='edit' />" $false
$v['plainEditNoIdWithActionChild'] = Run-Import "<Item type='Part' action='edit'><action>edit</action></Item>" $false
$v['plainNoActionNoId'] = Run-Import "<Item type='Part' />" $false
$v['plainDeleteNoId'] = Run-Import "<Item type='Part' action='delete' />" $false
$v['plainAddWhereOnly'] = Run-Import "<Item type='Part' where=""name='x'"" action='add' />" $false
$v['plainAddEmptyId'] = Run-Import "<Item type='Part' id='' action='add' />" $false
$v['nestedAddNoId'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add' /></Relationships></Item>" $false
$v['nestedEditNoId'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='edit' /></Relationships></Item>" $false
$verV = { param($h) $h.Versionable['Part'] = $true }
$v['versionableNestedAddNoId'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add' /></Relationships></Item>" $false $verV
$v['versionableNestedAddSourceMatches'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'><source_id>A</source_id></Item></Relationships></Item>" $false $verV
$v['versionableNestedAddSourceOther'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'><source_id>Z</source_id></Item></Relationships></Item>" $false $verV
$v['versionableNestedAddSourceElementChild'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'><source_id><Item type='Part' id='A'/></source_id></Item></Relationships></Item>" $false $verV
$v['versionableRootWhere'] = Run-Import "<Item type='Part' where=""name='x'"" action='edit'><Relationships><Item type='Part BOM' action='add'><source_id>Z</source_id></Item></Relationships></Item>" $false $verV
$v['versionableRootWhereEmptySource'] = Run-Import "<Item type='Part' where=""name='x'"" action='edit'><Relationships><Item type='Part BOM' action='add'><source_id /></Item></Relationships></Item>" $false $verV
$v['versionableRootAddNoIdNoWhere'] = Run-Import "<Item type='Part' action='add' />" $false $verV
$v['versionableApostropheId'] = Run-Import "<Item type='Part' id=""A'B"" action='add' />" $false $verV
$v['nonVersionableApostropheId'] = Run-Import "<Item type='Part' id=""A'B"" action='add' />" $false
$v['versionableRootEditWithId'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' action='edit' /></Relationships></Item>" $false $verV
Note 'V.validation' $v

# --- F: the final apply and the exception wrapping ------------------------------------------------
$f = [ordered]@{}
$f['plainSend'] = Run-Import "<Item type='Part' id='A' action='add' doGetItem='0'><name>n</name></Item>" $false
$f['sendFaultCode0'] = Run-Import "<Item type='Part' id='A' action='add' />" $false { param($h) $h.OnApply = [Func[string, string]]{ param($a) 'FAULT:0' } }
$f['sendFault999'] = Run-Import "<Item type='Part' id='A' action='add' />" $false { param($h) $h.OnApply = [Func[string, string]]{ param($a) 'FAULT:999' } }
Note 'F.finalApply' $f

# --- M: merge mode --------------------------------------------------------------------------------
$m = [ordered]@{}
$exists = { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return (Env '<Item type="Part" id="A"><id>A</id></Item>') } return (Env '') } }
$m['notMerge'] = Run-Import "<Item type='Part' id='A' action='add'><name>n</name></Item>" $false $exists
$m['existsBecomesEdit'] = Run-Import "<Item type='Part' id='A' action='add'><name>n</name></Item>" $true $exists
$m['absentStaysAdd'] = Run-Import "<Item type='Part' id='A' action='add'><name>n</name></Item>" $true
$m['getFault999'] = Run-Import "<Item type='Part' id='A' action='add'><name>n</name></Item>" $true { param($h) $h.OnApply = [Func[string, string]]{ param($a) 'FAULT:999' } }
$m['addWithoutIdIgnored'] = Run-Import "<Item type='Part' where=""name='x'"" action='add'><name>n</name></Item>" $true
$m['editAndDeleteIgnored'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' id='B' action='delete' /></Relationships></Item>" $true
$m['nestedAddsGroupedByType'] = Run-Import "<Item type='Part' id='P1' action='add'><Relationships><Item type='Part BOM' id='R1' action='add' /><Item type='Part AML' id='R2' action='add' /><Item type='Part BOM' id='R3' action='add' /></Relationships></Item>" $true
$m['typeOrderFollowsFirstAdd'] = Run-Import "<Item type='B' id='B1' action='add'><Relationships><Item type='A' id='A1' action='add' /><Item type='B' id='B2' action='add' /><Item type='A' id='A2' action='add' /></Relationships></Item>" $true
$m['typeWithoutIdFirst'] = Run-Import "<Item type='B' action='add' where=""name='x'""><Relationships><Item type='A' id='A1' action='add' /></Relationships></Item>" $true
$m['sameIdTwiceSameType'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='R' action='add' /><Item type='Part BOM' id='R' action='add' /></Relationships></Item>" $true
$m['typeIsCaseSensitive'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='part' id='B' action='add' /></Relationships></Item>" $true
$exOnlyA = { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return (Env '<Item type="Part" id="A"><id>A</id></Item><Item type="Part" id="C"><id>C</id></Item>') } return (Env '') } }
$m['onlySomeExist'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='B' action='add' /></Relationships></Item>" $true $exOnlyA
$m['sameIdOtherType'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='A' action='add' /></Relationships></Item>" $true { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*type='Part' action='get'*") { return (Env '<Item type="Part" id="A"><id>A</id></Item>') } return $null } }
$m['idCaseSensitive'] = Run-Import "<Item type='Part' id='a' action='add' />" $true { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return (Env '<Item type="Part" id="A"><id>A</id></Item>') } return (Env '') } }
$m['locked'] = Run-Import "<Item type='Part' id='A' action='add' />" $true { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return (Env '<Item type="Part" id="A"><id>A</id><locked_by_id keyed_name="x" type="User">U1</locked_by_id></Item>') } return (Env '') } }
$m['lockedEmpty'] = Run-Import "<Item type='Part' id='A' action='add' />" $true { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return (Env '<Item type="Part" id="A"><id>A</id><locked_by_id /></Item>') } return (Env '') } }
$m['lockedDuplicateId'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part' id='A' action='add' /></Relationships></Item>" $true { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return (Env '<Item type="Part" id="A"><id>A</id><locked_by_id>U1</locked_by_id></Item>') } return (Env '') } }
$m['unlockFails'] = Run-Import "<Item type='Part' id='A' action='add' />" $true { param($h) $h.UnlockFault = 'FAULT:999'; $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return (Env '<Item type="Part" id="A"><id>A</id><locked_by_id>U1</locked_by_id></Item>') } return (Env '') } }
$m['responseNoNamespaceEnvelope'] = Run-Import "<Item type='Part' id='A' action='add' />" $true { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return '<Envelope><Body><Result><Item type="Part" id="A"><id>A</id></Item></Result></Body></Envelope>' } return (Env '') } }
$m['responseOtherNamespace'] = Run-Import "<Item type='Part' id='A' action='add' />" $true { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return '<e:Envelope xmlns:e="urn:other"><e:Body><e:Result><Item type="Part" id="A"><id>A</id></Item></e:Result></e:Body></e:Envelope>' } return (Env '') } }
$m['responseItemInsideItems'] = Run-Import "<Item type='Part' id='A' action='add' />" $true { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return (Env '<Items><Item type="Part" id="A"><id>A</id></Item></Items>') } return (Env '') } }
$m['apostropheInType'] = Run-Import "<Item type=""Pa'rt"" id='A' action='add' />" $true
$m['ampersandInId'] = Run-Import "<Item type='Part' id='A&amp;B' action='add' />" $true
$m['getRequestsKeepDuplicates'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part' id='A' action='add' /></Relationships></Item>" $true
Note 'M.merge' $m

# --- G: versionable adds in merge mode -----------------------------------------------------------------
$g = [ordered]@{}
$g['versionableAddCallsSetItemId'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='R' action='add' /></Relationships></Item>" $true { param($h) $h.Versionable['Part'] = $true; $h.LatestId['A'] = 'A2' }
$g['versionableIdChangedThenExists'] = Run-Import "<Item type='Part' id='A' action='add' />" $true { param($h) $h.Versionable['Part'] = $true; $h.LatestId['A'] = 'A2'; $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return (Env '<Item type="Part" id="A2"><id>A2</id></Item>') } return (Env '') } }
$g['nonVersionableNoCall'] = Run-Import "<Item type='Part' id='A' action='add' />" $true
$g['versionableCalledForNestedEditsNot'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part' id='B' action='add' /></Relationships></Item>" $true { param($h) $h.Versionable['Part'] = $true }
$g['versionableNoIdSkipsDictionary'] = Run-Import "<Item type='Part' where=""name='x'"" action='add' />" $true { param($h) $h.Versionable['Part'] = $true }
Note 'G.versionableMerge' $g

# --- C: the Change Controlled Relationship property rule --------------------------------------------------
$c = [ordered]@{}
$ccrExists = { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*action='get'*") { return (Env '<Item type="Property" id="P1"><id>P1</id></Item>') } return (Env '') } }
foreach ($nm in 'related_id', 'sort_order', 'source_id', 'name', 'Related_Id') {
    $c["ccr.$nm"] = Run-Import "<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'><name>$nm</name><source_id keyed_name='Change Controlled Relationship' type='ItemType'>IT</source_id></Item></Relationships></Item>" $true $ccrExists
}
$c['ccr.otherKeyedName'] = Run-Import "<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'><name>related_id</name><source_id keyed_name='Part' type='ItemType'>IT</source_id></Item></Relationships></Item>" $true $ccrExists
$c['ccr.noKeyedName'] = Run-Import "<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'><name>related_id</name><source_id>IT</source_id></Item></Relationships></Item>" $true $ccrExists
$c['ccr.noName'] = Run-Import "<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'><source_id keyed_name='Change Controlled Relationship'>IT</source_id></Item></Relationships></Item>" $true $ccrExists
$c['ccr.notExisting'] = Run-Import "<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'><name>related_id</name><source_id keyed_name='Change Controlled Relationship'>IT</source_id></Item></Relationships></Item>" $true
$c['ccr.anyTypeWithTheShape'] = Run-Import "<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Other' id='P1' action='add'><name>related_id</name><source_id keyed_name='Change Controlled Relationship'>IT</source_id></Item></Relationships></Item>" $true { param($h) $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*type='Other'*action='get'*") { return (Env '<Item type="Other" id="P1"><id>P1</id></Item>') } return (Env '') } }
$c['ccr.rootProperty'] = Run-Import "<Item type='Property' id='P1' action='add'><name>related_id</name><source_id keyed_name='Change Controlled Relationship'>IT</source_id></Item>" $true $ccrExists
$c['ccr.sameIdTwoNodes'] = Run-Import "<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'><name>related_id</name><source_id keyed_name='Change Controlled Relationship'>IT</source_id></Item><Item type='Property' id='P1' action='add'><name>other</name></Item></Relationships></Item>" $true $ccrExists
Note 'C.ccrProperty' $c

# --- P: ProcessVersionableItem ---------------------------------------------------------------------------------
$p = [ordered]@{}
$verRoot = { param($h) $h.Versionable['Part'] = $true }
$p['plainRelationshipExists'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id>B</related_id></Item></Relationships></Item>" $false { param($h) $h.Versionable['Part'] = $true; $h.RelExists['Part BOM|A|B'] = $true }
$p['plainRelationshipMissing'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' id='R1' action='edit' where=""x='y'""><source_id>A</source_id><related_id>B</related_id></Item></Relationships></Item>" $false $verRoot
$p['relationshipWithoutSourceId'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' id='R1' action='add'><related_id>B</related_id></Item></Relationships></Item>" $false $verRoot
$p['relationshipWithoutRelatedId'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id></Item></Relationships></Item>" $false $verRoot
$p['relatedIdWithItemAndId'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id><Item type='Part' id='B' action='add' /></related_id></Item></Relationships></Item>" $false { param($h) $h.Versionable['Part'] = $true; $h.RelExists['Part BOM|A|B'] = $true }
$p['relatedIdWithItemNoId'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id><Item type='Part' action='add' where=""name='b'"" /></related_id></Item></Relationships></Item>" $false $verRoot
$p['relatedIdTwoItemsSecondHasId'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id><Item type='Part' action='add' where=""name='b'"" /><Item type='Part' id='B2' action='add' /></related_id></Item></Relationships></Item>" $false { param($h) $h.Versionable['Part'] = $true; $h.RelExists['Part BOM|A|B2'] = $true }
$p['relatedIdTextWithWhitespaceChildren'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' action='add'><source_id>A</source_id><related_id keyed_name='k' type='Part'>B</related_id></Item></Relationships></Item>" $false { param($h) $h.Versionable['Part'] = $true; $h.RelExists['Part BOM|A|B'] = $true }
$p['existFaultOther'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' action='add'><source_id>A</source_id><related_id>B</related_id></Item></Relationships></Item>" $false { param($h) $h.Versionable['Part'] = $true; $h.RelFault['Part BOM|A|B'] = 999 }
$p['apostropheInRelated'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' action='add'><source_id>A</source_id><related_id>B'C</related_id></Item></Relationships></Item>" $false { param($h) $h.Versionable['Part'] = $true; $h.RelExists["Part BOM|A|B'C"] = $true }
$p['sourceIdNotRootId'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' action='add'><source_id>OTHER</source_id><related_id>B</related_id></Item></Relationships></Item>" $false { param($h) $h.Versionable['Part'] = $true; $h.RelExists['Part BOM|OTHER|B'] = $true }
$p['nonVersionableRootUntouched'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id>B</related_id></Item></Relationships></Item>" $false
$p['relationshipsNotUnderRootIgnored'] = Run-Import "<Item type='Part' id='A' action='edit'><Foo><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id>B</related_id></Item></Relationships></Foo></Item>" $false $verRoot
$p['deeperRelationshipsIgnored'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' action='add'><source_id>A</source_id><Relationships><Item type='X' id='R9' action='add'><source_id>A</source_id><related_id>B</related_id></Item></Relationships></Item></Relationships></Item>" $false $verRoot
$p['mpMacFound'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='mp_MacCondition' id='R1' action='add'><source_id>A</source_id><ref_id>RR</ref_id></Item></Relationships></Item>" $false { param($h) $h.Versionable['Part'] = $true; $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*mp_MacCondition*action='get'*") { return (Env '<Item type="mp_MacCondition" id="M1"><id>M1</id></Item>') } return (Env '') } }
$p['mpMacMissing'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='mp_MacCondition' id='R1' where=""z='1'"" action='edit'><source_id>A</source_id><ref_id>RR</ref_id></Item></Relationships></Item>" $false $verRoot
$p['mpMacFault999'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='mp_MacCondition' action='add'><source_id>A</source_id><ref_id>RR</ref_id></Item></Relationships></Item>" $false { param($h) $h.Versionable['Part'] = $true; $h.OnApply = [Func[string, string]]{ param($a) if ($a -like "*mp_MacCondition*action='get'*") { return 'FAULT:999' } return (Env '') } }
$p['mpMacNoRefId'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='mp_MacCondition' action='add'><source_id>A</source_id></Item></Relationships></Item>" $false $verRoot
$p['mpMacNoSourceId'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='mp_MacCondition' action='add'><ref_id>RR</ref_id></Item></Relationships></Item>" $false $verRoot
$p['mpMacWithRelatedIdIgnored'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='mp_MacCondition' action='add'><source_id>A</source_id><ref_id>RR</ref_id><related_id>B</related_id></Item></Relationships></Item>" $false $verRoot
$p['mpMacApostrophe'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='mp_MacCondition' action='add'><source_id>A</source_id><ref_id>R'R</ref_id></Item></Relationships></Item>" $false $verRoot
$p['mpMacTypeCaseSensitive'] = Run-Import "<Item type='Part' id='A' action='edit'><Relationships><Item type='MP_MacCondition' action='add'><source_id>A</source_id><ref_id>RR</ref_id><related_id>B</related_id></Item></Relationships></Item>" $false $verRoot
$p['mergeThenVersionable'] = Run-Import "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id>B</related_id></Item></Relationships></Item>" $true { param($h) $h.Versionable['Part'] = $true; $h.LatestId['A'] = 'A2'; $h.RelExists['Part BOM|A|B'] = $true }
Note 'P.processVersionableItem' $p

# ---------------------------------------------------------------------------------------------
# Part 2: CItemHelper against a stub connection
# ---------------------------------------------------------------------------------------------
function New-Helper($conn) {
    $helper = New-Object Aras.Tools.SolutionUpgrade.CItemHelper($conn)
    # 12.0's version type has three fields, 14.0.7's five.
    if ($Engine -eq '12.0') { $version = New-Object Aras.Tools.SolutionUpgrade.ArasVersion(12, 0, 9) } else { $version = New-Object Aras.Tools.SolutionUpgrade.ArasVersion(14, 0, 9, 1, 0) }
    $helper.GetType().GetProperty('InnovatorVersion').GetSetMethod($true).Invoke($helper, [object[]]@($version.psobject.BaseObject)) | Out-Null
    $helper.Folder = 'C:\probe-out'
    return $helper
}
function New-Stub($script) { $c = New-Object Probe.StubConnection; $c.Respond = $script; return $c }
function Load([string] $xml) { $d = New-Object System.Xml.XmlDocument; $d.LoadXml($xml); return $d }
$isVer = { param($r) $r -like '*select="is_versionable"*' }

# A script for a versionable type. `curState` is what the first current-id lookup (config_id, is_current) answers:
# current, old, missing (faultcode 0, and the config lookup then finds nothing either), missingConfigFound (faultcode 0,
# and the config lookup finds `latest`), error (faultcode 999) or nocfg (an item without config_id).
function Version-Script([bool] $versionable, [string] $curState, [string] $latest = 'LATEST') {
    return {
        param($r)
        if ($r -like '*select="is_versionable"*') { return (Env ('<Item type="ItemType" id="X"><is_versionable>' + $(if ($versionable) { '1' } else { '0' }) + '</is_versionable></Item>')) }
        if ($r -like '*select="config_id, is_current"*') {
            if ($curState -eq 'current') { return (Env '<Item type="Part" id="A"><config_id>CFG</config_id><is_current>1</is_current></Item>') }
            if ($curState -eq 'old') { return (Env '<Item type="Part" id="A"><config_id>CFG</config_id><is_current>0</is_current></Item>') }
            if ($curState -eq 'missing' -or $curState -eq 'missingConfigFound') { return [Probe.Env]::Fault('0', 'No items of type Part found.') }
            if ($curState -eq 'error') { return [Probe.Env]::Fault('999', 'boom') }
            if ($curState -eq 'nocfg') { return (Env '<Item type="Part" id="A"><is_current>0</is_current></Item>') }
        }
        if ($r -like '*select="id"*<config_id>*') {
            if ($curState -eq 'missing') { return [Probe.Env]::Fault('0', 'No items of type Part found.') }
            return (Env ('<Item type="Part" id="' + $latest + '"><id>' + $latest + '</id></Item>'))
        }
        if ($r -like '*is_keyed*') { return (Env '<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><name>item_number</name></Item></Relationships></Item>') }
        if ($r -like '*item_number*') { return (Env '<Item type="Part" id="KEYID"><id>KEYID</id></Item>') }
        return $null
    }.GetNewClosure()
}
function Run-Set([string] $xml, $script) {
    $c = New-Stub $script
    $h = New-Helper $c
    $d = Load $xml
    $thrown = $null
    try { $h.SetItemIdToLastGeneration($d.DocumentElement) } catch { $thrown = Desc $_.Exception }
    return [ordered]@{ input = $xml; requests = @($c.Requests); thrown = $thrown; documentAfter = $d.OuterXml }
}
$s = [ordered]@{}
$partXml = "<Item type='Part' id='A' action='add'><item_number>P1</item_number><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id></Item><Item type='Part BOM' id='R2' action='add'><source_id>OTHER</source_id><Relationships><Item type='X' action='add'><source_id>A</source_id></Item></Relationships></Item></Relationships></Item>"
$s['noId'] = Run-Set "<Item type='Part' action='add'/>" (Version-Script $true 'current')
$s['noType'] = Run-Set "<Item id='A' action='add'/>" (Version-Script $true 'current')
$s['emptyId'] = Run-Set "<Item type='Part' id='' action='add'/>" (Version-Script $true 'current')
$s['notVersionable'] = Run-Set $partXml (Version-Script $false 'current')
$s['alreadyCurrent'] = Run-Set $partXml (Version-Script $true 'current')
$s['oldGeneration'] = Run-Set $partXml (Version-Script $true 'old' 'LATEST')
$s['oldGenerationSameIdAsLatest'] = Run-Set $partXml (Version-Script $true 'old' 'A')
$s['currentIdLookupMissingConfigFound'] = Run-Set $partXml (Version-Script $true 'missingConfigFound')
$s['notFoundAnywhereFallsToUniqueKey'] = Run-Set $partXml (Version-Script $true 'missing')
$s['currentIdLookupFaultOtherFallsToUniqueKey'] = Run-Set $partXml (Version-Script $true 'error')
$s['currentIdNoConfigIsNotCaught'] = Run-Set $partXml (Version-Script $true 'nocfg')
$noKeyProps = {
    param($r)
    if ($r -like '*select="is_versionable"*') { return (Env '<Item type="ItemType" id="X"><is_versionable>1</is_versionable></Item>') }
    if ($r -like '*select="config_id, is_current"*') { return [Probe.Env]::Fault('0', 'none') }
    if ($r -like '*select="id"*<config_id>*') { return [Probe.Env]::Fault('0', 'none') }
    if ($r -like '*is_keyed*') { return [Probe.Env]::Fault('0', 'none') }
    return $null
}
$s['uniqueKeyNoPropertiesLeavesIdAlone'] = Run-Set $partXml $noKeyProps
$s['uniqueKeyMissingPropertyThrows'] = Run-Set "<Item type='Part' id='A' action='add'><Relationships /></Item>" (Version-Script $true 'missing')
$s['relationshipsWithoutSourceId'] = Run-Set "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='R1' action='add'><related_id>B</related_id></Item></Relationships></Item>" (Version-Script $true 'old' 'LATEST')
$s['nestedInRelatedIdUntouched'] = Run-Set "<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id><Item type='Part' id='A'><Relationships><Item type='Y'><source_id>A</source_id></Item></Relationships></Item></related_id></Item></Relationships></Item>" (Version-Script $true 'old' 'LATEST')
Note 'S.setItemIdToLastGeneration' $s

function Run-Exists([string] $xml, $script, [bool] $withPair = $false) {
    $c = New-Stub $script
    $h = New-Helper $c
    $d = Load $xml
    $thrown = $null; $result = $null; $pairId = $null
    try {
        if ($withPair) {
            $pair = New-Object Aras.Tools.SolutionUpgrade.CItemHelper+IdTypePair('Part', 'A')
            $result = $h.DoesItemAlreadyExist($d.DocumentElement, $pair)
            $pairId = $pair.strId
        } else {
            $result = $h.DoesItemAlreadyExist($d.DocumentElement, $null)
        }
    } catch { $thrown = Desc $_.Exception }
    return [ordered]@{ input = $xml; result = $result; pairId = $pairId; requests = @($c.Requests); thrown = $thrown; documentAfter = $d.OuterXml }
}
$e = [ordered]@{}
$plainItem = "<Item type='List' id='L1' action='add'><name>n</name></Item>"
$e['plainExists'] = Run-Exists $plainItem { param($r) if ($r -like '*select="is_versionable"*') { return (Env '<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>') } return (Env '<Item type="List" id="L1"><id>L1</id></Item>') }
$e['plainMissing'] = Run-Exists $plainItem { param($r) if ($r -like '*select="is_versionable"*') { return (Env '<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>') } return [Probe.Env]::Fault('0', 'No items') }
$e['plainServerError999IsNotExist'] = Run-Exists $plainItem { param($r) if ($r -like '*select="is_versionable"*') { return (Env '<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>') } return [Probe.Env]::Fault('999', 'boom') }
$e['noIdAttribute'] = Run-Exists "<Item type='List' action='add'/>" { param($r) return $null }
$e['noTypeAttribute'] = Run-Exists "<Item id='L1' action='add'/>" { param($r) return $null }
$e['emptyIdAttribute'] = Run-Exists "<Item type='List' id='' action='add'/>" { param($r) return $null }
$e['versionableCurrent'] = Run-Exists $partXml (Version-Script $true 'current')
$e['versionableOldGeneration'] = Run-Exists $partXml (Version-Script $true 'old' 'LATEST')
$e['versionableConfigFoundByLookup'] = Run-Exists $partXml (Version-Script $true 'missingConfigFound')
$e['versionableNotFoundUniqueKeyFinds'] = Run-Exists $partXml (Version-Script $true 'missing')
$e['versionableNotFoundUniqueKeyNone'] = Run-Exists $partXml $noKeyProps
$e['versionableLookupFault999FallsToUniqueKey'] = Run-Exists $partXml (Version-Script $true 'error')
$e['versionableNoConfigNotCaught'] = Run-Exists $partXml (Version-Script $true 'nocfg')
$e['idTypePairIsUsed'] = Run-Exists "<Item type='Part' id='IGNORED' action='add'/>" (Version-Script $true 'old' 'LATEST') $true
Note 'E.doesItemAlreadyExist' $e

# ItemExistById, ExistRelItemInCurVer and Unlock send these requests (no IsVersionable involved).
$x = [ordered]@{}
foreach ($mode in 'found', 'missing', 'error999', 'xmlerror') {
    $c = New-Stub ({ param($r) if ($mode -eq 'found') { return (Env '<Item type="Part" id="A"><id>A</id></Item>') } if ($mode -eq 'missing') { return [Probe.Env]::Fault('0', 'No items') } if ($mode -eq 'error999') { return [Probe.Env]::Fault('999', 'boom') } return $null }.GetNewClosure())
    $h = New-Helper $c
    $r1 = $null; $t1 = $null; $r2 = $null; $t2 = $null
    try { $r1 = $h.ItemExistById('A', 'Part') } catch { $t1 = Desc $_.Exception }
    try { $r2 = $h.ExistRelItemInCurVer('Part BOM', 'A', 'B') } catch { $t2 = Desc $_.Exception }
    $x["rel.$mode"] = [ordered]@{ itemExistById = $r1; itemExistByIdThrown = $t1; existRel = $r2; existRelThrown = $t2; requests = @($c.Requests); actions = @($c.Actions) }
}
$c = New-Stub { param($r) return (Env '<Item type="Part" id="A"/>') }
$h = New-Helper $c
$h.Unlock('A', 'Part')
$x['unlock.ok'] = [ordered]@{ requests = @($c.Requests); actions = @($c.Actions) }
$c = New-Stub { param($r) return [Probe.Env]::Fault('999', 'cannot unlock') }
$h = New-Helper $c
$t = $null; try { $h.Unlock('A', 'Part') } catch { $t = Desc $_.Exception }
$x['unlock.fault'] = [ordered]@{ requests = @($c.Requests); thrown = $t }
$c = New-Stub { param($r) return [Probe.Env]::Fault('0', 'No items') }
$h = New-Helper $c
$t = $null; try { $h.Unlock('A', 'Part') } catch { $t = Desc $_.Exception }
$x['unlock.fault0'] = [ordered]@{ requests = @($c.Requests); thrown = $t }
$c = New-Stub { param($r) return (Env '') }
$h = New-Helper $c
$t = $null; try { [void]$h.ExistRelItemInCurVer("Part BOM", "A'B", "C&D") } catch { $t = Desc $_.Exception }
$x['rel.unescapedValues'] = [ordered]@{ requests = @($c.Requests); thrown = $t }
# An empty document (the Change Controlled Relationship rule can leave one) sent through the real applyAML.
$c = New-Stub { param($r) return (Env '') }
$h = New-Helper $c
$t = $null; try { [void]$h.applyAML('') } catch { $t = Desc $_.Exception }
$x['applyAML.emptyString'] = [ordered]@{ requests = @($c.Requests); thrown = $t }
Note 'X.lookups' $x

[System.IO.File]::WriteAllText($Out, ($log | ConvertTo-Json -Depth 14), (New-Object System.Text.UTF8Encoding($false)))
'done'
