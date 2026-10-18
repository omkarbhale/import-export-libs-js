# CImportItems.Import for a language-pack Property item (14.35): the lpimport branch, the ApplySQL update, and what the
# version decides. Covers LP-040 to LP-044. CItemHelper.doImport is called directly over the model server.
. (Join-Path $PSScriptRoot 'model.ps1')
$i18n = 'xmlns:i18n="http://www.aras.com/I18N"'
function Lbl([string]$lang, [string]$text) { "<i18n:label $i18n xml:lang=""$lang"">$text</i18n:label>" }
$script:propAnswer = $null; $script:langAnswer = $null
function Run([string]$label, [string]$xml, [string]$propAnswer, [string]$langAnswer = $DefaultLangsSfx, [int[]]$ver = @(12, 0, 9, 24090, 0), [switch]$batch, [bool]$merge = $false) {
  $script:propAnswer = $propAnswer; $script:langAnswer = $langAnswer
  $w = New-World; $script:w = $w
  $respond = {
    param($r)
    if ($r -like '*type="Language"*action="get"*') { return $script:langAnswer }
    if ($r -like '*type="Property"*action="get"*select="id[[]is_not_null()[]]*') { return $script:propAnswer }
    return (Model-Respond $script:w $r)
  }
  $h = NewHelper $respond $ver
  $doc = New-Object Xml.XmlDocument
  $doc.LoadXml($xml)
  Write-Output "## $label"
  try {
    if ($batch) {
      $ic = New-Object Aras.Tools.SolutionUpgrade.SUImportContext; $ic.AmlBatchMode = $true; $ic.bMerge = $merge
      $h.helper.doImport($doc, $ic)
    } else { $h.helper.doImport($doc, $merge) }
    Say 'doImport' 'ok'
  } catch { Say 'doImport' (Ex $_.Exception) }
  for ($i = 0; $i -lt $h.conn.Requests.Count; $i++) { Say "request $($i + 1) [$($h.conn.Actions[$i])]" (Scrub (Esc $h.conn.Requests[$i])) }
  Say 'document after' (Esc $doc.OuterXml)
}
$DefaultLangsSfx = LangResponse @(@('en', 'English', ''), @('de', 'German', '_de'), @('fr', 'French', '_fr'))
function PropItem([string]$children, [string]$attrs = ' context_action="lpimport"', [string]$type = 'Property') {
  '<Item isNew="1" isTemp="1" type="' + $type + '" action="edit" doGetItem="0"' + $attrs + ' where="[' + $type + '].id=''P1''">' + $children + '</Item>'
}
function PropGet([string]$keyed) { Result ('<Item type="Property" id="PROP1"><id>PROP1</id><keyed_name>' + $keyed + '</keyed_name></Item>') }
$lbl2 = (Lbl 'de' 'Etikett') + (Lbl 'fr' 'Libelle')
$std = PropItem ('<default_value>dv</default_value>' + $lbl2)

Run 'source-id-goes-by-sql' $std (PropGet 'source_id')
Run 'related-id-goes-by-sql' $std (PropGet 'related_id')
Run 'other-property-goes-by-aml' $std (PropGet 'label')
Run 'keyed-name-compared-ordinal' $std (PropGet 'Source_Id')
Run 'property-get-no-items' $std (Fault '0' 'No items of type Property found.')
Run 'property-get-other-fault' $std (Fault '5' 'boom')
Run 'property-get-two-items' $std (Result '<Item type="Property" id="A"><keyed_name>source_id</keyed_name></Item><Item type="Property" id="B"><keyed_name>source_id</keyed_name></Item>')
Run 'property-get-no-keyed-name' $std (Result '<Item type="Property" id="PROP1"><id>PROP1</id></Item>')
Run 'language-not-in-the-answer' (PropItem ((Lbl 'es' 'Etiqueta'))) (PropGet 'source_id')
Run 'language-get-no-items' $std (PropGet 'source_id') (Fault '0' 'No items of type Language found.')
Run 'language-get-other-fault' $std (PropGet 'source_id') (Fault '5' 'boom')
Run 'language-get-duplicate-code' $std (PropGet 'source_id') (LangResponse @(@('de', '', '_de'), @('de', '', '_x'), @('fr', '', '_fr')))
Run 'language-get-item-without-code' $std (PropGet 'source_id') (LangResponse @(@($null, '', '_x'), @('de', '', '_de'), @('fr', '', '_fr')))
Run 'language-get-item-without-suffix' $std (PropGet 'source_id') (LangResponse @(@('de', '', $null), @('fr', '', '_fr')))
Run 'language-get-uppercase-code' (PropItem ((Lbl 'de' 'x'))) (PropGet 'source_id') (LangResponse @(,@('DE', '', '_de')))
Run 'value-with-quote-amp-lt' (PropItem ((Lbl 'de' "O'Brien &amp; &lt;b&gt; N'x"))) (PropGet 'source_id')
$ea = [string][char]0xE9
Run 'value-non-ascii' (PropItem ((Lbl 'de' ($ea + 'tiquette')))) (PropGet 'source_id')
Run 'value-empty' (PropItem ((Lbl 'de' '') + (Lbl 'fr' 'x'))) (PropGet 'source_id')
Run 'child-without-prefix' (PropItem '<label xml:lang="de">plain</label>') (PropGet 'source_id')
Run 'child-with-other-prefix' (PropItem '<x:label xmlns:x="urn:x" xml:lang="de">other</x:label>') (PropGet 'source_id')
Run 'only-plain-children-nothing-is-sent' (PropItem '<default_value>dv</default_value><data_type>string</data_type>') (PropGet 'source_id')
Run 'empty-lang-attribute-skipped' (PropItem ('<label xml:lang="">x</label>' + (Lbl 'de' 'y'))) (PropGet 'source_id')
Run 'element-with-nested-markup' (PropItem ('<i18n:label ' + $i18n + ' xml:lang="de">a<b>b</b>c</i18n:label>')) (PropGet 'source_id')
Run 'batch-mode-sql-still-sent' $std (PropGet 'source_id') $DefaultLangsSfx @(12, 0, 9, 24090, 0) -batch
Run 'batch-mode-other-property-not-sent' $std (PropGet 'label') $DefaultLangsSfx @(12, 0, 9, 24090, 0) -batch
Run 'merge-mode-edit-item' $std (PropGet 'source_id') $DefaultLangsSfx @(12, 0, 9, 24090, 0) -merge $true

Write-Output '#### what the version and the item type decide'
Run 'version-14-35-keeps-context-action' $std (PropGet 'source_id') $DefaultLangsSfx @(14, 35, 0, 0, 0)
Run 'version-14-0-sp22-keeps-context-action' $std (PropGet 'source_id') $DefaultLangsSfx @(14, 0, 22, 0, 0)
Run 'version-14-0-sp21-handles' $std (PropGet 'source_id') $DefaultLangsSfx @(14, 0, 21, 0, 0)
Run 'version-14-0-service-update-22-handles' $std (PropGet 'source_id') $DefaultLangsSfx @(14, 0, 0, 0, 22)
Run 'other-type-keeps-context-action' (PropItem $lbl2 ' context_action="lpimport"' 'Foo') (PropGet 'source_id')
Run 'property-without-context-action' (PropItem $lbl2 '') (PropGet 'source_id')
Run 'context-action-other-value' (PropItem $lbl2 ' context_action="x"') (PropGet 'source_id')
Run 'context-action-case' (PropItem $lbl2 ' context_action="LPIMPORT"') (PropGet 'source_id')
Run 'lowercase-type-property' (PropItem $lbl2 ' context_action="lpimport"' 'property') (PropGet 'source_id')

Write-Output '#### the version predicate itself'
$t = $libs.GetType('Aras.Tools.SolutionUpgrade.Extensions.ArasVersionExtensions')
$m = $t.GetMethod('NeedToHandleNullPropertyValues')
foreach ($v in @(@(9, 4, 0, 0, 0), @(11, 0, 0, 0, 0), @(12, 0, 0, 0, 0), @(12, 0, 9, 0, 0), @(12, 5, 99, 0, 0), @(13, 0, 0, 0, 0), @(13, 9, 30, 0, 0), @(14, 0, 0, 0, 0), @(14, 0, 7, 0, 7), @(14, 0, 21, 0, 0), @(14, 0, 22, 0, 0), @(14, 0, 22, 39629, 0), @(14, 0, 30, 0, 0), @(14, 0, 0, 0, 22), @(14, 0, 0, 0, 35), @(14, 1, 0, 0, 0), @(14, 35, 0, 0, 0), @(15, 0, 0, 0, 0), @(35, 0, 0, 0, 0))) {
  $av = New-Object Aras.Tools.SolutionUpgrade.ArasVersion($v[0], $v[1], $v[2], $v[3], $v[4])
  Say ("major=$($v[0]) minor=$($v[1]) servicePack=$($v[2]) build=$($v[3]) serviceUpdate=$($v[4])") $m.Invoke($null, [object[]]@($av.psobject.BaseObject))
}
Remove-Item -Recurse -Force $caseRoot -ErrorAction SilentlyContinue
