# Probes the 12.0 Libs.dll for the post-XSL step and the file write that differ from 14.0.7 (spec/export-write.md, EXP-405, EXP-420 to EXP-423).
# Run on Windows PowerShell 5.1 against a staged copy of oracle/native/12.0 (see README.md). It calls the engine's own
# CdataFilterXmlInMacCondition and CommonMethods.SaveToFile by reflection on offline documents and writes only under -Work.
param([string]$Bin, [string]$Work)
$ErrorActionPreference = 'Stop'
[Environment]::CurrentDirectory = $Work
Set-Location $Work
[Reflection.Assembly]::LoadFrom((Join-Path $Bin 'IOM.dll')) | Out-Null
$libs = [Reflection.Assembly]::LoadFrom((Join-Path $Bin 'Libs.dll'))
Add-Type -AssemblyName System.Xml
$flags = [Reflection.BindingFlags]'Public,NonPublic,Instance,Static'
$cei = $libs.GetType('Aras.Tools.SolutionUpgrade.CExportItems')
$cm = $libs.GetType('Aras.Tools.CommonMethods')
$mCDF = $cei.GetMethod('CdataFilterXmlInMacCondition', $flags)
$mSave = $cm.GetMethod('SaveToFile', $flags)

function Esc([string]$s) { if ($null -eq $s) { return '<null>' }; $sb = New-Object Text.StringBuilder; foreach ($c in $s.ToCharArray()) { $n = [int]$c; if ($c -eq "`r") { [void]$sb.Append('\r') } elseif ($c -eq "`n") { [void]$sb.Append('\n') } elseif ($c -eq "`t") { [void]$sb.Append('\t') } elseif ($c -eq '"') { [void]$sb.Append('\"') } elseif ($n -lt 32 -or $n -gt 126) { [void]$sb.Append(('\u{0:X4}' -f $n)) } else { [void]$sb.Append($c) } }; $sb.ToString() }
function U($x) { if ($x -is [System.Management.Automation.PSObject]) { $x.psobject.BaseObject } else { $x } }
function NewDoc([string]$xml) { $d = New-Object System.Xml.XmlDocument; $d.PreserveWhitespace = $true; $d.LoadXml($xml); $d }
function Save($doc, [string]$path) {
  try { $mSave.Invoke($null, [object[]]@($path, (U $doc))) | Out-Null } catch [Reflection.TargetInvocationException] { throw $_.Exception.InnerException }
  $b = [IO.File]::ReadAllBytes($path)
  $bom = ''; $off = 0
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $bom = '[BOM]'; $off = 3 }
  $bom + '"' + (Esc ([Text.Encoding]::UTF8.GetString($b, $off, $b.Length - $off))) + '"'
}
function Run($id, $inp) {
  try {
    $d = NewDoc $inp
    try { $mCDF.Invoke($null, [object[]]@((U $d))) | Out-Null } catch [Reflection.TargetInvocationException] { throw $_.Exception.InnerException }
    $p = Join-Path $Work ('f' + [guid]::NewGuid().ToString('N') + '.xml')
    "$id in : " + (Esc $inp); "$id out: " + (Save $d $p); Remove-Item $p
  } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; "$id in : " + (Esc $inp); "$id EXC: " + $e.GetType().FullName + ': ' + (Esc $e.Message) }
}

"## CDF CdataFilterXmlInMacCondition (12.0: first occurrence only, condition_xml only)"
foreach ($pair in @(
 @('CDF1', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>a&b</filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF2', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml><![CDATA[a]]]]><![CDATA[></filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF3', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml>&lt;filter_xml&gt;&lt;a x="1"&gt;t&amp;amp;u&lt;/a&gt;&lt;/filter_xml&gt;</condition_xml></Item></AML>'),
 @('CDF4', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[no filter here &amp; &lt;]]></condition_xml></Item></AML>'),
 @('CDF5', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml/></Item></AML>'),
 @('CDF6', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>x</filter_xml><filter_xml>y</filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF7', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>x &amp;nbsp; &#160; &lt;b&gt; &eacute;</filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF8', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>x]]]]><![CDATA[></filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF10', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml>plain &amp; text</condition_xml></Item></AML>'),
 @('CDF11', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>x</filter_xml>]]>  tail</condition_xml></Item></AML>'),
 @('CDF13', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>x</filter_xml><filter_xml>y</filter_xml><filter_xml>z</filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF14', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml><![CDATA[a]]]]><![CDATA[></filter_xml><filter_xml>b</filter_xml>]]></condition_xml></Item></AML>'),
 @('CDF15', '<AML><Item type="mp_MacPolicy" id="1"><condition_xml><![CDATA[<filter_xml>x</filter_xml>]]></condition_xml></Item><Item type="mp_MacPolicy" id="2"><condition_xml><![CDATA[<filter_xml>y</filter_xml><filter_xml>z</filter_xml>]]></condition_xml></Item></AML>')
)) { Run $pair[0] $pair[1] }

"## SAVE CommonMethods.SaveToFile (12.0: the item-file writer, no path normalisation)"
$doc = NewDoc ('<AML><Item type="Foo" id="1" action="add"><name>caf' + [char]0xE9 + '</name><text>a' + "`r`n" + 'b</text><empty/><Relationships/></Item></AML>')
$p = Join-Path $Work 's1.xml'
"SAVE1 out: " + (Save $doc $p); Remove-Item $p
$sub = Join-Path $Work 'sub'
try { $r = Save $doc (Join-Path $sub 's2.xml') } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; $r = 'EXC: ' + $e.GetType().FullName + ': ' + (Esc $e.Message) }
"SAVE2 missing folder: $r"
$rel = 'rel.xml'
"SAVE3 relative path: " + (Save $doc $rel); Remove-Item $rel
# a path whose full length is over 260 characters, written with no prefix (the host runtime decides whether this works)
$deep = $Work; $n = 0
while (($deep.Length + 1) -lt 200) { $deep = Join-Path $deep ('d' * 40); $n++ }
[IO.Directory]::CreateDirectory($deep) | Out-Null
$longFile = Join-Path $deep ('x' * 70 + '.xml')
try { $r = Save $doc $longFile } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; $r = 'EXC: ' + $e.GetType().FullName + ': ' + (Esc $e.Message) }
"SAVE4 long path (full path $($longFile.Length - $Work.Length) characters longer than the work folder, over 260 in total: $($longFile.Length -gt 260)): " + $(if ($r.StartsWith('EXC')) { $r } else { 'written' })
Remove-Item -Recurse -Force (Join-Path $Work ('d' * 40)) -ErrorAction SilentlyContinue
