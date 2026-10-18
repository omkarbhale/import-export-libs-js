# Failures, the temp package layout, package names, debug retention and the empty-path constructor.
# Covers LP-050 to LP-072.
. (Join-Path $env:LOCALAPPDATA 'libsjs23-probe\lp-common.ps1')
function Exp([string]$items) { '<export>' + $items + '</export>' }
$one = Exp '<Item type="Foo" id="A1"><property __name="name" de="Hallo"/></Item>'
$cfgFoo = Cfg 'de' @('<itemtype name="Foo"/>')
function Std([string]$name) { WriteCase $name @{ 'ImportConfig.xml' = $cfgFoo; 'xml\Foo.xml' = $one } }

Write-Output '#### config file and xml folder'
RunLP 'config-missing' (Join-Path $caseRoot 'no-such\ImportConfig.xml') 'PKG' $false $DefaultLangs
$d = WriteCase 'config-is-directory' @{ 'ImportConfig.xml\x.txt' = 'x' }
RunLP 'config-is-directory' (Join-Path $d 'ImportConfig.xml') 'PKG' $false $DefaultLangs
$d = WriteCase 'config-malformed' @{ 'ImportConfig.xml' = '<ImportConfig><languages'; 'xml\Foo.xml' = $one }
RunLP 'config-malformed' (Join-Path $d 'ImportConfig.xml') 'PKG' $false $DefaultLangs
$d = WriteCase 'config-empty' @{ 'ImportConfig.xml' = ''; 'xml\Foo.xml' = $one }
RunLP 'config-empty' (Join-Path $d 'ImportConfig.xml') 'PKG' $false $DefaultLangs
$d = WriteCase 'config-only-no-xml-folder' @{ 'ImportConfig.xml' = $cfgFoo }
RunLP 'config-only-no-xml-folder' (Join-Path $d 'ImportConfig.xml') 'PKG' $false $DefaultLangs
$d = WriteCase 'config-other-file-name' @{ 'MyPack.cfg' = $cfgFoo; 'xml\Foo.xml' = $one }
RunLP 'config-other-file-name' (Join-Path $d 'MyPack.cfg') 'PKG' $false $DefaultLangs
$d = WriteCase 'config-xml-sibling-is-file' @{ 'ImportConfig.xml' = $cfgFoo; 'xml' = 'a file' }
RunLP 'config-xml-sibling-is-file' (Join-Path $d 'ImportConfig.xml') 'PKG' $false $DefaultLangs

Write-Output '#### config path spellings'
$d = Std 'path-relative'
$old = [Environment]::CurrentDirectory
[Environment]::CurrentDirectory = $d
RunLP 'path-bare-file-name' 'ImportConfig.xml' 'PKG' $false $DefaultLangs
[Environment]::CurrentDirectory = $old
$d = Std 'path-forward-slashes'
RunLP 'path-forward-slashes' ((Join-Path $d 'ImportConfig.xml').Replace('\', '/')) 'PKG' $false $DefaultLangs
$d = Std 'path-dotdot'
RunLP 'path-with-dotdot' (Join-Path $d 'x\..\ImportConfig.xml') 'PKG' $false $DefaultLangs
RunLP 'path-empty-string' '' 'PKG' $false $DefaultLangs
RunLP 'path-null' $NS 'PKG' $false $DefaultLangs

Write-Output '#### package names and the temp layout'
$d = Std 'pkg'
$c = Join-Path $d 'ImportConfig.xml'
RunLP 'pkg-plain' $c 'LIBSJS-SCRATCH-LP' $true $DefaultLangs -Full
RunLP 'pkg-with-dots' $c 'My.Pkg' $true $DefaultLangs -Full
RunLP 'pkg-standard-core' $c 'com.aras.innovator.core' $true $DefaultLangs -Full
RunLP 'pkg-standard-default' $c 'com.aras.defaults.Lang' $true $DefaultLangs -Full
RunLP 'pkg-trailing-dot' $c 'a.b.' $true $DefaultLangs -Full
RunLP 'pkg-with-space' $c 'a b' $true $DefaultLangs -Full
RunLP 'pkg-empty' $c '' $true $DefaultLangs -Full
RunLP 'pkg-slash' $c 'a/b' $true $DefaultLangs -Full
RunLP 'pkg-backslash' $c 'a\b' $true $DefaultLangs -Full
RunLP 'pkg-dotdot' $c '..' $true $DefaultLangs -Full
# '..' makes Path.Combine leave the temp folder: the Fixes folder is <temp>\Import\Fixes, outside it.
Write-Output "dotdot Fixes folder outside the LanguagePack folder => $(Test-Path (Join-Path $tmpRoot 'Import\Fixes\Foo.xml'))"
if (Test-Path (Join-Path $tmpRoot 'Import\Fixes\Foo.xml')) { Remove-Item -Recurse -Force (Join-Path $tmpRoot 'Import') }
RunLP 'pkg-illegal-char-pipe' $c 'a|b' $true $DefaultLangs -Full
RunLP 'pkg-colon' $c 'a:b' $true $DefaultLangs -Full
RunLP 'pkg-quote' $c "a'b" $true $DefaultLangs -Full
RunLP 'pkg-unicode' $c "P$([char]0xFC)ck" $true $DefaultLangs -Full
$rooted = Join-Path $caseRoot 'rooted-out\Lp'
if (Test-Path (Join-Path $caseRoot 'rooted-out')) { Remove-Item -Recurse -Force (Join-Path $caseRoot 'rooted-out') }
RunLP 'pkg-rooted-path' $c $rooted $true $DefaultLangs -Full
Write-Output "rooted package folder exists outside the temp folder => $(Test-Path (Join-Path $rooted 'Import\Fixes\Foo.xml'))"
if (Test-Path (Join-Path $caseRoot 'rooted-out')) { Remove-Item -Recurse -Force (Join-Path $caseRoot 'rooted-out') }

Write-Output '#### debug retention and Dispose'
RunLP 'debug-false' $c 'PKG' $false $DefaultLangs
RunLP 'debug-true' $c 'PKG' $true $DefaultLangs
Write-Output '## dispose-twice-and-after-external-delete'
$before = LPDirs
$helper = New-Object FakeHelper
[FakeConn]::Response = $DefaultLangs
$helper.InnValue = [Aras.IOM.IomFactory]::CreateInnovator((New-Object FakeConn))
$pp = New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $helper, (New-Object Aras.Tools.SolutionUpgrade.ManifestFile), $c, 'PKG', $false)
$pp.Dispose(); Say 'Dispose 1' 'ok'
try { $pp.Dispose(); Say 'Dispose 2' 'ok' } catch { Say 'Dispose 2' (Ex $_.Exception) }
Say 'temp dirs left' (@(LPDirs | Where-Object { $before -notcontains $_ }).Count)
$pp = New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $helper, (New-Object Aras.Tools.SolutionUpgrade.ManifestFile), $c, 'PKG', $false)
foreach ($n in @(LPDirs | Where-Object { $before -notcontains $_ })) { Remove-Item -Recurse -Force $n }
try { $pp.Dispose(); Say 'Dispose after external delete' 'ok' } catch { Say 'Dispose after external delete' (Ex $_.Exception) }
$pp = New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $helper, (New-Object Aras.Tools.SolutionUpgrade.ManifestFile), $c, 'PKG', $false)
$tmpDir = Split-Path $pp.TempManifestFilePath
[IO.File]::WriteAllText((Join-Path $tmpDir 'extra.txt'), 'x')
$fs = [IO.File]::Open((Join-Path $tmpDir 'extra.txt'), 'Open', 'Read', 'None')
try { $pp.Dispose(); Say 'Dispose with a locked file' 'ok' } catch { Say 'Dispose with a locked file' (Ex $_.Exception) }
$fs.Dispose()
Say 'temp dir still there' (Test-Path $tmpDir)
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue

Write-Output '#### the TempManifestFile object and the empty-path constructor'
$mf = New-Object Aras.Tools.SolutionUpgrade.ManifestFile
$pp = New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $helper, $mf, $c, 'PKG', $true)
Say 'TempManifestFile is the object passed in' ([object]::ReferenceEquals($pp.TempManifestFile, $mf))
Say 'manifest names' (($mf.GetAllPackageNames() | ForEach-Object { Esc $_ }) -join ', ')
foreach ($n in @(LPDirs | Where-Object { $before -notcontains $_ })) { Remove-Item -Recurse -Force $n }
foreach ($lp in '', $NS) {
  [FakeConn]::Requests.Clear()
  $pp = New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $helper, (New-Object Aras.Tools.SolutionUpgrade.ManifestFile), $lp, 'PKG', $true)
  Say ("empty LPPath " + (Esc $lp)) ("TempManifestFilePath=" + (Esc $pp.TempManifestFilePath) + " names=" + $pp.TempPackagesNames.Count + " requests=" + [FakeConn]::Requests.Count)
  $pp.Dispose()
}
Say 'new dirs after empty-path runs' (@(LPDirs | Where-Object { $before -notcontains $_ }).Count)
Write-Output '## null arguments'
try { [void](New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor($null, $helper, (New-Object Aras.Tools.SolutionUpgrade.ManifestFile), $c, 'PKG', $false)) } catch { Say 'null iOWrapper' (Ex $_.Exception) }
try { [void](New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $null, (New-Object Aras.Tools.SolutionUpgrade.ManifestFile), $c, 'PKG', $false)) } catch { Say 'null cItemHelper' (Ex $_.Exception) }
try { [void](New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $helper, $null, $c, 'PKG', $false)) } catch { Say 'null manifestFile' (Ex $_.Exception) }
Say 'new dirs after null runs' (@(LPDirs | Where-Object { $before -notcontains $_ }).Count)
