$dll = Join-Path $env:LOCALAPPDATA 'libsjs10-probe\14.0.7\Libs.dll'
[void][Reflection.Assembly]::LoadFrom($dll)
Add-Type -ReferencedAssemblies $dll -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Text;
using Aras.Tools.SolutionUpgrade;
public static class P11 {
  static string R(List<int> l) {
    var sb = new StringBuilder("["); int i = 0;
    while (i < l.Count) { int j = i; while (j + 1 < l.Count && l[j + 1] == l[j] + 1) j++;
      if (i > 0) sb.Append(',');
      sb.Append("[" + l[i] + "," + l[j] + "]"); i = j + 1; }
    return sb.Append("]").ToString();
  }
  public static string Run() {
    string pfx = "com.aras.innovator.";
    var ign = new List<int>(); var afterDot = new List<int>(); var dotEq = new List<int>(); var nEq = new List<int>(); var lead = new List<int>();
    var solAfter = new List<int>();
    for (int cp = 0; cp <= 0x10FFFF; cp++) {
      if (cp >= 0xD800 && cp <= 0xDFFF) continue;
      string s = char.ConvertFromUtf32(cp);
      if (ExportImportBase.IsCorePackage("com.aras" + s + ".innovator.x")) ign.Add(cp);
      if (ExportImportBase.IsCorePackage(s + "com.aras.innovator.x")) lead.Add(cp);
      if (!ExportImportBase.IsCorePackage(pfx + s + "x")) afterDot.Add(cp);
      if (s != "." && ExportImportBase.IsCorePackage("com" + s + "aras.innovator.x")) dotEq.Add(cp);
      if (s != "n" && ExportImportBase.IsCorePackage("com.aras.innovator".Substring(0, 13) + "n" + s + "ovator.x")) nEq.Add(cp);
      // after the final dot of the solution prefix: a mark there makes "com.aras.innovator.solution"+s not a solution prefix
      if (ExportImportBase.IsCorePackage(pfx + "solution" + s + "x") ) solAfter.Add(cp);
    }
    return "{\"ignorable\":" + R(ign) + ",\"leadingSame\":" + (R(ign) == R(lead)) .ToString().ToLower() + ",\"afterPrefixBreaks\":" + R(afterDot) + ",\"equalsDot\":" + R(dotEq) + ",\"equalsNAfterN\":" + R(nEq) + ",\"solutionPlusSoftHyphenClass\":" + R(solAfter) + "}";
  }
}
'@
Write-Output ([P11]::Run())
