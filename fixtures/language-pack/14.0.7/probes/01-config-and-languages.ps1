# Config file reading (languages, itemtype, properties) and the Language get. Covers LP-010 to LP-023.
. (Join-Path $env:LOCALAPPDATA 'libsjs23-probe\lp-common.ps1')
$foo = '<export><Item type="Foo" id="A1"><property __name="name" de="Hallo" fr="Salut" en="Hello" es="Hola"/><property __name="Label" de="L" fr="LF"/></Item></export>'
$it = '<itemtype name="Foo"/>'
function Case($name, $cfg, $resp, $files = @{}) {
  $f = @{ 'ImportConfig.xml' = $cfg; 'xml\Foo.xml' = $foo }
  foreach ($k in $files.Keys) { $f[$k] = $files[$k] }
  $d = WriteCase $name $f
  RunLP $name (Join-Path $d 'ImportConfig.xml') 'PKG' $false $resp
}
Case 'languages-list-de-fr' (Cfg 'de,fr' @($it)) $DefaultLangs
Case 'languages-none-means-all' (Cfg '' @($it)) $DefaultLangs
Case 'languages-uppercase-and-spaces' (Cfg ' DE , Fr ' @($it)) $DefaultLangs
Case 'languages-space-only-list' (Cfg ' ' @($it)) $DefaultLangs
Case 'languages-unknown-only' (Cfg 'xx' @($it)) $DefaultLangs
Case 'languages-empty-items-in-list' (Cfg 'de,,fr,' @($it)) $DefaultLangs
Case 'languages-element-twice' ('<ImportConfig><languages list="de"/><languages list="fr"/>' + $it + '</ImportConfig>') $DefaultLangs
Case 'languages-nested-not-read' ('<ImportConfig><x><languages list="de"/></x>' + $it + '</ImportConfig>') $DefaultLangs
Case 'languages-uppercase-attr-name' ('<ImportConfig><languages LIST="de"/>' + $it + '</ImportConfig>') $DefaultLangs
Case 'root-other-name' ('<Whatever><languages list="de"/>' + $it + '</Whatever>') $DefaultLangs
Case 'server-code-uppercase' (Cfg 'de' @($it)) (LangResponse @(@('en',''),@('DE','_de')))
Case 'server-code-uppercase-all' (Cfg '' @($it)) (LangResponse @(@('en',''),@('DE','_de'),@('de','_d2')))
Case 'server-order-fr-de' (Cfg '' @($it)) (LangResponse @(@('en',''),@('fr','_fr'),@('de','_de')))
Case 'server-no-en' (Cfg '' @($it)) (LangResponse @(@('de','_de')))
Case 'server-en-uppercase' (Cfg '' @($it)) (LangResponse @(@('EN',''),@('de','_de')))
Case 'server-suffix-missing' (Cfg '' @($it)) (LangResponse @(@('en',''),@('de',$null)))
Case 'server-code-missing' (Cfg '' @($it)) (LangResponse @(@('en',''),@($null,'_x'),@('de','_de')))
Case 'server-code-missing-with-list' (Cfg 'de' @($it)) (LangResponse @(@($null,'_x'),@('de','_de')))
Case 'server-code-duplicate' (Cfg '' @($it)) (LangResponse @(@('en',''),@('de','_de'),@('de','_d2')))
Case 'server-code-duplicate-not-requested' (Cfg 'fr' @($it)) (LangResponse @(@('en',''),@('de','_de'),@('de','_d2'),@('fr','_fr')))
Case 'server-one-language-only' (Cfg '' @($it)) (LangResponse @(,@('de','_de')))
Case 'server-no-items-fault0' (Cfg '' @($it)) (FaultResponse '0' 'No items of type Language found.')
Case 'server-other-fault' (Cfg '' @($it)) (FaultResponse '1' 'Access denied')
Case 'server-empty-result' (Cfg '' @($it)) (Envelope '<Result></Result>')
Case 'server-garbage-response' (Cfg '' @($it)) '<html/>'
Case 'code-with-xml-special' (Cfg '' @($it)) (LangResponse @(@('en',''),@('d-e','_de')))
$fooHy = '<export><Item type="Foo" id="A1"><property __name="name" d-e="Hallo" de="X"/></Item></export>'
Case 'code-with-hyphen' (Cfg '' @($it)) (LangResponse @(@('en',''),@('d-e','_de'))) @{ 'xml\Foo.xml' = $fooHy }

Write-Output '#### trim set and case mapping of the languages list'
$nb = [string][char]0xA0; $ide = [string][char]0x3000; $zw = [string][char]0x200B
Case 'languages-list-nbsp-and-ideographic-space' (Cfg ("$nb" + "de$ide,fr") @($it)) $DefaultLangs
Case 'languages-list-zero-width-space-not-trimmed' (Cfg ("$zw" + "de,fr") @($it)) $DefaultLangs
$eAcute = [string][char]0xE9; $eAcuteUp = [string][char]0xC9
$fooE = '<export><Item type="Foo" id="A1"><property __name="name" ' + $eAcute + 'x="Hallo" de="D"/></Item></export>'
Case 'languages-list-non-ascii-uppercase' (Cfg ($eAcuteUp + 'x') @($it)) (LangResponse @(@('en',''),@(($eAcute + 'x'),'_ex'),@('de','_de'))) @{ 'xml\Foo.xml' = $fooE }
