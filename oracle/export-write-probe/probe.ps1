# Probes the 14.0.7 post-XSL, file-layout and serialization behaviour of Libs.dll (spec/export-write.md).
# Run on Windows PowerShell 5.1 against a staged copy of oracle/native/14.0.7 (see README.md).
param([string]$Bin, [string]$Work)
$ErrorActionPreference = 'Stop'
[Environment]::CurrentDirectory = $Work
Set-Location $Work
[Reflection.Assembly]::LoadFrom((Join-Path $Bin 'IOM.dll')) | Out-Null
$libs = [Reflection.Assembly]::LoadFrom((Join-Path $Bin 'Libs.dll'))
Add-Type -AssemblyName System.Xml
$flags = [Reflection.BindingFlags]'Public,NonPublic,Instance,Static'
$T = 'Aras.Tools.SolutionUpgrade.'
$cih = $libs.GetType($T + 'CItemHelper')
$cei = $libs.GetType($T + 'CExportItems')
$iow = New-Object ($libs.GetType($T + 'IOWrapper'))
$helper = [Runtime.Serialization.FormatterServices]::GetUninitializedObject($cih)
$cih.GetField('_requestedItems', $flags).SetValue($helper, (New-Object 'System.Collections.Generic.Dictionary[string,System.Xml.XmlDocument]'))

function Esc([string]$s) { if ($null -eq $s) { return '<null>' }; $sb = New-Object Text.StringBuilder; foreach ($c in $s.ToCharArray()) { $n = [int]$c; if ($c -eq "`r") { [void]$sb.Append('\r') } elseif ($c -eq "`n") { [void]$sb.Append('\n') } elseif ($c -eq "`t") { [void]$sb.Append('\t') } elseif ($c -eq '"') { [void]$sb.Append('\"') } elseif ($n -lt 32 -or $n -gt 126) { [void]$sb.Append(('\u{0:X4}' -f $n)) } else { [void]$sb.Append($c) } }; $sb.ToString() }
function Abbr([string]$s) { $e = Esc $s; if ($e.Length -gt 90) { $e.Substring(0, 40) + '...(' + $s.Length + ' chars)...' + $e.Substring($e.Length - 12) } else { $e } }
function NewDoc([string]$xml, [bool]$pw = $true) { $d = New-Object System.Xml.XmlDocument; $d.PreserveWhitespace = $pw; $d.LoadXml($xml); $d }
function Dump($doc) {
  $p = Join-Path $Work ('f' + [guid]::NewGuid().ToString('N') + '.xml')
  $iow.XmlDocumentSaveWithSettings($doc, $p, $null)
  $b = [IO.File]::ReadAllBytes($p); Remove-Item $p
  $bom = ''; $off = 0
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $bom = '[BOM]'; $off = 3 }
  $bom + '"' + (Esc ([Text.Encoding]::UTF8.GetString($b, $off, $b.Length - $off))) + '"'
}
function Run($id, $inp, [scriptblock]$body, [bool]$pw = $true) {
  try { $d = NewDoc $inp $pw; & $body $d; "$id in : " + (Esc $inp); "$id out: " + (Dump $d) }
  catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; "$id in : " + (Esc $inp); "$id EXC: " + $e.GetType().FullName + ': ' + (Esc $e.Message) }
}
function U($x) { if ($x -is [System.Management.Automation.PSObject]) { $x.psobject.BaseObject } else { $x } }
function Call($m, $obj, $args2) { $a = @(); foreach ($x in $args2) { $a += ,(U $x) }; try { $m.Invoke((U $obj), [object[]]$a) | Out-Null } catch [Reflection.TargetInvocationException] { throw $_.Exception.InnerException } }
$mREL = $cih.GetMethod('RemoveEmptyRelationships')
$mRNN = $cih.GetMethod('RemoveNamespaceNodes')
$mRPL = $cih.GetMethod('ReplaceReferencesToPolyLists')
$mCDF = $cei.GetMethod('CdataFilterXml', $flags)
$mRPM = $cei.GetMethod('RemovePermissionIdWhenItMatchesToDefaultPermission', $flags)
$exp = $cei.GetConstructors()[0].Invoke([object[]]@((U $helper)))

"## REL RemoveEmptyRelationships"
Run 'REL1' '<AML><Item type="a"><Relationships/></Item><Item type="b"><Relationships></Relationships></Item><Item type="c"><Name>x</Name></Item></AML>' { param($d) Call $mREL $helper @($d) }
Run 'REL2' '<AML><Item type="a"><Relationships/><Relationships/><Relationships/></Item></AML>' { param($d) Call $mREL $helper @($d) }
Run 'REL3' '<AML><Item type="c"><Relationships><Item type="d"><Relationships/></Item></Relationships></Item></AML>' { param($d) Call $mREL $helper @($d) }
Run 'REL4' '<AML><Item type="a"><Relationships> </Relationships><Relationships><!--c--></Relationships><Relationships>text</Relationships><Relationships><![CDATA[]]></Relationships></Item></AML>' { param($d) Call $mREL $helper @($d) }
Run 'REL5' '<AML><Relationships/><Item type="a"/></AML>' { param($d) Call $mREL $helper @($d) }
Run 'REL6' "<AML>`r`n <Item type=`"a`">`r`n  <name>x</name>`r`n  <Relationships />`r`n </Item>`r`n</AML>" { param($d) Call $mREL $helper @($d) }
Run 'REL7' '<AML><Item type="a"><name>x</name><Relationships/></Item></AML>' { param($d) Call $mREL $helper @($d) } $false
Run 'REL8' '<AML><Item type="a"><name>x</name><Relationships><Item type="b"/></Relationships></Item></AML>' { param($d) $r = $d.SelectSingleNode('//Relationships'); $r.RemoveChild($r.FirstChild) | Out-Null; Call $mREL $helper @($d) }
Run 'REL9' '<AML><Item type="a"><Relationships xmlns:p="urn:p"/><p:Relationships xmlns:p="urn:p"/></Item></AML>' { param($d) Call $mREL $helper @($d) }

"## RNN RemoveNamespaceNodes"
Run 'RNN1' '<AML xmlns:q="urn:q"><Item type="a" id="1" xmlns:i18n="http://www.aras.com/I18N" i18n:x="1" xml:lang="en" q:z="2" xmlns="urn:def"><name xmlns:i18n="urn:n" i18n:y="1">n</name></Item></AML>' { param($d) Call $mRNN $helper @($d) }
Run 'RNN2' '<AML><Item type="a" xmlns="urn:def"><Item type="b" xmlns:p="urn:p" p:a="1"/></Item><Other xmlns:p="urn:p" p:a="1"/></AML>' { param($d) Call $mRNN $helper @($d) }
Run 'RNN3' '<AML><x:Item xmlns:x="urn:x" xmlns:y="urn:y" y:a="1"/><Item xmlns:y="urn:y" y:a="1" b="2"/></AML>' { param($d) Call $mRNN $helper @($d) }
Run 'RNN4' '<AML><Item type="a" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" action="add"/></AML>' { param($d) Call $mRNN $helper @($d) }

"## CDF CdataFilterXml"
foreach ($pair in @(
 @('CDF1', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>a&b</filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF2', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml><![CDATA[a]]]]><![CDATA[></filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF3', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml>&lt;filter_xml&gt;&lt;a x="1"&gt;t&amp;amp;u&lt;/a&gt;&lt;/filter_xml&gt;</condition_xml></Item></AML>'),
 @('CDF4', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[no filter here &amp; &lt;]]></condition_xml></Item></AML>'),
 @('CDF5', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml/></Item></AML>'),
 @('CDF6', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>x</filter_xml><filter_xml>y</filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF7', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>x &amp;nbsp; &#160; &lt;b&gt; &eacute;</filter_xml>]]></condition_xml></Item><Item type="mp_MacPolicy" id="2"><condition_xml><![CDATA[<filter_xml>y</filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF8', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>x]]]]><![CDATA[></filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF9', '<AML><Item type="dr_RelationshipFamily" id="1"><implementation_query><![CDATA[<Item type="x" action="get"/>]]></implementation_query><condition_xml><![CDATA[<filter_xml>q</filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF10', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml>plain &amp; text</condition_xml></Item><Item type="mp_MacPolicy" id="2"><a><condition_xml>deep</condition_xml></a></Item></AML>'),
 @('CDF11', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>x</filter_xml>]]>  tail</condition_xml></Item></AML>')
)) { $xp = 'condition_xml'; Run $pair[0] $pair[1] { param($d) Call $mCDF $null @($d, $xp) } }
Run 'CDF12' '<AML><Item type="dr_RelationshipFamily" id="1"><implementation_query><![CDATA[<filter_xml>q</filter_xml>]]></implementation_query></Item></AML>' { param($d) Call $mCDF $null @($d, 'implementation_query') }

"## RPL ReplaceReferencesToPolyLists (polytype names = Poly)"
$poly = New-Object Collections.ArrayList; [void]$poly.Add('Poly'); [void]$poly.Add('Other Poly')
$cih.GetField('_mPolynames', $flags).SetValue($null, $poly)
$prop = { param($ds) '<AML><Item type="ItemType" id="1" action="add"><name>T</name><Relationships><Item type="Property" id="2" action="add"><name>p</name><data_type>list</data_type>' + $ds + '</Item></Relationships></Item></AML>' }
Run 'RPL1' (& $prop '<data_source keyed_name="Poly" type="List">AAAA</data_source>') { param($d) Call $mRPL $helper @($d) }
Run 'RPL2' (& $prop '<data_source keyed_name="Plain" type="List">AAAA</data_source>') { param($d) Call $mRPL $helper @($d) }
Run 'RPL3' (& $prop '<data_source keyed_name="poly" type="List">AAAA</data_source>') { param($d) Call $mRPL $helper @($d) }
Run 'RPL4' (& $prop '<data_source type="List">AAAA</data_source>') { param($d) Call $mRPL $helper @($d) }
Run 'RPL5' (& $prop '') { param($d) Call $mRPL $helper @($d) }
Run 'RPL6' (& $prop '<data_source keyed_name=" " type="List">AAAA</data_source>') { param($d) Call $mRPL $helper @($d) }
Run 'RPL7' (& $prop '<data_source keyed_name="Other Poly &amp; &lt;x&gt;" type="List"/>') { param($d) Call $mRPL $helper @($d) }
Run 'RPL8' (& $prop '<data_source keyed_name="Other Poly" type="List"/>') { param($d) Call $mRPL $helper @($d) }
Run 'RPL9' (& $prop '<data_source keyed_name="Poly" is_null="0"/>') { param($d) Call $mRPL $helper @($d) }
Run 'RPL10' '<AML><Item type="X" id="1"><Relationships><Item type="Property"><data_type>float</data_type><data_source keyed_name="Poly"/></Item><Item type="Other"><data_type>list</data_type><data_source keyed_name="Poly"/></Item></Relationships></Item></AML>' { param($d) Call $mRPL $helper @($d) }
Run 'RPL11' '<AML><Item type="X" id="1"><Item type="Property"><data_type>list</data_type></Item><Relationships><Item type="Property"><Relationships><Item type="Property"><data_type>list</data_type><data_source keyed_name="Poly"/><data_source keyed_name="Other Poly"/></Item></Relationships></Item></Relationships></Item></AML>' { param($d) Call $mRPL $helper @($d) }
Run 'RPL12' ("<AML><Item type=`"X`"><Relationships>`r`n <Item type=`"Property`"><data_type>list</data_type> <data_source keyed_name=`"Poly`"/></Item></Relationships></Item></AML>") { param($d) Call $mRPL $helper @($d) }

"## RPM RemovePermissionIdWhenItMatchesToDefaultPermission"
function ItReq($n) { "<Item type='ItemType' action='get' select='id, is_relationship, use_src_access'><name>" + $n + "</name><Relationships><Item type='Allowed Permission' action='get' select='related_id(id)'><is_default>1</is_default></Item></Relationships></Item>" }
function ItDoc($isRel, $useSrc, $perm) {
  $r = '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><Result><Item type="ItemType" id="IT1">'
  if ($isRel -ne $null) { $r += "<is_relationship>$isRel</is_relationship>" }
  if ($useSrc -ne $null) { $r += "<use_src_access>$useSrc</use_src_access>" }
  if ($perm -ne $null) { $r += '<Relationships><Item type="Allowed Permission" id="AP1"><related_id><Item type="Permission" id="' + $perm + '"><id>' + $perm + '</id></Item></related_id></Item></Relationships>' }
  $r + '</Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>'
}
function Seed($name, $xml) { $dd = New-Object System.Xml.XmlDocument; $dd.PreserveWhitespace = $true; $dd.LoadXml($xml); $dict = $cih.GetField('_requestedItems', $flags).GetValue($helper); $dict[(ItReq $name)] = $dd }
function Reset { $cih.GetField('_requestedItems', $flags).SetValue($helper, (New-Object 'System.Collections.Generic.Dictionary[string,System.Xml.XmlDocument]')) }
$pi = '<AML><Item type="TypeA" id="1" action="add"><name>n</name><permission_id keyed_name="p" type="Permission">PERM1</permission_id></Item></AML>'
Reset; Seed 'TypeA' (ItDoc '0' '0' 'PERM1'); Run 'RPM1' $pi { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '0' '0' 'PERM2'); Run 'RPM2' $pi { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '1' '1' 'PERM2'); Run 'RPM3' $pi { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '1' '0' 'PERM2'); Run 'RPM4' $pi { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '1' '1' $null); Run 'RPM5' $pi { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '0' '0' $null); Run 'RPM6' $pi { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc $null '1' 'PERM1'); Run 'RPM7' $pi { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '1' $null 'PERM1'); Run 'RPM8' $pi { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '1' '1' $null); Run 'RPM9' '<AML><Item type="TypeA" id="1"><name>n</name><permission_id>P</permission_id><permission_id>Q</permission_id></Item></AML>' { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '0' '0' 'PERM1'); Run 'RPM10' '<AML><Item type="TypeA" id="1"><name>n</name><permission_id>PERM1</permission_id><Relationships><Item type="TypeA" id="2"><permission_id>PERM1</permission_id><x><permission_id>PERM1</permission_id></x></Item></Relationships></Item></AML>' { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '0' '0' 'PERM1'); Run 'RPM11' '<AML><Item type="TypeA" id="1"><name>n</name><permission_id keyed_name="k" type="Permission"> PERM1 </permission_id></Item></AML>' { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '0' '0' 'PERM1'); Run 'RPM12' '<AML><Item type="TypeA" id="1"><name>n</name><permission_id keyed_name="k" type="Permission"/></Item></AML>' { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '0' '0' 'PERM1'); Run 'RPM13' '<AML><Item type="TypeA" id="1"><name>n</name><PERMISSION_ID>PERM1</PERMISSION_ID><Permission_Id>PERM1</Permission_Id></Item></AML>' { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '0' '0' 'PERM1'); Run 'RPM15' '<AML><Item type="TypeA" id="1"><name>n</name><permission_id>PERM1</permission_id></Item><Item type="View" action="delete" where="x"/></AML>' { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '0' '0' 'PERM1'); Run 'RPM16' '<AML><Item type="TypeA" id="1"><name>n</name><permission_id></permission_id><a/></Item></AML>' { param($d) Call $mRPM $exp @($d) }
Reset; Seed 'TypeA' (ItDoc '0' '0' 'PERM1'); Run 'RPM17' "<AML>`r`n <Item type=`"TypeA`" id=`"1`">`r`n  <name>n</name>`r`n  <permission_id>PERM1</permission_id>`r`n </Item>`r`n</AML>" { param($d) Call $mRPM $exp @($d) }

"## RNN extra"
Run 'RNN5' '<AML xmlns="urn:d"><Item xmlns="" type="a" xmlns:p="urn:p" p:z="1" xml:lang="en" xml:space="preserve" xmlns:xml2="urn:x"/></AML>' { param($d) Call $mRNN $helper @($d) }
Run 'RNN6' '<AML><Item type="a" xmlns:p="urn:p" id="1"><Item type="b" xml:lang="en" p:k="1" id="2"><name xml:lang="de">n</name></Item></Item></AML>' { param($d) Call $mRNN $helper @($d) }

"## XSL ApplyXsl (real export.xsl, then the strip and reload)"
$mAX = $cih.GetMethod('ApplyXsl')
$ns = 'xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"'
$env = { param($body) '<SOAP-ENV:Envelope ' + $ns + ' xmlns:i18n="http://www.aras.com/I18N"><SOAP-ENV:Body><Result>' + $body + '</Result></SOAP-ENV:Body></SOAP-ENV:Envelope>' }
$m1 = '<Item type="Method" id="M1" keyed_name="m" is_current="1"><name>m</name><method_type>JavaScript</method_type><method_code>a ' + $ns + ' b</method_code><comments>' + $ns + '</comments><label xml:lang="en" i18n:xx="1">l</label></Item>'
Run 'AX1' (& $env $m1) { param($d) Call $mAX $null @($d, 'export.xsl') }
Run 'AX2' (& $env $m1) { param($d) Call $mAX $null @($d, 'export.xsl') } $false
Run 'AX3' ((& $env $m1).Replace('<SOAP-ENV:Body>', "`r`n <SOAP-ENV:Body>`r`n  ").Replace('<Item ', "`r`n  <Item ").Replace('</Item>', "`r`n  </Item>`r`n")) { param($d) Call $mAX $null @($d, 'export.xsl') }
Run 'AX4' '<AML><Item type="Method" id="M1"/></AML>' { param($d) Call $mAX $null @($d, 'export.xsl') }
Run 'AX5' (& $env '') { param($d) Call $mAX $null @($d, 'export.xsl') }
Run 'AX6' (& $env '<Item type="ItemType" id="IT"><name>x</name><Relationships><Item type="FileSelectorTemplate" id="F"/></Relationships></Item>') { param($d) Call $mAX $null @($d, 'export.xsl') }
Run 'AX7' (& $env '<Item type="Method" id="M1"><name>m</name><method_code>x]]&gt;y</method_code></Item>') { param($d) Call $mAX $null @($d, 'export.xsl') }
Run 'AX8' (& $env '<Item type="List" id="L1"><name>n</name><label/><xp-x/></Item>') { param($d) Call $mAX $null @($d, 'export.xsl') }
try { Call $mAX $null @($null, 'export.xsl'); 'AX9 no exception' } catch { 'AX9 EXC: ' + $_.Exception.GetType().FullName + ': ' + (Esc $_.Exception.Message) }
try { $d9 = NewDoc (& $env $m1); Call $mAX $null @($d9, 'nosuch.xsl'); 'AX10 no exception' } catch { 'AX10 EXC: ' + $_.Exception.GetType().FullName + ': ' + (Esc $_.Exception.Message) + ' | inner: ' + $(if ($_.Exception.InnerException) { (Esc $_.Exception.InnerException.Message) }) }
Run 'AX11' ('<SOAP-ENV:Envelope ' + $ns + '><SOAP-ENV:Body><Result><Item type="Method" id="M1"><name>m</name><method_code>' + ('x' * 3) + '</method_code></Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>') { param($d) Call $mAX $null @($d, 'export.xsl') }
"## IsStandardPackage / IsCorePackage / IsDefaultPackage"
$eib = $libs.GetType($T + 'ExportImportBase')
foreach ($n in @('com.aras.innovator.core', 'com.aras.innovator.', 'com.aras.innovator', 'com.aras.innovator.solution.PLM', 'com.aras.innovator.solution.', 'com.aras.innovator.solution', 'com.aras.innovator.solutionX', 'com.aras.innovator.Solution.PLM', 'COM.ARAS.INNOVATOR.core', 'Com.Aras.Innovator.core', 'com.aras.defaults.x', 'COM.ARAS.DEFAULTS.x', 'com.aras.defaults', 'com.aras.defaults.', "com.aras.innov$([char]0xAD)ator.x", "com.aras.innovator.$([char]0xAD)x", "com.aras.innovator$([char]0x200B).x", 'x.com.aras.innovator.core', ' com.aras.innovator.core', '')) {
  $c = $eib.GetMethod('IsCorePackage').Invoke($null, [object[]]@($n)); $d = $eib.GetMethod('IsDefaultPackage').Invoke($null, [object[]]@($n)); $st = $eib.GetMethod('IsStandardPackage').Invoke($null, [object[]]@($n))
  'STD pkg=' + (Esc $n) + ' core=' + $c + ' default=' + $d + ' standard=' + $st
}
try { $eib.GetMethod('IsStandardPackage').Invoke($null, [object[]]@($null)) } catch { 'STD null EXC ' + $_.Exception.InnerException.GetType().Name }

"## Engine call form for the type directory: Folder\type\ then DirectoryExists, CreateDirectory, save"
$fsd = Join-Path $Work 'fs5'; if (Test-Path $fsd) { Remove-Item -Recurse -Force $fsd }; New-Item -ItemType Directory -Path $fsd | Out-Null
function TypeWrite($type, $name, $content) {
  $text2 = $fsd + '\' + $type + '\'
  $d = NewDoc ('<AML><Item id="' + $content + '"/></AML>')
  try { if (-not $iow.DirectoryExists($text2)) { [void]$iow.DirectoryCreateDirectory($text2) }; $iow.XmlDocumentSaveWithSettings($d, ($text2 + $name), $null); 'TW type=' + (Esc $type) + ' name=' + (Esc $name) + ' ok' } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; 'TW type=' + (Esc $type) + ' name=' + (Esc $name) + ' EXC ' + $e.GetType().Name + ': ' + (Esc $e.Message) }
}
TypeWrite 'Method' 'a.xml' 'm1'; TypeWrite 'method' 'b.xml' 'm2'; TypeWrite 'METHOD' 'A.XML' 'm3'
TypeWrite 'Sp ' 'a.xml' 'sp'; TypeWrite 'Sp' 'b.xml' 'sp-plain'
TypeWrite 'Dot.' 'a.xml' 'dot'; TypeWrite 'Dot' 'b.xml' 'dot-plain'
TypeWrite 'Two  ' 'a.xml' 'two-spaces'
TypeWrite 'Sp.. ' 'a.xml' 'dots-then-space'
TypeWrite 'a/b' 'x.xml' 'slash'; TypeWrite 'a\b' 'y.xml' 'backslash'
TypeWrite 'a:b' 'x.xml' 'colon'; TypeWrite 'a*b' 'x.xml' 'star'; TypeWrite 'a?b' 'x.xml' 'q'; TypeWrite 'a"b' 'x.xml' 'dq'; TypeWrite 'a<b' 'x.xml' 'lt'; TypeWrite 'a|b' 'x.xml' 'bar'
TypeWrite '' 'x.xml' 'empty-type'
TypeWrite 'Item Type' 'with space.xml' 'sp-name'
TypeWrite 'NUL' 'x.xml' 'nul'; TypeWrite 'CON' 'x.xml' 'con'
TypeWrite '..' 'up.xml' 'dotdot'; TypeWrite '.' 'cur.xml' 'dot'
TypeWrite 'T' ' .xml' 'space-name'; TypeWrite 'T' '..xml' 'dots-name'; TypeWrite 'T' '.xml' 'only-ext'
'FS5 tree:'
Get-ChildItem -Recurse -Force $fsd | ForEach-Object { '  ' + (Esc ($_.FullName.Replace($fsd, '<FS>'))) + $(if ($_.PSIsContainer) { ' [dir]' } else { ' = ' + (Esc ([IO.File]::ReadAllText($_.FullName))) }) }
"parent listing: " + ((Get-ChildItem $Work -Force | Where-Object { $_.Name -in 'up.xml','cur.xml' } | ForEach-Object { $_.Name }) -join ',')
Remove-Item (Join-Path $Work 'up.xml') -ErrorAction SilentlyContinue

$ctxT = $libs.GetType($T + "SolutionUpgradeContext"); $iem = $libs.GetType($T + "ImportExportManager"); $mCOD = $iem.GetMethod("CreateOutputDir", $flags)
"## NLP NormalizeLongPath"
$long = 'C:\' + ('d' * 120) + '\' + ('e' * 120) + '\f.xml'
foreach ($p in @('C:\a\b.xml', '.\x\y.xml', 'x\y.xml', '\\server\share\dir\f.xml', '\\?\C:\a\b.xml', '\\?\UNC\server\share\f.xml', '??C:\a', $long, ('C:\' + ('d' * 251)), ('C:\' + ('d' * 252)), ('C:\' + ('d' * 253)), 'C:\a\..\b', '', $null, '//server/share/x', 'C:/a/b.xml', 'C:\a\b.xml ')) {
  try { $r = $iow.NormalizeLongPath($p); "NLP in=" + (Abbr $p) + " len=" + $(if ($p) { $p.Length } else { 0 }) + " out=" + (Abbr $r) } catch { "NLP in=" + (Abbr $p) + " EXC " + ($_.Exception.InnerException.Message) }
}
"cwd=" + (Get-Location).Path

"## COD CreateOutputDir"
$ctxT = $libs.GetType($T + 'SolutionUpgradeContext')
$iem = $libs.GetType($T + 'ImportExportManager')
$ctx = New-Object $ctxT; $ctx.WorkingDirectory = $Work
$ctx.Action = [Enum]::ToObject($libs.GetType($T + "ImportExport"), 1)
$mgr = $iem.GetConstructors()[0].Invoke([object[]]@((U $ctx), $null, (U $helper)))
$mCOD = $iem.GetMethod('CreateOutputDir', $flags)
function Cod($pkg) { try { $r = $mCOD.Invoke((U $mgr), [object[]]@($pkg)); $rel = $r.Replace($Work, '<WD>'); "COD pkg=" + (Esc $pkg) + " -> " + (Esc $rel) } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; "COD pkg=" + (Esc $pkg) + " EXC " + $e.GetType().FullName + ': ' + (Esc $e.Message) } }
foreach ($p in @('com.aras.innovator.core', 'com.aras.innovator.solution.PLM', 'com.aras.innovator.Core', 'COM.ARAS.DEFAULTS.x', 'com.aras.defaults', 'com.aras.defaults.', 'com.aras.innovator.', 'com.aras.innovator', 'com.acme.thing', 'Thing', 'a.b.', 'a.b.c.', '.', '', 'a..b', 'com.x.PLM', 'org.y.PLM', 'a.b ', 'a.b.CON', "a.b`n", 'a b.c d', 'a.b.c:d', 'a.b/c')) { Cod $p }
"-- wipe test"
$d1 = Join-Path $Work 'PLM\Import'; New-Item -ItemType Directory -Force -Path $d1 | Out-Null; Set-Content -Path (Join-Path $d1 'keep.txt') -Value 'x'; New-Item -ItemType Directory -Force -Path (Join-Path $d1 'sub') | Out-Null
"before: " + ((Get-ChildItem -Recurse $d1 | ForEach-Object { $_.FullName.Replace($Work, '<WD>') }) -join ', ')
Cod 'org.other.PLM' | Out-Null
"after : " + ((Get-ChildItem -Recurse $d1 | ForEach-Object { $_.FullName.Replace($Work, '<WD>') }) -join ', ') + ' (exists=' + (Test-Path $d1) + ')'

"## CreateOutputDir forms"
$ctx2 = New-Object $ctxT
$ctx2.WorkingDirectory = $Work + '\wd2\'
$ctx2.Action = [Enum]::ToObject($libs.GetType($T + "ImportExport"), 1)
$mgr2 = $iem.GetConstructors()[0].Invoke([object[]]@((U $ctx2), $null, (U $helper)))
function Cod2($pkg) { try { $r = $mCOD.Invoke((U $mgr2), [object[]]@($pkg)); 'COD2 pkg=' + (Esc $pkg) + ' -> ' + (Esc $r.Replace($Work, '<WD>')) } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; 'COD2 pkg=' + (Esc $pkg) + ' EXC ' + $e.GetType().Name } }
Cod2 'com.aras.innovator.core'; Cod2 'com.x.PLM'
$ctx3 = New-Object $ctxT; $ctx3.WorkingDirectory = 'rel_out'; $ctx3.Action = [Enum]::ToObject($libs.GetType($T + "ImportExport"), 1)
$mgr3 = $iem.GetConstructors()[0].Invoke([object[]]@((U $ctx3), $null, (U $helper)))
try { $r = $mCOD.Invoke((U $mgr3), [object[]]@('com.x.PLM')); 'COD3 relative WD -> ' + (Esc $r) } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; 'COD3 EXC ' + $e.GetType().Name + ': ' + (Esc $e.Message) }
'-- case-insensitive wipe'
$ctx4 = New-Object $ctxT; $ctx4.WorkingDirectory = $Work + '\wd4'; $ctx4.Action = [Enum]::ToObject($libs.GetType($T + "ImportExport"), 1)
New-Item -ItemType Directory -Force -Path $ctx4.WorkingDirectory | Out-Null
$mgr4 = $iem.GetConstructors()[0].Invoke([object[]]@((U $ctx4), $null, (U $helper)))
$r1 = $mCOD.Invoke((U $mgr4), [object[]]@('com.aras.innovator.Core')); Set-Content -Path ($r1 + '\x.txt') -Value 'x'
'before: ' + ((Get-ChildItem -Recurse ($ctx4.WorkingDirectory + '\com') | ForEach-Object { $_.FullName.Replace($ctx4.WorkingDirectory, '<WD>') }) -join ', ')
$r2 = $mCOD.Invoke((U $mgr4), [object[]]@('com.aras.innovator.core'))
'after : ' + ((Get-ChildItem -Recurse ($ctx4.WorkingDirectory + '\com') | ForEach-Object { $_.FullName.Replace($ctx4.WorkingDirectory, '<WD>') }) -join ', ') + ' ; x.txt exists=' + (Test-Path ($r2 + '\x.txt'))
'-- wipe leaves readonly/hidden?'
$r5 = $mCOD.Invoke((U $mgr4), [object[]]@('com.q.RO')); Set-Content -Path ($r5 + '\ro.txt') -Value 'x'; (Get-Item ($r5 + '\ro.txt')).IsReadOnly = $true
try { [void]$mCOD.Invoke((U $mgr4), [object[]]@('org.q.RO')); 'RO wipe ok, exists=' + (Test-Path ($r5 + '\ro.txt')) } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; 'RO wipe EXC ' + $e.GetType().Name + ': ' + (Esc $e.Message) }
'-- file where dir expected'
New-Item -ItemType Directory -Force -Path ($ctx4.WorkingDirectory + '\FF') | Out-Null; Set-Content -Path ($ctx4.WorkingDirectory + '\FF\Import') -Value 'x'
try { [void]$mCOD.Invoke((U $mgr4), [object[]]@('a.FF')); 'FILEDIR ok, isdir=' + (Test-Path -PathType Container ($ctx4.WorkingDirectory + '\FF\Import')) } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; 'FILEDIR EXC ' + $e.GetType().Name + ': ' + (Esc $e.Message) }
"## FS case rules and device-named directories"
$fsd = Join-Path $Work 'fs2'; if (Test-Path $fsd) { Remove-Item -Recurse -Force $fsd }; New-Item -ItemType Directory -Path $fsd | Out-Null
function FsWrite($rel, $content) {
  $p = $fsd + '\' + $rel
  $d = NewDoc ('<AML><Item id="' + $content + '"/></AML>')
  try { $dir = [IO.Path]::GetDirectoryName($p); if (-not $iow.DirectoryExists($dir)) { [void]$iow.DirectoryCreateDirectory($dir) }; $iow.XmlDocumentSaveWithSettings($d, $p, $null); "FSW " + (Esc $rel) + " ok" } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; "FSW " + (Esc $rel) + " EXC " + $e.GetType().FullName + ': ' + (Esc $e.Message) }
}
$pairs = @(@(0x00E4,0x00C4,'a-umlaut'), @(0x00E9,0x00C9,'e-acute'), @(0x0131,0x0049,'dotless-i vs I'), @(0x0130,0x0069,'dotted-I vs i'), @(0x017F,0x0053,'long-s vs S'), @(0x212A,0x006B,'kelvin vs k'), @(0x03C3,0x03A3,'sigma vs Sigma'), @(0x03C2,0x03A3,'final-sigma vs Sigma'), @(0x00DF,0x1E9E,'sharp-s vs capital sharp-s'), @(0x00B5,0x039C,'micro vs Mu'), @(0x01C5,0x01C4,'Dz-titlecase vs DZ'), @(0x1E9B,0x1E60,'long-s-dot vs S-dot'), @(0x0069,0x0049,'i vs I'))
foreach ($p in $pairs) {
  $n = $p[2]; $dd = 'c_' + ($p[0].ToString('X4')) + '_' + ($p[1].ToString('X4'))
  $a = [string][char]$p[0]; $b = [string][char]$p[1]
  FsWrite ($dd + '\' + $a + '.xml') 'first'; FsWrite ($dd + '\' + $b + '.xml') 'second'
  $names = (Get-ChildItem (Join-Path $fsd $dd) | ForEach-Object { Esc $_.Name }) -join ' | '
  'CASE ' + $n + ' (U+' + $p[0].ToString('X4') + ' / U+' + $p[1].ToString('X4') + ') -> files: ' + $names
}
FsWrite 'NUL\x.xml' 'nul-dir'; FsWrite 'CON\x.xml' 'con-dir'; FsWrite 'aux\x.xml' 'aux-dir'; FsWrite 'LPT1\x.xml' 'lpt-dir'
'DEVDIR: ' + ((Get-ChildItem $fsd -Directory | Where-Object { $_.Name -notlike 'c_*' } | ForEach-Object { Esc $_.Name }) -join ' | ')
FsWrite 'Dir  \z.xml' 'two-trailing-spaces'
FsWrite 'Dir.\z2.xml' 'trailing-dot'
FsWrite 'D\z.xml' 'D'; FsWrite 'd\z.xml' 'd-lower'
'D: ' + ((Get-ChildItem $fsd -Directory | Where-Object { $_.Name -like '?' -or $_.Name -like 'Dir*' } | ForEach-Object { Esc $_.Name }) -join ' | ')
'DZ: ' + (Esc ([IO.File]::ReadAllText((Get-ChildItem (Join-Path $fsd 'D') | Select-Object -First 1).FullName)))
"## Partial write: lone surrogate reference"
$fsd = Join-Path $Work 'fs3'; if (Test-Path $fsd) { Remove-Item -Recurse -Force $fsd }; New-Item -ItemType Directory -Path $fsd | Out-Null
$d = NewDoc '<AML><Item type="a"><name>x&#xD800;y</name></Item></AML>'
try { $iow.XmlDocumentSaveWithSettings($d, ($fsd + '\sur.xml'), $null); 'SUR no exception' } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; 'SUR EXC ' + $e.GetType().FullName + ': ' + (Esc $e.Message) }
$b = [IO.File]::ReadAllBytes($fsd + '\sur.xml'); 'SUR file bytes=' + $b.Length + ' hex=' + (($b | ForEach-Object { $_.ToString('X2') }) -join '')
"## Trailing space and dot in file names (direct)"
function W2($rel, $c) { $d = NewDoc ('<AML><Item id="' + $c + '"/></AML>'); try { $iow.XmlDocumentSaveWithSettings($d, ($fsd + '\' + $rel), $null); 'W2 ' + (Esc $rel) + ' ok' } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; 'W2 ' + (Esc $rel) + ' EXC ' + $e.GetType().Name + ': ' + (Esc $e.Message) } }
W2 'tr.xml ' 'sp'; W2 'tr.xml.' 'dot'; W2 'tr2.xml  ' 'sp2'; W2 'tr3 .xml' 'midsp'; W2 'dot..' 'dd'
'LS3: ' + ((Get-ChildItem $fsd | ForEach-Object { Esc $_.Name }) -join ' | ')
"## NormalizeLongPath boundaries"
foreach ($n in 252, 253, 254, 255, 256, 259, 260, 261, 270) {
  $p = 'C:\' + ('d' * ($n - 3)); try { $r = $iow.NormalizeLongPath($p); 'NLPB len=' + $n + ' prefixed=' + $r.StartsWith('\\?\') + ' outlen=' + $r.Length } catch { 'NLPB len=' + $n + ' EXC ' + $_.Exception.InnerException.GetType().Name }
}
foreach ($n in 250, 254, 255, 256, 300) {
  $p = '\\srv\sh\' + ('d' * ($n - 9)); try { $r = $iow.NormalizeLongPath($p); 'NLPU len=' + $n + ' out=' + (Abbr $r) + ' outlen=' + $r.Length } catch { 'NLPU len=' + $n + ' EXC ' + $_.Exception.InnerException.GetType().Name }
}
foreach ($n in 255, 300) {
  $p = 'x\' + ('d' * ($n - 2)); try { $r = $iow.NormalizeLongPath($p); 'NLPR len=' + $n + ' prefixed=' + $r.StartsWith('\\?\') + ' outlen=' + $r.Length + ' startsWithCwd=' + $r.StartsWith('\\?\' + (Get-Location).Path) } catch { 'NLPR len=' + $n + ' EXC ' + $_.Exception.InnerException.GetType().Name }
}
foreach ($p in @('\\?\C:\a\b', '\\?\\C:\a', '?\?C:\a', '\\\a', '\\?', '\\', '?', '\\?\\\?\X:\q', '\?\C:\a')) { try { 'NLPT in=' + (Esc $p) + ' out=' + (Esc $iow.NormalizeLongPath($p)) } catch { 'NLPT in=' + (Esc $p) + ' EXC ' + $_.Exception.InnerException.GetType().Name + ': ' + (Esc $_.Exception.InnerException.Message) } }
"## NLP unc write: where does the file land"
$cwd = (Get-Location).Path; "cwd=" + $cwd
$d = NewDoc '<AML><Item id="u"/></AML>'
$tmpShare = '\\localhost\' + ($Work.Substring(0,1)) + '$' + $Work.Substring(2) + '\uncw'
New-Item -ItemType Directory -Force -Path ($Work + '\uncw') | Out-Null
try { $iow.XmlDocumentSaveWithSettings($d, ($tmpShare + '\f.xml'), $null); 'UNCW ok' } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; 'UNCW EXC ' + $e.GetType().Name + ': ' + (Esc $e.Message) }
'UNCW real exists=' + (Test-Path ($Work + '\uncw\f.xml'))
'UNCW relative exists=' + (Test-Path ($cwd + '\localhost\' + ($Work.Substring(0,1)) + '$' + $Work.Substring(2) + '\uncw\f.xml'))
Get-ChildItem -Recurse -Force ($cwd) -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like '*localhost*' } | Select-Object -First 5 | ForEach-Object { 'UNCW found ' + $_.FullName.Replace($cwd, '<CWD>') }

"## Astral code points and Unicode normalisation in file names"
$d = Join-Path $Work 'astral'; if (Test-Path $d) { Remove-Item -Recurse -Force $d }; New-Item -ItemType Directory -Path $d | Out-Null
$a = [char]::ConvertFromUtf32(0x10428); $b = [char]::ConvertFromUtf32(0x10400)
[IO.File]::WriteAllText((Join-Path $d ($a + '.xml')), 'lower'); [IO.File]::WriteAllText((Join-Path $d ($b + '.xml')), 'upper')
'ASTRAL files=' + ((Get-ChildItem $d | ForEach-Object { $_.Name.Length.ToString() + ':' + (($_.Name.ToCharArray() | ForEach-Object { ([int]$_).ToString('X4') }) -join '') }) -join ' | ')
$e = Join-Path $d 'e'; New-Item -ItemType Directory $e | Out-Null
$x = [string][char]0x00E9; $y = [string][char]0x0065 + [char]0x0301
[IO.File]::WriteAllText((Join-Path $e ($x + '.xml')), '1'); [IO.File]::WriteAllText((Join-Path $e ($y + '.xml')), '2')
'NORM files=' + ((Get-ChildItem $e | ForEach-Object { (($_.Name.ToCharArray() | ForEach-Object { ([int]$_).ToString('X4') }) -join '') }) -join ' | ')

"## T1 Same file name in different case: overwrite keeps the first spelling"
$fsd = Join-Path $Work 'fs1'; if (Test-Path $fsd) { Remove-Item -Recurse -Force $fsd }; New-Item -ItemType Directory -Path $fsd | Out-Null
foreach ($pair in @(@('y.XML', 'first'), @('y.Xml', 'second'), @('Y.xml', 'third'))) {
  $d = NewDoc ('<AML><Item id="' + $pair[1] + '"/></AML>'); $iow.XmlDocumentSaveWithSettings($d, ($fsd + '\' + $pair[0]), $null)
}
'T1 files: ' + ((Get-ChildItem $fsd | ForEach-Object { $_.Name + ' = ' + (Esc ([IO.File]::ReadAllText($_.FullName))) }) -join ' | ')

"## NLPL NormalizeLongPath input-length limit (absolute and relative inputs)"
foreach ($n in 255, 256, 257, 258, 259) { $p = 'C:\' + ('d' * ($n - 3)); try { $r = $iow.NormalizeLongPath($p); "NLPL ABS in=$n out=$($r.Length) prefixed=$($r.StartsWith('\\?\'))" } catch { "NLPL ABS in=$n EXC $($_.Exception.InnerException.GetType().Name)" } }
foreach ($n in 200, 254, 255, 256, 257, 258, 259, 260, 400) { $p = ('d' * ($n - 2)) + '\f'; try { $r = $iow.NormalizeLongPath($p); "NLPL REL in=$n out=$($r.Length) prefixed=$($r.StartsWith('\\?\'))" } catch { "NLPL REL in=$n EXC $($_.Exception.InnerException.GetType().Name)" } }
