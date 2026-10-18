param([string]$Work)
Add-Type -TypeDefinition @"
using System; using System.IO; using System.Text; using System.Collections.Generic;
public static class UpProbe {
  public static string Run(string dir) {
    if (Directory.Exists(dir)) Directory.Delete(dir, true);
    Directory.CreateDirectory(dir);
    var sb = new StringBuilder(); int skipped = 0, created = 0;
    var bad = new HashSet<char>(Path.GetInvalidFileNameChars());
    for (int c = 0x20; c <= 0xFFFF; c++) {
      char ch = (char)c;
      if (bad.Contains(ch) || (c >= 0xD800 && c <= 0xDFFF)) { skipped++; continue; }
      string name = "u" + ch + ".xml";
      string path = Path.Combine(dir, name);
      try {
        var found = Directory.GetFiles(dir, name);
        if (found.Length > 0) { sb.Append(c.ToString("X4")).Append(" ~ ").Append(((int)Path.GetFileName(found[0])[1]).ToString("X4")).Append('\n'); continue; }
        File.WriteAllText(path, "x"); created++;
      } catch (Exception e) { sb.Append(c.ToString("X4")).Append(" ERR ").Append(e.GetType().Name).Append('\n'); }
    }
    Directory.Delete(dir, true);
    return "created=" + created + " skipped=" + skipped + "\n" + sb.ToString();
  }
}
"@
[UpProbe]::Run((Join-Path $Work 'up'))
