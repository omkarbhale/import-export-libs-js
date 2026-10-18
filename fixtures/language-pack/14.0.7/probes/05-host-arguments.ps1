# ConsoleUpgrade.exe (14.0.7) argument handling for lpimport, driven through its private static ParseArguments.
# Stage a copy of the toolset's ConsoleUpgrade.exe(.config) next to Libs.dll and IOM.dll in
# %LOCALAPPDATA%\libsjs23-probe\cu\ first. Covers LP-002.
$cu = Join-Path $env:LOCALAPPDATA 'libsjs23-probe\cu'
[void][Reflection.Assembly]::LoadFrom((Join-Path $cu 'IOM.dll'))
[void][Reflection.Assembly]::LoadFrom((Join-Path $cu 'Libs.dll'))
$asm = [Reflection.Assembly]::LoadFrom((Join-Path $cu 'ConsoleUpgrade.exe'))
$t = $asm.GetType('Aras.Tools.SolutionUpgrade.ConsoleUpgrade.ConsoleUpgrade')
$m = $t.GetMethod('ParseArguments', [Reflection.BindingFlags]'NonPublic,Static')
$io = New-Object Aras.Tools.SolutionUpgrade.IOWrapper
function Esc([string]$s) { '"' + $s.Replace('\', '\\').Replace("`r", '\r').Replace("`n", '\n') + '"' }
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
  $out = $sw.ToString()
  Write-Output ("{0} => rc={1} console={2}" -f $label, $rc, (Esc $out))
  if ($rc -eq 0 -and $d) {
    $keys = 'IMPORT','RELEASE','LPPATH','LPPACKAGE','LPDEBUG','DIR','MFFILE','MERGE','FASTMODE','DESCRIPTION','VERBOSE','TIMEOUT'
    Write-Output ('    ' + (($keys | ForEach-Object { $_ + '=' + (Esc ([string]$d[$_])) }) -join ' '))
  }
}
$base = @('server=http://h/i', 'database=db', 'login=admin', 'password=x')
Parse 'lpimport complete' ($base + @('lpimport', 'release=R1', 'lppath=C:\lp\ImportConfig.xml', 'lppackage=PKG'))
Parse 'lpimport with lpdebug' ($base + @('lpimport', 'release=R1', 'lppath=C:\lp\c.xml', 'lppackage=PKG', 'lpdebug=true'))
Parse 'lpdebug not a bool' ($base + @('lpimport', 'release=R1', 'lppath=C:\lp\c.xml', 'lppackage=PKG', 'lpdebug=yes'))
Parse 'lpdebug bare word' ($base + @('lpimport', 'release=R1', 'lppath=C:\lp\c.xml', 'lppackage=PKG', 'lpdebug'))
Parse 'lpdebug uppercase value' ($base + @('lpimport', 'release=R1', 'lppath=C:\lp\c.xml', 'lppackage=PKG', 'LPDEBUG=TRUE'))
Parse 'all options' ($base + @('LPIMPORT', 'release=R1', 'lppath=C:\lp\c.xml', 'lppackage=PKG', 'merge', 'fastmode', 'description=foxwords', 'dir=C:\x', 'mffile=m.mf', 'verbose'))
Parse 'quoted values' ($base + @('lpimport', "release='R 1'", "lppath='C:\lp dir\c.xml'", "lppackage='PKG'"))
Parse 'missing release' ($base + @('lpimport', 'lppath=C:\lp\c.xml', 'lppackage=PKG'))
Parse 'missing lppath' ($base + @('lpimport', 'release=R1', 'lppackage=PKG'))
Parse 'missing lppackage' ($base + @('lpimport', 'release=R1', 'lppath=C:\lp\c.xml'))
Parse 'missing both lp args' ($base + @('lpimport', 'release=R1'))
Parse 'empty lppath value' ($base + @('lpimport', 'release=R1', 'lppath=', 'lppackage=PKG'))
Parse 'path with equals sign' ($base + @('lpimport', 'release=R1', 'lppath=C:\a=b\c.xml', 'lppackage=PKG'))
Parse 'unknown option' ($base + @('lpimport', 'release=R1', 'lppath=C:\lp\c.xml', 'lppackage=PKG', 'colour=red'))
Parse 'lp options without lpimport (import)' ($base + @('import', 'release=R1', 'dir=C:\x', 'lppath=C:\lp\c.xml', 'lppackage=PKG'))
Parse 'password empty' (@('server=http://h/i', 'database=db', 'login=admin', 'password=', 'lpimport', 'release=R1', 'lppath=C:\lp\c.xml', 'lppackage=PKG'))
Parse 'both import and lpimport (last wins)' ($base + @('import', 'lpimport', 'release=R1', 'lppath=C:\lp\c.xml', 'lppackage=PKG'))
Parse 'lpimport then import (last wins)' ($base + @('lpimport', 'import', 'release=R1', 'dir=C:\nonexistent-libsjs23', 'lppath=C:\lp\c.xml', 'lppackage=PKG'))
