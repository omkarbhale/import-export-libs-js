# Does the import find what the 14.35 preprocessor wrote? After the preprocessor ran, resolve the package the way the
# import does (read the saved manifest, ImportExportManager.GetSolutionPath, then look for the folder). The 14.0.7 twin is
# fixtures/language-pack/14.0.7/probes/04-resolve-and-iom.ps1. Covers the [14.35] variant of LP-033.
. (Join-Path $PSScriptRoot 'lp-common.ps1')
$one = '<export><Item type="Foo" id="A1"><property __name="name" de="Hallo"/></Item></export>'
$d = WriteCase 'resolve' @{ 'ImportConfig.xml' = (Cfg 'de' @('<itemtype name="Foo"/>')); 'xml\Foo.xml' = $one }
$c = Join-Path $d 'ImportConfig.xml'
$rootedBase = Join-Path $caseRoot 'rooted-resolve'
$langs = { param($r) if ($r -like '*type="Language"*') { return (LangResponse @(@('en', '', ''), @('de', '', '_de'), @('fr', '', '_fr'))) }; return $null }

function Resolve([string]$label, [string]$pkg) {
  $before = LPDirs
  $conn = New-Object StubConn; $conn.Respond = [Func[string,string]]$langs
  $helper = New-Object FakeHelper
  $helper.InnValue = [Aras.IOM.IomFactory]::CreateInnovator($conn)
  $helper.VersionValue = New-Object Aras.Tools.SolutionUpgrade.ArasVersion(12, 0, 9, 24090, 0)
  Write-Output "## $label"
  try {
    $pp = New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $helper, (New-Object Aras.Tools.SolutionUpgrade.ManifestFile), $c, $pkg, $true)
  } catch { Say 'ctor' (Scrub (Ex $_.Exception)); foreach ($n in @(LPDirs | Where-Object { $before -notcontains $_ })) { Remove-Item -Recurse -Force $n }; return }
  $mfPath = $pp.TempManifestFilePath
  $mfDir = Split-Path $mfPath
  $mf = New-Object Aras.Tools.SolutionUpgrade.ManifestFile($mfPath)
  Say 'names in the saved manifest' (Scrub (($mf.GetAllPackageNames() | ForEach-Object { Esc $_ }) -join ', '))
  try {
    $p = [Aras.Tools.SolutionUpgrade.ImportExportManager]::GetSolutionPath($pkg, $mfDir, $mf)
    Say 'GetSolutionPath' (Scrub (Esc $p))
    Say 'package folder exists' (Test-Path -LiteralPath $p)
    $subs = @(); if (Test-Path -LiteralPath $p) { $subs = @(Get-ChildItem -LiteralPath $p -Directory | ForEach-Object { $_.Name }) }
    Say 'subfolders the import would read' (($subs | ForEach-Object { Esc $_ }) -join ', ')
    Say 'Fixes\Foo.xml found by the import' (Test-Path -LiteralPath (Join-Path $p 'Fixes\Foo.xml'))
  } catch { Say 'GetSolutionPath' (Scrub (Ex $_.Exception)) }
  $pp.Dispose()
  foreach ($n in @(LPDirs | Where-Object { $before -notcontains $_ })) { Remove-Item -Recurse -Force $n }
}
Resolve 'plain name' 'LIBSJS-SCRATCH-LP'
Resolve 'name with a dot' 'My.Pkg'
Resolve 'name with two dots' 'com.example.lang'
Resolve 'core package name' 'com.aras.innovator.core'
Resolve 'default package name' 'com.aras.defaults.Lang'
Resolve 'solution package name' 'com.aras.innovator.solution.PLM'
Resolve 'trailing dot' 'a.b.'
Resolve 'name with a space' 'a b'
Resolve 'name with a slash' 'a/b'
if (Test-Path $rootedBase) { Remove-Item -Recurse -Force $rootedBase }
Resolve 'rooted name without dots' (Join-Path $rootedBase 'Lp')
if (Test-Path $rootedBase) { Remove-Item -Recurse -Force $rootedBase }
Remove-Item -Recurse -Force $caseRoot -ErrorAction SilentlyContinue
