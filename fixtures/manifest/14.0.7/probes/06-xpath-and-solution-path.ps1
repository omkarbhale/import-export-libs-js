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
Write-Output '## 10 XPath failure shapes (AddPackage on a fresh manifest)'
$q = [string][char]39
$names = @($q, ('a' + $q), ($q + 'a'), ('a' + $q + $q + 'b'), ('a' + $q + ' and ' + $q + 'b'), ('x' + $q + '] | //package[@name=' + $q + 'My.Pkg'), ('x' + $q + ' or ' + $q + $q + '=' + $q), ('x' + $q + ' or 1=1 or ' + $q), ('x' + $q + ')'), ('x' + $q + '[1]'), ('x' + $q + ' or @name=' + $q + 'My.Pkg'), ('a' + $q + 'b' + $q + 'c'), ('x' + $q + ' or true() or @name=' + $q), ('x' + $q + ' or contains(@name,' + $q + 'My' + $q + ') or @name=' + $q))
foreach ($n in $names) {
  $m = New-Object Aras.Tools.SolutionUpgrade.ManifestFile
  [void]$m.AddPackage('My.Pkg'); [void]$m.AddPackage('Other')
  try { $el = $m.AddPackage($n); Say ("AddPackage " + (Esc $n)) (Esc $el.OuterXml) } catch { Say ("AddPackage " + (Esc $n)) (Ex $_.Exception) }
}
Write-Output '## 11 GetSolutionPath'
$m = Mf '<imports><package name="My.Pkg" path="Pkg\Import"/><package name="com.aras.innovator.core" path=".\"/><package name="NoPath"/><package name="Blank" path="  "/></imports>'
foreach ($n in 'My.Pkg', 'com.aras.innovator.core', 'NoPath', 'Blank', 'Missing', '', $NS, "x'y") {
  try { Say ("GetSolutionPath " + (Esc $n)) (Esc ([Aras.Tools.SolutionUpgrade.ImportExportManager]::GetSolutionPath($n, 'C:\m', $m))) } catch { Say ("GetSolutionPath " + (Esc $n)) (Ex $_.Exception) }
}
try { [void][Aras.Tools.SolutionUpgrade.ImportExportManager]::GetSolutionPath('x', 'C:\m', $null) } catch { Say 'GetSolutionPath manifest=null' (Ex $_.Exception) }
$m2 = Mf '<imports><package name="Bad" path="a|b"/></imports>'
try { [void][Aras.Tools.SolutionUpgrade.ImportExportManager]::GetSolutionPath('Bad', 'C:\m', $m2) } catch { Say 'GetSolutionPath illegal path' (Ex $_.Exception) }
try { [void][Aras.Tools.SolutionUpgrade.ImportExportManager]::GetSolutionPath('Bad', $NS, $m) } catch { Say 'GetSolutionPath folder=null' (Ex $_.Exception) }
try { Say 'GetSolutionPath folder=null,abs' ([Aras.Tools.SolutionUpgrade.ImportExportManager]::GetSolutionPath('com.aras.innovator.core', $NS, $m)) } catch { Say 'GetSolutionPath folder=null' (Ex $_.Exception) }
try { Say 'GetSolutionPath My.Pkg folder=null' ([Aras.Tools.SolutionUpgrade.ImportExportManager]::GetSolutionPath('My.Pkg', $NS, $m)) } catch { Say 'GetSolutionPath My.Pkg folder=null' (Ex $_.Exception) }
Say 'GetPackagePath path attr missing (NoPath)' (Esc ([Aras.Tools.SolutionUpgrade.ExportImportBase]::GetPackagePath($m.GetPackageNode('NoPath'), 'C:\m')))
