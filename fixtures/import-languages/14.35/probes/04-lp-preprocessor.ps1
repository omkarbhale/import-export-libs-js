# LanguagePackPreprocessor (14.35): what differs from 14.0.7. Covers LP-040, LP-041 and the [14.35] variants of LP-020 to LP-029 and LP-036.
. (Join-Path $PSScriptRoot 'lp-common.ps1')
$row = { param($type, $id) '<export><Item type="' + $type + '" id="' + $id + '"><property __name="name" de="Hallo" fr="Salut" en="Hello"/><property __name="label" de="Etikett"/></Item></export>' }
function Case([string]$name, [string]$cfg, [hashtable]$files, [scriptblock]$respond, [int[]]$ver = @(12, 0, 9, 24090, 0)) {
  $f = @{ 'ImportConfig.xml' = $cfg }
  foreach ($k in $files.Keys) { $f[$k] = $files[$k] }
  $d = WriteCase $name $f
  RunLP $name (Join-Path $d 'ImportConfig.xml') 'PKG' $respond $ver
}
$it = '<itemtype name="Foo"/>'
$any = { param($r) if ($r -like '*type="Language"*') { return (LangResponse @(@('en', '', ''), @('de', '', '_de'), @('fr', '', '_fr'))) }; return $null }

Write-Output '#### file names: Path.GetFileNameWithoutExtension'
Case 'name-plain' (Cfg '' @('<itemtype name="Foo"/>')) @{ 'xml\Foo.xml' = (& $row 'Foo' 'A1') } $any
Case 'name-two-dots' (Cfg '' @('<itemtype name="A.B"/>')) @{ 'xml\A.B.xml' = (& $row 'A.B' 'A1') } $any
Case 'name-xmlbak' (Cfg '' @('<itemtype name="Foo"/>')) @{ 'xml\Foo.xmlbak' = (& $row 'Foo' 'A1') } $any
Case 'name-upper-extension' (Cfg '' @('<itemtype name="Foo"/>')) @{ 'xml\Foo.XML' = (& $row 'Foo' 'A1') } $any
Case 'name-xml-twice' (Cfg '' @('<itemtype name="Foo.xml"/>')) @{ 'xml\Foo.xml.xml' = (& $row 'Foo' 'A1') } $any
Case 'name-xml-in-the-middle' (Cfg '' @('<itemtype name="A.xml.xml.B"/>')) @{ 'xml\A.xml.xml.B.xml' = (& $row 'A' 'A1') } $any
Case 'name-with-spaces' (Cfg '' @('<itemtype name="Sub Type"/>')) @{ 'xml\Sub Type.xml' = (& $row 'Sub Type' 'A1') } $any
Case 'name-hidden-file' (Cfg '' @('<itemtype name=""/>')) @{ 'xml\.xml' = (& $row 'Foo' 'A1') } $any
Case 'name-collision-two-files' (Cfg '' @('<itemtype name="Foo"/>', '<itemtype name="Foo.xml"/>')) @{ 'xml\Foo.xml' = (& $row 'Foo' 'A1'); 'xml\Foo.xml.xml' = (& $row 'Foo' 'A2') } $any
Case 'name-config-key-14-0-7-style' (Cfg '' @('<itemtype name="Foo"/>')) @{ 'xml\Foo.xml.xml' = (& $row 'Foo' 'A1') } $any

Case 'itemtype-none-with-file' (Cfg '' @()) @{ 'xml\Foo.xml' = (& $row 'Foo' 'A1') } $any
Case 'itemtype-none-without-files' (Cfg '' @()) @{ 'xml\readme.txt' = 'x' } $any
Case 'itemtype-other-only' (Cfg '' @('<itemtype name="Bar"/>')) @{ 'xml\Foo.xml' = (& $row 'Foo' 'A1') } $any

Write-Output '#### Property items (version 12.0 SP9: null-value handling on)'
$prop = { param($id) '<export><Item type="Property" id="' + $id + '" action="x" keyed_name="k"><property __name="label" de="Etikett" fr="Libelle"/></Item></export>' }
$ptype = '<itemtype name="Property"/>'
$vals = @{ 'P1' = '<Item type="Property" id="P1"><default_value>dv</default_value><data_source>ds</data_source><data_type>string</data_type></Item>';
           'P2' = '<Item type="Property" id="P2"><data_type>item</data_type></Item>';
           'P3' = '<Item type="Property" id="P3"><default_value></default_value></Item>';
           'P4' = '<Item type="Property" id="P4"><default_value>a</default_value></Item><Item type="Property" id="P5"><default_value>b</default_value></Item>' }
foreach ($id in 'P1', 'P2', 'P3', 'P4', 'PX') {
  Case "property-values-$id" (Cfg '' @($ptype)) @{ 'xml\Property.xml' = (& $prop $id) } (Answer $vals)
}
Case 'property-get-fault-other' (Cfg '' @($ptype)) @{ 'xml\Property.xml' = (& $prop 'P1') } (Answer @{} (Fault '5' 'boom'))
Case 'property-get-empty-result' (Cfg '' @($ptype)) @{ 'xml\Property.xml' = (& $prop 'P1') } (Answer @{} (Envelope '<Result></Result>'))
Case 'property-get-garbage' (Cfg '' @($ptype)) @{ 'xml\Property.xml' = (& $prop 'P1') } (Answer @{} '<html/>')
$noTrans = '<export><Item type="Property" id="P1"><property __name="label" en="Only English"/></Item></export>'
Case 'property-no-translation-still-asks' (Cfg '' @($ptype)) @{ 'xml\Property.xml' = $noTrans } (Answer $vals)
$many = '<export><Item type="Property" id="P1" keyed_name="k" foo="bar"><property __name="label" de="A"/></Item><Item type="Property" id="P2"><property __name="label" de="B"/></Item></export>'
Case 'property-two-items-attributes-as-properties' (Cfg '' @($ptype)) @{ 'xml\Property.xml' = $many } (Answer $vals)
$noId = '<export><Item type="Property" keyed_name="k"><property __name="label" de="A"/></Item></export>'
Case 'property-item-without-attributes' (Cfg '' @($ptype)) @{ 'xml\Property.xml' = $noId } (Answer $vals)
$prefixed = '<export><Item type="Property" id="P1" a:b="c" xmlns:a="urn:a"><property __name="label" de="A"/></Item></export>'
Case 'property-prefixed-attribute' (Cfg '' @($ptype)) @{ 'xml\Property.xml' = $prefixed } (Answer $vals)
Case 'property-lowercase-file-name-not-property' (Cfg '' @('<itemtype name="property"/>')) @{ 'xml\property.xml' = (& $prop 'P1') } (Answer $vals)
Case 'property-with-spaces-name' (Cfg '' @('<itemtype name="Property "/>')) @{ 'xml\Property .xml' = (& $prop 'P1') } (Answer $vals)
Case 'foo-type-never-asks' (Cfg '' @($it)) @{ 'xml\Foo.xml' = (& $row 'Foo' 'A1') } (Answer $vals)

Write-Output '#### the version decides (Property P1 file, answers as above)'
foreach ($v in @(@(11, 0, 0, 0, 0), @(12, 0, 0, 0, 0), @(13, 0, 0, 0, 0), @(14, 0, 0, 0, 0), @(14, 0, 21, 0, 0), @(14, 0, 22, 0, 0), @(14, 0, 0, 0, 22), @(14, 0, 7, 0, 7), @(14, 1, 0, 0, 0), @(14, 35, 0, 0, 0), @(15, 0, 0, 0, 0))) {
  Case ('version-' + ($v -join '.')) (Cfg '' @($ptype)) @{ 'xml\Property.xml' = (& $prop 'P1') } (Answer $vals) $v
}

Write-Output '#### the version is read when the preprocessor is built'
$d = WriteCase 'no-version' @{ 'ImportConfig.xml' = (Cfg '' @($it)); 'xml\Foo.xml' = (& $row 'Foo' 'A1') }
RunLP 'no-version-with-a-pack' (Join-Path $d 'ImportConfig.xml') 'PKG' $any -noVersion
RunLP 'no-version-with-an-empty-lp-path' (Join-Path $d 'ImportConfig.xml') 'PKG' $any -noVersion -lpPath ''
RunLP 'version-with-an-empty-lp-path' (Join-Path $d 'ImportConfig.xml') 'PKG' $any -lpPath ''
Remove-Item -Recurse -Force $caseRoot -ErrorAction SilentlyContinue
