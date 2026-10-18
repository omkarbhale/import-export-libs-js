# Shared harness for the 14.35 language-pack probes: runs the real 14.35 LanguagePackPreprocessor over a case folder
# with a fake ICItemHelper (from the real interface; supplies the Innovator and the server version) and a stub connection
# whose answers a script gives (request -> envelope).
. (Join-Path $PSScriptRoot 'stub.ps1')
$helperStubs = StubInterface ([Aras.Tools.SolutionUpgrade.ICItemHelper]) @('Inn', 'InnovatorVersion')
$code2 = @"
using System; using System.Collections.Generic; using System.Xml; using Aras.IOM; using Aras.Tools.SolutionUpgrade;
public class FakeHelper : ICItemHelper {
  public Innovator InnValue; public ArasVersion VersionValue;
  public Innovator Inn { get { return InnValue; } }
  public ArasVersion InnovatorVersion { get { return VersionValue; } }
  $helperStubs
}
"@
Add-Type -TypeDefinition $code2 -ReferencedAssemblies @((Join-Path $dll 'IOM.dll'), (Join-Path $dll 'Libs.dll'), 'System.Xml.dll', 'System.dll') -Language CSharp

$tmpRoot = [IO.Path]::GetTempPath()
function Tree([string]$base) {
  if (-not (Test-Path $base)) { return }
  Get-ChildItem -Recurse -Force $base | Sort-Object FullName | ForEach-Object {
    $rel = Esc ($_.FullName.Substring($base.Length).TrimStart('\'))
    if (-not $_.PSIsContainer -and $rel -ne '"imports.mf"') {
      $b = [IO.File]::ReadAllBytes($_.FullName)
      $bom = if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { '[BOM] ' } else { '' }
      $t = [Text.Encoding]::UTF8.GetString($b)
      if ($bom) { $t = $t.Substring(1) }
      Say "  file $rel" ($bom + (Scrub (Esc $t)))
    }
  }
}
function LPDirs { @(Get-ChildItem -Directory -Path $tmpRoot -Filter 'LanguagePack_*' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
$StdLang = '<Item isNew="1" isTemp="1" type="Language" action="get" select="code,suffix" />'

# $respond: scriptblock (request -> envelope). Version: @(major, minor, servicePack, build, serviceUpdate).
function RunLP([string]$label, [string]$cfgPath, [string]$pkg, [scriptblock]$respond, [int[]]$ver = @(12, 0, 9, 24090, 0), [switch]$noVersion, [string]$lpPath = $null) {
  $before = LPDirs
  $conn = New-Object StubConn
  $conn.Respond = [Func[string,string]]$respond
  $helper = New-Object FakeHelper
  $helper.InnValue = [Aras.IOM.IomFactory]::CreateInnovator($conn)
  if (-not $noVersion) { $helper.VersionValue = New-Object Aras.Tools.SolutionUpgrade.ArasVersion($ver[0], $ver[1], $ver[2], $ver[3], $ver[4]) }
  $pp = $null
  Write-Output "## $label"
  try {
    $pp = New-Object Aras.Tools.SolutionUpgrade.LanguagePackPreprocessor((New-Object Aras.Tools.SolutionUpgrade.IOWrapper), $helper, (New-Object Aras.Tools.SolutionUpgrade.ManifestFile), $(if ($PSBoundParameters.ContainsKey('lpPath')) { $lpPath } else { $cfgPath }), $pkg, $false)
    Say 'ctor' 'ok'
  } catch { Say 'ctor' (Ex $_.Exception) }
  foreach ($r in $conn.Requests) { if ($r -ne $StdLang) { Say 'request' (Scrub (Esc $r)) } }
  $new = @(LPDirs | Where-Object { $before -notcontains $_ })
  foreach ($n in $new) { Tree $n }
  foreach ($n in $new) { Remove-Item -Recurse -Force $n }
}
function Cfg([string]$languages, [string[]]$itemtypes) {
  $s = '<ImportConfig>'
  if ($languages) { $s += '<languages list="' + $languages + '"/>' }
  foreach ($i in $itemtypes) { $s += $i }
  $s + '</ImportConfig>'
}
# the usual answers: the Language get, and a Property get from a table of id -> values
function Answer([hashtable]$propValues = @{}, $propFault = $null) {
  $pv = $propValues; $pf = $propFault; $dl = $DefaultLangs
  { param($r)
    if ($r -like '*type="Language"*') { return (LangResponse @(@('en', '', ''), @('de', '', '_de'), @('fr', '', '_fr'))) }
    if ($r -like '*type="Property"*action="get"*') {
      if ($pf) { return $pf }
      $m = [regex]::Match($r, '<id>([^<]*)</id>')
      $id = if ($m.Success) { $m.Groups[1].Value } else { '' }
      if ($pv.ContainsKey($id)) { return (Result $pv[$id]) }
      return (Fault '0' 'No items of type Property found.')
    }
    return $null
  }.GetNewClosure()
}
