# ImportExportManager constructor (14.35): the package scan, the "*" expansion and the installed-language check.
# Covers IMP-610, IMP-612, IMP-613 and IMP-620 to IMP-623. A real CItemHelper over a stub connection answers the Language get from a script.
. (Join-Path $PSScriptRoot 'stub.ps1')
$i18n = 'xmlns:i18n="http://www.aras.com/I18N"'
function It([string]$langs) {
  $s = '<Item type="Foo" id="A1" action="add">'
  foreach ($l in ($langs -split ',')) { if ($l -ne '') { $s += "<i18n:label $i18n xml:lang=""$l"">v</i18n:label>" } }
  $s + '</Item>'
}
function Aml([string]$items) { '<AML>' + $items + '</AML>' }
function Mf($pkgs) { $m = '<imports>'; foreach ($p in $pkgs) { $m += '<package name="' + $p + '" path="' + $p + '\Import" />' }; $m + '</imports>' }

# $pkgUse: ordered name -> languages the package uses; $langs: the Languages array (or $null); $resp: the Language answer
function Ctor([string]$label, $pkgUse, $langs, [string]$resp = $DefaultLangs, [string]$action = 'Import', $extraFiles = @{}) {
  $files = @{}
  foreach ($k in $pkgUse.Keys) { $files["$k\Import\Foo\a.xml"] = (Aml (It $pkgUse[$k])) }
  foreach ($k in $extraFiles.Keys) { $files[$k] = $extraFiles[$k] }
  $files['imports.mf'] = (Mf $pkgUse.Keys)
  $d = WriteCase $label $files
  $h = NewHelper ([scriptblock]::Create('param($r) if ($r -like ''*type="Language"*'') { return $script:resp }; return $null'))
  $script:resp = $resp
  $ctx = New-Object Aras.Tools.SolutionUpgrade.SolutionUpgradeContext
  $ctx.Action = [Aras.Tools.SolutionUpgrade.ImportExport]::$action
  $ctx.ManifestFile = "$d\imports.mf"; $ctx.WorkingDirectory = $d
  if ($null -ne $langs) { $ctx.Languages = [string[]]$langs }
  Write-Output "## $label"
  $mgr = $null
  try { $mgr = New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($ctx, (New-Object RecFactory), $h.helper); Say 'ctor' 'ok' } catch { Say 'ctor' (Ex $_.Exception) }
  $l = $ctx.Languages
  Say 'context.Languages after' $(if ($null -eq $l) { 'null' } else { '[' + ((@($l) | ForEach-Object { Esc $_ }) -join ', ') + ']' })
  foreach ($r in $h.conn.Requests) { Say 'request' (Scrub (Esc $r)) }
  Say 'requests' $h.conn.Requests.Count
  foreach ($n in $pkgUse.Keys) { Say "static cache $(Esc $n)" ((@([Aras.Tools.SolutionUpgrade.ImportExportManager]::LanguageCodesExtractor.GetUsedLanguagesByPackage($n)) | Sort-Object -CaseSensitive | ForEach-Object { Esc $_ }) -join ', ') }
}
$P1 = [ordered]@{ 'P1' = 'de,fr' }
Ctor 'languages-null' $P1 $null
Ctor 'languages-empty-array' $P1 @()
Ctor 'languages-de-en' $P1 @('de', 'en')
Ctor 'languages-de-only' $P1 @('de')
Ctor 'languages-en-only' $P1 @('en')
Ctor 'languages-star' ([ordered]@{ 'P1' = 'de,fr,en' }) @('*')
Ctor 'languages-star-package-without-languages' ([ordered]@{ 'P1' = '' }) @('*')
Ctor 'languages-star-two-packages' ([ordered]@{ 'P1' = 'fr,de'; 'P2' = 'de,en' }) @('*')
Ctor 'languages-star-uppercase-in-files' ([ordered]@{ 'P1' = 'DE,Fr' }) @('*')
Ctor 'languages-star-and-more' $P1 @('*', 'de')
Ctor 'languages-de-and-star' $P1 @('de', '*')
Ctor 'languages-star-twice' $P1 @('*', '*')
Ctor 'languages-star-not-installed' ([ordered]@{ 'P1' = 'de,es' }) @('*')
Ctor 'languages-star-two-not-installed' ([ordered]@{ 'P1' = 'pt-br,es,it,de' }) @('*')
Ctor 'languages-not-installed-duplicates' $P1 @('xx', 'yy', 'xx', 'de', 'yy')
Ctor 'languages-uppercase-selected' $P1 @('DE', 'en')
Ctor 'languages-uppercase-installed' $P1 @('de') (LangResponse @(@('EN', 'English', ''), @('DE', 'German', '_de')))
Ctor 'languages-with-spaces' $P1 @(' de', 'fr ')
Ctor 'languages-empty-string' $P1 @('')
Ctor 'language-get-fault0' $P1 @('de') (Fault '0' 'No items of type Language found.')
Ctor 'language-get-other-fault' $P1 @('de') (Fault '1' 'Access denied')
Ctor 'language-get-empty-result' $P1 @('de') (Envelope '<Result></Result>')
Ctor 'language-get-garbage' $P1 @('de') '<html/>'
Ctor 'language-get-item-without-code' $P1 @('de') (LangResponse @(@('en', 'English', ''), @($null, 'x', ''), @('de', 'German', '')))
Ctor 'language-get-item-without-code-after-all-found' $P1 @('en') (LangResponse @(@('en', 'English', ''), @($null, 'x', '')))
Ctor 'language-get-duplicate-code' $P1 @('de') (LangResponse @(@('de', 'German', ''), @('de', 'Deutsch', '')))
Ctor 'language-get-item-without-name' $P1 @('de') (LangResponse @(,@('de', $null, '')))
Ctor 'export-action-checks-languages' $P1 @('xx') $DefaultLangs 'Export'
Ctor 'export-action-star-not-expanded' $P1 @('*') $DefaultLangs 'Export'

Write-Output '## scan failures'
Ctor 'bad-file-in-unrelated-package' ([ordered]@{ 'P1' = 'de'; 'P2' = 'fr' }) @('de') $DefaultLangs 'Import' @{ 'P2\Import\notes\bad.xml' = '<AML><Item>' }
Ctor 'bad-file-no-languages-option' ([ordered]@{ 'P1' = 'de' }) $null $DefaultLangs 'Import' @{ 'P1\Import\readme.xml' = 'not xml' }
Ctor 'non-item-xml-files-are-fine' ([ordered]@{ 'P1' = 'de' }) $null $DefaultLangs 'Import' @{ 'P1\Import\config.xml' = '<settings/>' }
$d = WriteCase 'missing-package-folder' @{ 'imports.mf' = '<imports><package name="P1" path="P1\Import" /></imports>' }
$h = NewHelper ([scriptblock]::Create('param($r) return $null'))
$ctx = New-Object Aras.Tools.SolutionUpgrade.SolutionUpgradeContext
$ctx.Action = [Aras.Tools.SolutionUpgrade.ImportExport]::Import; $ctx.ManifestFile = "$d\imports.mf"; $ctx.WorkingDirectory = $d
Write-Output '## missing-package-folder'
try { [void](New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($ctx, (New-Object RecFactory), $h.helper)); Say 'ctor' 'ok' } catch { Say 'ctor' (Ex $_.Exception) }
Say 'requests' $h.conn.Requests.Count

Write-Output '## static cache survives a later export manager'
$d = WriteCase 'static-cache' @{ 'imports.mf' = (Mf @('P1')); 'P1\Import\a.xml' = (Aml (It 'de')) }
$h = NewHelper ([scriptblock]::Create('param($r) return $null'))
$ctx = New-Object Aras.Tools.SolutionUpgrade.SolutionUpgradeContext
$ctx.Action = [Aras.Tools.SolutionUpgrade.ImportExport]::Import; $ctx.ManifestFile = "$d\imports.mf"; $ctx.WorkingDirectory = $d
[void](New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($ctx, (New-Object RecFactory), $h.helper))
$ctx2 = New-Object Aras.Tools.SolutionUpgrade.SolutionUpgradeContext
$ctx2.Action = [Aras.Tools.SolutionUpgrade.ImportExport]::Export; $ctx2.WorkingDirectory = $d
[void](New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($ctx2, (New-Object RecFactory), $h.helper))
Say 'cache after the export manager, P1' ((@([Aras.Tools.SolutionUpgrade.ImportExportManager]::LanguageCodesExtractor.GetUsedLanguagesByPackage('P1')) | ForEach-Object { Esc $_ }) -join ', ')

Write-Output '## relative manifest paths (the scan uses Path.GetDirectoryName of the path as given)'
$d = WriteCase 'relative-manifest' @{ 'sub\imports.mf' = (Mf @('P1')); 'sub\P1\Import\a.xml' = (Aml (It 'de')) }
foreach ($rel in @('sub\imports.mf', "$d\sub\imports.mf")) {
  [Environment]::CurrentDirectory = $d
  $h = NewHelper ([scriptblock]::Create('param($r) return $null'))
  $ctx = New-Object Aras.Tools.SolutionUpgrade.SolutionUpgradeContext
  $ctx.Action = [Aras.Tools.SolutionUpgrade.ImportExport]::Import; $ctx.ManifestFile = $rel; $ctx.WorkingDirectory = $d
  try { [void](New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($ctx, (New-Object RecFactory), $h.helper)); Say "ctor, manifest $(Scrub (Esc $rel))" 'ok' } catch { Say "ctor, manifest $(Scrub (Esc $rel))" (Ex $_.Exception) }
}
$d2 = WriteCase 'bare-manifest' @{ 'imports.mf' = (Mf @('P1')); 'P1\Import\a.xml' = (Aml (It 'de')) }
[Environment]::CurrentDirectory = $d2
$h = NewHelper ([scriptblock]::Create('param($r) return $null'))
$ctx = New-Object Aras.Tools.SolutionUpgrade.SolutionUpgradeContext
$ctx.Action = [Aras.Tools.SolutionUpgrade.ImportExport]::Import; $ctx.ManifestFile = 'imports.mf'; $ctx.WorkingDirectory = $d2
try { [void](New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($ctx, (New-Object RecFactory), $h.helper)); Say 'ctor, manifest "imports.mf" (bare file name)' 'ok' } catch { Say 'ctor, manifest "imports.mf" (bare file name)' (Ex $_.Exception) }
[Environment]::CurrentDirectory = $root
Remove-Item -Recurse -Force $caseRoot -ErrorAction SilentlyContinue
