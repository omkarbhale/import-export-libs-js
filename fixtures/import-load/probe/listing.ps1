param([string]$Names, [string]$Out)
$ErrorActionPreference='Stop'
$dir = Join-Path $env:LOCALAPPDATA 'libsjs-18-listing-probe'
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
New-Item -ItemType Directory -Path $dir | Out-Null
$lists = [System.IO.File]::ReadAllText($Names) | ConvertFrom-Json
$sb = New-Object System.Text.StringBuilder
foreach ($cps in $lists) {
  $n = ''
  foreach ($cp in $cps) { $n += [char]::ConvertFromUtf32([int]$cp) }
  try { [System.IO.File]::WriteAllText((Join-Path $dir ($n + '.xml')), 'x') ; [void][System.IO.Directory]::CreateDirectory((Join-Path $dir ('d_' + $n))) } catch { [void]$sb.AppendLine("skip: " + $_.Exception.Message) }
}
$files = [System.IO.Directory]::GetFiles($dir, '*.xml') | ForEach-Object { [System.IO.Path]::GetFileName($_) }
$dirs = [System.IO.Directory]::GetDirectories($dir) | ForEach-Object { [System.IO.Path]::GetFileName($_) }
[void]$sb.AppendLine('FILES')
foreach ($f in $files) { [void]$sb.AppendLine((($f.ToCharArray() | ForEach-Object { '{0:X4}' -f [int]$_ }) -join ' ')) }
[void]$sb.AppendLine('DIRS')
foreach ($f in $dirs) { [void]$sb.AppendLine((($f.ToCharArray() | ForEach-Object { '{0:X4}' -f [int]$_ }) -join ' ')) }
[System.IO.File]::WriteAllText($Out, $sb.ToString())
Remove-Item -Recurse -Force $dir
