# Shared harness for the language-pack probes: loads the staged 14.0.7 Libs.dll and IOM.dll, builds a
# fake IOM connection and a fake ICItemHelper from the real interfaces, and runs the real
# LanguagePackPreprocessor over a case folder.
$ErrorActionPreference = 'Continue'
$root = Join-Path $env:LOCALAPPDATA 'libsjs23-probe'
$dll = Join-Path $root '14.0.7'
[void][Reflection.Assembly]::LoadFrom((Join-Path $dll 'IOM.dll'))
[void][Reflection.Assembly]::LoadFrom((Join-Path $dll 'Libs.dll'))
. (Join-Path $root 'common.ps1')
$NS = [NullString]::Value

function CsName([Type]$t) {
  if ($t.IsArray) { return (CsName $t.GetElementType()) + '[]' }
  if ($t.IsGenericType) {
    $n = $t.GetGenericTypeDefinition().FullName -replace '`\d+$', '' -replace '\+', '.'
    return $n + '<' + (($t.GetGenericArguments() | ForEach-Object { CsName $_ }) -join ', ') + '>'
  }
  if ($t -eq [void]) { return 'void' }
  return ($t.FullName -replace '\+', '.')
}
function StubInterface([Type]$iface, [string[]]$skip, [bool]$throwing) {
  $sb = New-Object System.Text.StringBuilder
  $all = @($iface) + @($iface.GetInterfaces())
  foreach ($i in $all) {
    foreach ($p in $i.GetProperties()) {
      if ($skip -contains $p.Name) { continue }
      $ty = CsName $p.PropertyType
      $body = if ($throwing) { 'throw new System.NotImplementedException("' + $p.Name + '");' } else { 'return default(' + $ty + ');' }
      [void]$sb.Append("public $ty $($p.Name) {")
      if ($p.CanRead) { [void]$sb.Append(" get { $body }") }
      if ($p.CanWrite) { [void]$sb.Append(' set { }') }
      [void]$sb.AppendLine(' }')
    }
    foreach ($m in $i.GetMethods()) {
      if ($m.IsSpecialName) { continue }
      if ($skip -contains $m.Name) { continue }
      $ps = ($m.GetParameters() | ForEach-Object { (CsName $_.ParameterType) + ' ' + $_.Name }) -join ', '
      $rt = CsName $m.ReturnType
      $body = if ($throwing) { 'throw new System.NotImplementedException("' + $m.Name + '");' } elseif ($rt -eq 'void') { '' } else { 'return default(' + $rt + ');' }
      [void]$sb.AppendLine("public $rt $($m.Name)($ps) { $body }")
    }
  }
  $sb.ToString()
}

$connStubs = StubInterface ([Aras.IOM.IServerConnection]) @('CallAction') $false
$helperStubs = StubInterface ([Aras.Tools.SolutionUpgrade.ICItemHelper]) @('Inn') $true
$code = @"
using System; using System.Collections.Generic; using System.Xml; using Aras.IOM; using Aras.Tools.SolutionUpgrade;
public class FakeConn : IServerConnection {
  public static List<string> Requests = new List<string>();
  public static string Response = "";
  public void CallAction(string action, XmlDocument inDom, XmlDocument outDom) {
    Requests.Add(action + " " + inDom.OuterXml);
    outDom.LoadXml(Response);
  }
  $connStubs
}
public class FakeHelper : ICItemHelper {
  public Innovator InnValue;
  public Innovator Inn { get { return InnValue; } }
  $helperStubs
}
"@
$refs = @((Join-Path $dll 'IOM.dll'), (Join-Path $dll 'Libs.dll'), 'System.Xml.dll', 'System.dll')
Add-Type -TypeDefinition $code -ReferencedAssemblies $refs -Language CSharp

function Envelope([string]$inner) {
  '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>' + $inner + '</SOAP-ENV:Body></SOAP-ENV:Envelope>'
}
function LangResponse($langs) {
  # $langs: array of @(code, suffix) ; $null suffix omits the element; $null code omits it
  $items = ''
  foreach ($l in $langs) {
    $items += '<Item type="Language" id="X' + $items.Length + '">'
    if ($null -ne $l[0]) { $items += '<code>' + $l[0] + '</code>' }
    if ($null -ne $l[1]) { $items += '<suffix>' + $l[1] + '</suffix>' }
    $items += '</Item>'
  }
  Envelope ('<Result>' + $items + '</Result>')
}
function FaultResponse([string]$code, [string]$str) {
  Envelope ('<SOAP-ENV:Fault xmlns:af="http://www.aras.com/InnovatorFault"><faultcode>' + $code + '</faultcode><faultstring>' + $str + '</faultstring></SOAP-ENV:Fault>')
}
$DefaultLangs = LangResponse @(@('en', ''), @('de', '_de'), @('fr', '_fr'))

$caseRoot = Join-Path $root 'cases'
$tmpRoot = [IO.Path]::GetTempPath()
function Scrub([string]$s) {
  if ($null -eq $s) { return $s }
  $s = $s.Replace($tmpRoot, '%TEMP%\').Replace($caseRoot, '%CASES%')
  $s = [regex]::Replace($s, 'LanguagePack_[a-z0-9]{8}\.[a-z0-9]{3}', 'LanguagePack_<random>')
  # the profile folder, plain or as Esc writes it (doubled backslashes), then the folders under it
  $s = [regex]::Replace($s, '[A-Za-z]:\\{1,2}Users\\{1,2}[^\\]+', '%USERPROFILE%')
  $s
}
function WriteCase([string]$name, [hashtable]$files) {
  $dir = Join-Path $caseRoot $name
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  foreach ($k in $files.Keys) {
    $p = Join-Path $dir $k
    New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null
    [IO.File]::WriteAllText($p, $files[$k], (New-Object Text.UTF8Encoding($false)))
  }
  $dir
}
function Tree([string]$base, [bool]$full) {
  if (-not (Test-Path $base)) { return }
  Get-ChildItem -Recurse -Force $base | Sort-Object FullName | ForEach-Object {
    $rel = Esc ($_.FullName.Substring($base.Length).TrimStart('\'))
    if ($_.PSIsContainer) { if ($full) { Say "  dir  $rel" '' } }
    elseif ($rel -eq '"imports.mf"' -and -not $full) { }
    else {
      $b = [IO.File]::ReadAllBytes($_.FullName)
      $bom = if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { '[BOM] ' } else { '' }
      $t = [Text.Encoding]::UTF8.GetString($b)
      if ($bom) { $t = $t.Substring(1) }
      Say "  file $rel" ($bom + (Scrub (Esc $t)))
    }
  }
}
function LPDirs { @(Get-ChildItem -Directory -Path $tmpRoot -Filter 'LanguagePack_*' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }

# Runs the preprocessor over a prepared case folder and reports everything observable.
function RunLP([string]$label, [string]$cfgPath, [string]$pkg, [bool]$debug, [string]$response, [switch]$Full, [switch]$keepTemp) {
  $before = LPDirs
  [FakeConn]::Requests.Clear()
  [FakeConn]::Response = $response
  $helper = New-Object FakeHelper
  $helper.InnValue = [Aras.IOM.IomFactory]::CreateInnovator((New-Object FakeConn))
  $pp = $null
  Write-Output "## $label"
  try {
    $pp = New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $helper, (New-Object Aras.Tools.SolutionUpgrade.ManifestFile), $cfgPath, $pkg, $debug)
    Say 'ctor' 'ok'
    if ($Full) {
      Say 'TempManifestFilePath' (Scrub (Esc $pp.TempManifestFilePath))
      Say 'TempPackagesNames' (Scrub (($pp.TempPackagesNames | ForEach-Object { Esc $_ }) -join ', '))
    }
  } catch { Say 'ctor' (Scrub (Ex $_.Exception)) }
  $std = 'ApplyItem <Item isNew="1" isTemp="1" type="Language" action="get" select="code,suffix" />'
  foreach ($r in [FakeConn]::Requests) { if ($Full -or $r -ne $std) { Say 'request' (Scrub (Esc $r)) } }
  $new = @(LPDirs | Where-Object { $before -notcontains $_ })
  Say 'temp dirs created' $new.Count
  foreach ($n in $new) { Tree $n ([bool]$Full) }
  if ($pp) {
    try { $pp.Dispose(); Say 'Dispose' 'ok' } catch { Say 'Dispose' (Ex $_.Exception) }
    $left = @(LPDirs | Where-Object { $before -notcontains $_ })
    Say 'temp dirs after Dispose' $left.Count
  }
  if (-not $keepTemp) { foreach ($n in @(LPDirs | Where-Object { $before -notcontains $_ })) { Remove-Item -Recurse -Force $n } }
}

function Cfg([string]$languages, [string[]]$itemtypes) {
  $s = '<ImportConfig>'
  if ($languages) { $s += '<languages list="' + $languages + '"/>' }
  foreach ($i in $itemtypes) { $s += $i }
  $s + '</ImportConfig>'
}
