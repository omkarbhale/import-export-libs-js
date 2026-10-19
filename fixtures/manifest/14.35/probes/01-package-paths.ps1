$ErrorActionPreference = 'Continue'
$dll = Join-Path $env:LOCALAPPDATA 'libsjs60-probe\14.35\Libs.dll'
[void][Reflection.Assembly]::LoadFrom($dll)
$ns = 'Aras.Tools.SolutionUpgrade'
$SH=[string][char]0xAD; $ZW=[string][char]0x200B; $CM=[string][char]0x301; $NUL=[string][char]0
$tmp = Join-Path $env:LOCALAPPDATA 'libsjs60-probe\tmp'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

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

# ---- 1. GetPackagePath table
Write-Output '## 1 GetPackagePath'
$doc = New-Object System.Xml.XmlDocument
$cases = @(
  @('com.aras.innovator.core', '.\', 'C:\m'),
  @('com.aras.innovator.core', '', 'C:\m'),
  @('com.aras.innovator.core', '   ', 'C:\m'),
  @('com.aras.innovator.core', $null, 'C:\m'),
  @('My.Pkg', 'Pkg\Import', 'C:\m'),
  @('My.Pkg', 'Pkg\Import', 'C:\m\'),
  @('My.Pkg', 'Pkg\Import', 'C:/m'),
  @('My.Pkg', 'Pkg\Import', 'C:/m/'),
  @('My.Pkg', 'Pkg/Import', 'C:\m'),
  @('My.Pkg', 'C:\abs\x', 'C:\m'),
  @('My.Pkg', 'C:\abs\x\', 'C:\m'),
  @('My.Pkg', '\\srv\share\x', 'C:\m'),
  @('My.Pkg', '\rooted', 'C:\m'),
  @('My.Pkg', '/rooted', 'C:\m'),
  @('My.Pkg', 'D:rel', 'C:\m'),
  @('My.Pkg', ' x ', 'C:\m'),
  @('My.Pkg', 'a"b', 'C:\m'),
  @('My.Pkg', 'a|b', 'C:\m'),
  @('My.Pkg', "a`tb", 'C:\m'),
  @('My.Pkg', 'a?b*c', 'C:\m'),
  @('My.Pkg', 'x', 'C:\m"'),
  @('My.Pkg', 'x', ''),
  @('My.Pkg', 'x', $null),
  @('My.Pkg', 'x', 'C:'),
  @('My.Pkg', 'x', '/home/u/m'),
  @('My.Pkg', 'x', '\\srv\share\m'),
  @('My.Pkg', '..\y', 'C:\m'),
  @('com.aras.defaults.Foo.Bar', '.\', 'C:\m'),
  @('com.aras.defaults.Foo.Bar', '', 'C:\m'),
  @('COM.ARAS.DEFAULTS.Foo', '.\', 'C:\m'),
  @('com.aras.innovator.core', 'C:\abs', 'C:\m'),
  @('com.aras.innovator.core', 'Imp\', 'C:\m'),
  @('com.aras.innovator.', '.\', 'C:\m'),
  @('com.aras.innovator', '.\', 'C:\m'),
  @('COM.ARAS.INNOVATOR.core', '.\', 'C:\m'),
  @('com.aras.innovator.solution.PLM', '.\', 'C:\m'),
  @('com.aras.innovator.solution', '.\', 'C:\m'),
  @('com.aras.innovator.solutionX.PLM', '.\', 'C:\m'),
  @('com.aras.innovator.Solution.PLM', '.\', 'C:\m'),
  @('com.aras.defaults', '.\', 'C:\m'),
  @('com.aras.defaults.', '.\', 'C:\m'),
  @('com.aras.innovator.a..b', '.\', 'C:\m'),
  @(('com.aras.innovator.' + $SH + 'x'), '.\', 'C:\m'),
  @('', '.\', 'C:\m'),
  @('com.aras.innovator.core', 'x/', 'C:\m'),
  @('com.aras.innovator.core', 'C:', 'C:\m'),
  @('com.aras.innovator.core', '/', 'C:\m'),
  @('com.aras.innovator.core', 'Imp\\', 'C:\m'),
  @('com.aras.innovator.core', '.', 'C:\m'),
  @('com.aras.innovator.core', 'x', 'C:\m\'),
  @('com.aras.innovator.core', 'x', ''),
  @('com.aras.innovator.core', '', ''),
  @('com.aras.innovator.core', '', 'C:'),
  @('com.aras.innovator.core', '', 'C:/m/'),
  @('com.aras.innovator.core', '', $null),
  @('com.aras.innovator.core', 'a"b', 'C:\m'),
  @('com.aras.innovator.core', 'C:\a"b', 'C:\m'),
  @('com.aras.innovator.a"b', '.\', 'C:\m'),
  @('com.aras.innovator.a<b', 'C:\abs', 'C:\m'),
  @('com.aras.innovator.a|b', '.\', 'C:\m'),
  @(('com.aras.innovator.a' + [char]9 + 'b'), '.\', 'C:\m'),
  @('com.aras.innovator.a?b*c', '.\', 'C:\m'),
  @('com.aras.innovator.a/b', '.\', 'C:\m'),
  @('com.aras.innovator.a\b', '.\', 'C:\m'),
  @('com.aras.innovator.a..b', 'C:\abs', 'C:\m'),
  @('com.aras.innovator.', 'C:\abs\', 'C:\m'),
  @('com.aras.defaults.', '.', 'C:\m'),
  @('com.aras.defaults.Foo', '\\srv\share\x', 'C:\m'),
  @('com.aras.defaults.Foo', '\\srv\share\x\', 'C:\m'),
  @('com.aras.defaults.Foo', 'D:rel', 'C:\m'),
  @('com.aras.defaults.Foo', 'rel:', 'C:\m'),
  @('com.aras.innovator.core', 'x', '/home/u/m'),
  @('com.aras.innovator.core', 'a b', 'C:\m')
)
foreach ($c in $cases) {
  $el = $doc.CreateElement('package')
  $el.SetAttribute('name', $c[0])
  if ($null -ne $c[1]) { $el.SetAttribute('path', $c[1]) }
  try {
    $r = [Aras.Tools.SolutionUpgrade.ExportImportBase]::GetPackagePath($el, $c[2])
    Say ("name={0} path={1} folder={2}" -f (Esc $c[0]), (Esc $c[1]), (Esc $c[2])) (Esc $r)
  } catch { Say ("name={0} path={1} folder={2}" -f (Esc $c[0]), (Esc $c[1]), (Esc $c[2])) (Ex $_.Exception) }
}
# null packageNode
try { [void][Aras.Tools.SolutionUpgrade.ExportImportBase]::GetPackagePath($null, 'C:\m') } catch { Say 'packageNode=null' (Ex $_.Exception) }

# ---- 2. IsStandardPackage / core / default
Write-Output '## 2 IsStandard'
$names = @('com.aras.innovator.', 'com.aras.innovator.x', 'com.aras.innovator', 'COM.ARAS.INNOVATOR.x', 'com.aras.innovator.solution.', 'com.aras.innovator.solution.x', 'com.aras.innovator.Solution.x', 'com.aras.defaults.', 'COM.ARAS.DEFAULTS.X', 'com.aras.defaults', 'Com.Aras.Defaults.x', ' com.aras.innovator.x',
  ('com.aras.innovator.' + $SH + 'x'), ('com.aras.innovator' + $SH + '.x'), ('com.ar' + $ZW + 'as.innovator.x'), ('com.aras.innovator.' + $ZW + 'solution.x'), ('com.aras.innovator.solution' + $ZW + '.x'), ('com.aras.innovator.' + $CM + 'x'), ('com.aras.innovator.' + $NUL + 'x'), ('com' + $NUL + '.aras.innovator.x'), ($SH + 'com.aras.innovator.x'), ('com.aras.innovator.solution.' + $SH), ('com.aras.innovator.solutio' + $SH + 'n.x'), ('com.aras.defaults' + $SH + '.x'), 'com.aras.innovator.solutiOn.x', ('com.aras.innovator.solut' + [char]0x131 + 'on.x'), 'COM.ARAS.INNOVATOR.SOLUTION.x', 'Com.aras.innovator.x', ('com.aras.innovator.' + $SH), ('com.aras.defaults.' + $SH), ('com.aras.innovator.solution.' + $ZW + 'x'))
foreach ($n in $names) {
  $a = [Aras.Tools.SolutionUpgrade.ExportImportBase]::IsStandardPackage($n)
  $b = [Aras.Tools.SolutionUpgrade.ExportImportBase]::IsCorePackage($n)
  $d = [Aras.Tools.SolutionUpgrade.ExportImportBase]::IsDefaultPackage($n)
  Say ("name={0}" -f (Esc $n)) ("standard={0} core={1} default={2}" -f $a, $b, $d)
}
try { [void][Aras.Tools.SolutionUpgrade.ExportImportBase]::IsStandardPackage($null) } catch { Say 'IsStandardPackage(null)' (Ex $_.Exception) }
try { [void][Aras.Tools.SolutionUpgrade.ExportImportBase]::IsCorePackage($null) } catch { Say 'IsCorePackage(null)' (Ex $_.Exception) }
try { [void][Aras.Tools.SolutionUpgrade.ExportImportBase]::IsDefaultPackage($null) } catch { Say 'IsDefaultPackage(null)' (Ex $_.Exception) }
Say 'culture' ([System.Threading.Thread]::CurrentThread.CurrentCulture.Name + ' / ' + [System.Threading.Thread]::CurrentThread.CurrentUICulture.Name)
