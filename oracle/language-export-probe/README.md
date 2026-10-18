# language-export-probe

Runs engine 14.35's language-resource export code offline, for the rules of `spec/language-export.md` (`LP-100` to `LP-199`). It needs no server, no credential and no password: every request is answered by a script in `LangStub.cs` (which extends the export-output probe's `ScriptedConnection`, so that file's `Stub.cs` is required too), and it writes only under its work folder. The scripts exist for 14.35 only: 14.0.7 and 12.0 have neither mode.

`probe.ps1` has these sections (`-Only` takes comma-separated id patterns, `-Stack` prints stack traces, `-Requests` prints the requests of the `E` scenarios):

- `C`: the `ImportExportManager` constructor in the language actions and in `Export`, `LPImport`: the `*` expansion, the removal of `en`, a null list, the installed-language check and the Language requests it sends.
- `R`: the requests `CExportItems.Export` builds for a type in each action, over a small fictional schema (`TA`, `TB`, `R1` to `R3`): the select of every node, the ml_string lookups, depth 0 to 3, the `ItemType` and `cmf` bodies, and what a failed lookup does.
- `MK`, `RM`, `ORD`, `ADD`: the four private steps (`MarkPropertiesWithTranslationsIfNeeded`, `RemoveNotLocalizedProperties`, `OrderPropertiesWithTranslations`, `AddI18NNamespaceToAllRootItems`) called by reflection on in-memory documents.
- `E`: one item through the whole of `Export`, with the real `export.xsl`, in Only, Metadata and (for contrast) `Export`.
- `X`: whole `ExportSolutions` runs in the language modes.

The scripted connection answers what a script says. The probe therefore shows what the engine does with an answer (an item with a German label, an ItemType with no ml_string rows), not what the server answers; LP-127 and `fixtures/export-language/server-reactions.json` say what dev answers.

## Re-running

.NET Framework refuses DLLs from `\\wsl.localhost`, so use a staged copy (Windows PowerShell 5.1). `npm run oracle -- verify` stages and checks `%LOCALAPPDATA%\import-export-libs-js\oracle\<engine>-<digest>\`; pass that 14.35 folder as `-Bin`. Copy `LangStub.cs` and `probe.ps1` to one Windows folder and the export-output probe's `Stub.cs` to another, create a work folder, then:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File probe.ps1 -Bin <staged 14.35 folder> -Work <work folder> -StubDir <folder with Stub.cs>
```

Delete the copies afterwards. The recorded output is `fixtures/export-language/probe-14.35.txt`. Two runs agree line for line (the scenarios do not depend on thread timing: the log and message lines of `X` are sorted before they are printed, and the per-run times are replaced by `<T>`).
