param([string]$Names, [string]$Out)
$ci = [System.Globalization.CultureInfo]::InvariantCulture.CompareInfo
$lists = [System.IO.File]::ReadAllText($Names) | ConvertFrom-Json
$sb = New-Object System.Text.StringBuilder
foreach ($cps in $lists) {
  $s = ''
  foreach ($cp in $cps) { $s += [char]::ConvertFromUtf32([int]$cp) }
  $k = $ci.GetSortKey($s, [System.Globalization.CompareOptions]::None).KeyData
  [void]$sb.AppendLine((($cps | % { '{0:X}' -f $_ }) -join ',') + ' ' + (($k | % { '{0:X2}' -f $_ }) -join ''))
}
[System.IO.File]::WriteAllText($Out, $sb.ToString())
