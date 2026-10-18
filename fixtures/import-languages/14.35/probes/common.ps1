# Shared helpers for the 14.35 import-language probes: escaping, output, and the staged toolset.
# Stage oracle/native/14.35/ to %LOCALAPPDATA%\libsjs73-probe\14.35\ first (run.sh does).
$ErrorActionPreference = 'Continue'
$root = Join-Path $env:LOCALAPPDATA 'libsjs73-probe'
$dll = Join-Path $root '14.35'
[void][Reflection.Assembly]::LoadFrom((Join-Path $dll 'IOM.dll'))
$libs = [Reflection.Assembly]::LoadFrom((Join-Path $dll 'Libs.dll'))
if ($libs.GetName().Version.ToString() -ne '14.35.0.43890') { throw "Libs.dll is $($libs.GetName().Version), not 14.35.0.43890" }
Set-Location $root; [Environment]::CurrentDirectory = $root
$SU = 'Aras.Tools.SolutionUpgrade'
$caseRoot = Join-Path $root 'cases'
$utf8 = New-Object Text.UTF8Encoding($false)

function Esc([string]$s) {
  if ($null -eq $s) { return 'null' }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  foreach ($c in $s.ToCharArray()) {
    $n = [int]$c
    if ($c -eq '\') { [void]$sb.Append('\\') }
    elseif ($c -eq '"') { [void]$sb.Append('\"') }
    elseif ($n -eq 13) { [void]$sb.Append('\r') }
    elseif ($n -eq 10) { [void]$sb.Append('\n') }
    elseif ($n -eq 9) { [void]$sb.Append('\t') }
    elseif ($n -lt 32 -or $n -gt 126) { [void]$sb.Append(('\u{0:X4}' -f $n)) }
    else { [void]$sb.Append($c) }
  }
  [void]$sb.Append('"')
  $sb.ToString()
}
function Unwrap($e) {
  $x = $e
  while ($x.InnerException -and ($x -is [System.Reflection.TargetInvocationException] -or $x -is [System.Management.Automation.MethodInvocationException])) { $x = $x.InnerException }
  $x
}
function Scrub([string]$s) {
  if ($null -eq $s) { return $s }
  $s = $s.Replace($caseRoot, '%CASES%').Replace([IO.Path]::GetTempPath(), '%TEMP%\')
  $s = [regex]::Replace($s, 'LanguagePack_[a-z0-9]{8}\.[a-z0-9]{3}', 'LanguagePack_<random>')
  $s = [regex]::Replace($s, '[A-Za-z]:\\{1,2}Users\\{1,2}[^\\]+', '%USERPROFILE%')
  $s
}
function Ex($e) {
  $x = Unwrap $e
  $o = $x.GetType().FullName + ': ' + (Scrub (Esc $x.Message))
  if ($x -is [Aras.Tools.SolutionUpgrade.CItemException]) { $o += " [faultcode=$($x.faultcode) faultstring=$(Scrub (Esc $x.faultstring)) faultdetail=$(Scrub (Esc $x.faultdetail))]" }
  if ($x -is [AggregateException]) { $lines = @($x.InnerExceptions | ForEach-Object { $_.GetType().FullName + ': ' + (Scrub (Esc $_.Message)) } | Sort-Object); foreach ($ln in $lines) { $o += "`n    inner (order of the list is not defined; sorted here) " + $ln } }
  elseif ($x.InnerException) { $o += "`n    inner " + $x.InnerException.GetType().FullName + ': ' + (Scrub (Esc $x.InnerException.Message)) }
  $o
}
function Say($label, $text) { Write-Output ("{0} => {1}" -f $label, $text) }

function WriteCase([string]$name, [hashtable]$files) {
  $dir = Join-Path $caseRoot $name
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  foreach ($k in $files.Keys) {
    $p = Join-Path $dir $k
    New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null
    [IO.File]::WriteAllText($p, $files[$k], $utf8)
  }
  $dir
}

# SOAP envelopes for the stub connection.
function Envelope([string]$inner) {
  '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>' + $inner + '</SOAP-ENV:Body></SOAP-ENV:Envelope>'
}
function Result([string]$inner) { Envelope ('<Result>' + $inner + '</Result>') }
function Fault([string]$code, [string]$str) {
  Envelope ('<SOAP-ENV:Fault xmlns:af="http://www.aras.com/InnovatorFault"><faultcode>' + $code + '</faultcode><faultstring>' + $str + '</faultstring></SOAP-ENV:Fault>')
}
# $langs: array of @(code, name, suffix); $null code omits the element
function LangResponse($langs) {
  $items = ''
  $k = 0
  foreach ($l in $langs) {
    $k++
    $items += '<Item type="Language" id="LANG' + $k + '">'
    if ($null -ne $l[0]) { $items += '<code>' + $l[0] + '</code>' }
    if ($null -ne $l[1]) { $items += '<name>' + $l[1] + '</name>' }
    if ($l.Count -gt 2 -and $null -ne $l[2]) { $items += '<suffix>' + $l[2] + '</suffix>' }
    $items += '</Item>'
  }
  Result $items
}
$DefaultLangs = LangResponse @(@('en', 'English', ''), @('de', 'German', '_de'), @('fr', 'French', '_fr'))
