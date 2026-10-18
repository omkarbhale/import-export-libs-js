param([string]$Native, [string]$CasesFile, [string]$Out)
$ErrorActionPreference = 'Stop'
$asm = [System.Reflection.Assembly]::LoadFrom((Join-Path $Native 'Libs.dll'))
$iem = $asm.GetType('Aras.Tools.SolutionUpgrade.ImportExportManager')
$load = $iem.GetMethod('LoadPackageDom', [Type[]]@([string], [System.IO.TextWriter]))
$items = $iem.GetMethod('GetItemsFromPackageDom', [Type[]]@([System.Xml.XmlDocument]))
$root0 = Join-Path $env:LOCALAPPDATA 'libsjs-18\run'
if (Test-Path $root0) { Remove-Item -Recurse -Force $root0 }
New-Item -ItemType Directory -Path $root0 | Out-Null
$cases = [System.IO.File]::ReadAllText($CasesFile) | ConvertFrom-Json
$sb = New-Object System.Text.StringBuilder
function Esc([string]$s) { if ($s -eq $null) { return '<null>' }; return $s.Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t') }
$origCwd = [Environment]::CurrentDirectory
foreach ($c in $cases) {
  [void]$sb.AppendLine('=== ' + $c.name)
  $root = Join-Path $root0 $c.name
  New-Item -ItemType Directory -Path $root | Out-Null
  $pre = if ($c.longCreate) { '\\?\' } else { '' }
  foreach ($d in $c.dirs) { [void][System.IO.Directory]::CreateDirectory($pre + (Join-Path $root ($d -replace '/', '\'))) }
  foreach ($f in $c.files) {
    $p = $pre + (Join-Path $root ($f.path -replace '/', '\'))
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($p))
    if ($f.b64 -ne $null) { [System.IO.File]::WriteAllBytes($p, [Convert]::FromBase64String($f.b64)) } else { [System.IO.File]::WriteAllText($p, $f.text, (New-Object System.Text.UTF8Encoding($false))) }
  }
  foreach ($h in $c.hidden) { $hp = Join-Path $root ($h -replace '/', '\'); $it0 = Get-Item -Force $hp; $it0.Attributes = $it0.Attributes -bor [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::ReadOnly }
  $sp = if ($c.solutionPath -ne $null) { Join-Path $root ($c.solutionPath -replace '/', '\') } else { $root }
  if ($c.unc) { $sp = '\\localhost\' + $sp.Substring(0,1) + '$' + $sp.Substring(2) }
  $locks = @()
  foreach ($l in $c.lock) { $locks += [System.IO.File]::Open((Join-Path $root ($l -replace '/', '\')), 'Open', 'Read', 'None') }
  if ($c.trailingSlash) { $sp = $sp + '\' }
  if ($c.relative) { [Environment]::CurrentDirectory = $root; $sp = $c.relative }
  $log = New-Object System.IO.StringWriter
  try {
    $doc = $load.Invoke($null, [object[]]@([string]$sp, [System.IO.TextWriter]$log))
    [void]$sb.AppendLine('RESULT: ' + (Esc $doc.OuterXml).Replace($root, '<ROOT>'))
    $its = $items.Invoke($null, [object[]]@([System.Xml.XmlDocument]$doc))
    [void]$sb.AppendLine('ITEMS: ' + @($its).Count)
  } catch {
    $e = $_.Exception
    if ($e.InnerException -ne $null) { $e = $e.InnerException }
    [void]$sb.AppendLine('EXC: ' + $e.GetType().FullName + ' :: ' + (Esc $e.Message).Replace($root, '<ROOT>'))
    if ($e -is [Aras.Tools.SolutionUpgrade.CItemException] -or $e.GetType().Name -eq 'CItemException') {
      [void]$sb.AppendLine('  faultcode=' + $e.faultcode + ' faultstring=' + (Esc $e.faultstring).Replace($root, '<ROOT>') + ' bInnError=' + $e.bInnError)
      if ($e.InnerException -ne $null) { [void]$sb.AppendLine('  inner=' + $e.InnerException.GetType().FullName + ' :: ' + (Esc $e.InnerException.Message).Replace($root, '<ROOT>')) }
    }
  }
  foreach ($l in $locks) { $l.Close() }
  [Environment]::CurrentDirectory = $origCwd
  [void]$sb.AppendLine('LOG: ' + (Esc $log.ToString()).Replace($root, '<ROOT>'))
}
[System.IO.File]::WriteAllText($Out, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
Remove-Item -Recurse -Force $root0
