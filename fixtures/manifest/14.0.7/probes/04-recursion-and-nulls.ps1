param([string]$Mode = '', [int]$N = 0)
$dll = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\14.0.7\Libs.dll'
[void][Reflection.Assembly]::LoadFrom($dll)
$tmp = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\tmp'
. (Join-Path $env:LOCALAPPDATA 'libsjs10-probe\common.ps1')
function Mf([string]$xml) {
  $p = Join-Path $tmp ('m' + [guid]::NewGuid().ToString('N') + '.mf')
  [IO.File]::WriteAllText($p, $xml, (New-Object Text.UTF8Encoding($false)))
  New-Object Aras.Tools.SolutionUpgrade.ManifestFile($p)
}
$d = New-Object System.Xml.XmlDocument; $d.LoadXml('<AML/>')
if ($Mode -eq 'cycle') {
  # C>A, A>B, B>A : start C, cycle A<->B not through C
  $m = Mf '<imports><package name="A"><dependson name="B"/></package><package name="B"><dependson name="A"/></package><package name="C"><dependson name="A"/></package></imports>'
  $w = New-Object System.Collections.ArrayList
  $r = $m.GetPackageNamesInImportOrder(@('C','A','B'), $d, $w)
  Write-Output ('survived: ' + (@($r) -join ','))
}
if ($Mode -eq 'self') {
  # A>B, B>B
  $m = Mf '<imports><package name="A"><dependson name="B"/></package><package name="B"><dependson name="B"/></package></imports>'
  $w = New-Object System.Collections.ArrayList
  $r = $m.GetPackageNamesInImportOrder(@('A','B'), $d, $w)
  Write-Output ('survived: ' + (@($r) -join ',') + ' warnings=' + ($w -join '|'))
}
if ($Mode -eq 'chain') {
  # P0>P1>...>P(N-1), import in order P0..P(N-1)
  $sb = New-Object Text.StringBuilder; [void]$sb.Append('<imports>')
  for ($i = 0; $i -lt $N; $i++) { [void]$sb.Append("<package name=`"P$i`">"); if ($i -lt $N - 1) { [void]$sb.Append("<dependson name=`"P$($i+1)`"/>") }; [void]$sb.Append('</package>') }
  [void]$sb.Append('</imports>')
  $m = Mf $sb.ToString()
  $names = 0..($N - 1) | ForEach-Object { "P$_" }
  $w = New-Object System.Collections.ArrayList
  $r = $m.GetPackageNamesInImportOrder($names, $d, $w)
  Write-Output ('survived chain ' + $N + ': first=' + @($r)[0] + ' last=' + @($r)[-1] + ' count=' + @($r).Count)
}
if ($Mode -eq 'nulls') {
  $m = Mf '<imports><package name="A"/></imports>'
  $w = New-Object System.Collections.ArrayList
  try { [void]$m.GetPackageNamesInImportOrder($null, $d, $w) } catch { Say 'imported=null' (Ex $_.Exception) }
  $al = New-Object System.Collections.ArrayList; [void]$al.Add($null)
  try { [void]$m.GetPackageNamesInImportOrder($al, $d, $w) } catch { Say 'imported=[null]' (Ex $_.Exception) }
  $m = Mf '<imports><package name="A"><dependson name="X"/></package></imports>'
  try { [void]$m.GetPackageNamesInImportOrder(@('A'), $d, $null) } catch { Say 'warnings=null, warn path' (Ex $_.Exception) }
  try { [void]$m.GetPackageNamesInImportOrder(@('A'), $null, $w) } catch { Say 'db=null, db path' (Ex $_.Exception) }
  $m = Mf '<imports><package name="A"/></imports>'
  try { $r = $m.GetPackageNamesInImportOrder(@('A'), $null, $null); Say 'db=null warnings=null no-warn path' (@($r) -join ',') } catch { Say 'db=null no-warn' (Ex $_.Exception) }
}
