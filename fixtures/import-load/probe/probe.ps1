param([string]$Xsl, [string]$CasesFile, [string]$Out, [switch]$Raw)
$ErrorActionPreference = 'Stop'
$xslText = [System.IO.File]::ReadAllText($Xsl)
$t = New-Object System.Xml.Xsl.XslCompiledTransform
$rd = New-Object System.Xml.XmlTextReader((New-Object System.IO.StringReader($xslText)))
$t.Load($rd)
$cases = [System.IO.File]::ReadAllText($CasesFile) | ConvertFrom-Json
$sb = New-Object System.Text.StringBuilder
foreach ($c in $cases) {
  [void]$sb.AppendLine("=== " + $c.name)
  try {
    $cat = New-Object System.Text.StringBuilder
    $i = 0
    foreach ($p in $c.parts) {
      $i++
      $d = New-Object System.Xml.XmlDocument
      $d.LoadXml($p)
      $n = $d.SelectSingleNode("AML/Item")
      if ($n -eq $null) { [void]$sb.AppendLine("skip part $i"); continue }
      $n.SetAttribute("tempKeyName", "k$i")
      $n.SetAttribute("tempFullName", "f$i")
      [void]$cat.Append($d.OuterXml)
    }
    $doc = New-Object System.Xml.XmlDocument
    $doc.LoadXml("<AML>" + $cat.ToString() + "</AML>")
    $sw = New-Object System.IO.StringWriter([System.Globalization.CultureInfo]::InvariantCulture)
    $t.Transform($doc, $null, $sw)
    $text = $sw.ToString().Replace('xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"', '')
    $doc.LoadXml($text)
    if ($Raw -or $c.raw) { [void]$sb.AppendLine("RAW: " + $text.Replace("`r", '\r').Replace("`n", '\n')) }
    foreach ($it in $doc.SelectNodes("AML/Item")) {
      [void]$sb.AppendLine(("{0}|{1}|{2}|{3}" -f $it.GetAttribute("type"), $it.GetAttribute("action"), $it.GetAttribute("id"), $it.GetAttribute("tempKeyName")))
    }
  } catch { [void]$sb.AppendLine("EXC: " + $_.Exception.GetType().FullName + ": " + $_.Exception.Message) }
}
[System.IO.File]::WriteAllText($Out, $sb.ToString())
