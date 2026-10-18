# Import loading and build.xsl ordering: probe evidence

Recorded on Windows PowerShell 5.1 (.NET Framework 4.8, CLR 4.0.30319.42000), NTFS, culture en-IN, on 2026-10-18. They back `spec/import-load.md` (`IMP-001` to `IMP-099`). Nothing here is Aras code or a credential.

| File | What |
|---|---|
| `load-package-dom.cases.json`, `load-package-dom.out.txt` | The real 14.0.7 `ImportExportManager.LoadPackageDom` (vendored `oracle/native/14.0.7/Libs.dll`, staged to `%LOCALAPPDATA%`) run on package folders built from the cases, then `GetItemsFromPackageDom` on its result. The output gives the result DOM's outer XML (CR and LF escaped as `\r` and `\n`), the item count, the log text, or the exception. The run folder is shown as `<ROOT>`. |
| `build-xsl.cases.json`, `build-xsl.out.txt` | The engine's own `build.xsl` (extracted from the DLL with ILSpy into the gitignored `.decomp/14.0.7/`) run through `XslCompiledTransform` with `ApplyXsl`'s settings. Each case lists the package files (`parts`, each a file's text). A part is stamped as `LoadPackageDom` stamps it (`k<n>` and `f<n>`). A line `type\|action\|id\|tempKeyName` is one output item; `RAW:` is the serialized output after the `xmlns:SOAP-ENV` replace. |
| `nls-word-sort.json` | Per-character NLS sort-key sections for the repertoire of IMP-030, and random type names with the order `xsl:sort select="@type"` gave them. |
| `invariant-upper.json`, `listing-order.json` | `ToUpperInvariant` differences for BMP code units, and `Directory.GetFiles` / `GetDirectories` results on NTFS for scrambled creation order. They back IMP-004. |
| `probe/` | The PowerShell that recorded the files above. `lpd.ps1 -Native <staged Import folder> -CasesFile load-package-dom.cases.json -Out <file>` runs the first group; `probe.ps1 -Xsl <build.xsl> -CasesFile build-xsl.cases.json -Out <file>` the second. Run them from a Windows folder (not `\\wsl.localhost`), staging the DLLs as `oracle/README.md` describes. |

`spec/import-load.test.ts` replays `nls-word-sort.json`, `invariant-upper.json` and `listing-order.json` against the reference algorithms written in the spec.
