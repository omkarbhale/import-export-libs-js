# Replays the enumeration cases on the real .NET Framework XmlDocument, as ExportProc's
# RemoveReferencesToAnotherPackages does: SelectNodes consumed by foreach while nodes are removed.
# Usage (Windows PowerShell 5.1): record.ps1 -Mode relationships|methods -In <cases.tsv> -Out <results.tsv>
param([Parameter(Mandatory)][ValidateSet('relationships','methods')][string] $Mode, [Parameter(Mandatory)][string] $In, [Parameter(Mandatory)][string] $Out)
$sw = New-Object System.IO.StreamWriter($Out, $false, (New-Object System.Text.UTF8Encoding($false)))
$sw.NewLine = "`n"
foreach ($line in [System.IO.File]::ReadAllLines($In)) {
  $f = $line.Split("`t")
  $d = New-Object System.Xml.XmlDocument
  $d.LoadXml($f[0])
  $remove = @{}
  if ($f[1]) { foreach ($k in $f[1].Split(',')) { $remove[$k] = 1 } }
  $seen = New-Object System.Collections.ArrayList
  if ($Mode -eq 'relationships') {
    foreach ($n in $d.SelectNodes('.//Relationships/Item')) {
      [void]$seen.Add($n.GetAttribute('k'))
      if ($remove.ContainsKey($n.GetAttribute('k'))) {
        $p = $n.ParentNode
        [void]$p.RemoveChild($n)
        if (-not $p.HasChildNodes) { [void]$p.ParentNode.RemoveChild($p) }
      }
    }
  } else {
    foreach ($n in $d.SelectNodes(".//Item[@type='Method' and @action='get']")) {
      [void]$seen.Add($n.GetAttribute('k'))
      $parent = $n.ParentNode
      $grand = $parent.ParentNode
      if ($grand -ne $null -and $remove.ContainsKey($n.GetAttribute('k'))) { [void]$grand.RemoveChild($parent) }
    }
  }
  $sw.WriteLine(($seen -join ',') + "`t" + $d.OuterXml)
}
$sw.Close()
