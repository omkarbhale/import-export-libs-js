# Manifest and package ordering probes, 14.0.7

Evidence for `spec/manifest.md` (rules `MAN-`). Each probe script drives the vendored 14.0.7 `Libs.dll` directly and prints one `label => result` line per case, with strings escaped as in `probes/common.ps1` (`\r`, `\n`, `\t`, `\uXXXX`, `\\`, `\"`). The `.out` file next to each script is its output. `%PROBE%` stands for the scratch folder the probes ran in.

| Probe | Covers |
|---|---|
| `01-package-paths` | `ExportImportBase.GetPackagePath`, `IsStandardPackage`, `IsCorePackage`, `IsDefaultPackage` (MAN-030, MAN-031) |
| `02-manifest-edit-save` | `AddPackage`, `AddDependsOn`, `AddReferencedElement`, `Save`, reading (MAN-003, MAN-006, MAN-010 to MAN-014) |
| `03-order-and-lookups` | `GetPackageNamesInImportOrder` (about 60 cases), `GetDependsOnInfo` key order, the lookups (MAN-015 to MAN-023) |
| `04-recursion-and-nulls` | null arguments; the cycle and self-dependency cases that end the process (MAN-024, MAN-025) |
| `05-file-paths`, `05b-rooted-without-drive` | `NormalizeLongPath` through `Save` and the reading constructor (MAN-003 to MAN-005) |
| `06-xpath-and-solution-path` | failures of the unescaped XPath, `ImportExportManager.GetSolutionPath` (MAN-014, MAN-032) |
| `07-deep-chain` | a dependency chain of 500 to 12,000 packages is ordered without overflow (MAN-025) |
| `08-path-chars-and-edges` | which characters make `GetPackagePath` throw, `Path.Combine` shapes, `GetDependsOnInfo` edge cases |
| `09-nls-startswith` | writes `nls-startswith.json`: how the culture-sensitive `StartsWith` in `IsCorePackage` compares (MAN-031) |
| `10-combining-after-solution` | a combining mark after `solution.` (MAN-031) |

`nls-startswith.json` holds inclusive code point ranges: `ignorable` (skipped wherever they occur), `afterPrefixBreaks` (a code point directly after the prefix's last `.` that makes the prefix not match), `equalsDot` (counts as `.`) and `equalsNAfterN` (counts as a repeated `n`). The result was identical under en-IN, en-US, sv-SE, tr-TR and the invariant culture.

## Re-running

Run on Windows with 64-bit Windows PowerShell 5.1, as the oracle does (`oracle/README.md`). .NET refuses DLLs from `\\wsl.localhost`, so stage the folder first:

1. copy `oracle/native/14.0.7/` to `%LOCALAPPDATA%\libsjs10-probe\14.0.7\`;
2. copy `probes/common.ps1` and the probe you want to `%LOCALAPPDATA%\libsjs10-probe\`;
3. run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File %LOCALAPPDATA%\libsjs10-probe\<probe>.ps1`.

The probes write only below `%LOCALAPPDATA%\libsjs10-probe\` and never contact a server. `04-recursion-and-nulls.ps1` takes `-Mode cycle|self|nulls`; the first two kill the process, which is the result. `07-deep-chain.ps1` takes `-N <packages>`. The recorded runs used culture en-IN.
