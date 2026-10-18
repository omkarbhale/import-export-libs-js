# Offline probe of the export output steps that differ in engine 14.35 (spec/export-transform.md,
# spec/export-write.md, spec/export-run.md: the [14.35] variants). Windows PowerShell 5.1. It calls
# the engine's own methods by reflection on in-memory documents, so it needs no server and no
# credential, and it writes only under -Work. Run it against a staged copy of oracle/native/14.35
# (and, to see what changed, of oracle/native/14.0.7); see README.md.
param([Parameter(Mandatory)][string] $Bin, [Parameter(Mandatory)][string] $Work)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Work)) { New-Item -ItemType Directory -Path $Work | Out-Null }
[Environment]::CurrentDirectory = $Work
Set-Location $Work
[void][Reflection.Assembly]::LoadFrom((Join-Path $Bin 'IOM.dll'))
$libs = [Reflection.Assembly]::LoadFrom((Join-Path $Bin 'Libs.dll'))
Add-Type -AssemblyName System.Xml
$flags = [Reflection.BindingFlags]'Public,NonPublic,Instance,Static'
$T = 'Aras.Tools.SolutionUpgrade.'
$cih = $libs.GetType($T + 'CItemHelper'); $cei = $libs.GetType($T + 'CExportItems'); $iem = $libs.GetType($T + 'ImportExportManager')
$iow = New-Object ($libs.GetType($T + 'IOWrapper'))
$helper = [Runtime.Serialization.FormatterServices]::GetUninitializedObject($cih)
$v14_35 = $libs.GetName().Version.ToString() -eq '14.35.0.43890'
"# engine $($libs.GetName().Version), CLR $([Environment]::Version)"

function Esc([string]$s) { if ($null -eq $s) { return '<null>' }; $sb = New-Object Text.StringBuilder; foreach ($c in $s.ToCharArray()) { $n = [int]$c; if ($c -eq "`r") { [void]$sb.Append('\r') } elseif ($c -eq "`n") { [void]$sb.Append('\n') } elseif ($c -eq "`t") { [void]$sb.Append('\t') } elseif ($c -eq '"') { [void]$sb.Append('\"') } elseif ($n -lt 32 -or $n -gt 126) { [void]$sb.Append(('\u{0:X4}' -f $n)) } else { [void]$sb.Append($c) } }; $sb.ToString() }
function NewDoc([string]$xml, [bool]$pw = $true) { $d = New-Object System.Xml.XmlDocument; $d.PreserveWhitespace = $pw; $d.LoadXml($xml); $d }
function Dump($doc) {
  $p = Join-Path $Work ('f' + [guid]::NewGuid().ToString('N') + '.xml')
  $iow.XmlDocumentSaveWithSettings($doc, $p, $null)
  $b = [IO.File]::ReadAllBytes($p); Remove-Item $p
  $bom = ''; $off = 0
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $bom = '[BOM]'; $off = 3 }
  $bom + '"' + (Esc ([Text.Encoding]::UTF8.GetString($b, $off, $b.Length - $off))) + '"'
}
function Inner($e) { while ($e.InnerException) { $e = $e.InnerException }; $e }
function Run($id, $inp, [scriptblock]$body, [bool]$pw = $true) {
  try { $d = NewDoc $inp $pw; & $body $d; "$id in : " + (Esc $inp); "$id out: " + (Dump $d) }
  catch { $e = Inner $_.Exception; "$id in : " + (Esc $inp); "$id EXC: " + $e.GetType().FullName + ': ' + (Esc $e.Message) }
}
function U($x) { if ($x -is [System.Management.Automation.PSObject]) { $x.psobject.BaseObject } else { $x } }
function Call($m, $obj, $a2) { $a = @(); foreach ($x in $a2) { $a += ,(U $x) }; try { $m.Invoke((U $obj), [object[]]$a) } catch [Reflection.TargetInvocationException] { throw $_.Exception.InnerException } }

# ---------------------------------------------------------------------------------------------
"## RNN RemoveNamespaceNodes"
$mRNN = $cih.GetMethod('RemoveNamespaceNodes')
$i18n = 'http://www.aras.com/I18N'
$cases = [ordered]@{
  'RNN1'  = '<AML><Item type="a" id="1" xmlns:i18n="' + $i18n + '" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xml:lang="en"/></AML>'
  'RNN2'  = '<AML><Item type="a" id="1" xmlns:foo="' + $i18n + '" foo:y="1"/></AML>'
  'RNN3'  = '<AML><Item type="a" id="1" xmlns:i18n="urn:other" i18n:z="1"/></AML>'
  'RNN4'  = '<AML><Item type="a" id="1" xmlns:p="urn:p" p:i18n="v" p:other="w"/></AML>'
  'RNN5'  = '<AML><Item type="a" id="1" xmlns:p="urn:p" p:z="' + $i18n + '" p:w="x"/></AML>'
  'RNN6'  = '<AML><Item type="a" id="1" k="' + $i18n + '" xmlns:i18n="' + $i18n + '"/></AML>'
  'RNN7'  = '<AML><Item type="a" id="1" xmlns:i18n="HTTP://www.aras.com/i18n"/><Item type="b" xmlns:i18n="' + $i18n + ' "/></AML>'
  'RNN8'  = '<AML><Item type="a" xmlns="' + $i18n + '" xmlns:i18n="' + $i18n + '" xml:lang="en"/></AML>'
  'RNN9'  = '<AML><Other xmlns:i18n="' + $i18n + '" xmlns:q="urn:q" q:a="1"/><Item type="a"><Relationships><Item type="b" xmlns:i18n="' + $i18n + '" xmlns:q="urn:q" q:a="1" xml:lang="de"/></Relationships></Item></AML>'
  'RNN10' = '<AML><Item type="a" id="1" xmlns:i18n="' + $i18n + '" xmlns:i18n2="' + $i18n + '" i18n:x="1"/></AML>'
  'RNN11' = '<AML xmlns:i18n="' + $i18n + '"><Item type="a" id="1"><name i18n:k="1">n</name></Item></AML>'
}
foreach ($k in $cases.Keys) { $xml = $cases[$k]; Run $k $xml { param($d) [void](Call $mRNN $helper @($d)) } }

# ---------------------------------------------------------------------------------------------
"## AX ApplyXsl, then RemoveNamespaceNodes (the response envelope declares xmlns:i18n, as the server's does)"
$mAX = $cih.GetMethod('ApplyXsl')
$ns = 'xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"'
$env = { param($body) '<SOAP-ENV:Envelope ' + $ns + ' xmlns:i18n="' + $i18n + '"><SOAP-ENV:Body><Result>' + $body + '</Result></SOAP-ENV:Body></SOAP-ENV:Envelope>' }
function AX($id, $body, [bool]$strip = $true) {
  Run $id (& $env $body) { param($d) [void](Call $mAX $null @($d, 'export.xsl')); if ($strip) { [void](Call $mRNN $helper @($d)) } }
}
$tail = '<name>n</name>'
AX 'AX1'  ('<Item type="List" id="L1" keyed_name="k">' + $tail + '<label is_null="1"/><comments is_null="1"></comments></Item>')
AX 'AX2'  ('<Item type="List" id="L1">' + $tail + '<label is_null="1">text under null</label><description is_null="0">kept</description><x is_null="1 ">kept2</x></Item>')
AX 'AX3'  ('<Item type="List" id="L1">' + $tail + '<xp-foo is_null="1"/><xp-bar is_null="1">t</xp-bar><xpfoo is_null="1"/><XP-baz is_null="1"/></Item>')
AX 'AX4'  ('<Item type="List" id="L1">' + $tail + '<Relationships><Item type="Value" id="V1"><label is_null="1"/><value>v</value></Item><Item type="Value" id="V2" is_null="1"><value>w</value></Item></Relationships></Item>')
AX 'AX5'  ('<Item type="Method" id="M1" is_null="1">' + $tail + '<method_type is_null="1"/><method_code>c</method_code></Item>')
AX 'AX6'  ('<Item type="Part" id="P1">' + $tail + '<owned_by_id keyed_name="Admin" type="Identity" is_null="1"><Item type="Identity" id="I1" is_null="1"><name>Admin</name></Item></owned_by_id><created_by_id is_null="1"/><classification is_null="1"/></Item>')
AX 'AX7'  ('<Item type="Part" id="P1">' + $tail + '<owned_by_id keyed_name="World" type="Identity"><Item type="Identity" id="I1" is_null="1"><name>World</name></Item></owned_by_id><task type="Method" is_null="1"/></Item>')
AX 'AX8'  ('<Item type="X" id="X1">' + $tail + '<Relationships><Item type="Member" id="M" is_null="1"/><Item type="Y" id="Y1"><related_id type="Z" is_null="1"><Item type="Z" id="Z1"><name>z</name></Item></related_id></Item></Relationships></Item>')
AX 'AX9'  ('<Item type="X" id="X1" is_null="1">' + $tail + '<label is_null="1"/></Item>')
AX 'AX10' ('<Item type="Field" id="F1">' + $tail + '<css is_null="1"/><propertytype_id is_null="1"/><label is_null="1"/></Item>')
AX 'AX11' ('<Item type="Method" id="M1"><name>m</name><method_code is_null="1"></method_code><comments is_null="1"/></Item>')
AX 'AX13' ('<Item type="Report" id="R1">' + $tail + '<method keyed_name="rm" type="Method">M1</method></Item>')
AX 'AX14' ('<Item type="Report" id="R2">' + $tail + '<method is_null="1"/></Item>')
AX 'AX15' ('<Item type="Report" id="R3">' + $tail + '<method keyed_name="rm" type="Method" is_null="1">M1</method></Item>')
AX 'AX16' ('<Item type="View" id="V1">' + $tail + '<role keyed_name="World" type="Identity" is_null="1">R1</role><method is_null="1"/></Item>')
AX 'AX17' ('<Item type="List" id="L1"><name>n</name><label is_null="1"/><comments is_null="1"></comments><xp-foo is_null="1"/><Relationships><Item type="Value" id="V1"><label is_null="1"/><value>v</value></Item><Item type="Value" id="V2" is_null="1"><value>w</value></Item></Relationships></Item>')
AX 'AX12' ('<Item type="X" id="X1">' + $tail + '<is_null_child is_null="1"/><a is_null="1"><b>c</b></a></Item>')

# ItemType with system property rows: stock row, stock row flagged export_has_translations, modified row
$stockBehavior = '<label is_null="1"/><data_type>list</data_type><stored_length>64</stored_length><column_alignment>left</column_alignment><is_hidden>1</is_hidden><is_hidden2>1</is_hidden2><column_width></column_width><readonly>0</readonly><is_keyed>0</is_keyed><order_by></order_by><default_value is_null="1"/>'
function ItemType($rows) { '<Item type="ItemType" id="IT1" keyed_name="T1"><name>T1</name><is_versionable>0</is_versionable><Relationships>' + $rows + '</Relationships></Item>' }
AX 'AXF1' (ItemType ('<Item type="Property" id="P1"><name>behavior</name>' + $stockBehavior + '</Item>')) $false
AX 'AXF2' (ItemType ('<Item type="Property" id="P1" export_has_translations="1"><name>behavior</name>' + $stockBehavior + '</Item>')) $false
AX 'AXF3' (ItemType ('<Item type="Property" id="P1" export_has_translations="0"><name>behavior</name>' + $stockBehavior + '</Item>')) $false
AX 'AXF4' (ItemType ('<Item type="Property" id="P1"><name>behavior</name>' + $stockBehavior.Replace('<stored_length>64', '<stored_length>65') + '</Item>')) $false
AX 'AXF5' (ItemType ('<Item type="Property" id="P1" export_has_translations="1"><name>team_id</name><label>Team</label><data_type>item</data_type><stored_length></stored_length><column_alignment>left</column_alignment><is_hidden>1</is_hidden><is_hidden2>1</is_hidden2><column_width></column_width><readonly>0</readonly><is_keyed>0</is_keyed><order_by></order_by><default_value is_null="1"/></Item>')) $false
AX 'AXF6' (ItemType ('<Item type="Property" id="P2" export_has_translations="1"><name>custom</name><label>c</label><data_type>string</data_type></Item>')) $false
AX 'AXF8' (ItemType ('<Item type="Property" id="P1"><name>team_id</name><label is_null="1"/><data_type>item</data_type><stored_length></stored_length><column_alignment>left</column_alignment><is_hidden>1</is_hidden><is_hidden2>1</is_hidden2><column_width></column_width><readonly>0</readonly><is_keyed>0</is_keyed><order_by></order_by><default_value is_null="1"/></Item>')) $false
AX 'AXF7' (ItemType ('<Item type="Property" id="P1"><name>behavior</name>' + $stockBehavior + '</Item><Item type="Property" id="P3"><name>kk</name><label is_null="1"/><is_keyed>1</is_keyed><data_type>string</data_type></Item>')) $false

# ---------------------------------------------------------------------------------------------
if ($v14_35) {
"## RSER RemoveSeparatelyExportedRelationships (private static; Dictionary<type, HashSet<id>>)"
$mRSER = $cei.GetMethod('RemoveSeparatelyExportedRelationships', $flags)
function Map($pairs) { $m = New-Object 'System.Collections.Generic.Dictionary[string,System.Collections.Generic.HashSet[string]]'; foreach ($p in $pairs) { if (-not $m.ContainsKey($p[0])) { $m[$p[0]] = New-Object 'System.Collections.Generic.HashSet[string]' }; [void]$m[$p[0]].Add($p[1]) }; ,$m }
$res = { param($body) '<SOAP-ENV:Envelope ' + $ns + ' xmlns:i18n="' + $i18n + '"><SOAP-ENV:Body><Result>' + $body + '</Result></SOAP-ENV:Body></SOAP-ENV:Envelope>' }
function RS($id, $xml, $pairs, [bool]$pw = $true) {
  Run $id $xml { param($d) $m = Map $pairs; [void](Call $mRSER $null @($d, $m)) } $pw
}
$rel = { param($t, $i, $extra = '') '<Item type="' + $t + '" id="' + $i + '">' + $extra + '</Item>' }
RS 'RS1'  (& $res ('<Item type="A" id="1"><Relationships>' + (& $rel 'B' '2') + (& $rel 'B' '3') + (& $rel 'C' '4') + '</Relationships></Item>')) @(,@('B', '2'))
RS 'RS2'  (& $res ('<Item type="A" id="1"><Relationships>' + (& $rel 'B' '2') + (& $rel 'B' '3') + '</Relationships></Item>')) @(@('B', '2'), @('B', '3'))
RS 'RS3'  (& $res ('<Item type="A" id="1"><Relationships>' + (& $rel 'B' '2') + (& $rel 'b' '2') + (& $rel 'B' '2 ') + '</Relationships></Item>')) @(,@('B', '2'))
RS 'RS4'  (& $res ('<Item type="A" id="1"><Relationships>' + (& $rel 'B' '2' '<Relationships><Item type="C" id="9"/></Relationships>') + '</Relationships></Item>')) @(,@('C', '9'))
RS 'RS5'  (& $res ('<Item type="A" id="1"><Relationships>' + (& $rel 'B' '2' '<related_id><Item type="C" id="9"/></related_id>') + '</Relationships></Item>')) @(,@('C', '9'))
RS 'RS6'  (& $res ('<Item type="A" id="1"><Relationships>' + (& $rel 'B' '2') + '</Relationships></Item>')) @(,@('A', '1'))
RS 'RS7'  ('<AML><Item type="A" id="1"><Relationships>' + (& $rel 'B' '2') + '</Relationships></Item></AML>') @(,@('B', '2'))
RS 'RS8'  (& $res ('<Item type="A" id="1"><Relationships>' + (& $rel 'B' '2') + '</Relationships></Item><Item type="A2" id="7"><Relationships>' + (& $rel 'B' '2') + (& $rel 'B' '5') + '</Relationships></Item>')) @(,@('B', '2'))
RS 'RS9'  (& $res '<Item type="A" id="1"><Relationships><Item id="2"/><Item type="B"/><Item type="" id=""/></Relationships></Item>') @(,@('B', ''))
RS 'RS10' (& $res '<Item type="A" id="1"><Relationships><Item id="2"/><Item type="B"/></Relationships></Item>') @(,@('', ''))
RS 'RS11' (& $res ("<Item type=`"A`" id=`"1`">`r`n <Relationships>`r`n  " + (& $rel 'B' '2') + "`r`n  " + (& $rel 'B' '3') + "`r`n </Relationships>`r`n</Item>")) @(,@('B', '2'))
RS 'RS12' (& $res ('<Item type="A" id="1"><Relationships>' + (& $rel 'B' '2') + '</Relationships><Relationships>' + (& $rel 'B' '2') + (& $rel 'B' '3') + '</Relationships></Item>')) @(,@('B', '2'))
RS 'RS13' ('<SOAP-ENV:Envelope ' + $ns + '><SOAP-ENV:Body><p:Result xmlns:p="urn:p"><Item type="A" id="1"><Relationships>' + (& $rel 'B' '2') + '</Relationships></Item></p:Result></SOAP-ENV:Body></SOAP-ENV:Envelope>') @(,@('B', '2'))
RS 'RS14' ('<SOAP-ENV:Envelope ' + $ns + '><SOAP-ENV:Body><Result xmlns="urn:d"><Item type="A" id="1"><Relationships><Item type="B" id="2"/></Relationships></Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>') @(,@('B', '2'))
RS 'RS15' (& $res ('<Item type="A" id="1"><Relationships>' + (& $rel 'B' '2') + '</Relationships></Item>')) @()
try { $d = NewDoc (& $res '<Item type="A" id="1"/>'); [void](Call $mRSER $null @($d, $null)); 'RS16 null map: no exception' } catch { $e = Inner $_.Exception; 'RS16 null map EXC: ' + $e.GetType().FullName + ': ' + (Esc $e.Message) }
try { [void](Call $mRSER $null @($null, (Map @()))); 'RS17 null doc: no exception' } catch { $e = Inner $_.Exception; 'RS17 null doc EXC: ' + $e.GetType().FullName + ': ' + (Esc $e.Message) }

"## GPE GetPackageElementIdsByElementTypeMap (private static on ImportExportManager)"
$mGPE = $iem.GetMethod('GetPackageElementIdsByElementTypeMap', $flags)
function Show($m) { if ($m -eq $null) { return '<null>' }; ($m.Keys | Sort-Object | ForEach-Object { '[' + (Esc $_) + ']=' + (($m[$_] | Sort-Object | ForEach-Object { Esc $_ }) -join ',') }) -join ' ' }
function GPm($id, $xml) {
  try { $d = NewDoc $xml; $r = Call $mGPE $null @($d); "$id in : " + (Esc $xml); "$id out: " + (Show $r) } catch { $e = Inner $_.Exception; "$id in : " + (Esc $xml); "$id EXC: " + $e.GetType().FullName + ': ' + (Esc $e.Message) }
}
$pe = { param($t, $i) '<Item type="PackageElement"><element_type>' + $t + '</element_type><element_id>' + $i + '</element_id></Item>' }
GPm 'GP1' ('<Result><Item type="PackageDefinition"><name>p</name><Relationships><Item type="PackageGroup"><Relationships>' + (& $pe 'List' 'L1') + (& $pe 'List' 'L2') + (& $pe 'Method' 'M1') + (& $pe 'List' 'L1') + '</Relationships></Item></Relationships></Item></Result>')
GPm 'GP2' '<Result><Item type="PackageDefinition"/></Result>'
GPm 'GP3' ('<Result>' + (& $pe 'List' 'L1') + '<Item type="PackageElement"><element_id>X</element_id></Item></Result>')
GPm 'GP4' ('<Result>' + (& $pe 'List' 'L1') + '<Item type="PackageElement"><element_type>Method</element_type></Item></Result>')
GPm 'GP5' ('<Result>' + (& $pe 'List' ' L1 ') + (& $pe 'list' 'l1') + (& $pe '' '') + '</Result>')
GPm 'GP6' '<Result/>'
try { [void](Call $mGPE $null @($null)); 'GP7 null: no exception' } catch { $e = Inner $_.Exception; 'GP7 null EXC: ' + $e.GetType().FullName + ': ' + (Esc $e.Message) }
}

# ---------------------------------------------------------------------------------------------
"## PATH Path.Combine and IsPathRooted on this runtime (the engine's own calls)"
# PowerShell passes $null to a string parameter as an empty string, so a real null is [NullString]::Value.
function PC($a, $b) {
  $ia = if ($a -is [NullString]) { '<null>' } else { Esc $a }; $ib = if ($b -is [NullString]) { '<null>' } else { Esc $b }
  try { 'PC (' + $ia + ', ' + $ib + ') = ' + (Esc ([IO.Path]::Combine($a, $b))) } catch { $e = Inner $_.Exception; 'PC (' + $ia + ', ' + $ib + ') EXC ' + $e.GetType().FullName + ': ' + (Esc $e.Message) }
}
foreach ($pair in @(
  @('C:\wd', 'a\Import'), @('C:\wd\', 'a\Import'), @('C:\wd/', 'a\Import'), @('C:\wd', 'a/b\Import'), @('C:', 'x'), @('C:\', 'x'), @('', 'x'), @('C:\wd', ''), @('', ''),
  @('C:\wd', '\x'), @('C:\wd', '/x'), @('C:\wd', 'D:x'), @('C:\wd', 'D:\y'), @('C:\wd', 'a:b'), @('rel', 'x'), @('.', 'x'), @('C:\wd', '..\x'), @('C:\wd', 'x '), @(' ', 'x'),
  @('\\server\share', 'x'), @('\\server\share\', 'x'), @('C:\wd', '\\server\share\x'), @([NullString]::Value, 'x'), @('C:\wd', [NullString]::Value), @('C:\wd', 'a|b'), @('C:\wd', 'a"b'), @('C:\wd', 'a<b'), @('C:\wd', 'a>b'),
  @('C:\wd', "a$([char]1)b"), @("C:\w$([char]31)d", 'x'), @('C:\wd', 'a*b'), @('C:\wd', 'a?b'), @('C:\wd', "a$([char]0)b"), @('C:\wd', 'Import'), @('C:\w d', 'x y'), @('C:\wd', 'Dot.'), @('C:\wd', 'a\\b')
)) { PC $pair[0] $pair[1] }
foreach ($p in @('C:\a', '\a', '/a', 'C:a', 'a', '', 'a:b', '\\s\x', 'C:')) { 'IPR (' + (Esc $p) + ') = ' + [IO.Path]::IsPathRooted($p) }

"## COD CreateOutputDir (private instance on ImportExportManager)"
$ctxT = $libs.GetType($T + 'SolutionUpgradeContext')
$mCOD = $iem.GetMethod('CreateOutputDir', $flags)
$helperForMgr = U $helper
function Cod($wdir, $pkg, [string]$label) {
  $ctx = New-Object $ctxT; $ctxT.GetProperty('WorkingDirectory').SetValue($ctx, $(if ($wdir -is [NullString]) { $null } else { $wdir })); $ctx.Action = [Enum]::ToObject($libs.GetType($T + 'ImportExport'), 1)
  try {
    $mgr = $iem.GetConstructors()[0].Invoke([object[]]@((U $ctx), $null, $helperForMgr))
    $r = $mCOD.Invoke($mgr, [object[]]@($pkg))
    'COD ' + $label + ' pkg=' + (Esc $pkg) + ' -> ' + (Esc $r.Replace($Work, '<WD>'))
  } catch { $e = Inner $_.Exception; 'COD ' + $label + ' pkg=' + (Esc $pkg) + ' EXC ' + $e.GetType().FullName + ': ' + (Esc $e.Message.Replace($Work, '<WD>')) }
}
$w1 = Join-Path $Work 'cod1'; $w2 = $w1 + '\'; $w3 = $w1 + '/'
foreach ($p in @('com.aras.innovator.core', 'com.aras.innovator.solution.PLM', 'com.x.PLM', 'a.b.', 'a..b', 'nodot', '', 'com.aras.defaults.x', 'x.C:', 'x.a\b', 'x.a/b', 'x.\\y', 'x.a b', 'x.a|b', 'x.a"b')) { Cod $w1 $p 'wd' }
foreach ($p in @('com.aras.innovator.core', 'com.x.PLM')) { Cod $w2 $p 'wd\'; Cod $w3 $p 'wd/' }
foreach ($p in @('com.aras.innovator.core', 'com.x.PLM')) { Cod 'rel_out' $p 'relative' }
# 14.0.7 would join an empty or null working directory to a leading backslash, the root of the current drive: not run.
if ($v14_35) {
  foreach ($p in @('com.aras.innovator.core', 'com.x.PLM')) { Cod '' $p 'empty' }
  Cod ([NullString]::Value) 'com.x.PLM' 'null'
}
Cod ($Work + '\w|d') 'com.x.PLM' 'invalid-char-in-wd'
