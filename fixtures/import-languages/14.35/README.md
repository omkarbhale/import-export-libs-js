# 14.35 import languages and language-pack variants: probe evidence

Recorded on Windows PowerShell 5.1 (.NET Framework 4.8), NTFS, on 2026-10-19, against the vendored `oracle/native/14.35/` (`Libs.dll` 14.35.0.43890 and its `IOM.dll`). They back `spec/import-languages.md` (`IMP-600` to `IMP-699`) and the 14.35 parts of `spec/language-pack.md` (`LP-040` to `LP-044` and the `[14.35]` variants of `LP-001` to `LP-036`). Nothing here is Aras code or a credential, and no server was contacted.

| File | What |
|---|---|
| `probes/common.ps1`, `probes/stub.ps1` | The shared helpers. `stub.ps1` builds an `IServerConnection` from the real interface that records the document IOM hands to `CallAction` (and its action name) and answers from a script, a recording `IMessagesFactory`, and a real `CItemHelper` over that connection with a chosen server version. |
| `probes/model.ps1` | The server model of the 14.0.7 import-run probe (`fixtures/import-run/probe/probe.ps1`), reused unchanged so `ImportSolutions` can run: a small in-memory Aras that answers package definitions, audit rows and lookups. |
| `probes/lp-common.ps1` | The language-pack harness: the real 14.35 `LanguagePackPreprocessor` over a case folder with a fake `ICItemHelper` and a scripted connection. |
| `probes/01-extractor.ps1` / `.out` | `LanguageCodesExtractor` called directly: file patterns, depth, what is selected, lower-casing, the cache, sort order, failures (`IMP-610` to `IMP-615`). |
| `probes/02-manager-ctor.ps1` / `.out` | The `ImportExportManager` constructor with a `Languages` array: no selection, `*`, installed and missing languages, every `Language` answer shape, the scan failing, relative manifest paths (`IMP-610` to `IMP-623`). |
| `probes/03-import-skip.ps1` / `.out` | `ImportSolutions` with a selection: which `xml:lang` nodes are deleted from the AML that is sent, per package, in batch mode and after a batch fallback, the unescaped XPath, an `xml:lang` on the `Item` itself (`IMP-630` to `IMP-635`). |
| `probes/04-lp-preprocessor.ps1` / `.out` | The 14.35 `LanguagePackPreprocessor`: file names, `Property` items and their server request, the version thresholds, the version read at construction (`LP-020` to `LP-029`, `LP-036`, `LP-040`, `LP-041`). |
| `probes/05-lp-then-import.ps1` / `.out` | The preprocessor's package, then the manager built and run over its manifest as `ConsoleUpgrade.exe` does: `Languages` against the generated edit items, dotted package names failing in the constructor (`LP-033`, `IMP-640`). |
| `probes/06-null-values.ps1` / `.out` | `CItemHelper.doImport` for a `context_action="lpimport"` `Property` item: the `keyed_name` lookup, the `Language` suffix lookup, the `UPDATE innovator.PROPERTY` statement as `ApplySQL`, and the version predicate itself (`LP-040` to `LP-044`). |
| `probes/07-host-arguments.ps1` / `.out` | The 14.35 `ConsoleUpgrade.exe` argument parser (private `ParseArguments`, through reflection) for `langs` (`IMP-601`). |
| `probes/08-host-lpimport.ps1` / `.out` | The same parser for the `lpimport` cases of `fixtures/language-pack/14.0.7/probes/05-host-arguments.ps1`. The output is identical to the 14.0.7 one, line for line (`LP-002`). |
| `probes/09-resolve.ps1` / `.out` | The 14.35 twin of `fixtures/language-pack/14.0.7/probes/04-resolve-and-iom.ps1`: the package as the import resolves it from the saved manifest (`LP-033`). |

Each case prints a `## label` line, then `name => value` lines with strings escaped (`\r`, `\n`, `\t`, `\uXXXX`, `\\`, `\"`). Rule text cites a case by its label. `%USERPROFILE%`, `%TEMP%` and `%CASES%` replace local paths, and `LanguagePack_<random>` the random folder name. The order of the inner exceptions of an `AggregateException` is not defined, so the probes print them sorted.

**The server is a model.** The stub answers what the script says and never evaluates the engine's AML. The files show what the engine sends and how it reacts to those answers; they do not show what Aras answers. The import fixtures of wayfinder ticket 75 record that.

## Re-running

Run on Windows with 64-bit Windows PowerShell 5.1. .NET refuses DLLs from `\\wsl.localhost`, so `probes/run.sh <repo-root> <probe.ps1>` (in WSL) stages `oracle/native/14.35/` and the probes to `%LOCALAPPDATA%\libsjs73-probe\` and runs one probe. `07-host-arguments` and `08-host-lpimport` also need the toolset's `ConsoleUpgrade.exe` and `ConsoleUpgrade.exe.config` (sha256 of the exe `237f412b4621755683e253ac68b46aae4f7524a8d051f24fac819e060a6736a9`, from `Desktop\Delete me\PackageImportExportUtilities35\ConsoleUpgrade`); set `CU` to that folder when you run them. The probes write their case folders under `%LOCALAPPDATA%\libsjs73-probe\cases\` and delete them when they finish; `lp-common.ps1` also removes the temp folders the preprocessor makes under `%TEMP%`. Normalise the line breaks of a recorded output to LF (`run.sh` does) before committing it.
