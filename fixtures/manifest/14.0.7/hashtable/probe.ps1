# Runs Hashtable probe cases inside Windows PowerShell 5.1 via Add-Type C#,
# the same way aras-harness scripts/export.ps1 builds the engine's input table.
# Strings travel as base64 of raw UTF-16LE code units (lone surrogates and NULs survive).
param([Parameter(Mandatory)][string]$InPath, [Parameter(Mandatory)][string]$OutPath)
$ErrorActionPreference = 'Stop'
$code = @"
using System;
using System.Collections;
using System.IO;
using System.Text;

public static class HtProbe {
    static string Dec(string b64) {
        byte[] b = Convert.FromBase64String(b64);
        char[] c = new char[b.Length / 2];
        for (int i = 0; i < c.Length; i++) c[i] = (char)(b[2 * i] | (b[2 * i + 1] << 8));
        return new string(c);
    }
    static string Enc(string s) {
        byte[] b = new byte[s.Length * 2];
        for (int i = 0; i < s.Length; i++) { b[2 * i] = (byte)(s[i] & 0xFF); b[2 * i + 1] = (byte)(s[i] >> 8); }
        return Convert.ToBase64String(b);
    }
    static string Dump(Hashtable t) {
        var sb = new StringBuilder();
        IDictionaryEnumerator e = t.GetEnumerator();
        while (e.MoveNext()) {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(Enc((string)e.Key)).Append(':').Append(e.Value is Hashtable ? "T" : e.Value.ToString());
        }
        return sb.ToString();
    }
    public static string Env() {
        return "is64=" + Environment.Is64BitProcess + " clr=" + Environment.Version + " ptr=" + IntPtr.Size;
    }
    public static void Run(string inPath, string outPath) {
        using (var w = new StreamWriter(outPath, false, new UTF8Encoding(false))) {
            w.NewLine = "\n";
            foreach (var line in File.ReadAllLines(inPath)) {
                if (line.Length == 0) continue;
                string[] f = line.Split('\t');
                try {
                    if (f[0] == "H") {
                        w.WriteLine("H\t" + f[1] + "\t" + Dec(f[1]).GetHashCode());
                    } else if (f[0] == "C") {
                        var t = new Hashtable();
                        int seq = 0;
                        foreach (var op in f[2].Split(' ')) {
                            if (op.Length == 0) continue;
                            string k = Dec(op.Substring(2));
                            seq++;
                            if (op[0] == 'S') t[k] = seq;
                            else if (op[0] == 'A') t.Add(k, seq);
                            else if (op[0] == 'R') t.Remove(k);
                        }
                        w.WriteLine("C\t" + f[1] + "\t" + Dump(t));
                    } else if (f[0] == "N") {
                        // Host shape: table[pkg] = Hashtable(itemId -> item), built like export.ps1.
                        var table = new Hashtable();
                        int seq = 0;
                        foreach (var pair in f[2].Split(' ')) {
                            string[] pi = pair.Split(',');
                            string pkg = Dec(pi[0]), id = Dec(pi[1]);
                            seq++;
                            var inner = (Hashtable)table[pkg];
                            if (inner == null) { inner = new Hashtable(); table[pkg] = inner; }
                            inner[id] = seq;
                        }
                        var sb = new StringBuilder();
                        IDictionaryEnumerator e = table.GetEnumerator();
                        while (e.MoveNext()) {
                            if (sb.Length > 0) sb.Append('|');
                            sb.Append(Enc((string)e.Key)).Append('=').Append(Dump((Hashtable)e.Value));
                        }
                        w.WriteLine("N\t" + f[1] + "\t" + sb);
                    }
                } catch (Exception ex) {
                    w.WriteLine(f[0] + "\t" + f[1] + "\tERROR " + ex.GetType().Name);
                }
            }
        }
    }
}
"@
Add-Type -TypeDefinition $code
Write-Output ([HtProbe]::Env())
[HtProbe]::Run($InPath, $OutPath)
