param([string]$Only = '')
$ErrorActionPreference = 'Continue'
$dll = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\14.0.7\Libs.dll'
[void][Reflection.Assembly]::LoadFrom($dll)
$tmp = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\tmp'
. (Join-Path $env:LOCALAPPDATA 'libsjs10-probe\common.ps1')
$NS = [NullString]::Value
function Mf([string]$xml) {
  $p = Join-Path $tmp ('m' + [guid]::NewGuid().ToString('N') + '.mf')
  [IO.File]::WriteAllText($p, $xml, (New-Object Text.UTF8Encoding($false)))
  New-Object Aras.Tools.SolutionUpgrade.ManifestFile($p)
}
# spec: "A>B,C;B>C;C" => packages with deps
function Build([string]$spec) {
  $sb = New-Object Text.StringBuilder
  [void]$sb.Append('<imports>')
  foreach ($part in $spec.Split(';')) {
    if ($part -eq '') { continue }
    $nm = $part; $deps = @()
    if ($part.Contains('>')) { $nm = $part.Substring(0, $part.IndexOf('>')); $deps = $part.Substring($part.IndexOf('>') + 1).Split(',') }
    [void]$sb.Append("<package name=`"$nm`" path=`".\`">")
    foreach ($d in $deps) { [void]$sb.Append("<dependson name=`"$d`"/>") }
    [void]$sb.Append('</package>')
  }
  [void]$sb.Append('</imports>')
  $sb.ToString()
}
function DbDoc($names) {
  $d = New-Object System.Xml.XmlDocument
  $x = '<AML>'
  foreach ($n in $names) { $x += "<Item type=`"PackageDefinition`"><name>$n</name></Item>" }
  $d.LoadXml($x + '</AML>')
  $d
}
function Order($spec, $imp, $db) {
  $mf = Mf (Build $spec)
  $w = New-Object System.Collections.ArrayList
  try {
    $r = $mf.GetPackageNamesInImportOrder($imp, $db, $w)
    $res = (@($r) -join ',')
    Say ("spec=[{0}] import=[{1}] db=[{2}]" -f $spec, ($imp -join ','), $(if ($db) { ($db.SelectNodes('//name') | ForEach-Object { $_.InnerText }) -join ',' } else { 'null' })) ("result=[{0}] type={1} warnings={2}" -f $res, $r.GetType().Name, (($w | ForEach-Object { Esc $_ }) -join ' | '))
  } catch { Say ("spec=[{0}] import=[{1}]" -f $spec, ($imp -join ',')) ((Ex $_.Exception) + ' warnings=' + (($w | ForEach-Object { Esc $_ }) -join ' | ')) }
}
$empty = DbDoc @()
if ($Only -eq '' -or $Only -eq 'order') {
Write-Output '## 8 ordering'
Order 'A;B;C' @('B','A','C') $empty
Order 'A>B;B' @('A','B') $empty
Order 'A>B;B' @('B','A') $empty
Order 'A>B;B>C;C' @('A','B','C') $empty
Order 'A>B;B>C;C' @('C','B','A') $empty
Order 'A>B;B>C;C' @('B','A','C') $empty
Order 'A>B;B>C;C' @('A','C') $empty
Order 'A>B,C;B>C;C' @('A','B','C') $empty
Order 'A>B,C;B>C;C' @('A','C') $empty
Order 'A>B;B>A' @('A','B') $empty
Order 'A>B;B>A' @('B','A') $empty
Order 'A>A' @('A') $empty
Order 'A>X' @('A') $empty
Order 'A>X' @('A') (DbDoc @('X'))
Order 'A>X' @('A') (DbDoc @('Y','X'))
Order 'A>X' @('A') $NS
Order 'A>X;B>X' @('A','B') $empty
Order 'A>X;B>X' @('B','A') $empty
Order 'A>B;B>X' @('A','B') (DbDoc @('X'))
Order 'A>B;B>X' @('A','B') $empty
Order 'A' @('Z') $empty
Order 'A' @('Z','A') $empty
Order 'A' @('A','A') $empty
Order 'A;a' @('a','A') $empty
Order 'A>b;b' @('A') $empty
Order 'A>B;B' @('B') $empty
Order 'A>B;B' @() $empty
Order 'A>B,B;B' @('A','B') $empty
Order 'A>B;A>C;B;C' @('A','B','C') $empty
Order 'A>B;A>C;B;C' @('A','C','B') $empty
Order 'A>C,B;B;C' @('A','B','C') $empty
Order 'A>B;A;B' @('A','B') $empty
Order 'A>B;C>B;B>D;D' @('A','C','B','D') $empty
Order 'A>B;C>B;B>D;D' @('D','A','C','B') $empty
Order 'A>B;B>C;C>D;D' @('A','B','C','D') $empty
Order 'A>B;B>C;C>D;D>A' @('A','B','C','D') $empty
Order 'A>B;B>C;C>D;D>A' @('B','A','C','D') $empty
Order 'A>B;B>C;C>D;D>A' @('D','C','B','A') $empty
Order 'A>B,C;B>A;C>A' @('A','B','C') $empty
Order 'A>' @('A') $empty
Order 'A>B;B' @('A','B','A') $empty
Order 'A>B;B' @(,'A') $empty
Order 'A>B;B' @($NS, 'A') $empty
Order 'A>B;B' @('') $empty
Order "A>B;B" @('A', 'B') (DbDoc @('B'))
Order 'A>B' @('A') (DbDoc @('B'))
Order 'A>B' @('A') (DbDoc @('Bx'))
# DB doc shapes
$d2 = New-Object System.Xml.XmlDocument; $d2.LoadXml('<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><Result><Item type="PackageDefinition"><name>X</name></Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>')
Order 'A>X' @('A') $d2
$d3 = New-Object System.Xml.XmlDocument; $d3.LoadXml('<AML><Item type="PackageDefinition"><name> X </name></Item><Item type="PackageDefinition" id="1"><Relationships><Item type="PackageDefinition"><name>Q</name></Item></Relationships></Item></AML>')
Order 'A>X;B>Q' @('A','B') $d3
$d4 = New-Object System.Xml.XmlDocument; $d4.LoadXml('<AML><Item type="Other"><name>X</name></Item></AML>')
Order 'A>X' @('A') $d4
Order 'A>X' @('A') (New-Object System.Xml.XmlDocument)
# name quirks
Order "A>X'Y" @('A') $empty
Order "A" @("A'B") $empty
Order "A>X;B" @("B", "A") (DbDoc @("X"))
Order 'A>X"Y' @('A') $empty
$d5 = New-Object System.Xml.XmlDocument; $d5.LoadXml('<AML><Item type="PackageDefinition"><name>X</name></Item></AML>')
Order 'A>q' @('A') $d5
Order "A>q' or name='X" @('A') $d5
# dependson without name attr
$m = Mf '<imports><package name="A" path=".\"><dependson/></package></imports>'
$w = New-Object System.Collections.ArrayList
try { $r = $m.GetPackageNamesInImportOrder(@('A'), $empty, $w); Say 'dependson no name' (@($r) -join ',') } catch { Say 'dependson no name' (Ex $_.Exception) }
$m = Mf '<imports><package name="A" path=".\"><dependson name=""/></package></imports>'
$w = New-Object System.Collections.ArrayList
try { $r = $m.GetPackageNamesInImportOrder(@('A'), $empty, $w); Say 'dependson empty name' ((@($r) -join ',') + ' warnings=' + (($w | ForEach-Object { Esc $_ }) -join ' | ')) } catch { Say 'dependson empty name' (Ex $_.Exception) }
$m = Mf '<imports><package><dependson name="B"/></package></imports>'
try { Say 'package no name GetAllPackageNames' (@($m.GetAllPackageNames()) -join ',') } catch { Say 'package no name GetAllPackageNames' (Ex $_.Exception) }
# null arguments
$m = Mf (Build 'A')
$w = New-Object System.Collections.ArrayList
try { [void]$m.GetPackageNamesInImportOrder($NS, $empty, $w) } catch { Say 'imported=null' (Ex $_.Exception) }
$m = Mf (Build 'A>B;B')
try { [void]$m.GetPackageNamesInImportOrder(@('A','B'), $empty, $NS) ; Say 'warnings=null (no warn path)' 'ok' } catch { Say 'warnings=null' (Ex $_.Exception) }
$m = Mf (Build 'A>X')
try { [void]$m.GetPackageNamesInImportOrder(@('A'), $empty, $NS) ; Say 'warnings=null (warn path)' 'ok' } catch { Say 'warnings=null (warn path)' (Ex $_.Exception) }
# imported packages as non-string collection
try { $al = New-Object System.Collections.ArrayList; [void]$al.Add(5); [void]$m.GetPackageNamesInImportOrder($al, $empty, (New-Object System.Collections.ArrayList)) } catch { Say 'imported has int' (Ex $_.Exception) }
# returned collection mutable / type
$r = (Mf (Build 'A;B')).GetPackageNamesInImportOrder(@('A','B'), $empty, (New-Object System.Collections.ArrayList))
Say 'return type' $r.GetType().FullName
}
if ($Only -eq '' -or $Only -eq 'info') {
Write-Output '## 9 GetDependsOnInfo / lookups'
$depsets = @(
  @('c'),
  @('com.aras.innovator.core', 'com.aras.innovator.admin'),
  @('com.aras.innovator.core', 'com.aras.innovator.admin', 'com.aras.innovator.solution.PLM', 'com.aras.defaults.base'),
  @('a','b','c','d','e','f','g','h'),
  @('h','g','f','e','d','c','b','a'),
  @('com.aras.innovator.a','com.aras.innovator.b','com.aras.innovator.c','com.aras.innovator.d','com.aras.innovator.e','com.aras.innovator.f','com.aras.innovator.g','com.aras.innovator.h','com.aras.innovator.i','com.aras.innovator.j','com.aras.innovator.k','com.aras.innovator.l')
)
foreach ($ds in $depsets) {
  $x = '<imports><package name="P" path=".\">'
  foreach ($d in $ds) { $x += "<dependson name=`"$d`"><referenced_element id=`"id-$d`" type=`"T`" descr=`"D $d`"/></dependson>" }
  $x += '</package></imports>'
  $m = Mf $x
  $h = $m.GetDependsOnInfo('P')
  $keys = New-Object System.Collections.ArrayList
  foreach ($k in $h.Keys) { [void]$keys.Add($k) }
  $de = New-Object System.Collections.ArrayList
  $en = $h.GetEnumerator(); while ($en.MoveNext()) { [void]$de.Add($en.Key) }
  Say ("deps(" + ($ds -join ',') + ")") ("Keys=[" + ($keys -join ',') + "] enum=[" + ($de -join ',') + "] valueType=" + $h[$ds[0]].GetType().Name + " count=" + $h.Count)
}
$m = Mf '<imports><package name="P" path=".\"><dependson name="d"><referenced_element id="1" type="T" descr="x"/><referenced_element id="2"/><referenced_element type="Q"/></dependson><dependson name="d"/></package></imports>'
try { [void]$m.GetDependsOnInfo('P') } catch { Say 'GetDependsOnInfo duplicate dependson' (Ex $_.Exception) }
$m = Mf '<imports><package name="P" path=".\"><dependson name="d"><referenced_element id="1" type="T" descr="x"/><referenced_element id="2"/><referenced_element type="Q"/><referenced_element id="1" type="T2" descr="y"/></dependson></package></imports>'
$h = $m.GetDependsOnInfo('P')
Say 'refs' (($h['d'] | ForEach-Object { '(' + (Esc $_.keyedName) + ',' + (Esc $_.idName) + ',' + (Esc $_.typeName) + ')' }) -join ' ')
Say 'GetDependsOnInfo(missing pkg).Count' ($m.GetDependsOnInfo('nope').Count)
Say 'GetDependsOnInfo(null).Count' ($m.GetDependsOnInfo($NS).Count)
try { Say 'GetDependsOnInfo("a'+"'"+'b")' ($m.GetDependsOnInfo("a'b").Count) } catch { Say 'GetDependsOnInfo(quote)' (Ex $_.Exception) }
$p = $m.GetPackageNode('P')
Say 'GetDependsOn d' (Esc ($m.GetDependsOn($p, 'd')).OuterXml)
Say 'GetDependsOn missing' $(if ($m.GetDependsOn($p, 'zz')) { 'node' } else { 'null' })
try { [void]$m.GetDependsOn($p, ' ') } catch { Say 'GetDependsOn blank' (Ex $_.Exception) }
try { [void]$m.GetDependsOn($null, 'd') } catch { Say 'GetDependsOn null node' (Ex $_.Exception) }
try { [void]$m.GetAllDependsOnNames($null) } catch { Say 'GetAllDependsOnNames null' (Ex $_.Exception) }
try { [void]$m.GetReferencedElements($null) } catch { Say 'GetReferencedElements null' (Ex $_.Exception) }
Say 'GetPackageDependencies P' ((@($m.GetPackageDependencies('P'))) -join ',')
Say 'GetPackageDependencies nope len' (@($m.GetPackageDependencies('nope')).Count)
Say 'GetPackageNode blank' $(if ($m.GetPackageNode('  ')) { 'node' } else { 'null' })
Say 'GetPackageNode null' $(if ($m.GetPackageNode($NS)) { 'node' } else { 'null' })
Say 'GetPackageNode wrong case' $(if ($m.GetPackageNode('p')) { 'node' } else { 'null' })
Say 'GetPackageNode padded' $(if ($m.GetPackageNode(' P')) { 'node' } else { 'null' })
$m2 = Mf '<imports><package name="P" path="a"/><package name="P" path="b"/><package name="Q"/><other><package name="R"/></other></imports>'
Say 'dup package first wins' (Esc $m2.GetPackageNode('P').OuterXml)
Say 'GetAllPackageNames dup' ((@($m2.GetAllPackageNames())) -join ',')
Say 'nested package not found' $(if ($m2.GetPackageNode('R')) { 'node' } else { 'null' })
Say 'GetAllPackageNames type' ($m2.GetAllPackageNames().GetType().FullName)
$m3 = Mf '<?xml version="1.0" encoding="utf-8"?><!-- c --><imports xmlns="urn:x"><package name="P"/></imports>'
Say 'default ns: GetAllPackageNames' ((@($m3.GetAllPackageNames())) -join ',')
$m4 = Mf '<Imports><package name="P"/></Imports>'
Say 'wrong case root: names' ((@($m4.GetAllPackageNames())) -join ',')
$m5 = Mf '<imports><PACKAGE name="P"/><package NAME="Q"/></imports>'
try { Say 'case tags' ((@($m5.GetAllPackageNames())) -join ',') } catch { Say 'case tags' (Ex $_.Exception) }
}
