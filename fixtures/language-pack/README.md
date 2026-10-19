# Language-pack import: probe evidence

Recorded on Windows PowerShell 5.1 (.NET Framework 4.8), NTFS, on 2026-10-19. They back `spec/language-pack.md` (`LP-001` to `LP-036`). Nothing here is Aras code or a credential; no server was contacted.

| File | What |
|---|---|
| `invariant-lower.json` | `ToLower(CultureInfo.InvariantCulture)` differences for BMP code units and supplementary-plane code points. It backs LP-013. |
| `14.0.7/probes/lp-common.ps1` | The harness. It loads the vendored 14.0.7 `Libs.dll` and `IOM.dll` and builds a fake IOM connection (answers the `Language` get from a script, records requests) and a fake `ICItemHelper` from the real interfaces. `RunLP` then runs the real `LanguagePackPreprocessor` over a case folder and prints the requests, what it left in the temp folder and what `Dispose` did. |
| `14.0.7/probes/01-config-and-languages` | The configuration (`languages`, `itemtype`), the `Language` responses and the filter (LP-010 to LP-015). |
| `14.0.7/probes/02-rows-and-aml` | The `xml` row files, the generated `edit` items, the `where` clause, values, file names (LP-020 to LP-027). |
| `14.0.7/probes/03-failures-package-cleanup` | Missing and malformed files, config path spellings, package names and the temp layout, debug retention, `Dispose`, the empty-path and null-argument constructors (LP-010, LP-029 to LP-036). |
| `14.0.7/probes/04-resolve-and-iom` | Reads the saved manifest back and resolves the package as the import does, for ten package names (LP-033). IOM's item counts for the `Language` response shapes (LP-014). |
| `14.0.7/probes/05-host-arguments` | The 14.0.7 `ConsoleUpgrade.exe`'s private `ParseArguments` called through reflection with `lpimport` arguments (LP-002). |
| `14.0.7/probes/lower.ps1` | Records `invariant-lower.json`'s source table. |
| `14.0.7/probes/*.out` | The output of each probe. `%TEMP%`-style paths are shown with the user folder replaced by `%USERPROFILE%` and the random temp folder name by `LanguagePack_<random>`. |

Each case prints a `## label` line, then `name => value` lines with strings escaped as in `common.ps1` (`\r`, `\n`, `\t`, `\uXXXX`, `\\`, `\"`). Rule text cites a case by its label.

## Replayed by

`src/language-pack/probes.test.ts` rebuilds the cases of `01-config-and-languages`, `02-rows-and-aml` and `03-failures-package-cleanup` as language-pack folders, runs the port's preprocessor on them against the same scripted `Language` answers, and compares the lines it prints with the `.out` files. `src/language-pack/preprocessor.test.ts` replays `04-resolve-and-iom`. Cases that need a Windows drive path (`pkg-colon`, `pkg-rooted-path`), the process's current directory (`path-bare-file-name`) or a file held open (`Dispose with a locked file`) are not replayed. One case of the script is not what it says: `server-no-en` passes `@(@('de','_de'))`, which PowerShell flattens, so the server answered two languages, `d` and `_`, and the recorded output is that of this answer.

## Re-running

Run on Windows with 64-bit Windows PowerShell 5.1. .NET refuses DLLs from `\\wsl.localhost`, so stage the files first. `probes/run.sh <probe>.ps1` (in WSL) does steps 2 and 3 for a probe:

1. copy `oracle/native/14.0.7/` to `%LOCALAPPDATA%\libsjs23-probe\14.0.7\`. For `05-host-arguments`, copy the toolset's `ConsoleUpgrade.exe` and `ConsoleUpgrade.exe.config` (sha256 of the exe `10c7ff72…8a3f8`, from `Desktop\ImportExport\23\ConsoleUpgrade`) together with `Libs.dll` and `IOM.dll` to `%LOCALAPPDATA%\libsjs23-probe\cu\`;
2. copy `probes/*.ps1` to `%LOCALAPPDATA%\libsjs23-probe\`;
3. run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File %LOCALAPPDATA%\libsjs23-probe\<probe>.ps1`.

The probes write their case folders under `%LOCALAPPDATA%\libsjs23-probe\cases\` and the preprocessor's temp folders under `%TEMP%`, and delete the temp folders when they finish. Two cases write outside the temp folder on purpose (a rooted package name and `..`, LP-031); the probe deletes what they made. Normalise the line breaks of a recorded output to LF (`tr -d '\r'`) before committing it.
