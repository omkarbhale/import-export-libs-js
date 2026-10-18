# ImportSolutions with a language selection (14.35): which xml:lang nodes are removed before the item is sent.
# Covers IMP-630 to IMP-635. The engine's own ImportExportManager and CItemHelper run against the model server
# of model.ps1; the requests it sends are the evidence.
. (Join-Path $PSScriptRoot 'model.ps1')
$i18n = 'xmlns:i18n="http://www.aras.com/I18N"'
function L([string]$lang, [string]$text = 'v') { "<i18n:label $i18n xml:lang=""$lang"">$text</i18n:label>" }
function MethodItem([string]$id, [string]$children, [string]$attrs = '') { '<Item type="Method" id="' + $id + '" action="add"' + $attrs + '><name>M' + $id + '</name>' + $children + '</Item>' }
$M1 = 'M0000000000000000000000000000001'; $M2 = 'M0000000000000000000000000000002'

# $pkgs: ordered name -> list of file xml bodies (inside <AML>); $langs: Languages or $null; $opts: batch, merge
function Run([string]$label, $pkgs, $langs, $opts = @{}, [string]$langResp = $DefaultLangs, $respondExtra = $null) {
  $root = Join-Path $caseRoot $label
  if (Test-Path $root) { Remove-Item -Recurse -Force $root }
  New-Item -ItemType Directory -Path $root | Out-Null
  $mf = '<imports>'
  foreach ($pn in $pkgs.Keys) {
    $mf += '<package name="' + $pn + '" path="' + $pn + '\Import" />'
    $k = 0
    foreach ($xml in $pkgs[$pn]) {
      $k++
      $dir = Join-Path (Join-Path (Join-Path $root $pn) 'Import') 'Method'
      [void][IO.Directory]::CreateDirectory($dir)
      [IO.File]::WriteAllText((Join-Path $dir ("m$k.xml")), '<AML>' + $xml + '</AML>', $utf8)
    }
  }
  $mf += '</imports>'
  $mfPath = Join-Path $root 'imports.mf'
  [IO.File]::WriteAllText($mfPath, $mf, $utf8)
  $w = New-World
  $w.packages = @(); foreach ($pn in $pkgs.Keys) { $w.packages += @{ name = $pn } }
  $script:langResp = $langResp; $script:extra = $respondExtra; $script:w = $w
  $respond = {
    param($req)
    if ($req -like '*type="Language"*') { return $script:langResp }
    if ($script:extra) { $x = & $script:extra $req; if ($null -ne $x) { return $x } }
    return (Model-Respond $script:w $req)
  }
  $h = NewHelper $respond
  $ctx = New-Object Aras.Tools.SolutionUpgrade.SolutionUpgradeContext
  $ctx.Action = [Aras.Tools.SolutionUpgrade.ImportExport]::Import
  $ctx.ManifestFile = $mfPath; $ctx.WorkingDirectory = $root; $ctx.LogFilePath = (Join-Path $root 'engine.log')
  $ctx.Url = 'http://stub/'; $ctx.DataBase = 'db'; $ctx.UserName = 'admin'
  if ($null -ne $langs) { $ctx.Languages = [string[]]$langs }
  $imp = New-Object Aras.Tools.SolutionUpgrade.SUImportContext
  $imp.Release = 'R1'; $imp.Description = 'D1'
  if ($opts.batch) { $imp.AmlBatchMode = $true; $imp.AmlBatchMaxSize = [int]$opts.batchSize }
  $fac = New-Object RecFactory
  $oldOut = [Console]::Out; $con = New-Object IO.StringWriter; [Console]::SetOut($con)
  $res = $null; $thrown = $null; $ctor = $null; $mgr = $null
  try {
    try { $mgr = New-Object Aras.Tools.SolutionUpgrade.ImportExportManager($ctx, $fac, $h.helper) } catch { $ctor = Ex $_.Exception }
    if ($mgr) {
      $list = New-Object System.Collections.ArrayList
      foreach ($n in $pkgs.Keys) { [void]$list.Add($n) }
      try { $res = $mgr.ImportSolutions($list, $imp) } catch { $thrown = Ex $_.Exception }
    }
  } finally { [Console]::SetOut($oldOut) }
  Write-Output "## $label"
  Say 'Languages given' $(if ($null -eq $langs) { 'null' } else { '[' + ((@($langs) | ForEach-Object { Esc $_ }) -join ', ') + ']' })
  Say 'Languages after construction' $(if ($null -eq $ctx.Languages) { 'null' } else { '[' + ((@($ctx.Languages) | ForEach-Object { Esc $_ }) -join ', ') + ']' })
  if ($ctor) { Say 'ctor' $ctor } else { Say 'result' $res }
  if ($thrown) { Say 'exception' $thrown }
  foreach ($r in $h.conn.Requests) {
    if ($r -like '<Item type="Method"*' -and $r -like '*action="add"*' -or $r -like '<AML>*') { Say 'sent' (Scrub (Esc $r)) }
  }
  foreach ($m in $fac.Sink) { if ($m -like 'error*' -or $m -like 'warning*') { Say 'message' (Scrub (Esc $m)) } }
  $log = ''; $lp = Join-Path $root 'engine.log'; if (Test-Path $lp) { $log = [IO.File]::ReadAllText($lp, $utf8) }
  foreach ($line in ($log -split "`r?`n")) { if ($line -match 'Try to execute AMLs|AML successfully applied|Error of import in AML batch|faultstring') { Say 'log' (Scrub (Esc $line)) } }
}
$full = MethodItem $M1 ((L 'de' 'DE') + (L 'fr' 'FR') + (L 'en' 'EN'))
$pk = [ordered]@{ 'P1' = @($full) }
Run 'baseline-languages-null' $pk $null
Run 'languages-de-en-removes-fr' $pk @('de', 'en')
Run 'languages-en-removes-de-fr' $pk @('en')
Run 'languages-de-removes-en-and-fr' $pk @('de')
Run 'languages-star-removes-nothing' $pk @('*')
Run 'languages-empty-removes-nothing' $pk @()
Run 'languages-all-used-removes-nothing' $pk @('de', 'fr', 'en')

Write-Output '#### what the selector reaches'
$attrAndText = MethodItem $M1 ('<p xml:lang="fr"><q xml:lang="fr">deep</q></p><r xml:lang="de">keep</r><s>no lang</s>')
Run 'any-element-and-nested' ([ordered]@{ 'P1' = @($attrAndText) }) @('de', 'en')
$onItem = '<Item type="Method" id="' + $M1 + '" action="add" xml:lang="fr"><name>n</name>' + (L 'de') + '</Item>'
Run 'xml-lang-on-the-item-itself' ([ordered]@{ 'P1' = @($onItem) }) @('de', 'en')
$onItem2 = '<Item type="Method" id="' + $M1 + '" action="add" xml:lang="fr"><name>n</name>' + (L 'fr') + (L 'de') + '</Item>'
Run 'xml-lang-on-the-item-itself-and-used' ([ordered]@{ 'P1' = @($onItem2) }) @('de', 'en')
$upper = MethodItem $M1 ((L 'DE' 'upper') + (L 'fr' 'lower'))
Run 'uppercase-in-file-is-lowered-in-the-selector' ([ordered]@{ 'P1' = @($upper) }) @('en')
$quote = MethodItem $M1 ((L "d'e" 'quote') + (L 'de'))
Run 'apostrophe-in-a-used-code' ([ordered]@{ 'P1' = @($quote) }) @('de')
Run 'apostrophe-in-a-used-code-star' ([ordered]@{ 'P1' = @($quote) }) @('*') $DefaultLangs
$two = [ordered]@{ 'P1' = @((MethodItem $M1 ((L 'de') + (L 'fr')))); 'P2' = @((MethodItem $M2 ((L 'de') + (L 'es')))) }
Run 'per-package-skip-sets' $two @('de', 'en') @{} (LangResponse @(@('en', 'English', ''), @('de', 'German', ''), @('fr', 'French', ''), @('es', 'Spanish', '')))
Run 'item-with-empty-lang' ([ordered]@{ 'P1' = @((MethodItem $M1 ((L '' 'empty') + (L 'de')))) }) @('de')

Write-Output '#### batch mode'
$b1 = MethodItem $M1 ((L 'de') + (L 'fr')); $b2 = MethodItem $M2 ((L 'fr') + (L 'de'))
Run 'batch-success' ([ordered]@{ 'P1' = @($b1, $b2) }) @('de') @{ batch = $true; batchSize = 10 }
$failBatch = { param($req) if ($req -like '<AML>*') { return (Fault 5 'batch refused') }; return $null }
Run 'batch-falls-back-to-one-by-one' ([ordered]@{ 'P1' = @($b1, $b2) }) @('de') @{ batch = $true; batchSize = 10 } $DefaultLangs $failBatch
Remove-Item -Recurse -Force $caseRoot -ErrorAction SilentlyContinue
