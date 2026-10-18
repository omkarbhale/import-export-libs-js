# Offline probe of engine 14.35's language-resource export (spec/language-export.md, LP-100 to LP-199).
# Windows PowerShell 5.1. It runs the engine's own code: the ImportExportManager constructor with
# the language actions (section C), CExportItems.Export's requests (R), the four private steps on
# in-memory documents (MK, RM, ORD, ADD), a whole Export through the real export.xsl (E) and a whole
# ExportSolutions run (X). It needs no server, no credential and no password: LangStub.cs and the
# export-output probe's Stub.cs answer every request. It writes only under -Work.
# -Bin is a staged copy of oracle/native/14.35; -StubDir holds the export-output probe's Stub.cs (README.md).
param([Parameter(Mandatory)][string] $Bin, [Parameter(Mandatory)][string] $Work, [Parameter(Mandatory)][string] $StubDir, [string[]] $Only = @(), [switch] $Stack, [switch] $Requests)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Work)) { New-Item -ItemType Directory -Path $Work | Out-Null }
[Environment]::CurrentDirectory = $Work
Set-Location $Work
[void][Reflection.Assembly]::LoadFrom((Join-Path $Bin 'IOM.dll'))
$libs = [Reflection.Assembly]::LoadFrom((Join-Path $Bin 'Libs.dll'))
Add-Type -AssemblyName System.Xml
$refs = @((Join-Path $Bin 'IOM.dll'), (Join-Path $Bin 'Libs.dll'), 'System.Xml', 'System.Core')
# Stub.cs and LangStub.cs are compiled together: the using lines of both go first, then both bodies.
$files = @((Join-Path $StubDir 'Stub.cs'), (Join-Path $PSScriptRoot 'LangStub.cs'))
$usings = @(); $bodies = @()
foreach ($f in $files) { foreach ($line in (Get-Content -LiteralPath $f)) { if ($line -match '^using ') { $usings += $line.Trim() } else { $bodies += $line } } }
Add-Type -TypeDefinition ((($usings | Select-Object -Unique) -join "`n") + "`n" + ($bodies -join "`n")) -ReferencedAssemblies $refs
$flags = [Reflection.BindingFlags]'Public,NonPublic,Instance,Static'
$T = 'Aras.Tools.SolutionUpgrade.'
$cih = $libs.GetType($T + 'CItemHelper'); $cei = $libs.GetType($T + 'CExportItems'); $iem = $libs.GetType($T + 'ImportExportManager')
$ieType = $libs.GetType($T + 'ImportExport')
$iow = New-Object ($libs.GetType($T + 'IOWrapper'))
"# engine $($libs.GetName().Version), CLR $([Environment]::Version)"
function Act([string]$n) { [Enum]::Parse($ieType, $n) }
$I18N = 'http://www.aras.com/I18N'

function Esc([string]$s) { if ($null -eq $s) { return '<null>' }; $sb = New-Object Text.StringBuilder; foreach ($c in $s.ToCharArray()) { $n = [int]$c; if ($c -eq "`r") { [void]$sb.Append('\r') } elseif ($c -eq "`n") { [void]$sb.Append('\n') } elseif ($c -eq "`t") { [void]$sb.Append('\t') } elseif ($n -lt 32 -or $n -gt 126) { [void]$sb.Append(('\u{0:X4}' -f $n)) } else { [void]$sb.Append($c) } }; $sb.ToString() }
function Inner($e) { while ($e.InnerException) { $e = $e.InnerException }; $e }
function Want([string]$id) { if ($Only.Count -eq 0) { return $true }; foreach ($p in ($Only -split ',')) { if ($id -like $p) { return $true } }; return $false }
function NewDoc([string]$xml, [bool]$pw = $true) { $d = New-Object System.Xml.XmlDocument; $d.PreserveWhitespace = $pw; $d.LoadXml($xml); $d }
function Dump($doc) {
  $p = Join-Path $Work ('f' + [guid]::NewGuid().ToString('N') + '.xml')
  $iow.XmlDocumentSaveWithSettings($doc, $p, $null)
  $b = [IO.File]::ReadAllBytes($p); Remove-Item $p
  $bom = ''; $off = 0
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $bom = '[BOM]'; $off = 3 }
  $bom + '"' + (Esc ([Text.Encoding]::UTF8.GetString($b, $off, $b.Length - $off))) + '"'
}
function U($x) { if ($x -is [System.Management.Automation.PSObject]) { $x.psobject.BaseObject } else { $x } }
function Call($m, $obj, $a2) { $a = @(); foreach ($x in $a2) { $a += ,(U $x) }; try { $m.Invoke((U $obj), [object[]]$a) } catch [Reflection.TargetInvocationException] { throw $_.Exception.InnerException } }
function Norm([string]$s) { $s = $s.Replace($Work, '<WD>'); [regex]::Replace($s, '\d\d/\d\d/\d{4} \d\d:\d\d:\d\d', '<T>') }

# ---- helpers: a helper over a scripted connection ----------------------------------------------
function New-Conn([scriptblock]$setup) { $c = New-Object Probe.LangConnection; if ($setup) { & $setup $c }; $c }
function New-Helper($conn, [string]$folder = $Work) {
  $h = New-Object ($libs.GetType($T + 'CItemHelper')) -ArgumentList @($conn)
  $v = New-Object ($libs.GetType($T + 'ArasVersion')) -ArgumentList @(12, 0, 9, 1, 0)
  $h.GetType().GetProperty('InnovatorVersion').GetSetMethod($true).Invoke($h, [object[]]@($v.psobject.BaseObject)) | Out-Null
  $h.Folder = $folder
  $h
}
function New-Ctx([string]$action, $langs, [string]$wd = $Work) {
  $ctx = New-Object ($libs.GetType($T + 'SolutionUpgradeContext'))
  $ctx.Action = Act $action
  $ctx.WorkingDirectory = $wd
  $ctx.LogFilePath = Join-Path $wd 'engine.log'
  $ctx.Url = 'http://stub/'; $ctx.DataBase = 'db'; $ctx.UserName = 'u'
  if ($null -ne $langs) { $ctx.Languages = [string[]]$langs }
  $ctx
}
function Show-Langs($ctx) { $l = $ctx.Languages; if ([object]::ReferenceEquals($l, $null)) { '<null>' } else { '[' + (($l | ForEach-Object { '"' + $_ + '"' }) -join ',') + '] (' + $l.Length + ')' } }
function Show-Requests($conn, [switch]$Brief, [string]$Full = '') {
  $i = 0
  foreach ($q in $conn.Seen) {
    $i++
    if ($Brief) {
      $x = New-Object System.Xml.XmlDocument; $x.LoadXml($q); $e = $x.DocumentElement
      $nm = $x.SelectSingleNode('name')
      '  ' + $i + ' ' + $e.GetAttribute('type') + $(if ($nm) { ' name=' + $nm.InnerText } else { '' }) + ' select=' + $(if ($e.HasAttribute('select')) { '"' + $e.GetAttribute('select') + '"' } else { '<none>' })
      # the main fetch of the item (the request that holds the id of the exported item) is shown in full
      if ($e.SelectSingleNode('id')) { '    ' + (Esc $q) }
    } else { '  ' + $i + ' ' + (Esc $q) }
  }
}

# ================================================================================================
# C: the ImportExportManager constructor with the language actions
# ================================================================================================
function Ctor($id, $action, $langs, [scriptblock]$setup = $null) {
  if (-not (Want $id)) { return }
  $conn = New-Conn $setup
  $helper = New-Helper $conn
  $ctx = New-Ctx $action $langs
  "## $id  action=$action  in=$(if ($null -eq $langs) { '<null>' } else { '[' + ($langs -join ',') + '] (' + @($langs).Count + ')' })"
  $msgs = New-Object Probe.ProbeMessages
  try { [void](New-Object $iem -ArgumentList @($ctx, $msgs, $helper)); "result: constructed; context.Languages = " + (Show-Langs $ctx) }
  catch { $e = Inner $_.Exception; "result: " + $e.GetType().FullName + ': ' + (Esc $e.Message); if ($e.GetType().GetProperty('faultcode')) { "  faultcode=" + $e.faultcode + " faultstring=" + (Esc $e.faultstring) + " faultdetail=" + (Esc $e.faultdetail) }; "  context.Languages afterwards = " + (Show-Langs $ctx) }
  "language requests: $(@($conn.Seen | Where-Object { $_ -like '*type=""Language""*' }).Count) of $(@($conn.Seen).Count)"
  if (@($conn.Seen).Count -gt 0) { Show-Requests $conn }
}
"# ---- C: constructor"
$de3 = { param($c) $c.LanguageCodes = [Collections.Generic.List[string]]@('en', 'de', 'fr') }
$de1 = { param($c) $c.LanguageCodes = [Collections.Generic.List[string]]@('en', 'de') }
$en1 = { param($c) $c.LanguageCodes = [Collections.Generic.List[string]]@('en') }
Ctor 'C01-only-de' 'ExportLanguageResourcesOnly' @('en', 'de') $de3
Ctor 'C02-meta-de' 'ExportMetadataWithLanguageResources' @('en', 'de') $de3
Ctor 'C03-star-only' 'ExportLanguageResourcesOnly' @('*') $de3
Ctor 'C04-star-meta' 'ExportMetadataWithLanguageResources' @('*') $de3
Ctor 'C05-star-en-only' 'ExportLanguageResourcesOnly' @('*') $en1
Ctor 'C06-star-server-case' 'ExportLanguageResourcesOnly' @('*') { param($c) $c.LanguageXml = '<Item type="Language" id="1"><code>DE</code><name>German</name></Item><Item type="Language" id="2"><code>EN</code><name>English</name></Item><Item type="Language" id="3"><code>Fr</code><name>French</name></Item>' }
Ctor 'C07-star-server-error' 'ExportLanguageResourcesOnly' @('*') { param($c) $c.LanguageFaultCode = '1' }
Ctor 'C08-star-no-languages' 'ExportLanguageResourcesOnly' @('*') { param($c) }
Ctor 'C09-null-only' 'ExportLanguageResourcesOnly' $null $de3
Ctor 'C10-null-export' 'Export' $null $de3
Ctor 'C11-empty-only' 'ExportLanguageResourcesOnly' @() $de3
Ctor 'C12-upper-case-code' 'ExportLanguageResourcesOnly' @('en', 'DE') $de3
Ctor 'C13-upper-case-en' 'ExportLanguageResourcesOnly' @('EN', 'de') $de3
Ctor 'C14-not-installed' 'ExportLanguageResourcesOnly' @('en', 'xx', 'de', 'yy', 'xx') $de3
Ctor 'C15-not-installed-one' 'ExportMetadataWithLanguageResources' @('zz') $de3
Ctor 'C16-star-and-code' 'ExportLanguageResourcesOnly' @('*', 'de') $de3
Ctor 'C17-star-twice' 'ExportLanguageResourcesOnly' @('*', '*') $de3
Ctor 'C18-only-en' 'ExportLanguageResourcesOnly' @('en') $de3
Ctor 'C19-export-plain-de' 'Export' @('en', 'de') $de3
Ctor 'C20-export-plain-not-installed' 'Export' @('fr') $de1
Ctor 'C21-export-plain-star' 'Export' @('*') $de3
Ctor 'C22-lpimport-not-installed' 'LPImport' @('fr') $de1
Ctor 'C23-server-null-code' 'ExportLanguageResourcesOnly' @('de') { param($c) $c.LanguageXml = '<Item type="Language" id="1"><name>No code</name></Item>' }
Ctor 'C24-star-null-code' 'ExportLanguageResourcesOnly' @('*') { param($c) $c.LanguageXml = '<Item type="Language" id="1"><code>de</code></Item><Item type="Language" id="2"><name>No code</name></Item>' }
Ctor 'C25-check-server-fault' 'ExportLanguageResourcesOnly' @('de') { param($c) $c.LanguageFaultCode = '1' }
Ctor 'C26-check-no-languages' 'ExportLanguageResourcesOnly' @('de') { param($c) }
Ctor 'C27-empty-element-order' 'ExportLanguageResourcesOnly' @('b', 'a', 'b', 'c') { param($c) $c.LanguageCodes = [Collections.Generic.List[string]]@('en') }
Ctor 'C28-space-code' 'ExportLanguageResourcesOnly' @('en', ' de') $de3
Ctor 'C29-empty-string-code' 'ExportLanguageResourcesOnly' @('en', '') $de3

# ================================================================================================
# R: the requests of Export in the language modes
# ================================================================================================
$schema = {
  param($c)
  $c.Rels['TA'] = [string[]]@('R1', 'R2'); $c.Rels['TB'] = [string[]]@('R3')
  $c.Related['TA'] = ''; $c.Related['TB'] = ''; $c.Related['R1'] = 'TB'; $c.Related['R2'] = ''; $c.Related['R3'] = ''
  $c.Ml['TA'] = [string[]]@('label', 'description'); $c.Ml['R1'] = [string[]]@('title'); $c.Ml['TB'] = [string[]]@('label'); $c.Ml['Property'] = [string[]]@('label', 'help_tooltip', 'default_value')
  $c.Ml['ItemType'] = [string[]]@('label', 'label_plural'); $c.Ml['List'] = [string[]]@('label'); $c.Ml['Value'] = [string[]]@('label')
}
function ReqRun($id, $type, $level, $action, $langs, [scriptblock]$setup = $schema, [switch]$Brief, [string]$keyed = 'k', [string]$itId = 'A1B2C3D4E5F60718293A4B5C6D7E8F90') {
  if (-not (Want $id)) { return }
  $conn = New-Conn $setup
  $conn.ItemBody = ''
  $helper = New-Helper $conn
  $exporter = New-Object ($libs.GetType($T + 'CExportItems')) -ArgumentList @($helper)
  $dict = New-Object 'System.Collections.Concurrent.ConcurrentDictionary[string,System.Lazy[Aras.IOM.Item]]'
  $els = New-Object 'System.Collections.Generic.Dictionary[string,System.Collections.Generic.HashSet[string]]'
  $item = New-Object ($libs.GetType($T + 'ExportItem')) -ArgumentList @($keyed, $itId, $type)
  "## $id  type=$type level=$(if ($null -eq $level) { '<null>' } else { '"' + $level + '"' }) action=$action languages=$(if ($null -eq $langs) { '<null>' } else { '[' + ($langs -join ',') + ']' })"
  $thrown = $null
  $arg = $null; if ($null -ne $langs) { $arg = [string[]]@($langs) }
  try { $exporter.Export($item, 'pkg', $level, $null, (Act $action), $arg, $dict, $els) } catch { $e = Inner $_.Exception; $thrown = $e.GetType().FullName + ': ' + $e.Message }
  "thrown: " + $(if ($thrown) { Esc (Norm $thrown) } else { '<none>' })
  if ($Brief) { Show-Requests $conn -Brief -Full $type } else { Show-Requests $conn }
  '--'
}
"# ---- R: requests"
$L = @('de', 'fr')
ReqRun 'R01-TA-level1-only' 'TA' '1' 'ExportLanguageResourcesOnly' $L
ReqRun 'R02-TA-level2-only' 'TA' '2' 'ExportLanguageResourcesOnly' $L
ReqRun 'R03-TA-level1-meta' 'TA' '1' 'ExportMetadataWithLanguageResources' $L
ReqRun 'R04-TA-level2-meta' 'TA' '2' 'ExportMetadataWithLanguageResources' $L
ReqRun 'R05-TA-level0-only' 'TA' '0' 'ExportLanguageResourcesOnly' $L
ReqRun 'R06-TA-level0-meta' 'TA' '0' 'ExportMetadataWithLanguageResources' $L
ReqRun 'R07-TA-level1-export' 'TA' '1' 'Export' $L
ReqRun 'R08-TA-level1-only-no-languages' 'TA' '1' 'ExportLanguageResourcesOnly' @()
ReqRun 'R09-TA-level1-only-en-in-list' 'TA' '1' 'ExportLanguageResourcesOnly' @('en', 'de', 'EN')
ReqRun 'R10-TA-level1-only-null-languages' 'TA' '1' 'ExportLanguageResourcesOnly' $null
ReqRun 'R11-TA-level1-meta-null-languages' 'TA' '1' 'ExportMetadataWithLanguageResources' $null
ReqRun 'R12-TC-no-ml-only' 'TC' '1' 'ExportLanguageResourcesOnly' $L { param($c) $c.Rels['TC'] = [string[]]@('R2'); $c.Related['TC'] = '' }
ReqRun 'R13-TC-no-ml-meta' 'TC' '1' 'ExportMetadataWithLanguageResources' $L { param($c) $c.Rels['TC'] = [string[]]@('R2'); $c.Related['TC'] = '' }
ReqRun 'R14-TC-ml-answers-item-only' 'TC' '1' 'ExportLanguageResourcesOnly' $L { param($c) $c.MlNoRows = 'item'; $c.Rels['TC'] = [string[]]@('R2'); $c.Related['TC'] = '' }
ReqRun 'R15-TC-ml-answers-fault1-only' 'TC' '1' 'ExportLanguageResourcesOnly' $L { param($c) $c.MlNoRows = 'fault1'; $c.Rels['TC'] = [string[]]@('R2'); $c.Related['TC'] = '' }
ReqRun 'R16-TC-ml-answers-item-meta' 'TC' '1' 'ExportMetadataWithLanguageResources' $L { param($c) $c.MlNoRows = 'item'; $c.Rels['TC'] = [string[]]@('R2'); $c.Related['TC'] = '' }
ReqRun 'R17-TA-ml-fault-only' 'TA' '1' 'ExportLanguageResourcesOnly' $L { param($c) $c.MlFaultCode = '1'; $c.Rels['TA'] = [string[]]@('R2'); $c.Related['TA'] = '' }
ReqRun 'R18-Property-rel-only' 'TA' '1' 'ExportLanguageResourcesOnly' $L { param($c) $c.Rels['TA'] = [string[]]@('Property', 'ItemType'); $c.Related['TA'] = ''; $c.Ml['TA'] = [string[]]@('label'); $c.Ml['Property'] = [string[]]@('label', 'help_tooltip'); $c.Ml['ItemType'] = [string[]]@('label') }
ReqRun 'R19-Property-rel-meta' 'TA' '1' 'ExportMetadataWithLanguageResources' $L { param($c) $c.Rels['TA'] = [string[]]@('Property', 'ItemType'); $c.Related['TA'] = ''; $c.Ml['TA'] = [string[]]@('label'); $c.Ml['Property'] = [string[]]@('label', 'help_tooltip'); $c.Ml['ItemType'] = [string[]]@('label') }
ReqRun 'R20-Property-rel-no-ml-only' 'TA' '1' 'ExportLanguageResourcesOnly' $L { param($c) $c.Rels['TA'] = [string[]]@('Property'); $c.Related['TA'] = ''; $c.Ml['TA'] = [string[]]@('label') }
ReqRun 'R21-Item-Report-only' 'Item Report' '1' 'ExportLanguageResourcesOnly' $L { param($c) $c.Ml['Item Report'] = [string[]]@('label') }
ReqRun 'R22-Item-Report-meta' 'Item Report' '1' 'ExportMetadataWithLanguageResources' $L { param($c) $c.Ml['Item Report'] = [string[]]@('label') }
ReqRun 'R23-List-only' 'List' '1' 'ExportLanguageResourcesOnly' $L { param($c) $c.Rels['List'] = [string[]]@('Value'); $c.Related['List'] = ''; $c.Ml['List'] = [string[]]@('label'); $c.Ml['Value'] = [string[]]@('label') }
ReqRun 'R24-List-meta' 'List' '1' 'ExportMetadataWithLanguageResources' $L { param($c) $c.Rels['List'] = [string[]]@('Value'); $c.Related['List'] = ''; $c.Ml['List'] = [string[]]@('label'); $c.Ml['Value'] = [string[]]@('label') }
ReqRun 'R25-ItemType-body-only' 'ItemType' '1' 'ExportLanguageResourcesOnly' $L -Brief
ReqRun 'R26-ItemType-body-meta' 'ItemType' '1' 'ExportMetadataWithLanguageResources' $L -Brief
ReqRun 'R27-ItemType-body-export' 'ItemType' '1' 'Export' $L -Brief
ReqRun 'R28-cmf_ContentType-only' 'cmf_ContentType' '1' 'ExportLanguageResourcesOnly' $L -Brief
ReqRun 'R29-RelationshipType-only' 'RelationshipType' '1' 'ExportLanguageResourcesOnly' $L { param($c) $c.Rels['RelationshipType'] = [string[]]@('R2'); $c.Related['RelationshipType'] = ''; $c.Ml['RelationshipType'] = [string[]]@('label') }
ReqRun 'R30-TA-level-blank-only' 'TA' '' 'ExportLanguageResourcesOnly' $L
ReqRun 'R31-TA-level3-only-brief' 'TA' '3' 'ExportLanguageResourcesOnly' $L -Brief
ReqRun 'R32-TA-ml-lookup-text-only-meta' 'TA' '1' 'ExportMetadataWithLanguageResources' @('de')
# a failed ml lookup is remembered for the run with the rest of the template (EXP-062): the second item of the type sends nothing
if (Want 'R33*') {
  "## R33-ml-fault-remembered  two items of TA, one dictionary, the ml lookup of TA answers faultcode 1"
  $conn = New-Conn { param($c) $c.MlFaultCode = '1'; $c.Rels['TA'] = [string[]]@('R2'); $c.Related['TA'] = '' }
  $helper = New-Helper $conn
  $exporter = New-Object ($libs.GetType($T + 'CExportItems')) -ArgumentList @($helper)
  $dict = New-Object 'System.Collections.Concurrent.ConcurrentDictionary[string,System.Lazy[Aras.IOM.Item]]'
  $els = New-Object 'System.Collections.Generic.Dictionary[string,System.Collections.Generic.HashSet[string]]'
  foreach ($n in 1, 2) {
    $item = New-Object ($libs.GetType($T + 'ExportItem')) -ArgumentList @(('k' + $n), ('ID' + $n), 'TA')
    $before = @($conn.Seen).Count
    try { $exporter.Export($item, 'pkg', '1', $null, (Act 'ExportLanguageResourcesOnly'), [string[]]@('de'), $dict, $els); "item ${n}: no exception" } catch { $e = Inner $_.Exception; "item ${n}: " + $e.GetType().FullName + ': ' + (Esc $e.Message) }
    "  requests sent for item ${n}: $(@($conn.Seen).Count - $before)"
  }
  '--'
}
# null languages reach the suffix loop only for a type that has ml_string properties
ReqRun 'R34-TC-no-ml-null-languages-only' 'TC' '1' 'ExportLanguageResourcesOnly' $null { param($c) $c.Rels['TC'] = [string[]]@('R2'); $c.Related['TC'] = '' }
ReqRun 'R35-TA-rel-ml-null-languages-only' 'TC' '1' 'ExportLanguageResourcesOnly' $null { param($c) $c.Rels['TC'] = [string[]]@('R1'); $c.Related['TC'] = ''; $c.Ml['R1'] = [string[]]@('title') }

# ================================================================================================
# MK, RM, ORD, ADD: the four private steps, on in-memory documents
# ================================================================================================
$mMK = $cei.GetMethod('MarkPropertiesWithTranslationsIfNeeded', $flags)
$mRM = $cei.GetMethod('RemoveNotLocalizedProperties', $flags)
$mORD = $cei.GetMethod('OrderPropertiesWithTranslations', $flags)
$mADD = $cei.GetMethod('AddI18NNamespaceToAllRootItems', $flags)
$ns = 'xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"'
function Env([string]$body) { '<SOAP-ENV:Envelope ' + $ns + ' xmlns:i18n="' + $I18N + '"><SOAP-ENV:Body><Result>' + $body + '</Result></SOAP-ENV:Body></SOAP-ENV:Envelope>' }
function Step($id, [string]$xml, $method, [string]$action) {
  if (-not (Want $id)) { return }
  "$id" + $(if ($method.GetParameters().Count -eq 1) { '' } else { " action=$action" })
  "$id in : " + (Esc $xml)
  try {
    $d = NewDoc $xml
    $r = if ($method.GetParameters().Count -eq 1) { Call $method $null @($d) } else { Call $method $null @($d, (Act $action)) }
    if ($method.ReturnType -eq [System.Xml.XmlDocument]) { if ($null -eq $r) { "$id out: <null returned>"; "$id doc: " + (Dump $d) } else { "$id out: " + (Dump $r) + $(if ([object]::ReferenceEquals($r, $d)) { ' (same document)' } else { ' (another document)' }) } }
    else { "$id out: " + (Dump $d) }
  } catch { $e = Inner $_.Exception; "$id EXC: " + $e.GetType().FullName + ': ' + (Esc $e.Message) }
}
$lO = 'ExportLanguageResourcesOnly'; $lM = 'ExportMetadataWithLanguageResources'
$de = '<i18n:label xml:lang="de" xmlns:i18n="' + $I18N + '">Beschriftung</i18n:label>'
"# ---- MK: MarkPropertiesWithTranslationsIfNeeded"
Step 'MK01' (Env ('<Item type="Property" id="1"><name>label</name><label xml:lang="en">a</label>' + $de + '</Item>')) $mMK $lO
Step 'MK02' (Env '<Item type="Property" id="1"><name>label</name><label xml:lang="en">a</label></Item>') $mMK $lO
Step 'MK03' (Env '<Item type="Property" id="1"><label xml:lang="de"></label><label xml:lang="fr" /></Item>') $mMK $lO
Step 'MK04' (Env '<Item type="Property" id="1"><label xml:lang="EN">a</label><help xml:lang="En">b</help></Item>') $mMK $lO
Step 'MK05' (Env '<Item type="Property" id="1"><label xml:lang="">a</label></Item>') $mMK $lO
Step 'MK06' (Env '<Item type="Method" id="1"><label xml:lang="de">a</label></Item>') $mMK $lO
Step 'MK07' (Env '<Item type="ItemType" id="1"><name>T</name><Relationships><Item type="Property" id="2"><label xml:lang="de">a</label></Item><Item type="Property" id="3"><label xml:lang="en">b</label></Item></Relationships></Item>') $mMK $lO
Step 'MK08' (Env '<Item type="Property" id="1" export_has_translations="0"><label xml:lang="de">a</label></Item>') $mMK $lO
Step 'MK09' (Env '<Item type="Property" id="1" export_has_translations="0" other="x"><label xml:lang="en">a</label></Item>') $mMK $lO
Step 'MK10' (Env '<Item type="Property" id="1"><label xml:lang="de">a</label></Item>') $mMK $lM
Step 'MK11' (Env '<Item type="Property" id="1"><label xml:lang="de">a</label></Item>') $mMK 'Export'
Step 'MK12' (Env '<Item type="Property" id="1"><x><label xml:lang="de">a</label></x></Item>') $mMK $lO
Step 'MK13' (Env '<Item type="Property" id="1"><label xml:lang="de"> </label></Item>') $mMK $lO
Step 'MK14' (Env '<Item type="Property" id="1"><label xml:lang="de"><b>x</b></label></Item>') $mMK $lO
Step 'MK15' (Env '<Item type="Property" id="1"><label xml:lang="de"><b/></label></Item>') $mMK $lO
Step 'MK16' (Env '<Item type="Property" id="1" xml:lang="de"><label>a</label></Item>') $mMK $lO
Step 'MK17' (Env '<Item type="Property" id="1"><name>n</name><label xml:lang="de-DE">a</label></Item><Item type="Property" id="2"><label xml:lang="en">a</label></Item>') $mMK $lO
Step 'MK18' (Env '<Item type="property" id="1"><label xml:lang="de">a</label></Item>') $mMK $lO
Step 'MK19' '<AML><Item type="Property" id="1"><label xml:lang="de">a</label></Item></AML>' $mMK $lO
Step 'MK20' (Env '<Item type="Property" id="1"><label xml:lang="de">a</label><label xml:lang="fr">b</label></Item>') $mMK $lO

"# ---- RM: RemoveNotLocalizedProperties (the document is the output of export.xsl: AML at the root)"
$aml = { param($b) '<AML>' + $b + '</AML>' }
Step 'RM01' (& $aml ('<Item type="List" id="1" action="add"><name>n</name><label xml:lang="en">Colors</label>' + $de + '<description>d</description></Item>')) $mRM $lO
Step 'RM02' (& $aml '<Item type="List" id="1" action="add"><name>n</name><description>d</description></Item>') $mRM $lO
Step 'RM03' (& $aml '<Item type="List" id="1"><name>n</name><Relationships><Item type="Value" id="2"><value>v</value><label xml:lang="de">Rot</label></Item><Item type="Value" id="3"><value>w</value></Item></Relationships></Item>') $mRM $lO
Step 'RM04' (& $aml '<Item type="Value" id="2"><source_id keyed_name="k" type="List">S1</source_id><related_id>R</related_id><label xml:lang="de">Rot</label><value>v</value></Item>') $mRM $lO
Step 'RM05' (& $aml '<Item type="Value" id="2"><source_id>S1</source_id><value>v</value></Item>') $mRM $lO
Step 'RM06' (& $aml '<Item type="Value" id="2"><label xml:lang="de"><b>x</b>t<c y="1"/></label></Item>') $mRM $lO
Step 'RM07' (& $aml '<Item type="Value" id="2"><label xml:lang="">a</label><value>v</value></Item>') $mRM $lO
Step 'RM08' (& $aml '<Item type="Value" id="2" xml:lang="de"><value>v</value></Item>') $mRM $lO
Step 'RM09' (& $aml '<Item type="A" id="1"><name>n</name><related_id><Item type="B" id="2"><name>m</name><label xml:lang="de">x</label></Item></related_id></Item>') $mRM $lO
Step 'RM10' (& $aml '<Item type="A" id="1"><label xml:lang="de">x</label><Relationships><Item type="B" id="2"><name>m</name></Item></Relationships></Item>') $mRM $lO
Step 'RM11' (& $aml '<Item type="A" id="1"><label xml:lang="de">x</label></Item><Item type="A" id="2"><name>q</name></Item>') $mRM $lO
Step 'RM12' "<AML>`r`n  <Item type=`"A`" id=`"1`">`r`n    <name>n</name>`r`n    <label xml:lang=`"de`">a &amp; b &lt; c &gt; `"q`" 'p'</label>`r`n    <!-- note -->`r`n  </Item>`r`n</AML>" $mRM $lO
Step 'RM13' (& $aml '<Item type="A" id="1"><label xml:lang="de"><![CDATA[a <b> & c]]></label></Item>') $mRM $lO
Step 'RM14' (& $aml '<Item type="A" id="1" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N" action="add"><label xml:lang="en">x</label></Item>') $mRM $lO
Step 'RM15' (& $aml '<Item type="A" id="1"><label xml:lang="de">tab	here</label><x xml:lang="de">cr&#13;lf&#10;</x></Item>') $mRM $lO
Step 'RM16' (& $aml '<Item type="A" id="1"><name>n</name><label xml:lang="de">x</label></Item>') $mRM $lM
Step 'RM17' (& $aml '<Item type="A" id="1"><name>n</name><label xml:lang="de">x</label></Item>') $mRM 'Export'
Step 'RM18' (& $aml '<Item type="A" id="1"><source_id>S</source_id><name>n</name><label xml:lang="de">x</label></Item><Item type="B" id="2"><source_id>S2</source_id><name>n</name></Item>') $mRM $lO
Step 'RM19' (& $aml '<Item type="A" id="1"><label xml:lang="de">x</label><Relationships><Item type="B" id="2"><name>m</name><Relationships><Item type="C" id="3"><name>deep</name><label xml:lang="fr">y</label></Item></Relationships></Item></Relationships></Item>') $mRM $lO
Step 'RM20' '<AML />' $mRM $lO
Step 'RM21' (& $aml '<Item type="A" id="1"><label xml:lang="de">&#233;&#8364;</label></Item>') $mRM $lO
Step 'RM22' (& $aml '<Item type="A" id="1"><label xml:lang="de">x</label><label xml:lang="en">y</label><label>no lang</label></Item>') $mRM $lO
Step 'RM23' (& $aml '<Item type="A" id="1"><source_id>S</source_id><i18n:source_id xml:lang="de" xmlns:i18n="http://www.aras.com/I18N">x</i18n:source_id></Item>') $mRM $lO
Step 'RM24' (& $aml '<other><Item type="A" id="1"><label xml:lang="de">x</label></Item></other><Item type="A" id="2"><name>n</name></Item>') $mRM $lO

"# ---- ORD: OrderPropertiesWithTranslations"
$en = '<label xml:lang="en">E</label>'
function I([string]$lang, [string]$text, [string]$name = 'label', [string]$pfx = 'i18n') { '<' + $pfx + ':' + $name + ' xml:lang="' + $lang + '" xmlns:' + $pfx + '="' + $I18N + '">' + $text + '</' + $pfx + ':' + $name + '>' }
Step 'ORD01' (& $aml ('<Item type="A" id="1">' + $en + (I 'de' 'D') + '</Item>')) $mORD $lO
Step 'ORD02' (& $aml ('<Item type="A" id="1">' + $en + (I 'de' 'D') + (I 'fr' 'F') + '</Item>')) $mORD $lO
Step 'ORD03' (& $aml ('<Item type="A" id="1">' + (I 'de' 'D') + $en + '</Item>')) $mORD $lO
Step 'ORD04' (& $aml ('<Item type="A" id="1">' + (I 'de' 'D') + (I 'fr' 'F') + $en + '</Item>')) $mORD $lO
Step 'ORD05' (& $aml ('<Item type="A" id="1">' + (I 'de' 'D') + '<name>n</name></Item>')) $mORD $lO
Step 'ORD06' (& $aml ('<Item type="A" id="1">' + $en + '<name>n</name>' + (I 'de' 'D') + '</Item>')) $mORD $lO
Step 'ORD07' (& $aml ('<Item type="A" id="1">' + $en + '<description xml:lang="en">DE</description>' + (I 'de' 'D') + (I 'de' 'DD' 'description') + '</Item>')) $mORD $lO
Step 'ORD08' (& $aml ('<Item type="A" id="1">' + $en + '<label xml:lang="en">E2</label>' + (I 'de' 'D') + '</Item>')) $mORD $lO
Step 'ORD09' (& $aml ('<Item type="A" id="1">' + $en + '<i18n:label xmlns:i18n="' + $I18N + '">no lang</i18n:label>' + '</Item>')) $mORD $lO
Step 'ORD10' (& $aml ('<Item type="A" id="1">' + (I 'de' 'D') + '<label>no lang</label></Item>')) $mORD $lO
Step 'ORD11' (& $aml ('<Item type="A" id="1">' + $en + (I 'de' 'D' 'label' 'foo') + '</Item>')) $mORD $lO
Step 'ORD12' (& $aml ('<Item type="A" id="1"><Relationships><Item type="B" id="2">' + $en + (I 'de' 'D') + (I 'fr' 'F') + '</Item><Item type="B" id="3">' + (I 'de' 'D2') + $en + '</Item></Relationships></Item>')) $mORD $lO
Step 'ORD13' (& $aml ('<Item type="A" id="1">' + $en + (I 'de' 'D') + '</Item>')) $mORD $lM
Step 'ORD14' (& $aml ('<Item type="A" id="1">' + (I 'de' 'D') + $en + '</Item>')) $mORD 'Export'
Step 'ORD15' (& $aml ('<Item type="A" id="1">' + (I 'de' 'D' 'Label') + $en + '</Item>')) $mORD $lO
Step 'ORD16' (& $aml ('<Item type="A" id="1">' + (I 'de' 'D') + '<x><label xml:lang="en">E</label></x></Item>')) $mORD $lO
Step 'ORD17' (& $aml ('<Item type="A" id="1">' + $en + '<!-- c -->' + (I 'de' 'D') + '  ' + (I 'fr' 'F') + '</Item>')) $mORD $lO
Step 'ORD18' (& $aml ('<Item type="A" id="1">' + (I 'de' 'D') + (I 'fr' 'F') + (I 'it' 'I') + $en + '</Item>')) $mORD $lO
Step 'ORD19' (& $aml ('<Item type="A" id="1">' + $en + (I 'de' 'D') + (I 'fr' 'F') + (I 'it' 'I') + '</Item>')) $mORD $lO
Step 'ORD20' (& $aml ('<Item type="A" id="1">' + $en + '<label_x xml:lang="de">q</label_x>' + (I 'de' 'D') + '</Item>')) $mORD $lO

"# ---- ADD: AddI18NNamespaceToAllRootItems"
Step 'ADD01' (& $aml '<Item type="A" id="1" action="add"><name>n</name></Item>') $mADD $lO
Step 'ADD02' (& $aml ('<Item type="A" xmlns:i18n="' + $I18N + '" id="1" action="add" />')) $mADD $lO
Step 'ADD03' (& $aml ('<Item type="A" id="1" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="' + $I18N + '" action="add" />')) $mADD $lO
Step 'ADD04' (& $aml '<Item type="A" id="1" xmlns:i18n="urn:other" action="add" />') $mADD $lO
Step 'ADD05' (& $aml '<Item type="A" id="1"><Relationships><Item type="B" id="2" /></Relationships></Item><Item type="A" id="3" />') $mADD $lM
Step 'ADD06' (& $aml '<Item type="A" id="1" />') $mADD 'Export'
Step 'ADD07' '<Item type="A" id="1" />' $mADD $lO
Step 'ADD08' '<Other><AML><Item type="A" id="1" /></AML></Other>' $mADD $lO
Step 'ADD09' '<AML><Other><Item type="A" id="1" /></Other></AML>' $mADD $lO
Step 'ADD10' '<AML />' $mADD $lO
Step 'ADD11' (& $aml '<Item type="A" id="1" /><!-- c --><Item type="B" id="2" xmlns:i18n="http://www.aras.com/I18N" />') $mADD $lM


# ================================================================================================
# E: a whole CExportItems.Export through the real export.xsl, for one item
# ================================================================================================
$i18nLabel = { param($lang, $text, $name = 'label') '<i18n:' + $name + ' xml:lang="' + $lang + '" xmlns:i18n="' + $I18N + '">' + $text + '</i18n:' + $name + '>' }
function Show-Files([string]$wd) {
  $any = $false
  foreach ($f in (Get-ChildItem -Recurse -File $wd -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'engine.log' } | Sort-Object FullName)) {
    $any = $true
    $b = [IO.File]::ReadAllBytes($f.FullName); $bom = ''; $o = 0
    if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $bom = '[BOM]'; $o = 3 }
    'file ' + (Norm $f.FullName) + ': ' + $bom + '"' + (Esc ([Text.Encoding]::UTF8.GetString($b, $o, $b.Length - $o))) + '"'
  }
  if (-not $any) { 'files: <none>' }
}
function ExpRun($id, $type, $itemId, $action, $langs, [string]$body, [scriptblock]$setup = $null, [string]$level = '1', [string]$mainXml = $null) {
  if (-not (Want $id)) { return }
  $wd = Join-Path $Work $id
  if (Test-Path $wd) { Remove-Item -Recurse -Force $wd }
  New-Item -ItemType Directory -Path $wd | Out-Null
  $userSetup = $setup
  $conn = New-Conn { param($c) $c.ItemBody = ''; if ($userSetup) { & $userSetup $c } }.GetNewClosure()
  if ($mainXml) { $conn.MainById[$itemId] = $mainXml } else { $conn.BodyById[$itemId] = $body }
  $helper = New-Helper $conn $wd
  $exporter = New-Object ($libs.GetType($T + 'CExportItems')) -ArgumentList @($helper)
  $dict = New-Object 'System.Collections.Concurrent.ConcurrentDictionary[string,System.Lazy[Aras.IOM.Item]]'
  $els = New-Object 'System.Collections.Generic.Dictionary[string,System.Collections.Generic.HashSet[string]]'
  $item = New-Object ($libs.GetType($T + 'ExportItem')) -ArgumentList @(('k-' + $itemId), $itemId, $type)
  "## $id  type=$type action=$action languages=[$($langs -join ',')]"
  $arg = $null; if ($null -ne $langs) { $arg = [string[]]@($langs) }
  try { $exporter.Export($item, 'pkg', $level, $null, (Act $action), $arg, $dict, $els); 'thrown: <none>' } catch { $e = Inner $_.Exception; 'thrown: ' + $e.GetType().FullName + ': ' + (Esc (Norm $e.Message)); if ($Stack) { (Esc $e.StackTrace) } }
  Show-Files $wd
  if ($Requests) { Show-Requests $conn -Brief }
  '--'
}
"# ---- E: one item through Export"
$listBody = '<label xml:lang="en">Colors</label>' + (& $i18nLabel 'de' 'Farben') + (& $i18nLabel 'fr' 'Couleurs') + '<description is_null="1"/><Relationships><Item type="Value" id="V1"><value>red</value><label xml:lang="en">Red</label>' + (& $i18nLabel 'de' 'Rot') + '</Item><Item type="Value" id="V2"><value>plain</value></Item></Relationships>'
$listSetup = { param($c) $c.Rels['List'] = [string[]]@('Value'); $c.Related['List'] = ''; $c.Ml['List'] = [string[]]@('label'); $c.Ml['Value'] = [string[]]@('label') }
ExpRun 'E01-list-only' 'List' 'E01' 'ExportLanguageResourcesOnly' @('de', 'fr') $listBody $listSetup
ExpRun 'E02-list-meta' 'List' 'E02' 'ExportMetadataWithLanguageResources' @('de', 'fr') $listBody $listSetup
ExpRun 'E03-list-plain' 'List' 'E03' 'Export' $null $listBody $listSetup
ExpRun 'E04-list-only-nothing-to-keep' 'List' 'E04' 'ExportLanguageResourcesOnly' @('de') '<label is_null="1"/><description>plain</description><Relationships><Item type="Value" id="V1"><value>red</value></Item></Relationships>' $listSetup
ExpRun 'E05-list-only-en-only' 'List' 'E05' 'ExportLanguageResourcesOnly' @('de') '<label xml:lang="en">Colors</label><description>plain</description>' $listSetup
ExpRun 'E06-list-meta-no-translations' 'List' 'E06' 'ExportMetadataWithLanguageResources' @('de') '<label xml:lang="en">Colors</label><description>plain</description>' $listSetup
ExpRun 'E07-list-only-no-ml-type' 'List' 'E07' 'ExportLanguageResourcesOnly' @('de') '<label xml:lang="en">Colors</label>' { param($c) $c.Rels['List'] = [string[]]@('Value'); $c.Related['List'] = '' }
# an ItemType whose Property is a stock system property that carries a translation (EXP-381)
$itBody = '<Item type="ItemType" id="IT1" keyed_name="MyType"><id keyed_name="MyType" type="ItemType">IT1</id><name>MyType</name><is_versionable>0</is_versionable><label xml:lang="en">My Type</label>' + (& $i18nLabel 'de' 'Mein Typ') + '<Relationships>' +
  '<Item type="Property" id="P1"><name>behavior</name><label xml:lang="en">Behavior</label>' + (& $i18nLabel 'de' 'Verhalten') + '<data_type>list</data_type><data_source keyed_name="Behavior" type="List">L1</data_source><stored_length>64</stored_length><column_alignment>left</column_alignment><is_hidden>1</is_hidden><is_hidden2>1</is_hidden2><readonly>0</readonly><is_keyed>0</is_keyed></Item>' +
  '<Item type="Property" id="P2"><name>title</name><data_type>string</data_type><label xml:lang="en">Title</label>' + (& $i18nLabel 'de' 'Titel') + '</Item>' +
  '<Item type="Property" id="P3"><name>plain_prop</name><data_type>string</data_type><label xml:lang="en">Plain</label></Item></Relationships></Item>'
$itSetup = { param($c) $c.PolyNamesXml = '<Item type="ItemType" id="PT"><name>PolyT</name></Item>'; $c.Ml['ItemType'] = [string[]]@('label', 'label_plural'); $c.Ml['Property'] = [string[]]@('label', 'help_tooltip', 'default_value') }
ExpRun 'E08-itemtype-only' 'ItemType' 'IT1' 'ExportLanguageResourcesOnly' @('de') $null $itSetup -mainXml $itBody
ExpRun 'E09-itemtype-meta' 'ItemType' 'IT1' 'ExportMetadataWithLanguageResources' @('de') $null $itSetup -mainXml $itBody
ExpRun 'E10-itemtype-plain' 'ItemType' 'IT1' 'Export' $null $null $itSetup -mainXml $itBody


# ================================================================================================
# X: a whole ExportSolutions run in a language mode
# ================================================================================================
function XRun($id, $action, $langs, $pkgs, [scriptblock]$setup = $null, [string]$level = '1') {
  if (-not (Want $id)) { return }
  $wd = Join-Path $Work $id
  if (Test-Path $wd) { Remove-Item -Recurse -Force $wd }
  New-Item -ItemType Directory -Path $wd | Out-Null
  $userSetup = $setup
  $conn = New-Conn { param($c) $c.LanguageCodes = [Collections.Generic.List[string]]@('en', 'de', 'fr'); $c.ItemBody = ''; if ($userSetup) { & $userSetup $c } }.GetNewClosure()
  $sol = ''
  foreach ($p in $pkgs.Keys) { $sol += '<Item type="PackageDefinition" id="PD-' + $p + '"><name>' + $p + '</name><generation>1</generation></Item>' }
  $conn.SolutionsXml = $sol
  $helper = New-Helper $conn $wd
  $ctx = New-Ctx $action $langs $wd
  $msgs = New-Object Probe.ProbeMessages
  "## $id  action=$action languages=$(if ($null -eq $langs) { '<null>' } else { '[' + ($langs -join ',') + ']' })"
  $mgr = $null
  try { $mgr = New-Object $iem -ArgumentList @($ctx, $msgs, $helper); 'constructed; languages = ' + (Show-Langs $ctx) } catch { $e = Inner $_.Exception; 'constructor: ' + $e.GetType().FullName + ': ' + (Esc $e.Message); '--'; return }
  $ec = New-Object ($libs.GetType($T + 'SUExportContext'))
  $ec.sLevel = $level
  $ec.RefToUnknownPacks = [Enum]::Parse($libs.GetType($T + 'ReferencesToUnknownPackages'), 'DoNotRemove')
  $ec.bExportReferencedItems = $false
  $sel = New-Object System.Collections.Hashtable
  foreach ($p in $pkgs.Keys) {
    $inner = New-Object System.Collections.Hashtable
    foreach ($it in $pkgs[$p]) { $inner.Add($it[0], (New-Object ($libs.GetType($T + 'ExportItem')) -ArgumentList @(('k-' + $it[0]), $it[0], $it[1]))) }
    $sel.Add($p, $inner)
  }
  $thrown = $null
  try { $mgr.ExportSolutions($ec, $sel) } catch { $e = Inner $_.Exception; $thrown = $e.GetType().FullName + ': ' + $e.Message }
  'thrown: ' + $(if ($thrown) { Esc (Norm $thrown) } else { '<none>' })
  # 14.35 runs the items in parallel: the status texts race (EXP-573), the number of items that fail before the stop varies (EXP-555),
  # and the order of lines is not fixed. So the status lines are left out, repeated lines are printed once, and all are sorted.
  'messages (without status lines, once each, sorted):'
  $mm = @(); foreach ($m in $msgs.Log) { $f = $m.Split('|', 4); if ($f[2] -eq 'status' -and $f[3] -ne 'completed') { continue }; $mm += ($f[2] + '|' + [regex]::Replace($f[3], '(Not a single item(\\r\\n)?)+', 'Not a single item')) }
  foreach ($m in ($mm | Sort-Object -Unique)) { '  ' + (Esc (Norm $m)) }
  'log (once each, sorted):'
  if (Test-Path $ctx.LogFilePath) { foreach ($l in (([IO.File]::ReadAllText($ctx.LogFilePath) -split "`r?`n") | Sort-Object -Unique)) { if ($l) { '  | ' + (Esc (Norm $l)) } } } else { '  <no log file>' }
  Show-Files $wd
  $mf = Join-Path $wd 'imports.mf'
  if (Test-Path $mf) { 'imports.mf: ' + (Esc (Norm ([IO.File]::ReadAllText($mf)))) } else { 'imports.mf: <absent>' }
  '--'
}
"# ---- X: ExportSolutions"
$xBody = '<label xml:lang="en">Colors</label>' + (& $i18nLabel 'de' 'Farben')
$xSetup = { param($c) $c.Rels['List'] = [string[]]@('Value'); $c.Related['List'] = ''; $c.Ml['List'] = [string[]]@('label'); $c.BodyById['A01'] = $xBody; $c.BodyById['A03'] = $xBody }
$xPk = [ordered]@{ 'pkg.a' = @(@('A01', 'List'), @('A02', 'List'), @('A03', 'List')) }
XRun 'X01-only' 'ExportLanguageResourcesOnly' @('en', 'de') $xPk $xSetup
XRun 'X02-meta' 'ExportMetadataWithLanguageResources' @('en', 'de') $xPk $xSetup
XRun 'X03-only-star' 'ExportLanguageResourcesOnly' @('*') $xPk $xSetup
XRun 'X04-only-not-installed' 'ExportLanguageResourcesOnly' @('en', 'xx') $xPk $xSetup
XRun 'X05-only-en-only' 'ExportLanguageResourcesOnly' @('en') $xPk $xSetup
XRun 'X06-only-ml-lookup-fails' 'ExportLanguageResourcesOnly' @('en', 'de') $xPk { param($c) $c.Rels['List'] = [string[]]@('Value'); $c.Related['List'] = ''; $c.MlFaultCode = '1' }
XRun 'X07-only-two-packages' 'ExportLanguageResourcesOnly' @('en', 'de') ([ordered]@{ 'pkg.a' = @(,@('A01', 'List')); 'pkg.b' = @(@('A03', 'List'), @('B01', 'List')) }) $xSetup

"# ---- done through R"
