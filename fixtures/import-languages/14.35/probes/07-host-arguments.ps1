# ConsoleUpgrade.exe (14.35) argument handling for `langs`, through its private static ParseArguments. Covers IMP-601.
# Stage a copy of the toolset's ConsoleUpgrade.exe(.config) next to Libs.dll and IOM.dll in %LOCALAPPDATA%\libsjs73-probe\cu\ first
# (sha256 of the exe 237f412b4621755683e253ac68b46aae4f7524a8d051f24fac819e060a6736a9, from Desktop\Delete me\PackageImportExportUtilities35\ConsoleUpgrade).
$cu = Join-Path $env:LOCALAPPDATA 'libsjs73-probe\cu'
[void][Reflection.Assembly]::LoadFrom((Join-Path $cu 'IOM.dll'))
[void][Reflection.Assembly]::LoadFrom((Join-Path $cu 'Libs.dll'))
$asm = [Reflection.Assembly]::LoadFrom((Join-Path $cu 'ConsoleUpgrade.exe'))
$t = $asm.GetType('Aras.Tools.SolutionUpgrade.ConsoleUpgrade.ConsoleUpgrade')
$m = $t.GetMethod('ParseArguments', [Reflection.BindingFlags]'NonPublic,Static')
$io = New-Object Aras.Tools.SolutionUpgrade.IOWrapper
function Esc([string]$s) { if ($null -eq $s) { return 'null' }; '"' + $s.Replace('\', '\\').Replace("`r", '\r').Replace("`n", '\n') + '"' }
function Parse([string]$label, [string[]]$a) {
  $sw = New-Object IO.StringWriter
  $old = [Console]::Out
  [Console]::SetOut($sw)
  $rc = $null
  $argv = New-Object object[] 3
  $argv[0] = [string[]]$a
  $argv[2] = $io.psobject.BaseObject
  try { $rc = $m.Invoke($null, $argv) } catch { $rc = 'throws ' + $_.Exception.InnerException.GetType().FullName + ': ' + $_.Exception.InnerException.Message }
  [Console]::SetOut($old)
  $d = $argv[1]
  Write-Output ("{0} => rc={1} console={2}" -f $label, $rc, (Esc $sw.ToString()))
  if ($rc -eq 0 -and $d) {
    $l = $d['LANGS']
    Write-Output ('    IMPORT=' + (Esc ([string]$d['IMPORT'])) + ' LANGS=[' + ((@($l) | ForEach-Object { Esc $_ }) -join ', ') + '] count=' + @($l).Count)
  }
}
$base = @('server=http://h/i', 'database=db', 'login=admin', 'password=x', 'release=R1', 'dir=C:\')
Parse 'import without langs' ($base + @('import'))
Parse 'import langs=de,en' ($base + @('import', 'langs=de,en'))
Parse 'import langs=en,de keeps order' ($base + @('import', 'langs=en,de'))
Parse 'import langs=* alone' ($base + @('import', 'langs=*'))
Parse 'import langs=*,de (star first)' ($base + @('import', 'langs=*,de'))
Parse 'import langs=de,*,en (star not first, en present)' ($base + @('import', 'langs=de,*,en'))
Parse 'import langs=de (no en)' ($base + @('import', 'langs=de'))
Parse 'import langs=en' ($base + @('import', 'langs=en'))
Parse 'import langs=EN,de (en in any case)' ($base + @('import', 'langs=EN,de'))
Parse 'import LANGS=DE,EN (name in any case, values kept)' ($base + @('import', 'LANGS=DE,EN'))
Parse 'import langs=de,de,en (distinct)' ($base + @('import', 'langs=de,de,en'))
Parse 'import langs=de,DE,en (distinct is case sensitive)' ($base + @('import', 'langs=de,DE,en'))
Parse 'import langs=,de,,en, (empty entries dropped)' ($base + @('import', 'langs=,de,,en,'))
Parse 'import langs=,, (only separators)' ($base + @('import', 'langs=,,'))
Parse 'import langs= (nothing after =)' ($base + @('import', 'langs='))
Parse 'import langs bare word' ($base + @('import', 'langs'))
Parse 'import langs with space after comma' ($base + @('import', 'langs=de, en'))
Parse 'import langs quoted' ($base + @('import', "langs='de,en'"))
Parse 'import langs=*,* (star twice)' ($base + @('import', 'langs=*,*'))
Parse 'import langs=de,en last one wins' ($base + @('import', 'langs=fr,en', 'langs=de,en'))
Parse 'export (the default operation) langs=de (no en)' ($base + @('langs=de'))
Parse 'lpimport langs=de (no en needed)' (@('server=http://h/i', 'database=db', 'login=admin', 'password=x', 'release=R1', 'lpimport', 'lppath=C:\lp\c.xml', 'lppackage=PKG', 'langs=de'))
Parse 'lpimport langs=* ' (@('server=http://h/i', 'database=db', 'login=admin', 'password=x', 'release=R1', 'lpimport', 'lppath=C:\lp\c.xml', 'lppackage=PKG', 'langs=*'))
Parse 'lpimport without langs' (@('server=http://h/i', 'database=db', 'login=admin', 'password=x', 'release=R1', 'lpimport', 'lppath=C:\lp\c.xml', 'lppackage=PKG'))
