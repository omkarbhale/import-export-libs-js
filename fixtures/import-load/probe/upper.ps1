param([string]$Out)
$sb = New-Object System.Text.StringBuilder
for ($i = 0; $i -le 0xFFFF; $i++) {
  if ($i -ge 0xD800 -and $i -le 0xDFFF) { continue }
  $c = [string][char]$i
  $u = $c.ToUpperInvariant()
  if ($u -cne $c) { [void]$sb.AppendLine(('{0:X4} {1:X4}' -f $i, [int]$u[0])) }
}
# astral: Deseret
foreach ($cp in 0x10428, 0x10400, 0x1E922) { $s = [char]::ConvertFromUtf32($cp); $u = $s.ToUpperInvariant(); [void]$sb.AppendLine(('S {0:X} {1}' -f $cp, (($u.ToCharArray() | % { '{0:X4}' -f [int]$_ }) -join ','))) }
[System.IO.File]::WriteAllText($Out, $sb.ToString())
