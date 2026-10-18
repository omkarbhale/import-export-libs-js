$dll = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\14.0.7\Libs.dll'
[void][Reflection.Assembly]::LoadFrom($dll)
$tmp = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\tmp5'
. (Join-Path $env:LOCALAPPDATA 'libsjs10-probe\common.ps1')
Set-Location $tmp; [Environment]::CurrentDirectory = $tmp
$mm = New-Object Aras.Tools.SolutionUpgrade.ManifestFile; [void]$mm.AddPackage('P')
$rooted = $tmp.Substring(2) + '\rooted.mf'
Say 'rooted (no drive) path' $rooted
try { $mm.Save($rooted); Say 'Save rooted-no-drive' 'ok' } catch { Say 'Save rooted-no-drive' (Ex $_.Exception) }
$mm.Save((Join-Path $tmp 'exists.mf'))
try { [void](New-Object Aras.Tools.SolutionUpgrade.ManifestFile(($tmp.Substring(2) + '\exists.mf'))); Say 'Load rooted-no-drive existing file' 'ok' } catch { Say 'Load rooted-no-drive existing file' (Ex $_.Exception) }
$w = [IO.Path]::GetFileName($tmp)
