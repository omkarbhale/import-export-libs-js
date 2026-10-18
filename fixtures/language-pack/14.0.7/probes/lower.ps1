# Records the BMP code units whose .NET Framework 4.8 String.ToLower(CultureInfo.InvariantCulture) mapping differs
# from themselves (the call GetRequestedLanguages and GetItemTypes make). Writes "FROM TO" hex lines.
param([string]$Out = (Join-Path $env:LOCALAPPDATA 'libsjs23-probe\lower.txt'))
$inv = [Globalization.CultureInfo]::InvariantCulture
$sb = New-Object System.Text.StringBuilder
for ($i = 0; $i -le 0xFFFF; $i++) {
  if ($i -ge 0xD800 -and $i -le 0xDFFF) { continue }
  $c = [string][char]$i
  $l = $c.ToLower($inv)
  if ($l -cne $c) { [void]$sb.AppendLine(('{0:X4} {1:X4}' -f $i, [int]$l[0])) }
}
# supplementary planes: a surrogate pair is mapped as one code point in a whole-string call
for ($cp = 0x10000; $cp -le 0x1FFFF; $cp++) { $s = [char]::ConvertFromUtf32($cp); $l = $s.ToLower($inv); if ($l -cne $s) { [void]$sb.AppendLine(('S {0:X} {1:X}' -f $cp, [char]::ConvertToUtf32($l, 0))) } }
# context: no final-sigma rule, no special casing, no length change
foreach ($s in "$([char]0x130)", "I$([char]0x307)", "$([char]0x3A3)A$([char]0x3A3)", "A$([char]0x3A3)", "$([char]0x1E9E)") {
  [void]$sb.AppendLine(('W {0} => {1}' -f (($s.ToCharArray() | ForEach-Object { '{0:X4}' -f [int]$_ }) -join ','), (($s.ToLower($inv).ToCharArray() | ForEach-Object { '{0:X4}' -f [int]$_ }) -join ',')))
}
[IO.File]::WriteAllText($Out, $sb.ToString())
