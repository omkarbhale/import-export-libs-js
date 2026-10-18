# Does the import find what the preprocessor wrote? After the preprocessor ran, resolve the package the way
# the import does (read the saved manifest, ImportExportManager.GetSolutionPath, then look for the folder).
# Also IOM's getItemCount on the Language response shapes. Covers LP-013 and LP-032 to LP-034.
. (Join-Path $env:LOCALAPPDATA 'libsjs23-probe\lp-common.ps1')
$one = '<export><Item type="Foo" id="A1"><property __name="name" de="Hallo"/></Item></export>'
$d = WriteCase 'resolve' @{ 'ImportConfig.xml' = (Cfg 'de' @('<itemtype name="Foo"/>')); 'xml\Foo.xml' = $one }
$c = Join-Path $d 'ImportConfig.xml'
$rootedBase = Join-Path $caseRoot 'rooted-resolve'

function Resolve([string]$label, [string]$pkg) {
  $before = LPDirs
  [FakeConn]::Response = $DefaultLangs
  $helper = New-Object FakeHelper
  $helper.InnValue = [Aras.IOM.IomFactory]::CreateInnovator((New-Object FakeConn))
  Write-Output "## $label"
  try {
    $pp = New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $helper, (New-Object Aras.Tools.SolutionUpgrade.ManifestFile), $c, $pkg, $true)
  } catch { Say 'ctor' (Scrub (Ex $_.Exception)); foreach ($n in @(LPDirs | Where-Object { $before -notcontains $_ })) { Remove-Item -Recurse -Force $n }; return }
  $mfPath = $pp.TempManifestFilePath
  $mfDir = Split-Path $mfPath
  # what the host does next: the manager reads the saved manifest, the import resolves each package name in it
  $mf = New-Object Aras.Tools.SolutionUpgrade.ManifestFile($mfPath)
  Say 'names in the saved manifest' (Scrub (($mf.GetAllPackageNames() | ForEach-Object { Esc $_ }) -join ', '))
  try {
    $p = [Aras.Tools.SolutionUpgrade.ImportExportManager]::GetSolutionPath($pkg, $mfDir, $mf)
    Say 'GetSolutionPath' (Scrub (Esc $p))
    Say 'package folder exists' (Test-Path -LiteralPath $p)
    $subs = @(); if (Test-Path -LiteralPath $p) { $subs = @(Get-ChildItem -LiteralPath $p -Directory | ForEach-Object { $_.Name }) }
    Say 'subfolders the import would read' (($subs | ForEach-Object { Esc $_ }) -join ', ')
    $fx = Join-Path $p 'Fixes\Foo.xml'
    Say 'Fixes\Foo.xml found by the import' (Test-Path -LiteralPath $fx)
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

Write-Output '#### IOM item counts for the Language responses'
function Count([string]$label, [string]$resp) {
  [FakeConn]::Response = $resp
  $inn = [Aras.IOM.IomFactory]::CreateInnovator((New-Object FakeConn))
  $it = $inn.newItem('Language', 'get')
  $it.setAttribute('select', 'code,suffix')
  $r = $it.apply()
  Say $label ("isError=" + $r.isError() + " getItemCount=" + $r.getItemCount())
}
Count 'two items' $DefaultLangs
Count 'no items fault 0' (FaultResponse '0' 'No items of type Language found.')
Count 'other fault' (FaultResponse '1' 'Access denied')
Count 'empty Result' (Envelope '<Result></Result>')
Count 'not a SOAP envelope' '<html/>'
Count 'Result holding an Item without children' (Envelope '<Result><Item type="Language"/></Result>')
