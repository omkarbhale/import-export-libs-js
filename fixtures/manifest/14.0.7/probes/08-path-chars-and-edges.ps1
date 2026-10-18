$dll = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\14.0.7\Libs.dll'
[void][Reflection.Assembly]::LoadFrom($dll)
$tmp = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\tmp'
. (Join-Path $env:LOCALAPPDATA 'libsjs10-probe\common.ps1')
$NS = [NullString]::Value
$doc = New-Object System.Xml.XmlDocument
function Mf([string]$xml) {
  $p = Join-Path $tmp ('m' + [guid]::NewGuid().ToString('N') + '.mf')
  [IO.File]::WriteAllText($p, $xml, (New-Object Text.UTF8Encoding($false)))
  New-Object Aras.Tools.SolutionUpgrade.ManifestFile($p)
}
Write-Output '## 12 which characters make GetPackagePath throw (path attr / folder)'
$badPath = New-Object System.Collections.ArrayList
$badFolder = New-Object System.Collections.ArrayList
$okRooted = New-Object System.Collections.ArrayList
for ($i = 0; $i -le 0x9F; $i++) {
  $c = [string][char]$i
  $el = $doc.CreateElement('package'); $el.SetAttribute('name', 'N')
  $el.SetAttribute('path', 'a' + $c + 'b')
  try { [void][Aras.Tools.SolutionUpgrade.ExportImportBase]::GetPackagePath($el, 'C:\m') } catch { [void]$badPath.Add($i) }
  $el2 = $doc.CreateElement('package'); $el2.SetAttribute('name', 'N'); $el2.SetAttribute('path', 'x')
  try { [void][Aras.Tools.SolutionUpgrade.ExportImportBase]::GetPackagePath($el2, 'C:\a' + $c + 'b') } catch { [void]$badFolder.Add($i) }
  $el3 = $doc.CreateElement('package'); $el3.SetAttribute('name', 'N'); $el3.SetAttribute('path', 'C:\a' + $c + 'b')
  try { [void][Aras.Tools.SolutionUpgrade.ExportImportBase]::GetPackagePath($el3, 'C:\m') } catch { [void]$okRooted.Add($i) }
}
Say 'path attr throws for' (($badPath | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')
Say 'folder throws for' (($badFolder | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')
Say 'rooted path throws for' (($okRooted | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')
Write-Output '## 13 Combine / IsPathRooted shapes'
$combos = @(
  @('C:\m', 'x'), @('C:\m\', 'x'), @('C:\m/', 'x'), @('C:', 'x'), @('C:\m:', 'x'), @('', 'x'), @('C:\m', '\x'), @('C:\m', '/x'), @('C:\m', 'C:x'), @('C:\m', 'D:\x'), @('C:\m', '\\h\s'), @('C:\m', '//h/s'), @('C:\m', '.\x'), @('C:\m', '..\x'), @('rel', 'x'), @('rel\', 'x'), @('\\h\s\m', 'x'), @('C:\m ', 'x'), @('C:\m', ' x'), @('C:\m', 'x '), @('C:\m', ':x'), @('C:\m', 'a:b'), @('C:\m', '1:\x'), @('C:\m', 'ab:\x'), @('C:\m', '\\?\C:\x'), @('C:\m', '\??\C:\x')
)
foreach ($c in $combos) {
  $el = $doc.CreateElement('package'); $el.SetAttribute('name', 'N'); $el.SetAttribute('path', $c[1])
  try { Say ("folder={0} path={1}" -f (Esc $c[0]), (Esc $c[1])) (Esc ([Aras.Tools.SolutionUpgrade.ExportImportBase]::GetPackagePath($el, $c[0]))) } catch { Say ("folder={0} path={1}" -f (Esc $c[0]), (Esc $c[1])) (Ex $_.Exception) }
}
Write-Output '## 14 GetDependsOnInfo edge'
$m = Mf '<imports><package name="P"><dependson name=""/></package></imports>'
try { [void]$m.GetDependsOnInfo('P') } catch { Say 'GetDependsOnInfo dependson name=""' (Ex $_.Exception) }
$m = Mf '<imports><package name="P"><dependson name=" "/></package></imports>'
try { [void]$m.GetDependsOnInfo('P') } catch { Say 'GetDependsOnInfo dependson name=" "' (Ex $_.Exception) }
$m = Mf '<imports><package name="P"><dependson/></package></imports>'
try { [void]$m.GetDependsOnInfo('P') } catch { Say 'GetDependsOnInfo dependson no name' (Ex $_.Exception) }
$m = Mf '<imports><package name="P"><dependson name="x&apos;y"/></package></imports>'
try { [void]$m.GetDependsOnInfo('P') } catch { Say 'GetDependsOnInfo dependson name x quote y' (Ex $_.Exception) }
$m = Mf '<imports><package name="P"><dependson name="a"><referenced_element id="1"/></dependson><dependson name="a&apos; or @name=&apos;a"/><dependson name="b"><referenced_element id="2"/></dependson></package></imports>'
try { $h = $m.GetDependsOnInfo('P'); Say 'injection keys' (($h.Keys | ForEach-Object { $_ }) -join ' | ') } catch { Say 'injection' (Ex $_.Exception) }
$m = Mf '<imports><package name="P"><dependson name=" a "><referenced_element id="1"/></dependson><dependson name="A"/></package></imports>'
$h = $m.GetDependsOnInfo('P'); Say 'padded and case keys' (($h.Keys | ForEach-Object { Esc $_ }) -join ' | ')
$m = Mf '<imports><package name="P"><dependson name="a"><x><referenced_element id="deep"/></x><referenced_element id="top"/></dependson></package></imports>'
$h = $m.GetDependsOnInfo('P'); Say 'only direct referenced_element' (($h['a'] | ForEach-Object { $_.idName }) -join ',')
$m = Mf '<imports><package name="P"><x><dependson name="nested"/></x><dependson name="top"/></package></imports>'
$h = $m.GetDependsOnInfo('P'); Say 'only direct dependson' (($h.Keys | ForEach-Object { $_ }) -join ',')
Say 'GetPackageDependencies nested' ((@($m.GetPackageDependencies('P'))) -join ',')
try { Say 'GetPackageDependencies empty-name dep' ((@((Mf '<imports><package name="P"><dependson name=""/><dependson/></package></imports>').GetPackageDependencies('P')) | ForEach-Object { Esc $_ }) -join ',') } catch { Say 'GetPackageDependencies noname' (Ex $_.Exception) }
Write-Output '## 15 NormalizeLongPath-visible'
foreach ($p in @('.\n1.mf', '..\tmp\n2.mf', ('\\\' + (Join-Path $tmp 'n3.mf')), ('?' + (Join-Path $tmp 'n4.mf')))) {
  $mm = New-Object Aras.Tools.SolutionUpgrade.ManifestFile; [void]$mm.AddPackage('P')
  Set-Location $tmp; [Environment]::CurrentDirectory = $tmp
  try { $mm.Save($p); Say ('Save ' + (Esc $p)) 'ok' } catch { Say ('Save ' + (Esc $p)) (Ex $_.Exception) }
}
foreach ($p in @('', '   ', 'a|b', 'a<b', ("a`tb"), 'a?b', 'C:\x:y')) {
  $mm = New-Object Aras.Tools.SolutionUpgrade.ManifestFile; [void]$mm.AddPackage('P')
  try { $mm.Save($p); Say ('Save ' + (Esc $p)) 'ok' } catch { Say ('Save ' + (Esc $p)) (Ex $_.Exception) }
  try { [void](New-Object Aras.Tools.SolutionUpgrade.ManifestFile($p)); Say ('Load ' + (Esc $p)) 'ok' } catch { Say ('Load ' + (Esc $p)) (Ex $_.Exception) }
}
