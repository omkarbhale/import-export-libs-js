$dll = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\14.0.7\Libs.dll'
[void][Reflection.Assembly]::LoadFrom($dll)
$tmp = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\tmp5'
. (Join-Path $env:LOCALAPPDATA 'libsjs10-probe\common.ps1')
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Set-Location $tmp
[Environment]::CurrentDirectory = $tmp
$NS = [NullString]::Value
function NewMf { $m = New-Object Aras.Tools.SolutionUpgrade.ManifestFile; [void]$m.AddPackage('P'); $m }
function TrySave($label, $path) {
  $m = NewMf
  try { $m.Save($path); Say "Save $label" 'ok' } catch { Say "Save $label" (Ex $_.Exception) }
}
function TryLoad($label, $path) {
  try { $m = New-Object Aras.Tools.SolutionUpgrade.ManifestFile($path); Say "Load $label" ('ok names=' + (@($m.GetAllPackageNames()) -join ',')) } catch { Say "Load $label" (Ex $_.Exception) }
}
TrySave 'relative' 'rel.mf'
Say 'rel exists in cwd' (Test-Path (Join-Path $tmp 'rel.mf'))
TryLoad 'relative' 'rel.mf'
TrySave 'abs' (Join-Path $tmp 'abs.mf')
TrySave 'fwd slashes' (($tmp -replace '\\','/') + '/fwd.mf')
TrySave 'prefix \\?\' ('\\?\' + $tmp + '\pre.mf')
TryLoad 'prefix \\?\' ('\\?\' + $tmp + '\pre.mf')
Say 'pre exists' (Test-Path (Join-Path $tmp 'pre.mf'))
$unc = '\\localhost\' + ($tmp.Substring(0,1)) + '$' + $tmp.Substring(2) + '\unc.mf'
Say 'unc path' $unc
Say 'unc reachable by .NET' ([IO.Directory]::Exists([IO.Path]::GetDirectoryName($unc)))
TrySave 'unc' $unc
TryLoad 'unc' $unc
Say 'unc exists (via abs)' (Test-Path (Join-Path $tmp 'unc.mf'))
TrySave 'question marks' ('???' + $tmp + '\qq.mf')
Say 'qq exists' (Test-Path (Join-Path $tmp 'qq.mf'))
# long path
$base = $tmp
$seg = 'd' * 50
$p = $base
while (($p.Length + 60) -lt 262) { $p = $p + '\' + $seg }
foreach ($len in 240, 250, 253, 254, 255, 256, 259) {
  # build a path of exactly $len characters total ending in \x.mf
  $dir = $base
  while ($dir.Length -lt ($len - 5 - 51)) { $dir = $dir + '\' + $seg }
  $rest = $len - 5 - $dir.Length - 1   # name part before \x.mf , preceded by '\'
  if ($rest -gt 0) { $dir = $dir + '\' + ('e' * ($rest)) }
  $full = $dir + '\x.mf'
  if ($full.Length -ne $len) { Say "len $len" ("could not build, got " + $full.Length); continue }
  [void][IO.Directory]::CreateDirectory('\\?\' + $dir)
  TrySave ("len=$len") $full
  Say ("len=$len exists") ([IO.File]::Exists('\\?\' + $full))
  TryLoad ("len=$len") $full
}
Say 'target framework / long path quirk' ([AppContext]::TargetFrameworkName)
