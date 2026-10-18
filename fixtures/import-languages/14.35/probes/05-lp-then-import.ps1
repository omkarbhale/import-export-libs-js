# lpimport end to end (14.35): the preprocessor's temporary package, then the manager built and run over its manifest,
# the way ConsoleUpgrade.exe does. Covers the [14.35] variant of LP-033 and IMP-640.
. (Join-Path $PSScriptRoot 'lp-common.ps1')
. (Join-Path $PSScriptRoot 'model.ps1')
$row = '<export><Item type="Foo" id="A1"><property __name="name" de="Hallo" fr="Salut" en="Hello"/></Item></export>'
$langsAnswer = { param($r) if ($r -like '*type="Language"*') { return (LangResponse @(@('en', 'English', ''), @('de', 'German', '_de'), @('fr', 'French', '_fr'))) }; return $null }

# builds the pack, runs the preprocessor, then the manager over TempManifestFilePath
function Flow([string]$label, [string]$pkg, $langs, [switch]$import) {
  $d = WriteCase $label @{ 'ImportConfig.xml' = (Cfg '' @('<itemtype name="Foo"/>')); 'xml\Foo.xml' = $row }
  $conn = New-Object StubConn; $conn.Respond = [Func[string,string]]$langsAnswer
  $fh = New-Object FakeHelper
  $fh.InnValue = [Aras.IOM.IomFactory]::CreateInnovator($conn)
  $fh.VersionValue = New-Object Aras.Tools.SolutionUpgrade.ArasVersion(12, 0, 9, 24090, 0)
  Write-Output "## $label"
  $pp = New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $fh, (New-Object Aras.Tools.SolutionUpgrade.ManifestFile), (Join-Path $d 'ImportConfig.xml'), $pkg, $false)
  Say 'preprocessor' 'ok'
  Say 'manifest' (Scrub (Esc ([IO.File]::ReadAllText($pp.TempManifestFilePath))))
  $w = New-World; $w.packages = @(@{ name = $pkg })
  $script:w = $w
  $h = NewHelper ([scriptblock]::Create('param($r) if ($r -like ''*type="Language"*'') { return (LangResponse @(@(''en'', ''English'', ''''), @(''de'', ''German'', ''_de''), @(''fr'', ''French'', ''_fr''))) }; return (Model-Respond $script:w $r)'))
  $ctx = New-Object Aras.Tools.SolutionUpgrade.SolutionUpgradeContext
  $ctx.Action = [Aras.Tools.SolutionUpgrade.ImportExport]::Import
  $ctx.ManifestFile = $pp.TempManifestFilePath; $ctx.WorkingDirectory = $d; $ctx.LogFilePath = (Join-Path $d 'engine.log')
  $ctx.Url = 'http://stub/'; $ctx.DataBase = 'db'; $ctx.UserName = 'admin'
  if ($null -ne $langs) { $ctx.Languages = [string[]]$langs }
  $fac = New-Object RecFactory
  $mgr = $null
  try { $mgr = New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($ctx, $fac, $h.helper); Say 'manager ctor' 'ok' } catch { Say 'manager ctor' (Ex $_.Exception) }
  Say 'Languages after' $(if ($null -eq $ctx.Languages) { 'null' } else { '[' + ((@($ctx.Languages) | ForEach-Object { Esc $_ }) -join ', ') + ']' })
  if ($mgr -and $import) {
    $imp = New-Object Aras.Tools.SolutionUpgrade.SUImportContext; $imp.Release = 'R1'; $imp.Description = 'D1'
    $oldOut = [Console]::Out; [Console]::SetOut((New-Object IO.StringWriter))
    try { $names = $mgr.ManifestFile.GetAllPackageNames(); $rc = $mgr.ImportSolutions($names, $imp); Say 'ImportSolutions' $rc } catch { Say 'ImportSolutions' (Ex $_.Exception) } finally { [Console]::SetOut($oldOut) }
    foreach ($r in $h.conn.Requests) { if ($r -like '*type="Foo"*action="edit"*') { Say 'sent' (Scrub (Esc $r)) } }
    foreach ($m in $fac.Sink) { if ($m -like 'error*') { Say 'message' (Scrub (Esc $m)) } }
  }
  $pp.Dispose()
}
Flow 'plain-package-no-languages' 'LIBSJS-SCRATCH-LP' $null -import
Flow 'plain-package-languages-de' 'LIBSJS-SCRATCH-LP' @('de') -import
Flow 'plain-package-languages-de-en' 'LIBSJS-SCRATCH-LP' @('de', 'en') -import
Flow 'plain-package-languages-en-only' 'LIBSJS-SCRATCH-LP' @('en') -import
Flow 'plain-package-languages-star' 'LIBSJS-SCRATCH-LP' @('*')
Flow 'dotted-package-name' 'My.Pkg' $null
Flow 'dotted-package-name-languages-star' 'My.Pkg' @('*')
Flow 'dotted-package-name-dot-at-end' 'a.b.' $null
Remove-Item -Recurse -Force $caseRoot -ErrorAction SilentlyContinue
