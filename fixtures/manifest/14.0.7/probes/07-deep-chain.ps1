param([int]$N)
$dll = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\14.0.7\Libs.dll'
[void][Reflection.Assembly]::LoadFrom($dll)
$tmp = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\tmp'
$sb = New-Object Text.StringBuilder; [void]$sb.Append('<imports>')
for ($i = 0; $i -lt $N; $i++) { [void]$sb.Append("<package name=`"P$i`">"); if ($i -lt $N - 1) { [void]$sb.Append("<dependson name=`"P$($i+1)`"/>") }; [void]$sb.Append('</package>') }
[void]$sb.Append('</imports>')
$p = Join-Path $tmp ('chain' + $N + '.mf'); [IO.File]::WriteAllText($p, $sb.ToString())
$m = New-Object Aras.Tools.SolutionUpgrade.ManifestFile($p)
$names = New-Object System.Collections.ArrayList; for ($i = 0; $i -lt $N; $i++) { [void]$names.Add("P$i") }
$d = New-Object System.Xml.XmlDocument; $d.LoadXml('<AML/>')
$w = New-Object System.Collections.ArrayList
$r = $m.GetPackageNamesInImportOrder($names, $d, $w)
Write-Output ("chain $N survived: first=" + $r[0] + " last=" + $r[$r.Count-1] + " count=" + $r.Count)
