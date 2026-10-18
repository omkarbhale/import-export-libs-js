# The xml/<ItemType>.xml rows and the edit AML built from them. Covers LP-020 to LP-044.
. (Join-Path $env:LOCALAPPDATA 'libsjs23-probe\lp-common.ps1')
function Exp([string]$items) { '<export>' + $items + '</export>' }
function Case($name, $cfg, $files, $resp = $DefaultLangs, [switch]$Full) {
  $f = @{ 'ImportConfig.xml' = $cfg }
  foreach ($k in $files.Keys) { $f["xml\$k"] = $files[$k] }
  $d = WriteCase $name $f
  RunLP $name (Join-Path $d 'ImportConfig.xml') 'PKG' $false $resp -Full:$Full
}
$it = '<itemtype name="Foo"/>'
$one = Exp '<Item type="Foo" id="A1" keyed_name="K"><property __name="name" de="Hallo" fr="Salut"/></Item>'

Write-Output '#### itemtype selection'
Case 'itemtype-none-with-file' (Cfg 'de' @()) @{ 'Foo.xml' = $one }
Case 'itemtype-none-without-files' (Cfg 'de' @()) @{ 'readme.txt' = 'x' }
Case 'itemtype-other-only' (Cfg 'de' @('<itemtype name="Bar"/>')) @{ 'Foo.xml' = $one; 'Bar.xml' = $one.Replace('Foo', 'Bar') }
Case 'itemtype-name-case' (Cfg 'de' @('<itemtype name="foo"/>')) @{ 'Foo.xml' = $one }
Case 'itemtype-duplicate-last-wins' (Cfg 'de' @('<itemtype name="Foo"><properties list="name"/></itemtype>', '<itemtype name="Foo"><properties list="other"/></itemtype>')) @{ 'Foo.xml' = $one }
Case 'itemtype-duplicate-last-all' (Cfg 'de' @('<itemtype name="Foo"><properties list="other"/></itemtype>', '<itemtype name="Foo"/>')) @{ 'Foo.xml' = $one }
Case 'itemtype-no-name' (Cfg 'de' @('<itemtype/>')) @{ 'Foo.xml' = $one }
Case 'itemtype-nested-not-read' ('<ImportConfig><x><itemtype name="Foo"/></x></ImportConfig>') @{ 'Foo.xml' = $one }
Case 'itemtype-name-with-spaces' (Cfg 'de' @('<itemtype name="Sub Type"/>')) @{ 'Sub Type.xml' = (Exp '<Item type="Sub Type" id="A1"><property __name="name" de="Hallo"/></Item>') }

Write-Output '#### property list'
$two = Exp '<Item type="Foo" id="A1"><property __name="name" de="N"/><property __name="Label" de="L"/><property __name="label" de="l"/></Item>'
Case 'props-list-name' (Cfg 'de' @('<itemtype name="Foo"><properties list="name"/></itemtype>')) @{ 'Foo.xml' = $two }
Case 'props-list-uppercase-in-config' (Cfg 'de' @('<itemtype name="Foo"><properties list="NAME,LABEL"/></itemtype>')) @{ 'Foo.xml' = $two }
Case 'props-list-space-after-comma' (Cfg 'de' @('<itemtype name="Foo"><properties list="name, label"/></itemtype>')) @{ 'Foo.xml' = $two }
Case 'props-list-space-around' (Cfg 'de' @('<itemtype name="Foo"><properties list=" name "/></itemtype>')) @{ 'Foo.xml' = $two }
Case 'props-list-empty' (Cfg 'de' @('<itemtype name="Foo"><properties list=""/></itemtype>')) @{ 'Foo.xml' = $two }
Case 'props-list-spaces-only' (Cfg 'de' @('<itemtype name="Foo"><properties list="   "/></itemtype>')) @{ 'Foo.xml' = $two }
Case 'props-list-none-match' (Cfg 'de' @('<itemtype name="Foo"><properties list="zzz"/></itemtype>')) @{ 'Foo.xml' = $two }
Case 'props-element-twice' (Cfg 'de' @('<itemtype name="Foo"><properties list="name"/><properties list="label"/></itemtype>')) @{ 'Foo.xml' = $two }
Case 'props-no-list-attr' (Cfg 'de' @('<itemtype name="Foo"><properties/></itemtype>')) @{ 'Foo.xml' = $two }
Case 'props-trailing-comma-no-name-attr' (Cfg 'de' @('<itemtype name="Foo"><properties list="name,"/></itemtype>')) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property de="X"/><property __name="name" de="N"/></Item>') }
Case 'prop-no-name-attr-all-props' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property de="X"/><property __name="name" de="N"/></Item>') }

Write-Output '#### properties and translations'
Case 'prop-duplicate-both-translated' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property __name="name" de="A"/><property __name="name" de="B"/></Item>') }
Case 'prop-duplicate-first-untranslated' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property __name="name" en="E"/><property __name="name" de="B"/></Item>') }
Case 'prop-duplicate-excluded-by-list' (Cfg 'de' @('<itemtype name="Foo"><properties list="x"/></itemtype>')) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property __name="name" de="A"/><property __name="name" de="B"/></Item>') }
Case 'translation-empty-string' (Cfg 'de,fr' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property __name="name" de="" fr="F"/></Item>') }
Case 'translation-all-empty-item-skipped' (Cfg 'de,fr' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property __name="name" de="" fr=""/></Item>') }
Case 'translation-whitespace' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property __name="name" de=" "/></Item>') }
Case 'translation-en-only' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property __name="name" en="E"/></Item>') }
Case 'translation-language-not-on-server' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property __name="name" it="I"/></Item>') }
Case 'item-without-translations-then-with' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property __name="name" en="E"/></Item><Item type="Foo" id="A2"><property __name="name" de="D2"/></Item>') }
Case 'no-item-translated-no-file' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"><property __name="name" en="E"/></Item>') }
Case 'item-with-no-properties' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A1"/>') }
Case 'two-items-order' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="B"><property __name="name" de="2"/></Item><Item type="Foo" id="A"><property __name="name" de="1"/></Item>') }
Case 'property-order-in-file' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" id="A"><property __name="z" de="1"/><property __name="a" de="2"/></Item>') }

Write-Output '#### which nodes are read'
Case 'root-not-export' (Cfg 'de' @($it)) @{ 'Foo.xml' = ($one.Replace('export', 'AML')) }
Case 'items-nested-not-selected' (Cfg 'de' @($it)) @{ 'Foo.xml' = '<export><x><Item id="N"><property __name="name" de="D"/></Item></x><Item id="A"><Relationships><Item id="R"><property __name="name" de="D"/></Item></Relationships></Item></export>' }
Case 'property-nested-not-selected' (Cfg 'de' @($it)) @{ 'Foo.xml' = '<export><Item id="A"><x><property __name="name" de="D"/></x></Item></export>' }
Case 'export-element-twice' (Cfg 'de' @($it)) @{ 'Foo.xml' = '<export><Item id="A"><property __name="name" de="D"/></Item></export>' }
Case 'item-in-namespace' (Cfg 'de' @($it)) @{ 'Foo.xml' = '<export xmlns="urn:x"><Item id="A"><property __name="name" de="D"/></Item></export>' }
Case 'property-element-name-case' (Cfg 'de' @($it)) @{ 'Foo.xml' = '<export><Item id="A"><Property __name="name" de="D"/></Item></export>' }
Case 'translation-attr-case' (Cfg 'de' @($it)) @{ 'Foo.xml' = '<export><Item id="A"><property __name="name" DE="D"/></Item></export>' }
Case 'name-attr-uppercase-in-file' (Cfg 'de' @('<itemtype name="Foo"><properties list="name"/></itemtype>')) @{ 'Foo.xml' = '<export><Item id="A"><property __name="NAME" de="D"/></Item></export>' }

Write-Output '#### the where clause'
Case 'where-attributes-in-order' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item zeta="1" type="Foo" id="A1" keyed_name="K" alpha="2" Type="T" KEYED_NAME="k"><property __name="name" de="D"/></Item>') }
Case 'where-no-attributes' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item type="Foo" keyed_name="K"><property __name="name" de="D"/></Item>') }
Case 'where-no-attributes-at-all' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item><property __name="name" de="D"/></Item>') }
Case 'where-value-quote-and-markup' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item id="a''b" other="x&amp;y &lt;z&gt; &quot;q&quot;" empty=""><property __name="name" de="D"/></Item>') }
Case 'where-prefixed-attributes' (Cfg 'de' @($it)) @{ 'Foo.xml' = '<export xmlns:a="urn:a"><Item a:id="1" xml:lang="en" id="2"><property __name="name" de="D"/></Item></export>' }
Case 'where-type-name-spaces' (Cfg 'de' @('<itemtype name="Sub  Type X"/>')) @{ 'Sub  Type X.xml' = (Exp '<Item id="A1"><property __name="name" de="D"/></Item>') }

Write-Output '#### values'
Case 'value-markup-and-controls' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item id="A"><property __name="name" de="a &amp; b &lt; c &gt; d &quot;e&quot; ''f'' &#9;tab &#10;lf &#13;cr &#13;&#10;crlf"/></Item>') }
Case 'value-non-ascii' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item id="A"><property __name="name" de="Gr&#xFC;&#xDF;e &#x1F600; &#x4E2D;"/></Item>') }
Case 'value-lone-surrogate-reference' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item id="A"><property __name="name" de="a&#xD800;b"/></Item>') }
Case 'value-looks-like-xml' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item id="A"><property __name="name" de="&lt;b&gt;x&lt;/b&gt;"/></Item>') }

Write-Output '#### file names'
Case 'file-xmlbak-extension' (Cfg 'de' @('<itemtype name="Foobak"/>')) @{ 'Foo.xmlbak' = $one }
Case 'file-xmlbak-config-foo' (Cfg 'de' @($it)) @{ 'Foo.xmlbak' = $one }
Case 'file-uppercase-extension' (Cfg 'de' @('<itemtype name="Foo.XML"/>')) @{ 'Foo.XML' = $one }
Case 'file-double-extension' (Cfg 'de' @($it)) @{ 'Foo.xml.xml' = $one }
Case 'file-dot-inside' (Cfg 'de' @('<itemtype name="A.B"/>')) @{ 'A.B.xml' = $one }
Case 'file-dot-xml-inside' (Cfg 'de' @('<itemtype name="A.B"/>')) @{ 'A.xml.xml.B.xml' = $one }
Case 'file-hidden-name' (Cfg 'de' @('<itemtype name=""/>')) @{ '.xml' = $one }
Case 'file-not-xml' (Cfg 'de' @($it)) @{ 'Foo.txt' = $one }
Case 'xml-folder-subfolder-ignored' (Cfg 'de' @($it)) @{ 'sub\Foo.xml' = $one }

Write-Output '#### several files, failure in the middle'
Case 'second-file-fails-first-stays' (Cfg 'de' @('<itemtype name="A"/>', '<itemtype name="B"/>')) @{ 'A.xml' = $one; 'B.xml' = (Exp '<Item id="A1"><property __name="name" de="A"/><property __name="name" de="B"/></Item>') }
Case 'malformed-xml-file' (Cfg 'de' @($it)) @{ 'Foo.xml' = '<export><Item' }
Case 'empty-xml-file' (Cfg 'de' @($it)) @{ 'Foo.xml' = '' }
Case 'xml-file-with-declaration-and-bom' (Cfg 'de' @($it)) @{ 'Foo.xml' = ([string][char]0xFEFF + '<?xml version="1.0" encoding="utf-8"?>' + $one) }

Write-Output '#### two files that give the same name'
Case 'file-name-collision' (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp '<Item id="FIRST"><property __name="name" de="1"/></Item>'); 'Foo.xml.xml' = (Exp '<Item id="SECOND"><property __name="name" de="2"/></Item>') }

Write-Output '#### property names that are not XML names'
$k = 0
foreach ($n in 'a b', '1a', 'a:b', 'a.b', 'a-b', ([string][char]0xE9), 'a<b', 'xml:lang', 'a/b', 'a:b:c', ':b') {
  $k++
  Case ('property-name-' + $k + ' ' + (Esc $n).Trim('"').Replace('\', '_').Replace(':', '_').Replace('<', '_').Replace('/', '_')) (Cfg 'de' @($it)) @{ 'Foo.xml' = (Exp ('<Item id="A"><property __name="' + $n.Replace('<', '&lt;') + '" de="D"/></Item>')) }
}
