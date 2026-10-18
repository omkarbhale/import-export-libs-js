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
function Ex($e) {
  $x = $e
  while ($x.InnerException -and ($x -is [System.Reflection.TargetInvocationException] -or $x -is [System.Management.Automation.MethodInvocationException])) { $x = $x.InnerException }
  ($x.GetType().FullName) + ': ' + (Esc $x.Message)
}
function Say($label, $text) { Write-Output ("{0} => {1}" -f $label, $text) }
