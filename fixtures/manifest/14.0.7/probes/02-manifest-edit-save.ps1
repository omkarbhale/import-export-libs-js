$ErrorActionPreference = 'Continue'
$dll = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\14.0.7\Libs.dll'
[void][Reflection.Assembly]::LoadFrom($dll)
$tmp = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\tmp'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
. (Join-Path $env:LOCALAPPDATA 'libsjs10-probe\common.ps1')
$NS = [NullString]::Value

Write-Output '## 3 null/edge args to IsStandard'
foreach ($f in 'IsStandardPackage','IsCorePackage','IsDefaultPackage') {
  try { $r = [Aras.Tools.SolutionUpgrade.ExportImportBase]::$f($NS); Say "$f(null)" $r } catch { Say "$f(null)" (Ex $_.Exception) }
}
$LS = [string][char]0x17F
foreach ($n in ("com.aras.defaults" + $LS + ".x"), ("com.aras.default" + $LS + ".x"), ("com.aras.innovator.x"), ("com.aras.defaults.x")) {
  Say ("IsDefault " + (Esc $n)) ([Aras.Tools.SolutionUpgrade.ExportImportBase]::IsDefaultPackage($n))
}

Write-Output '## 4 Trim whitespace set (Char.IsWhiteSpace vs String.Trim) over BMP'
$ws = New-Object System.Collections.ArrayList
$wsTrim = New-Object System.Collections.ArrayList
for ($i = 0; $i -le 0xFFFF; $i++) {
  if ($i -ge 0xD800 -and $i -le 0xDFFF) { continue }
  $s = [string][char]$i
  if ([char]::IsWhiteSpace([char]$i)) { [void]$ws.Add($i) }
  if ($s.Trim().Length -eq 0) { [void]$wsTrim.Add($i) }
}
Say 'IsWhiteSpace' (($ws | ForEach-Object { '{0:X4}' -f $_ }) -join ' ')
Say 'Trim-empty' (($wsTrim | ForEach-Object { '{0:X4}' -f $_ }) -join ' ')

Write-Output '## 5 AddPackage / Save'
function NewMf { New-Object Aras.Tools.SolutionUpgrade.ManifestFile }
function SaveHex($mf, $name) {
  $p = Join-Path $tmp $name
  if (Test-Path $p) { Remove-Item $p }
  $mf.Save($p)
  $b = [IO.File]::ReadAllBytes($p)
  $bom = ''
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $bom = '[BOM] ' }
  elseif ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE) { $bom = '[UTF16LE-BOM] ' }
  $t = if ($bom -eq '[UTF16LE-BOM] ') { [Text.Encoding]::Unicode.GetString($b, 2, $b.Length - 2) } else { [Text.Encoding]::UTF8.GetString($b) }
  if ($bom -eq '[BOM] ') { $t = $t.Substring(1) }
  $bom + (Esc $t)
}
$mf = NewMf
Say 'empty' (SaveHex $mf 'e.mf')
$names = @('com.aras.innovator.solution.PLM', 'com.aras.innovator.core', 'com.aras.defaults.X.Y', 'My.Pkg', 'nodots', 'trailing.', 'a.b.', '.lead', 'a..b', '', 'x.y z', "a.b`n", "a.b`r`n", 'Ünï.çode', 'COM.ARAS.DEFAULTS.q')
foreach ($n in $names) {
  $mf = NewMf
  try { $el = $mf.AddPackage($n); Say ("AddPackage " + (Esc $n)) (Esc $el.OuterXml) } catch { Say ("AddPackage " + (Esc $n)) (Ex $_.Exception) }
}
$mf = NewMf
try { [void]$mf.AddPackage($NS) } catch { Say 'AddPackage(null)' (Ex $_.Exception) }
# duplicate AddPackage returns existing
$mf = NewMf
$a = $mf.AddPackage('My.Pkg'); $b = $mf.AddPackage('My.Pkg'); Say 'dup AddPackage same node' ([object]::ReferenceEquals($a, $b))
$c = $mf.AddPackage('my.pkg'); Say 'case-different AddPackage new node' (-not [object]::ReferenceEquals($a, $c))
Say 'dup saved' (SaveHex $mf 'dup.mf')
# quote in name
foreach ($n in "a'b", 'a"b', "x' or '1'='1", "x' or @name='My.Pkg", "a]b", 'a&b<c>', "a`tb") {
  $mf = NewMf
  [void]$mf.AddPackage('My.Pkg')
  try { $el = $mf.AddPackage($n); Say ("AddPackage2 " + (Esc $n)) (Esc $el.OuterXml) } catch { Say ("AddPackage2 " + (Esc $n)) (Ex $_.Exception) }
  try { $el = $mf.GetPackageNode($n); Say ("GetPackageNode " + (Esc $n)) $(if ($el) { Esc $el.OuterXml } else { 'null' }) } catch { Say ("GetPackageNode " + (Esc $n)) (Ex $_.Exception) }
}

Write-Output '## 6 AddDependsOn / AddReferencedElement'
$mf = NewMf
$p = $mf.AddPackage('My.Pkg')
foreach ($d in 'com.aras.innovator.core', '', '   ', "`t", $NS, 'dep"x', "dep'x", 'com.aras.innovator.core', 'dep&amp;') {
  try { $el = $mf.AddDependsOn($p, $d); Say ("AddDependsOn " + (Esc $d)) (Esc $el.OuterXml) } catch { Say ("AddDependsOn " + (Esc $d)) (Ex $_.Exception) }
}
try { [void]$mf.AddDependsOn($null, 'x') } catch { Say 'AddDependsOn(null node)' (Ex $_.Exception) }
$dep = $mf.AddDependsOn($p, 'com.aras.innovator.core')
$items = @(@('Part & <"Doc"> ''q'' é', 'ABC', 'ItemType'), @($NS, 'ID2', $NS), @('', 'ID3', ''), @('x', $NS, 'T'), @('dup', 'ABC', 'Other'), @("k`tl`r`nm", "I'D", 'T2'))
foreach ($i in $items) {
  $ei = New-Object Aras.Tools.SolutionUpgrade.ExportItem($i[0], $i[1], $i[2])
  try { $el = $mf.AddReferencedElement($dep, $ei); Say ("AddReferencedElement id=" + (Esc $i[1])) (Esc $el.OuterXml) } catch { Say ("AddReferencedElement id=" + (Esc $i[1])) (Ex $_.Exception) }
}
try { [void]$mf.AddReferencedElement($dep, $null) } catch { Say 'AddReferencedElement(null item)' (Ex $_.Exception) }
try { [void]$mf.AddReferencedElement($null, (New-Object Aras.Tools.SolutionUpgrade.ExportItem('a','b','c'))) } catch { Say 'AddReferencedElement(null node)' (Ex $_.Exception) }
Say 'saved' (SaveHex $mf 'full.mf')

Write-Output '## 7 Save round trip, declaration, error'
$mf = NewMf; [void]$mf.AddPackage('My.Pkg')
$p1 = Join-Path $tmp 'rt.mf'
$mf.Save($p1)
$mf2 = New-Object Aras.Tools.SolutionUpgrade.ManifestFile($p1)
Say 'rt names' (($mf2.GetAllPackageNames() | ForEach-Object { $_ }) -join ',')
$mf2.Save((Join-Path $tmp 'rt2.mf'))
Say 'rt same bytes' (([IO.File]::ReadAllText($p1)) -eq ([IO.File]::ReadAllText((Join-Path $tmp 'rt2.mf'))))
try { $mf.Save((Join-Path $tmp 'nodir\x.mf')) } catch { Say 'Save to missing dir' (Ex $_.Exception) }
try { $mf.Save('') } catch { Say 'Save to empty' (Ex $_.Exception) }
try { $mf.Save($NS) } catch { Say 'Save to null' (Ex $_.Exception) }
try { [void](New-Object Aras.Tools.SolutionUpgrade.ManifestFile((Join-Path $tmp 'missing.mf'))) } catch { Say 'ctor missing file' (Ex $_.Exception) }
$bad = Join-Path $tmp 'bad.mf'; [IO.File]::WriteAllText($bad, '<imports><package></imports>')
try { [void](New-Object Aras.Tools.SolutionUpgrade.ManifestFile($bad)) } catch { Say 'ctor malformed' (Ex $_.Exception) }
[IO.File]::WriteAllText($bad, '')
try { [void](New-Object Aras.Tools.SolutionUpgrade.ManifestFile($bad)) } catch { Say 'ctor empty file' (Ex $_.Exception) }
[IO.File]::WriteAllText($bad, '<other/>')
$mfo = New-Object Aras.Tools.SolutionUpgrade.ManifestFile($bad)
Say 'other-root names' (($mfo.GetAllPackageNames() | ForEach-Object { $_ }) -join ',')
try { [void]$mfo.AddPackage('x') } catch { Say 'other-root AddPackage' (Ex $_.Exception) }
try { [void](New-Object Aras.Tools.SolutionUpgrade.ManifestFile($NS)) } catch { Say 'ctor null' (Ex $_.Exception) }
