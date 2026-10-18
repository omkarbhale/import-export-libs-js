# LanguageCodesExtractor (14.35), driven directly. Covers IMP-610 to IMP-615.
. (Join-Path $PSScriptRoot 'common.ps1')
function Pkg([string]$name, [string]$folder) {
  $p = New-Object Aras.Tools.SolutionUpgrade.Package
  $p.Name = $name; $p.FolderPath = $folder
  $p
}
function Sorted($a) { (@($a) | Sort-Object { $_ } -CaseSensitive | ForEach-Object { Esc $_ }) -join ', ' }
# $pkgs: array of @(name, folder); $names: package names asked afterwards
function Scan([string]$label, $pkgs, $names) {
  Write-Output "## $label"
  $ex = New-Object Aras.Tools.SolutionUpgrade.LanguageCodesExtractor
  $list = New-Object 'System.Collections.Generic.List[Aras.Tools.SolutionUpgrade.Package]'
  foreach ($p in $pkgs) { $list.Add((Pkg $p[0] $p[1])) }
  try { $ex.ExtractLanguageCodesFromPackages($list); Say 'extract' 'ok' } catch { Say 'extract' (Ex $_.Exception) }
  foreach ($n in $names) { Say "by package $(Esc $n)" (Sorted ($ex.GetUsedLanguagesByPackage($n))) }
  Say 'by packages (engine order)' ((@($ex.GetUsedLanguagesByPackages([string[]]$names)) | ForEach-Object { Esc $_ }) -join ', ')
  $script:ex = $ex
}
$Idot = [string][char]0x130; $GreekSigma = ([string][char]0x391) + ([string][char]0x3A3); $eAcute = [string][char]0xE9; $aUml = [string][char]0xE4
function Aml([string]$items) { '<AML>' + $items + '</AML>' }
$i18n = 'xmlns:i18n="http://www.aras.com/I18N"'
function It([string]$langs) {
  $s = '<Item type="Foo" id="A1" action="add">'
  foreach ($l in ($langs -split ',')) { if ($l -ne '') { $s += "<i18n:label $i18n xml:lang=""$l"">v</i18n:label>" } }
  $s + '</Item>'
}

$d = WriteCase 'basic' @{
  'P\Import\Foo\a.xml' = (Aml (It 'de,fr'));
  'P\Import\Foo\sub\deep\b.xml' = (Aml (It 'de,es'));
  'P\Import\Bar\c.xml' = (Aml (It 'en'));
}
Scan 'basic-all-depths' @(,@('P', "$d\P\Import")) @('P')

$d = WriteCase 'file-name-patterns' @{
  'P\a.xml' = (Aml (It 'aa')); 'P\b.XML' = (Aml (It 'bb')); 'P\c.xmlbak' = (Aml (It 'cc')); 'P\d.txt' = (Aml (It 'dd'));
  'P\e.xml.txt' = (Aml (It 'ee')); 'P\sub\f.xml' = (Aml (It 'ff')); 'P\g.Xml' = (Aml (It 'gg'));
}
Scan 'file-name-patterns' @(,@('P', "$d\P")) @('P')

$d = WriteCase 'selection' @{
  'P\Import\a.xml' = '<AML><Item type="Foo" id="A" xml:lang="itemattr"><name xml:lang="child">x</name><Relationships><Item type="Rel" id="R" xml:lang="relattr"><label xml:lang="relchild">y</label></Item></Relationships></Item></AML>';
  'P\Import\b.xml' = '<root><sub><Item type="Foo"><p xml:lang="deepitem"/></Item></sub></root>';
  'P\Import\c.xml' = '<AML><Item type="Foo"><p><q xml:lang="grandchild"/></p></Item></AML>';
  'P\Import\d.xml' = '<AML><Item type="Foo"><p lang="plainlang"/><p xml:space="preserve"/></Item></AML>';
  'P\Import\e.xml' = '<AML><item type="Foo"><p xml:lang="lowercaseitem"/></item></AML>';
  'P\Import\f.xml' = '<AML><Item type="Foo"><p xml:lang=""/></Item></AML>';
  'P\Import\g.xml' = '<AML xmlns="urn:x"><Item type="Foo"><p xml:lang="innamespace"/></Item></AML>';
}
Scan 'selection-rules' @(,@('P', "$d\P\Import")) @('P')

$d = WriteCase 'case' @{
  'P\a.xml' = (Aml (It 'DE,De,de')); 'P\b.xml' = (Aml (It 'ZH-CN,zh-cn')); 'P\c.xml' = (Aml ((It $Idot) + (It $GreekSigma)));
}
Scan 'case-lowered-and-merged' @(,@('P', "$d\P")) @('P')

$d = WriteCase 'two' @{
  'P1\a.xml' = (Aml (It 'de,fr')); 'P2\a.xml' = (Aml (It 'es,de')); 'P3\empty.txt' = 'x';
}
Scan 'two-packages' @(@('P1', "$d\P1"), @('P2', "$d\P2"), @('P3', "$d\P3")) @('P1', 'P2', 'P3', 'Unknown')
Say 'by packages P1,P2' ((@($ex.GetUsedLanguagesByPackages([string[]]@('P1', 'P2'))) | ForEach-Object { Esc $_ }) -join ', ')
Say 'by packages P2,P1,P2' ((@($ex.GetUsedLanguagesByPackages([string[]]@('P2', 'P1', 'P2'))) | ForEach-Object { Esc $_ }) -join ', ')
Say 'by packages none' ((@($ex.GetUsedLanguagesByPackages([string[]]@())) | ForEach-Object { Esc $_ }) -join ', ')

$d = WriteCase 'same-name' @{ 'A\a.xml' = (Aml (It 'de')); 'B\a.xml' = (Aml (It 'fr')) }
Scan 'same-package-name-twice-first-wins' @(@('P', "$d\A"), @('P', "$d\B")) @('P')

Write-Output '## order-of-package-names-in-the-sort'
$d = WriteCase 'sortorder' @{ 'P\a.xml' = (Aml (It ('b,a,B,A,zh-cn,zhcn,zh-tw,zh,de-ch,de,dex,en,en-us,' + $eAcute + ',e,f,' + $aUml + ',a-b,ab,a_b,Z,z,10,2,1'))) }
Scan 'sort-order' @(,@('P', "$d\P")) @('P')
$d = WriteCase 'sortorder2' @{ 'P\a.xml' = (Aml (It 'pt-br,pt,zh-tw,zh-cn,en-us,en,de-ch,dea,de,fr-ca,fr,es,es-mx,sv,sv-fi,da,nl,nl-be')) }
Scan 'sort-order-realistic' @(,@('P', "$d\P")) @('P')

$d = WriteCase 'rescan' @{ 'A\a.xml' = (Aml (It 'de')); 'B\a.xml' = (Aml (It 'fr')) }
Write-Output '## re-extract-clears-the-cache'
$ex = New-Object Aras.Tools.SolutionUpgrade.LanguageCodesExtractor
$l1 = New-Object 'System.Collections.Generic.List[Aras.Tools.SolutionUpgrade.Package]'; $l1.Add((Pkg 'A' "$d\A"))
$l2 = New-Object 'System.Collections.Generic.List[Aras.Tools.SolutionUpgrade.Package]'; $l2.Add((Pkg 'B' "$d\B"))
$ex.ExtractLanguageCodesFromPackages($l1); Say 'after first extract, A' (Sorted ($ex.GetUsedLanguagesByPackage('A')))
$ex.ExtractLanguageCodesFromPackages($l2); Say 'after second extract, A' (Sorted ($ex.GetUsedLanguagesByPackage('A'))); Say 'after second extract, B' (Sorted ($ex.GetUsedLanguagesByPackage('B')))
$ex.ExtractLanguageCodesFromPackages((New-Object 'System.Collections.Generic.List[Aras.Tools.SolutionUpgrade.Package]')); Say 'after empty extract, B' (Sorted ($ex.GetUsedLanguagesByPackage('B')))

Write-Output '## failures'
$d = WriteCase 'bad-file' @{ 'P\good.xml' = (Aml (It 'de')); 'P\sub\bad.xml' = '<AML><Item>'; 'Q\ok.xml' = (Aml (It 'fr')) }
Scan 'malformed-file-in-first-package' @(@('P', "$d\P"), @('Q', "$d\Q")) @('P', 'Q')
$d = WriteCase 'bad-file2' @{ 'P\good.xml' = (Aml (It 'de')); 'P\bad1.xml' = '<AML><Item>'; 'P\bad2.xml' = ''; 'P\bad3.xml' = '<a/><b/>' }
Scan 'three-malformed-files' @(,@('P', "$d\P")) @('P')
$d = WriteCase 'bad-second' @{ 'P\good.xml' = (Aml (It 'de')); 'Q\bad.xml' = '<AML><Item>' }
Scan 'malformed-file-in-second-package' @(@('P', "$d\P"), @('Q', "$d\Q")) @('P', 'Q')
$d = WriteCase 'empty-pkg' @{ 'P\readme.txt' = 'x' }
Scan 'package-without-xml' @(,@('P', "$d\P")) @('P')
Scan 'missing-folder' @(@('P', "$d\P"), @('M', "$d\Missing")) @('P', 'M')
Scan 'folder-is-a-file' @(,@('F', "$d\P\readme.txt")) @('F')
Scan 'no-packages' @() @('P')
$d = WriteCase 'dtd' @{ 'P\a.xml' = '<!DOCTYPE AML [<!ENTITY e "x">]><AML><Item><p xml:lang="de"/></Item></AML>' }
Scan 'doctype-in-file' @(,@('P', "$d\P")) @('P')
$d = WriteCase 'bom' @{ 'P\a.xml' = ([string][char]0xFEFF + '<?xml version="1.0" encoding="utf-8"?><AML><Item><p xml:lang="de"/></Item></AML>') }
Scan 'bom-and-declaration' @(,@('P', "$d\P")) @('P')
Remove-Item -Recurse -Force $caseRoot -ErrorAction SilentlyContinue
