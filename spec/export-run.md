# Export orchestration, messages, log and the error question

This document specifies what `ImportExportManager.ExportSolutions` does around the per-item export: which packages it visits and in what order, the package-definition lookups, the dependency and manifest bookkeeping, the referenced-items second pass, the error question, cancel, every message and log line, and how the run ends. What happens inside one item (`CExportItems.Export`: requests, the transform, post-processing, the file bytes) is specified by the other `EXP-` documents. This one stops at the call to `CItemHelper.PackageItem` and picks up again when it returns or throws.

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`) and of Aras's three hosts, `ConsoleUpgrade.exe`, `export.exe` and `import.exe` (decompiled locally, never committed);
- live runs of the vendored 14.0.7 engine against dev through the oracle (`oracle/README.md`), on the 12 SP9 server. Where a rule says *observed*, it quotes such a run. Where it says *inferred*, the behaviour comes from the code and .NET Framework semantics and no run exercised it. Dev holds no `PackageReferencedElement` rows, so the referenced-items pass and the `referenced_element` entries are inferred until ticket 67 seeds them;
- for 14.35: the 14.35 decompile (`.decomp/14.35/`, never committed), compared with 14.0.7's, and runs of the real 14.35 `Libs.dll` against a scripted connection that answers the requests an export makes and never touches a network (`oracle/export-output-probe/run-export.ps1`; scenarios `S1` to `S21`, recorded in `fixtures/export-output/run-export-14.35.txt`). No server and no credential was involved. A rule that says *observed* with a scenario id quotes such a run; the same scenario can differ in its timing from run to run, so a rule quotes only what held in every run it was repeated in, and says *seen in some runs* otherwise.

**Engine 14.35.** The package loop, the definition and dependency lookups, the manifest and the referenced-items pass are 14.0.7's code. What changed is how `ExportProc` runs the items of one package (concurrently, with a logger of its own), what a failed item does (it stops the whole export), the null package list, the paths (`EXP-460`) and the message texts. Every rule below holds for 14.35 as written unless it has a `[14.35]` variant, and `EXP-550` to `EXP-558` are the rules new in 14.35. The engine's sources of nondeterminism are listed once, in EXP-551, and the way to compare two 14.35 runs is EXP-558.

Conventions used below:

- **Table order** is the enumeration order of a .NET Framework `Hashtable` with string keys, the default comparer and 64-bit hashing (ticket 07). It depends on the exact sequence of `Add` and indexer-set operations, so each rule that builds a table gives that sequence. The emulation itself is specified and built with the manifest rules (`MAN-`, ticket 10 and 28).
- **The log** is the engine's log file (EXP-505). **A message** is one of the five channels of EXP-503.
- **`{x}`** in a text is a value interpolated by `string.Format` with the invariant culture. Values interpolated into AML or XPath are never escaped (AGENTS.md rule 7).
- **CRLF** is `\r\n`. Texts that contain `\n` alone say so.

The `[12.0]` variants come from the 12.0 decompile (`.decomp/12.0/`), compared method by method with 14.0.7's, from Aras's `ConsoleUpgrade.exe` 12.0, and from live runs of the vendored 12.0 engine against dev through the oracle (a rule says *observed* where it quotes one). The 12.0 orchestration writes no log header, opens the log after `GetSolutions2Xml`, and has no message catalogue (EXP-504).

## Inputs and the host

### EXP-500: ExportSolutions takes a context and a table of packages to items

[14.0.7] `ExportSolutions(exportContext, selItemsTable)` is the whole export. Its inputs:

- `exportContext`: the `SUExportContext` of EXP-501. A null context throws `ArgumentNullException` (parameter `exportContext`) before anything else happens.
- `selItemsTable`: a `Hashtable` from package name to an inner `Hashtable` from a key to an `ExportItem`. A null table throws `ArgumentNullException` (parameter `selItemsTable`), also before the log is opened. The engine reads the inner key only through its position in table order; the item is the value.
- An `ExportItem` has three strings: `keyedName`, `idName` (the id the host asked for) and `typeName`. Its constructor is `(keyedName, idName, typeName)`, and its text form is the `keyedName`. Every log line and message names an item by these three fields, with `idName` as the requested id, before any config id resolution.

The manager has already been built around a logged-in helper (EXP-502). `ExportSolutions` reads `ItemHelper.InnovatorVersion` while writing the log header (EXP-506), and only `CItemHelper.Login()` sets it (WIRE-021). A host that skipped the login therefore gets a `NullReferenceException` out of `ExportSolutions`: the log file has been opened (and created when it did not exist) but nothing is written to it, no message is sent and no manifest is saved. *Inferred from the code.* The library's client always logs in first (WIRE-001), so this is a programming error there, reported as the same exception text, `Object reference not set to an instance of an object.`

The library takes the two tables as ordered sequences of `(key, value)` insertions in the order the host performed them, and derives table order itself (EXP-508, EXP-514). Building them is the host's job: `ConsoleUpgrade.exe` and the console-mode rules (`EXP-700`–`EXP-799`, ticket 66) build them, and the CLI's own export builds them in ticket 43.

[12.0] Same inputs and the same argument checks (`exportContext`, then `selItemsTable`). One consequence differs: `ExportSolutions` does not read `InnovatorVersion` up front, because there is no log header (EXP-506). A host that skipped the login does not fail at the start. Only an item whose request needs the server version fails, and only that item: each `Export` of a type with the default row or of an `ItemType` (EXP-023, EXP-024) ends with the `NullReferenceException` of EXP-054, as `Can't export item.` The other types export. With the exact-type login of WIRE-017, a host that built a plain `HttpServerConnection` is such a host.

[14.35] Same inputs and the same two `ArgumentNullException` checks, before anything else. The log is opened through `TextWriter.Synchronized` (EXP-505). The table of packages is walked in the same way (EXP-508). The context also has the language settings of EXP-501, which a plain export leaves unset.

### EXP-501: The export and upgrade contexts

[14.0.7] `SUExportContext` holds four settings, all plain properties with no validation:

| Property | Type | Default | Effect on export |
|---|---|---|---|
| `sLevel` | string | null | The `levels` of the fetch request for types without a fixed level (export request rules, `EXP-001`–`EXP-099`). Logged as `Export level` (EXP-506). Passed to `PackageItem` unchanged. |
| `bExportReferencedItems` | bool | false | Whether referenced elements are also exported in a second pass (EXP-512, EXP-519). |
| `RefToUnknownPacks` | enum `ReferencesToUnknownPackages` | `RemoveSilently` | `RemoveSilently`, `RemoveWithWarning` or `DoNotRemove`. `DoNotRemove` skips the unknown-package machinery (EXP-514, EXP-517). |
| `UseImport` | bool | false | Logged only (EXP-506). It has no effect inside the engine; the host that sets it builds the table differently. |

The enum's default is its first member, `RemoveSilently` (value 0). `ConsoleUpgrade.exe` sets `DoNotRemove` explicitly, so the default is not seen there.

`SolutionUpgradeContext` is the shared context, one property pair per setting: `Action`, `Url`, `Password`, `DataBase`, `UserName`, `WorkingDirectory`, `Verbose`, `LogFilePath`, `ManifestFile`, `Timeout`, `LPPath`, `LPPackage` and `LPDebug`, plus the five certificate settings (WIRE-090). Export reads these:

- `Action`, `ManifestFile`, `LogFilePath`, `WorkingDirectory`, `Url`, `DataBase`, `UserName`, `LPPath` and `LPPackage` appear in the log header (EXP-506);
- `WorkingDirectory` is also the root of the output directories and of `imports.mf` (EXP-511, EXP-513);
- `LogFilePath` is also the log file (EXP-505);
- `ManifestFile` is also loaded in the constructor when the file exists (EXP-502);
- `Timeout` is applied by the constructor (WIRE-031).

Export never reads `Password` (only the host does, to log in), `Verbose` or `LPDebug`. `Verbose` changes only the import log.

[12.0] `SUExportContext` is the same four settings. `SolutionUpgradeContext` has the properties `Action`, `Url`, `Password`, `DataBase`, `UserName`, `WorkingDirectory`, `Verbose`, `LogFilePath`, `ManifestFile` and `Timeout`; it has no `LPPath`, `LPPackage` or `LPDebug` and no certificate settings. The `ImportExport` enum has `Import` and `Export` only. Export reads `ManifestFile`, `LogFilePath`, `WorkingDirectory` and `Timeout`, with the effects of 14.0.7, and `Action` only in the constructor, to tell an import from an export. Nothing is logged from the settings, as there is no header.

[14.35] Same four export settings and the same defaults. `SolutionUpgradeContext` has one more property, `Languages` (a string array, null by default), and `Action` has three more values: `ExportLanguageResourcesOnly`, `ExportMetadataWithLanguageResources` and `ImportDPPatch` (the first two: LP-100; the last: the DB patch rules). `ExportProc` passes the context's `Action` and `Languages` to every `PackageItem` call, and the constructor works on `Languages` only for imports and the language exports (EXP-502). With `Action = Export` and no languages, which is what a plain export sets, nothing of them changes a result (EXP-400).

### EXP-502: The manager is built around a helper, a context and a message factory

[14.0.7] `ImportExportManager(context, messagesFactory, itemHelper)` throws `ArgumentNullException` for a null `itemHelper` (checked first) or a null `context`. For an export it then:

1. takes `WorkingDirectory` as the manifest directory (`ManifestFileDirectoryPath`) and the context's `ManifestFile` as `ManifestFilePath`. For an import the directory is the manifest's parent instead, and a missing manifest throws; that is import orchestration;
2. applies the timeout (WIRE-031);
3. loads the manifest, when `ManifestFile` is not empty and the file exists, into the `ManifestFile` property. Loading uses the manifest read path, which throws on a file that is not well-formed XML, so a bad existing manifest fails the constructor even though `ExportSolutions` never uses the loaded document. With no such file the property stays null. The `ExportSolutions` run builds its own empty manifest document (EXP-511);
4. keeps the helper, context and factory. `messagesFactory` is not checked, and a null one fails on first use.

The helper, the loaded manifest and the engine's `IOWrapper` are read through the properties `ItemHelper`, `ManifestFile` and `iOWrapper`. They have no behaviour of their own.

[12.0] Same checks, in the same order, and the same timeout and manifest loading, with the differences of the older code: the manager has no `IOWrapper`, so `File.Exists(ManifestFile)` and the load go to the path as given (no normalisation, EXP-421), and the manifest is read with `XmlDocument.Load(path)` (MAN-003), which honours the encoding declaration and throws on invalid bytes, where 14.0.7 reads text and calls `LoadXml`.

[14.35] Same for an export with `Action = Export` and no languages. The constructor does more only for an import (it scans every package of the manifest for language codes, ticket 53) and for the language exports, which resolve the language list through the server (LP-110 to LP-115). It ends with a check of the selected languages that does nothing when there are none. `ExportSolutions` itself reads `ItemHelper`, the context and the message factory as before.

## Messages and the log

### EXP-503: Five message channels, one host answer

[14.0.7] The engine tells its host about progress through five channels. A message is created by the host's factory, given a `Text`, and sent with `Execute()`, which returns a nullable bool (an answer). The channels:

| Channel | Created by | Used for |
|---|---|---|
| `currentPackage` | `GetCurrentPackageMessage` | the package being exported (EXP-513, EXP-519), and an empty text at the end of a run (EXP-508) |
| `status` | `GetStatusMessage` | per-item progress, errors, cancel and `completed` (EXP-514 to EXP-518) |
| `errorQuestion` | `GetErrorMessageQuestion` | the question after a failed item (EXP-516) |
| `warning` | `GetWarningMessage` | no package definitions (EXP-507), removed references (EXP-517), a failed run (EXP-520) |
| `error` | `GetErrorMessage` | a failed package-definition query (EXP-507) |

- The engine reads the answer only for `errorQuestion`: `true` means "abort the current package", and `false` or null mean "continue". Answers to the other channels are ignored.
- A message object is reused. `GetStatusMessage` is called once per `ExportProc` call, `GetCurrentPackageMessage` once per `ExportSolutions` call and once per referenced package, `GetErrorMessage` and `GetWarningMessage` once per `GetSolutions2Xml` call, and `GetErrorMessageQuestion` and `GetWarningMessage` at the point of use. Each reuse assigns a new `Text` and executes again, so observable behaviour is the sequence of `(channel, text)` pairs and the one answer.
- `Message` is an abstract class with a `Text` property and `Execute`. It holds nothing else.

The reference hosts answer as follows. `ConsoleUpgrade.exe` prints `currentPackage`, `status` and `warning` texts to stdout, each preceded by an empty line, and prints `error` texts the same way to stderr. Its factory returns the *error* message for `errorQuestion`, whose answer is `false`, so it always continues. `export.exe` (the GUI) shows `error` and `errorQuestion` as an OK-only message box, which answers null, so it always continues too. No shipped host aborts a package after an item error. The oracle host answers `yes` or `no` (default `no`) to exercise both paths. The library exposes the answer as an option (`--on-item-error`, default `continue`, round 2 Q6, built in ticket 34); `abort-package` answers `true`.

*Observed:* run `r1` sent `currentPackage` "Exporting package com.aras.innovator.servicereporting", `status` "Item 1 of 1: List - Report Format Types", `status` "completed" and `currentPackage` "".

[12.0] Same as 14.0.7.

[14.35] The same five channels and the same use of them, with these differences:

- the answer to `errorQuestion` is not read at all (EXP-555): the question is sent, and the export stops whatever the host answers;
- `GetStatusMessage` is still called once per `ExportProc` call, but the one `status` object is now used by every worker of the package at the same time (EXP-553), and by the thread that runs `ExportProc` too;
- `warning` is also used by the aggregate handler of EXP-556, with the new `ErrorMessageMessage` text;
- the messages are sent from worker threads, so a host's `Execute` is called concurrently. A host that is not thread-safe is the host's problem; the engine adds no lock around `Execute`, except that the failed-item handler and the cancel branch run under locks (EXP-555, EXP-557).

*Observed* (`S1`): `currentPackage` "Exporting package pkg.a", four `status` messages "Item 1 of 4: List - k-A0x", `status` "completed" and `currentPackage` "".

### EXP-504: Message texts come from a fixed catalogue, filled with the invariant culture

[14.0.7] Every text goes through `ResourceManager.GetMessage(key, args)`: the template for `key` is formatted with `string.Format`, the invariant culture and the string arguments. A key with no template gives the empty string, and no arguments are formatted. The one-argument form `GetMessage(key)` returns the template as is. A null argument formats as an empty string.

The templates the export uses, with `\r\n` and `\n` literal in the templates and a tab written `\t`:

| Key | Template |
|---|---|
| `ExportingPackagePackageName` | `Exporting package {0}` |
| `ExportingReferencedItemsFromPackageName` | `Exporting referenced items from '{0}'` |
| `ItemIndexOfCountTypeNameKeyedName` | `Item {0} of {1}: {2} - {3}` |
| `ErrorOfExportingItemIdKeyedNameType` | `Error of exporting Item id :{0}  keyed_name : {1}    type : {2}` (two spaces before `keyed_name`, four before `type`) |
| `ItemIdKeyedNameTypeSuccessfullyExported` | `Item id :{0}  keyed_name : {1}   type : {2} successfully exported` (two spaces before `keyed_name`, three before `type`) |
| `ExportWasCanceledByUser` | `Export was canceled by user` |
| `Completed` | `completed` |
| `ExportSolutionName` | `         ****Export {0}****` (nine leading spaces) |
| `StartOfExecutionDateTime` | `start of execution : {0}` |
| `EndOfExecutionDateTime` | `end of execution : {0}` |
| `ErrorMessageStringDetailCode` | `      ******Error message******\r\nfaultstring: {0}\r\nfaultdetail: {1}\r\nfaultcode:   {2}\r\n     **********************` (six leading spaces on the first line, five on the last) |
| `ErrorMessageStringDetailCodeAbortCurrentExportOfSolutionName` | `          ****ErrorMessage****\r\nfaultstring: {0}\r\nfaultdetail :{1}\r\nfaultcode: {2}\r\n          *******************\r\n\r\n  Abort current export of {3} ?` (ten leading spaces on the first and fifth lines, two on the last) |
| `ErrorMessageMessage` | `          ****ErrorMessage****\r\n       {0}` (ten, then seven leading spaces) |
| `TheDatabaseContainsNoPackageDefinitionsPleaseSelectAnotherDatabaseAndTryAgain` | `The database contains no package definitions. Please select another database and try again` |
| `ThereAreReferencesToUnknownPackagesThatWereRemovedDuringTheExportOfThePackageSolutionNameSeeLogFileForMoreDetailsSearchForWordsRemovedRefError` | `There are references to unknown packages that were removed during the export of the package '{0}'.\nSee log file for more details (search for words '{1}')` (the break is `\n` alone) |
| `From`, `To`, `Reason` | `From:\t{0}`, `To:\t{0}`, `Reason:\t{0}` |
| `UnableToGetPackagesMeta` | `Unable to get packages meta.\r\n{0}` |
| `FailsToInitSolutionToPackageDefinitionPackageName` | ` Fails to init solution to PackageDefinition: {0}` (leading space) |
| `FailedToFindReferencedElementsForPackagePackageName` | ` Failed to find referenced elements for package '{0}'` (leading space) |
| `ErrorMessageFailedToFindReferencedElementsForPackageName` | `{0}; Failed to find referenced elements for package '{1}'` |
| `ReferencedElementDoesnotHaveElementNameSet` | `Referenced element doesn't have '{0}' set` |
| `EmptyDependencyPackageMessage` | `Name of 'dependson' package can't be 'null' or empty` |

The other templates in the catalogue belong to the import and the item-level rules. The ones that no export text reaches (the second argument of `ErrorMessageStringDetailCodeAML` and `faultAMLMessage`, EXP-516) are dead.

[12.0] There is no message catalogue and no `ResourceManager`: every text is a literal in the code, built with `string.Format(CultureInfo.InvariantCulture, …)` or by concatenation. They are the texts of the table above, except for these, which differ:

- **The end-of-run warning and log text** (`ErrorMessageMessage`, EXP-520) has a closing line: `          ****ErrorMessage****\r\n       {0}\r\n          *******************` (ten leading spaces on the first and last lines, nineteen stars, seven spaces before `{0}`). In 14.0.7 the text ends after `{0}`.
- **The `GetSolutions2Xml` error** (EXP-507) is `          ****ErrorMessage****\r\nfaultstring: {0}\r\nfaultdetail :{1}\r\nfaultcode: {2}\r\n          *******************`, the block of the abort question (EXP-516) without its question. 14.0.7 uses `ErrorMessageStringDetailCode`.
- **`getSolutions`** (`UnableToGetPackagesMeta`) appends `Unable to get packages meta.` to the `faultdetail`, with no leading space, line break or exception message.
- **The failed item's log line** (EXP-516) has one space before `type`: `Error of exporting Item id :{0}  keyed_name : {1} type : {2}`. Its `status` message keeps four spaces.
- **`FailedToProcessPropertiesOfTypeItemForItemType`** has no closing quote (EXP-044).
- **`UnableToGetDepencyLevelForRelationshipType`** is ` Unable to get depency level for RelationshipType.` (EXP-043). In 14.0.7 it is the empty string.
- **Date-times and numbers** are formatted with the current culture where the code concatenates them (EXP-505).

Every other text of the table, and the `{0}` and `{1}` arguments, are the same.

[14.35] The same catalogue with these export-relevant changes:

| Key | Template in 14.35 |
|---|---|
| `ErrorMessageMessage` | `\t\t****ErrorMessage****\r\n{0}` (two tabs, then the message on its own line) |
| `ServerErrorRequestResponse` | `Server error\r\n\r\nRequest (formatted):\r\n{0}\r\n\r\nResponse (formatted):\r\n{1}` (WIRE-051) |

Every other row of the table above is unchanged. The text `ErrorMessageMessageEnd` (`\r\n\t\t****ErrorMessage****\r\n{0}\r\n\t\t********************`) is changed too, but an export never reaches it. The catalogue also gains the texts of the DB patches, the AML batch mode and the language selection (tickets 53, 55, 56), and corrects two typos (`dependency`, `PackageDefinition`), none of which an export sends.

### EXP-505: The log is an append-only UTF-8 file written with CRLF

[14.0.7] `ExportSolutions` opens the log first, through `IOWrapper.NewStreamWriter(LogFilePath, append: true)`, before anything else is sent or created, and keeps one writer for the whole run:

- the path is passed through the engine's long-path normalisation first (`IOWrapper.NormalizeLongPath`, specified with the file layout in `spec/export-write.md`), then given to .NET's `StreamWriter(path, append)`;
- the file is created when it does not exist and appended to otherwise (earlier runs stay in front). A missing directory fails with `DirectoryNotFoundException`, and an empty path with `ArgumentException`. Both escape `ExportSolutions`;
- the encoding is UTF-8 without a BOM, also when the file is new;
- the writer is not auto-flushing. The bytes reach the file when the writer is disposed at the end of `ExportSolutions` or when its buffer fills, and a crash can lose the tail. The file is opened for writing with read sharing only, so no second writer can open it while the run lasts (EXP-541);
- `WriteLine` ends a line with CRLF. A text that holds `\r\n` or `\n` keeps those bytes inside the line.

A date-time written to the log is `DateTime.Now.ToString(CultureInfo.InvariantCulture)`, the local time as `MM/dd/yyyy HH:mm:ss`, for example `10/18/2026 05:22:16`. The port formats the host's local time the same way; tests inject a clock.

*Observed:* run `r1` wrote the log with CRLF line ends and no BOM.

[12.0] The log is opened later and without normalisation. `ExportSolutions` opens it with `new StreamWriter(LogFilePath, append: true)`, after the argument checks and after `GetSolutions2Xml` (EXP-507), and keeps one writer for the rest of the run. The path is not normalised (EXP-421). The file, the encoding (UTF-8 without a BOM), the append, the CRLF line ends, the missing buffer flush and the read-sharing are as in 14.0.7; a missing directory fails with `DirectoryNotFoundException` and an empty path with `ArgumentException`, both after the first request has been sent, and both escape `ExportSolutions`.

**Date-times.** The three date-times that the code concatenates (`start of execution : ` at the head of each package or referenced package, and `end of execution : ` after a cancel and after an abort) are `DateTime.Now.ToString()` of the **current culture**: its general date and time pattern (short date, long time). Only the last `end of execution : ` of a package is formatted with the invariant culture (`MM/dd/yyyy HH:mm:ss`, as in 14.0.7). Observed on the oracle machine, whose culture is en-IN: `start of execution : 19-10-2026 01:17:50`, then at the end `end of execution : 10/19/2026 01:17:51`. The port formats the host's local time with the general pattern of a culture the host names (the build ticket defines the option; the default is the process locale) and carries these patterns (probed with .NET Framework 4.8 on Windows): invariant `MM/dd/yyyy HH:mm:ss`, `en-US` `M/d/yyyy h:mm:ss tt`, `en-GB` and `fr-FR` `dd/MM/yyyy HH:mm:ss`, `en-IN` `dd-MM-yyyy HH:mm:ss`, `de-DE` `dd.MM.yyyy HH:mm:ss`. For another culture it uses the invariant pattern, which differs from the engine's there. The `faultcode` that the log and the abort question concatenate is also written with the current culture; for the cultures above it is the same as the invariant text.

[14.35] Same file, same encoding and the same CRLF. The `StreamWriter` is opened as before and wrapped in `TextWriter.Synchronized`, so each `WriteLine` call, from any thread, writes its whole text before another call begins. Lines are therefore never cut in two, but the lines of different workers interleave (EXP-551), and a text that is written as several calls is not atomic (the removed-reference block of EXP-517 is four calls). The per-item success lines do not go through this writer directly (EXP-554). Disposing the wrapper at the end of `ExportSolutions` flushes and closes the file.

### EXP-506: The log opens with a header block

[14.0.7] Right after opening the log, `ExportSolutions` writes the header and then the block's own trailing CRLF, so one empty line follows the last header line. The block is one `WriteLine` of lines built with `AppendLine`, each `Label: value` with the value formatted with the invariant culture (a bool is `True` or `False`, an enum is its name, null or empty is nothing):

```text
Tool version: 14.0.7.35492
Action: Export
Manifest file: {ManifestFile}
Log file: {LogFilePath}
Working directory: {WorkingDirectory}
URL: {Url}
Database: {DataBase}
User: {UserName}
Innovator version: {InnovatorVersionFullString}
Language pack: {LPPath}
Language pack name: {LPPackage}
Export referenced items: {bExportReferencedItems}
Export unknown packages action: {RefToUnknownPacks}
Export level: {sLevel}
Export using import structure: {UseImport}
```

- `Tool version` is the assembly version of `Libs.dll` (`14.0.7.35492`), not the server's.
- `Innovator version` is the text of WIRE-022 for the server version read at login.
- The import log adds import lines instead of the four export lines; they belong to the import orchestration rules.

*Observed* (`r1`, `r6`): the block above, with `Innovator version: 12.0 SP9 Build 24090`, `Manifest file: ` and both language-pack lines empty, and the empty line after `Export using import structure: False`.

[12.0] Not present. 12.0 writes no header: nothing is written to the log when it is opened, and the first line is the first package's `         ****Export {package}****` (EXP-513). There is no `Tool version`, `Innovator version` or other line, and no blank line. The input parameters are not logged, and `ExportSolutions` does not read the server version for the log.

[14.35] Same block, with `Tool version: 14.35.0.43890`. The language-resource export shows its action in `Action:`; the DB patch lines belong to the DB patch log.

## The run

### EXP-507: GetSolutions2Xml reads the package definitions, or reports why not

[14.0.7] `GetSolutions2Xml` is public and returns the response document of one request, or null. It creates its `warning` and `error` messages first and then calls `CItemHelper.getSolutions()`, which sends this `ApplyItem` (the whitespace is part of the request, WIRE-007; indentation is spaces, and the lines end in CRLF):

```xml
<Item type='PackageDefinition' select='name,generation' action='get' >
              <is_current>1</is_current>
              <Relationships>
                <Item type='PackageGroup' select='name'>
                  <Relationships>
                    <Item type='PackageElement' select='name,element_id,element_type' />
                  </Relationships>
                </Item>
                <Item type='PackageDependsOn' select='name' />
              </Relationships>
            </Item>
```

The first line has no indent; the following lines have 14, 14, 16, 18, 20, 18, 16, 16, 14 and 12 spaces. Through the DOM the request goes out with double-quoted attributes (WIRE-004).

- A fault with faultcode `0` (no package definitions, WIRE-052) makes `getSolutions` return null. `GetSolutions2Xml` then sends `warning` "The database contains no package definitions. Please select another database and try again" and returns null.
- Any other fault is rethrown by `getSolutions` with its `faultdetail` extended by `Unable to get packages meta.\r\n{exception message}` (the message is the whole `Server error` text of WIRE-051). `GetSolutions2Xml` catches it, sends `error` with `ErrorMessageStringDetailCode(faultstring, faultdetail, faultcode)`, and then writes the same text and a line end to the log through a *second* writer opened with `new StreamWriter(LogFilePath, append: true)` and disposed at once. It returns null. Called on its own, as the console modes of ticket 66 do before `ExportSolutions`, this appends the error text to the log. Called from `ExportSolutions`, the second open fails (EXP-541).
- An exception that is not a `CItemException`, such as an XML error, is not caught.
- The faultstring of such an error is the full `Server error` text of WIRE-051, so the logged and sent text repeats the request and the whole response envelope.

The response document is the envelope, with the package definitions as `Item[@type='PackageDefinition']` carrying `name`, `Relationships/Item[@type='PackageGroup']/Relationships/Item[@type='PackageElement']` and `Relationships/Item[@type='PackageDependsOn']/name`. `ExportSolutions` reads only the dependencies from it (EXP-510).

*Observed:* request 7 of `r1`, with the whitespace above.

[12.0] The request, the faultcode `0` branch (the `warning` and a null result) and the rule that a non-`CItemException` is not caught are as in 14.0.7. Three things differ for any other fault:

- `getSolutions` extends the `faultdetail` by `Unable to get packages meta.` alone (EXP-504), without a line break or the exception message;
- `GetSolutions2Xml` sends the `error` message with, and writes to the log, the text `          ****ErrorMessage****\r\nfaultstring: {faultstring}\r\nfaultdetail :{faultdetail}\r\nfaultcode: {faultcode}\r\n          *******************` (EXP-504);
- the log write goes through the second writer opened with `new StreamWriter(LogFilePath, append: true)` and closed at once, as in 14.0.7, but **nothing else holds the file**: `ExportSolutions` calls `GetSolutions2Xml` before it opens its own writer (EXP-505), so the write succeeds, creates the file when it is missing and appends the text and a line end (EXP-541 does not occur). The function returns null, and `ExportSolutions` goes on with the null document: its first package is added to the manifest and its definition looked up (EXP-509), and then the dependency XPath on the null document fails with a `NullReferenceException`, which EXP-520 handles with the warning `Object reference not set to an instance of an object.` in the text of EXP-504. A definition lookup that fails first escapes as in EXP-542.

Called on its own, as the console modes of ticket 66 do, it behaves the same.

[14.35] Same request, same two messages and the same handling of a fault. A null result no longer lets the run go on: EXP-550. The second log writer of the error branch is still opened on the file that the run holds open (EXP-541).

### EXP-508: The package loop visits non-empty tables in table order

[14.0.7] After the log header, `ExportSolutions` calls `GetSolutions2Xml` (EXP-507), creates its `currentPackage` message and an empty `ManifestFile` document (EXP-511), and enters a `try` block (EXP-520) that sets the progress state to *in progress* (EXP-518). It then walks `selItemsTable` in table order. For each `(package, items)`:

1. an inner table with no entries is skipped: no manifest entry, no definition lookup, no directory, no message and no log lines;
2. otherwise the package is exported by EXP-509 to EXP-519, in this order: `AddPackage`, the package definition lookup (`new PackageDefinitionManager(..., doCreate: false)`), the dependencies, `CreateOutputDir`, the `currentPackage` message, `ExportProc`;
3. after `ExportProc` returns, a progress state of *cancelled* ends the loop (EXP-518).

After the loop, when the referenced-elements table has any package, EXP-519 runs. The last thing the `try` block does is send `currentPackage` with an empty text, so a host can clear its label. That message is not sent when an exception leaves the block early; a cancel does reach it.

The order of the outer table decides the order of packages in the log, in the messages and in `imports.mf`. The order of an inner table decides the order of the items.

[12.0] Same loop. The sequence before it differs: after the argument checks `GetSolutions2Xml` runs first, then the log is opened, with no header (EXP-505, EXP-506), then the `currentPackage` message and the empty manifest document are created and the `try` block (EXP-520) is entered.

[14.35] Same walk of the packages, in the same order and with the same steps, and the same final `currentPackage` message. Two additions: the package-element map is built right after `GetSolutions2Xml`, before the manifest document (EXP-550), and the *cancelled* state that ends the loop is now also set by a failed item (EXP-555), and is checked after each package's `ExportProc` in the same place.

### EXP-509: A package definition must exist: PackageDefinitionManager with doCreate false

[14.0.7] `new PackageDefinitionManager(helper, packageName, doCreate)` stores the helper and the name and calls `InitSolution(doCreate)`. For an export `doCreate` is false.

`InitSolution` sends `ApplyItem`:

```xml
<Item type='PackageDefinition' select='id,name,generation' action='get'><name>{package}</name><is_current>1</is_current></Item>
```

- On success it takes the text of the first `.//Item[@type='PackageDefinition']/id` of the response as the package definition id, which later requests carry as `source_id`. A response without it (null node) is a `NullReferenceException`, converted below.
- On a `CItemException` it rethrows it unless `faultcode` is `0` **and** `doCreate` is true. With `doCreate` false, a missing package definition (faultcode `0`, `No items of type PackageDefinition found.`) is therefore an error. With `doCreate` true (import), faultcode `0` instead sends `<Item type='PackageDefinition' action='add'><name>{package}</name></Item>` and reads the id from that response.
- A `CItemException` that leaves the lookup has ` Fails to init solution to PackageDefinition: {package}` appended to its `faultdetail`, and is rethrown. It escapes `ExportSolutions` (EXP-542).
- Any other exception is wrapped in a new `CItemException(-1, <stack trace>, <message> + " Fails to init solution to PackageDefinition: {package}", <inner>)`, which also escapes.

*Observed* (`r2`, a package that does not exist): the manifest holds the package's entry, the run stops with the `CItemException` of WIRE-051 whose request is the AML above and whose faultcode is `0`, no message was sent, and the log holds the header only.

[12.0] Same as 14.0.7.

[14.35] Same (`PackageDefinitionManager` is unchanged).

### EXP-510: Each dependency of a package contributes referenced elements

[14.0.7] With the package definition known, `ExportSolutions` selects the package's dependencies from the response of EXP-507:

```text
.//Item[@type='PackageDefinition' and name='{package}']/Relationships/Item[@type='PackageDependsOn']/name
```

The package name is interpolated unescaped (EXP-544). The nodes come in document order. For each, with `dep` its text:

1. a null or empty `dep` is skipped; a whitespace-only `dep` is not, and fails in step 2 with `ArgumentException` `Name of 'dependson' package can't be 'null' or empty` (EXP-520);
2. `AddDependsOn(packageNode, dep)` finds or creates the `dependson` entry (EXP-511);
3. `FindReferencedElements(dep)` returns the referenced elements, which the loop walks in order, adding each to the manifest (`AddReferencedElement`, EXP-511) and, when `bExportReferencedItems` is set, to `refsToExport` (EXP-512).

A dependency named twice for one package runs steps 2 and 3 twice: the manifest entries merge, and the request is sent twice.

`FindReferencedElements(dep)` sends:

```xml
<Item type='PackageDependsOn' levels='1' configPath='.|PackageReferencedElement' select='id|element_id,element_type,element_description' action='get'><name>{dep}</name><source_id>{package definition id}</source_id></Item>
```

and reads `//Item[@type='PackageReferencedElement']` from the whole response, in document order. For each such node:

- `element_id` missing, or blank after .NET's `Trim()`, throws `CItemException(-1, "", "Referenced element doesn't have 'element_id' set", null)`. `element_type` likewise names `'element_type'`;
- `element_description`, when present and not blank after `Trim()`, is the keyed name as written (untrimmed); otherwise the keyed name is the empty string;
- the element becomes `ExportItem(keyedName, element_id text, element_type text)`, with the texts untrimmed.

The elements found so far are dropped when one node fails. The error handling:

- a `CItemException` with faultcode `0` (the dependency row does not exist) is swallowed, and the result is an empty list. That covers a dependency that is not a package of the database;
- any other `CItemException`, including the two above (faultcode `-1`), gets ` Failed to find referenced elements for package '{package}'` appended to its `faultdetail`, where `{package}` is the package being exported and not `dep`, and is rethrown (EXP-542);
- any other exception becomes `CItemException(-1, <stack trace>, "<message>; Failed to find referenced elements for package '{package}'", <inner>)` and escapes the same way.

*Observed* (`r1`): request 9 for dependency `com.aras.innovator.ssvc` returned no referenced elements, and the run went on. Dev has no `PackageReferencedElement` rows, so the element branch is inferred.

[12.0] Same as 14.0.7.

[14.35] Same (the dependency query, `FindReferencedElements` and the error handling are unchanged).

### EXP-511: The manifest document gets one entry per package, dependency and referenced element

[14.0.7] `ExportSolutions` builds a new `ManifestFile`, whose document is `<imports/>`, and fills it as the loop goes. Each add finds an existing entry with an XPath that interpolates the name unescaped (EXP-544) and creates the entry only when none exists:

| Call | XPath used to find an entry | New element |
|---|---|---|
| `AddPackage(name)` | `imports/package[@name='{name}']` | `package` appended to `imports`, with attributes `name` and `path`, in that order |
| `AddDependsOn(package, dep)` | `dependson[@name='{dep}']` under the package | `dependson` appended to the package, with attribute `name` |
| `AddReferencedElement(dependson, item)` | `referenced_element[@id='{id}']` under the `dependson` | `referenced_element` appended, with attributes `id`, `type` and `descr`, in that order |

- `path` is `.\` for a standard package (`com.aras.innovator.*` except `com.aras.innovator.solution.*`, or `com.aras.defaults.*`, the latter case-insensitively), and `{last segment}\Import` for any other, where the last segment is the regex match `([^\.]+)$` of the name (the empty string when the name ends in a dot). The directory rule of EXP-513 uses the same split.
- `id`, `type` and `descr` are the item's `idName`, `typeName` and `keyedName`.
- `AddDependsOn` with a null, empty or whitespace-only name throws `ArgumentException` with the `EmptyDependencyPackageMessage` text. A null node argument throws `ArgumentNullException`.
- `AddPackage` runs before the package definition lookup (EXP-509), so a package whose lookup fails is still in the saved manifest (EXP-520), and `dependson` entries are written even when their dependency has no referenced elements. Referenced elements are always written, whether or not `bExportReferencedItems` is set. Packages exported only in the referenced pass (EXP-519) are not added (EXP-540).

The manifest is saved by `ManifestFile.Save` to `WorkingDirectory + "\imports.mf"` in a `finally` block (EXP-520), always, even when nothing was exported (`<imports />`). The byte format of the saved file is specified with the manifest rules (`spec/manifest.md`, `MAN-`).

*Observed* (`r1`, `r6`, `r5`): `<imports>`, a `package name="com.aras.innovator.servicereporting" path=".\"` with `<dependson name="com.aras.innovator.ssvc" />`, a non-standard package as `path="configurator\Import"` and an empty `<imports />`, in 2-space indentation with CRLF, no BOM and no final line end.

[12.0] Same as 14.0.7.

[14.35] Same entries and attributes. The manifest is saved to `Combine(WorkingDirectory, "imports.mf")` (EXP-460). The path is computed after the package-element map (EXP-550) and before the `try` block, so a null working directory throws `ArgumentNullException` (parameter `path1`) from `ExportSolutions` before anything is exported or saved. The `path` attribute of a package entry is still written with literal backslashes (`.\` or `{last segment}\Import`), not with `Combine`.

### EXP-512: refsToExport collects referenced elements by dependency, by insertion order

[14.0.7] When `bExportReferencedItems` is set, `ExportSolutions` fills a `Hashtable refsToExport` from package name (the dependency's name, not the exporting package's) to an inner `Hashtable` from `idName` to `ExportItem`. `AddToRefsForExport(refs, dep, item)` does, in this order:

1. `refs.Contains(dep)`: if true, take the inner table `refs[dep]`; otherwise create `new Hashtable()` and `refs.Add(dep, inner)`;
2. `inner.Contains(item.idName)`: if false, `inner.Add(item.idName, item)`.

So the first element with an id wins, and a later one with the same id (from another package that depends on the same package, or a repeated row) is dropped. The outer table gets one `Add` per distinct dependency name, in order of first occurrence. The inner table gets one `Add` per distinct id, in order of first occurrence. Both facts matter because `Hashtable` enumeration depends on the insertion sequence (ticket 07). The occurrence order is the loop order of EXP-508 and EXP-510: packages in table order, dependencies in document order, elements in response order.

With the setting off the table stays empty, so there is no second pass.

[12.0] Same as 14.0.7.

[14.35] Same. `refsToExport` is built by the thread that runs `ExportSolutions`, before any worker starts, so its order does not depend on timing.

### EXP-513: A package is exported into its own directory, with a per-package log header

[14.0.7] For each package, `ExportSolutions` calls `CreateOutputDir(package)`, sends `currentPackage` `Exporting package {package}`, and calls `ExportProc(exportContext, directory, items, package, log)`.

`CreateOutputDir` returns `WorkingDirectory + "\" + X`, after deleting that directory recursively when it exists and creating it. `X` is the name with `.` replaced by `\` for a standard package, and `{last segment}\Import` otherwise. Its details, the wipe and the last-segment collision (EXP-519 relies on it), are specified with the file layout (`spec/export-write.md`).

`ExportProc` starts with the log lines (`ExportSolutionName`, then `StartOfExecutionDateTime`):

```text
         ****Export {package}****
start of execution : {now}
```

and then:

- creates its `status` message;
- sets `ItemHelper.Folder` to the directory (the `dir2Import != null` test is always true);
- creates the `excludedRefs` table, a fresh `Hashtable`, unless `RefToUnknownPacks` is `DoNotRemove`, when it is null (EXP-514);
- takes the item count `n` as the inner table's entry count and starts the item index `i` at 1.

*Observed* (`r1`): `         ****Export com.aras.innovator.servicereporting****` and `start of execution : 10/18/2026 05:22:16`.

[12.0] Same, except that the `start of execution : {now}` line uses the current culture (EXP-505). Observed on the oracle machine: `start of execution : 19-10-2026 01:17:50`.

[14.35] Same package folder (EXP-414, built with `Combine`), message and log header. `ExportProc` then also creates the progress logger and starts it (EXP-554), and the item index `i` becomes the shared counter of EXP-552. The folder is wiped and created before the workers start and nothing else touches it while they run.

### EXP-514: Items are exported one at a time, in table order

[14.0.7] `ExportProc` walks the inner table in table order. For each item:

1. it yields the thread (no observable effect);
2. a progress state of *cancelled* ends the package (EXP-518);
3. it sends `status` `Item {i} of {n}: {typeName} - {keyedName}` (the type before the keyed name);
4. it calls `CItemHelper.PackageItem(item, package, sLevel, excludedRefs)` (EXP-515).

`i` starts at 1 and grows after each item that was exported or failed without aborting. `n` is fixed at the start. The value of the table is cast to `ExportItem`.

`excludedRefs` collects references removed from the exported items when `RefToUnknownPacks` is not `DoNotRemove`. It is filled by `RemoveReferencesToAnotherPackages`, which the unknown-package rules specify (`EXP-600`–`EXP-699`), with an `Add` behind a `ContainsKey` guard. Its keys and its insertion order decide the order of EXP-517's blocks. The table lives for one `ExportProc` call, so each package starts empty, and every item of the package shares it.

*Observed* (`r3`): `Item 1 of 3: List - Report Format Types`, then `Item 2 of 3: List - Nope Two` and `Item 3 of 3: List - Nope One`, where the second and third items come in table order and not in the order they were passed.

[12.0] Same as 14.0.7.

[14.35] The items run concurrently, not one at a time: EXP-551 (the model and the sources of nondeterminism), EXP-552 (the index `i`), EXP-553 (the status message) and EXP-554 (the logger). The table order of the items still decides the order in which items start. The check for *cancelled* is made at the start of each item (EXP-557).

### EXP-515: A successful item is logged

[14.0.7] `PackageItem` builds a `CExportItems` for the helper and calls its `Export(item, package, sLevel, excludedRefs)`, which does the whole item (the other `EXP-` documents). When that returns, `ExportProc` writes to the log:

```text
Item id :{idName}  keyed_name : {keyedName}   type : {typeName} successfully exported
```

Nothing is sent as a message. `PackageItem` and the `Folder` property of the helper, which the item export reads for its file paths, have no behaviour beyond this.

*Observed* (`r1`): `Item id :1854A8A75F5940A78369146966674FA6  keyed_name : Report Format Types   type : List successfully exported`.

[12.0] Same as 14.0.7.

[14.35] The success line is not written by the worker: it is queued on the progress logger (EXP-554) after `PackageItem` returns, and the logger writes it. Its text is the same. Nothing is sent as a message. The line of an item that finishes after a failure or a cancel is lost (EXP-570).

### EXP-516: A failed item asks the host whether to abort the package

[14.0.7] Only a `CItemException` out of `PackageItem` is handled per item. (Item-level errors that the export converts to it are in the item rules; an `IOException` and the like are not converted and end the whole run, EXP-520.) For a failed item, in this order:

1. `status`: `Error of exporting Item id :{idName}  keyed_name : {keyedName}    type : {typeName}`;
2. the same text as one log line;
3. the log gets `ErrorMessageStringDetailCode` with the exception's `faultstring`, `faultdetail` and `faultcode` (as an invariant integer), as one log line. The branch that adds a `faultAML` block (`ErrorMessageStringDetailCodeAML`, and a line to stderr) is taken when `faultAMLError` is non-empty. Nothing in the engine ever assigns that field, so the branch is dead;
4. `errorQuestion` with `ErrorMessageStringDetailCodeAbortCurrentExportOfSolutionName` (`faultstring`, `faultdetail`, `faultcode`, the package name);
5. if the answer is `true`, the package is aborted: the log gets `end of execution : {now}`, `status` is `completed`, and `ExportProc` returns. EXP-517's blocks and warning are skipped, so the removed references already collected for the package are not logged, and the cancel check is not made. Otherwise the item is skipped, `i` grows and the loop goes on.

An abort ends the current package only (EXP-508 goes on with the next package and, later, the referenced pass).

The two texts differ in spelling on purpose: the log's `faultdetail: ` has its colon right after the word, the question's `faultdetail :` has a space before it. For a request that failed, `faultstring` is the `Server error` text of WIRE-051, so both repeat the request AML and the response envelope.

*Observed* (`r3`, answer `no`; `r4`, answer `yes`), for an item that does not exist:

```text
Error of exporting Item id :00000000000000000000000000000002  keyed_name : Nope Two    type : List
      ******Error message******
faultstring: Server error

Request: <Item type="List" action="get" levels="1"><id>00000000000000000000000000000002</id></Item>

Responce: <SOAP-ENV:Envelope …>…</SOAP-ENV:Envelope>
faultdetail: No items of type List found.No items of type 'List' found using the criteria: 
<Item type="List" action="get" levels="1"><id>00000000000000000000000000000002</id></Item>

faultcode:   0
     **********************
```

With `no`, the third item was tried and failed the same way, and the package ended with `end of execution`; with `yes`, `status` `completed` followed the first failure and the third item was never tried.

[12.0] The same steps, status and question texts, and the same decision. The log lines differ in two respects:

1. The first log line has one space before `type`: `Error of exporting Item id :{idName}  keyed_name : {keyedName} type : {typeName}`. The `status` text keeps four (`…keyed_name : {keyedName}    type : {typeName}`).
2. The block is written as separate lines, not from one template, with the same bytes as 14.0.7's `ErrorMessageStringDetailCode` text: `      ******Error message******`, `faultstring: {faultstring}`, `faultdetail: {faultdetail}`, `faultcode:   {faultcode}`, `     **********************`, each ended by CR LF. A `faultAML` block (the lines `faultAML:` and the text, in the log and on stderr) would sit before the closing line; it is dead as in 14.0.7.

For a failed request, `faultstring` is the response's outer XML and not the `Server error` text (WIRE-006). Observed (12.0, an item that does not exist):

```text
Error of exporting Item id :00000000000000000000000000000002  keyed_name : Nope Two type : List
      ******Error message******
faultstring: <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault …>…</SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>
faultdetail: No items of type List found.No items of type 'List' found using the criteria:
<Item type="List" action="get" levels="1"><id>00000000000000000000000000000002</id></Item>

faultcode:   0
     **********************
```

With the answer `yes` the log gets `end of execution : {now}` in the current culture (EXP-505).

[14.35] Replaced by EXP-555: a failed item stops the whole export and the host's answer is not read. Steps 1 to 4 (the status text, the log text, the fault block and the question) are the same, and the fault block now holds the pretty-printed request and response of WIRE-051. Steps 5 and later are not.

### EXP-517: A package ends with its removed references, a warning and a completion

[14.0.7] When the loop of EXP-514 ends without a cancel or an abort, `ExportProc`:

1. when `excludedRefs` exists and has entries, writes one block per `RemovedReference`, in the order of `excludedRefs.Values`:
   ```text
   {LF} --- REMOVED REFERENCE ---
   From:{tab}{From}
   To:{tab}{To}
   Reason:{tab}{Reason}
   ```
   The first line is `WriteLine("\n --- {0} ---", "REMOVED REFERENCE")`: a lone LF, then ` --- REMOVED REFERENCE ---` and a CRLF, so the log shows an empty LF-terminated line before it. `From`, `To` and `Reason` are the texts of the `RemovedReference` (unknown-package rules, `EXP-600`–`EXP-699`);
2. when `RefToUnknownPacks` is `RemoveWithWarning` and the table had entries, sends `warning` with `ThereAreReferencesToUnknownPackagesThatWereRemovedDuringTheExportOfThePackageSolutionNameSeeLogFileForMoreDetailsSearchForWordsRemovedRefError` (the package name and `REMOVED REFERENCE`);
3. writes `end of execution : {now}` to the log;
4. sends `status` `completed`.

`RemoveSilently` writes the blocks and sends no warning. With `DoNotRemove`, or when nothing was removed, steps 1 and 2 are skipped.

An empty inner table cannot reach here from `ExportSolutions` (EXP-508 skips it), but a referenced table cannot be empty either (EXP-512), so the loop always runs at least once.

*Observed* (`r6`, `RemoveWithWarning`, item `ScopeCacheDependency` of `com.aras.innovator.configurator`): after the item's success line, three blocks, each `From:{tab}[com.aras.innovator.configurator].[ItemType].ScopeCacheDependency (ID='A22E…1459')` with a different `To:` (`[Method].868F…`, `[ItemType].A8C3…`, `[ItemType].0B47…`) and the item-type `Reason:`; then `end of execution`. The messages were `currentPackage`, `status` (item), `warning` ("…package 'com.aras.innovator.configurator'.\nSee log file for more details (search for words 'REMOVED REFERENCE')"), `status` `completed` and `currentPackage` "".

[12.0] Same as 14.0.7.

[14.35] Same blocks, warning, `end of execution` and `completed`, written by the thread that runs `ExportProc` after the loop, so after the final drain of the logger has put every success line in the log (EXP-554). They are reached only when no item failed and no cancel was seen. The blocks follow `excludedRefs.Values` in the table's order, which depends on the insertion sequence; the workers insert in the order their items finish, so the order of the blocks is not that of the table (EXP-551). Each block is four separate `WriteLine` calls, so blocks of a package are written by one thread in sequence and are not mixed with other lines, as the workers have finished.

### EXP-518: Cancel is a flag that two places look at

[14.0.7] `Cancel()` sets the manager's progress state to *cancelled*. `ExportSolutions` sets it to *in progress* when its `try` block starts and to *idle* in `finally` (EXP-520). So:

- a `Cancel()` before the `try` block starts is overwritten and has no effect;
- `ExportProc` looks at the flag at the start of each item's turn (EXP-514 step 2). When set, it sends `status` `Export was canceled by user`, writes the same text and then `end of execution : {now}` to the log, and returns. It does not send `completed`, and it ends no sooner than the next item's turn: a cancel that arrives during the last item of a package is not seen by that package's loop;
- `ExportSolutions` looks at the flag after each package's `ExportProc` returns, and ends the package loop;
- `ExportReferencedElements` looks at it after each referenced package, and ends its loop;
- nothing else looks at it. In particular, the lookups before a package's items (definition, dependencies, directory) run to the end, and a package whose table is empty is never cancelled.

After a cancel the run still passes the referenced pass (EXP-543), sends the empty `currentPackage` and saves the manifest (EXP-520). It ends normally, with no error.

[12.0] Same, and the two `end of execution : {now}` lines that this and EXP-516 write after a cancel or an abort use the current culture (EXP-505).

[14.35] Replaced by EXP-557 for the item loop: the flag is looked at at the start of every worker's turn and the cancel text can be written several times. `ExportSolutions` looks at the flag after each package's `ExportProc` as before, and the referenced pass is entered after a cancel as before (EXP-543).

### EXP-519: Referenced elements are exported in a second pass

[14.0.7] After the package loop (and also after a cancel, EXP-543), when `refsToExport` has any package, `ExportReferencedElements(exportContext, refsToExport, log)` walks `refsToExport.Keys` in table order. For each dependency package `dep`:

1. `CreateOutputDir(dep)`: the output directory of `dep`, wiped when it exists (EXP-513). A referenced package with the same directory as a package exported earlier in the run, for example a dependency that was also asked for, deletes that package's output;
2. sends `currentPackage` `Exporting referenced items from '{dep}'`;
3. calls `ExportProc(exportContext, directory, inner table, dep, log)`. `ExportProc` behaves as EXP-513 to EXP-517, with `dep` as the package name: the log header `****Export {dep}****`, the status and error messages, the item index over this table, and `dep` as the package of `PackageItem`, whose unknown-package checks then use `dep` as "this package";
4. a progress state of *cancelled* ends the loop.

The items are the referenced elements of EXP-510, exported as ordinary items with the keyed name from `element_description`. `AddPackage` is never called for `dep`, so the second pass does not appear in `imports.mf` (EXP-540). Referenced elements are collected only when `bExportReferencedItems` is set, and the pass never runs otherwise.

[12.0] Same as 14.0.7.

[14.35] Same pass, with the same wipe and the same messages. It is also entered after a failed item, because the flag that the failure sets ends only the package loop (EXP-555); it then does no export work. Each referenced package runs the concurrent `ExportProc` of EXP-551.

### EXP-520: Errors of the run, and what always happens at the end

[14.0.7] The package loop, the referenced pass and the final message run inside one `try` block with a `catch` for `SystemException`, a `catch` for thread abort and a `finally` block.

- A `SystemException` anywhere inside the block ends the whole run: the remaining packages and the referenced pass are skipped, and no `end of execution`, `completed` or empty `currentPackage` is sent for the package in flight. The engine sends `warning` with `ErrorMessageMessage` (the exception's message) and writes the same text and a line end to the log. `ExportSolutions` then returns normally. The family includes `IOException` (disk errors, a locked directory), `XmlException` and `XPathException` (including those of EXP-544), `NullReferenceException`, `ArgumentException` (EXP-510, EXP-511), `InvalidCastException` and `FormatException`.
- A `CItemException` does not derive from `SystemException`. It is caught per item (EXP-516) only. From the package-definition lookups (EXP-509, EXP-510) it escapes `ExportSolutions` (EXP-542).
- A thread abort is swallowed silently. The port has no thread abort: cancel (EXP-518) is the supported way to stop a run.
- The `finally` block runs for every exit of the block, including an escaping exception: the progress state becomes *idle* and the manifest is saved to `WorkingDirectory + "\imports.mf"` (EXP-511). A failure to save, for example when the working directory does not exist, replaces the exception in flight.
- The log writer is disposed on every exit of `ExportSolutions`, which flushes it.

Failures before the block (EXP-500, the header, EXP-507's log sharing) save no manifest.

*Observed* (`r5`, package name `LIBSJS-SCRATCH-O'B`): the `AddPackage` XPath failed, the `warning` text was `          ****ErrorMessage****\r\n       'imports/package[@name='LIBSJS-SCRATCH-O'B']' has an invalid token.`, the log got the same two lines after the header, no directory was created and the manifest was `<imports />`. (`r2`: the `CItemException` of EXP-509 escaped, the manifest kept the package entry.)

[12.0] The same structure. The warning and the log text of a `SystemException` is the 12.0 text of `ErrorMessageMessage` (EXP-504), with its closing line: `          ****ErrorMessage****\r\n       {message}\r\n          *******************`. The `finally` block saves the manifest through `ManifestFile.Save` with the raw path (MAN-006).

[14.35] The block has one more `catch`, for `AggregateException`, in front of the `SystemException` one (EXP-556). Everything else is as written: a thread abort is swallowed, the `finally` block resets the state and saves the manifest, and the writer is disposed on every exit. A `CItemException` raised outside the workers still escapes (EXP-542). The text of the warning is the new `ErrorMessageMessage` (EXP-504). The failures before the block save no manifest, and the null package list is one of them (EXP-550).

## 14.35: the parallel run

### EXP-550: The package-element map is built first, and a missing package list ends the run

[14.0.7] `ExportSolutions` reads only the dependencies from the package-definition document (EXP-510). With no package definitions (a null document, EXP-507) the run went on, and failed only when the first package with items needed the document: a `NullReferenceException` inside the `try` block, reported by EXP-520, with the manifest saved.

[14.35] Right after `GetSolutions2Xml` (EXP-507) and before the manifest document, the manifest path (EXP-511) and the `try` block, `ExportSolutions` builds a map from `element_type` to the set of `element_id` for every PackageElement of the document: `GetPackageElementIdsByElementTypeMap(document)`. It selects `//Item[@type='PackageElement']` anywhere in the document, so it covers every package definition of the database and not only the exported ones, and for each Item, in document order:

1. the key is the text of its first `element_type` child. A missing child gives a null key, and `Dictionary.ContainsKey(null)` throws `ArgumentNullException` (`Value cannot be null.\r\nParameter name: key`) (`GP3`);
2. the value set of that key (created on first use) gets the text of its first `element_id` child. A missing child adds a null (`GP4`);
3. strings are compared exactly, untrimmed and case-sensitive; duplicates collapse (`GP1`, `GP5`).

The map is handed to every `PackageItem` call of the run, read by EXP-170, and never changed afterwards.

A null document, which is the `GetSolutions2Xml` result when the database holds no package definitions (EXP-507, whose `warning` has been sent), makes the call throw `ArgumentNullException` with the message `Value cannot be null.\r\nParameter name: dom`. The call is outside the `try` block, so the exception leaves `ExportSolutions` at once. What the run did before it stays: the log file exists and holds the header of EXP-506, the `warning` was sent, nothing else was sent, no directory was created and **no manifest is saved**, not even `<imports />`. It does not depend on what the host asked to export: an empty selection fails too (`S7`, `S7b`; `GP7` for the call itself). The exception is not a `CItemException`, and the host sees it.

*Observed* (`S7`, `S7b`): `warning` "The database contains no package definitions. Please select another database and try again", the exception above, the log holding the header only, and no `imports.mf`.

### EXP-551: The items of a package run concurrently

[14.0.7] One at a time, in table order (EXP-514).

[14.35] `ExportProc` hands the items of the package to `Parallel.ForEach` over the values of its inner table, in table order, with no `ParallelOptions`. Each iteration is one whole `PackageItem` call: the item's requests, its transform and post-processing, and its file write. The loop returns when every iteration that started has ended. Before the first iteration the thread has opened the package (EXP-513), and after the last it continues with EXP-517, so packages are still exported one after another.

- **How many at once.** The engine sets no bound. .NET runs the iterations on thread-pool threads and on the calling thread, starting about as many workers as there are logical processors (the calling thread included) at once and adding more only slowly, about one per half second, while all are blocked. On the machine of the probes (14 logical processors), runs of 12 to 100 items had up to 12 to 15 items in flight at the same time (`S3`, `S10`; `S2` and `S20` hold 6 and 14 in flight by design). The port starts items in table order and runs at most `P` of them at a time, where `P` is `--parallelism`, default the number of logical processors of the host (round 4 Q2, as confirmed in round 5). `--parallelism 1` runs them one at a time.
- **What the order is.** Items start roughly in table order, but the engine hands them to workers in chunks, so the start order is not exactly the table order, and the finish order is whatever the timing gives (`S2`: fetches finished as `A07, A06, A05, …`). Nothing in the output is guaranteed to follow the table: not the log lines, not the messages, not the order of the entries of `excludedRefs`.
- **What is shared.** The helper (`CItemHelper`) and its caches; the per-run table of main requests, keyed by type; the log writer; the `status` message object (EXP-553); the item index (EXP-552); the progress logger (EXP-554); the progress state flag; the table `excludedRefs` of EXP-517, which every worker writes with an `Add` behind a `ContainsKey` and no lock, so the insertion order is the order the adds happen and two adds of one key at once can fail (`ArgumentException`, *inferred, not seen*); the package-element map (read only, EXP-550); and the file system (EXP-419).
- **The caches** are filled once per key even when several workers ask together (the request rules, ticket 51). A lookup that fails is not kept.
- **Server load.** The workers share one IOM connection and call the server at the same time. The scripted connection of the probes accepts that; whether a real IOM connection does is not known (nothing in the engine serializes the calls). The port keeps one client and issues the requests of its workers on it.

Every rule that names a log line, a message or a file therefore names a set, not a sequence, for 14.35. EXP-558 says how two runs are compared.

### EXP-552: The item index is a shared counter

[14.0.7] `i` starts at 1 and grows after each item that was exported or failed without aborting (EXP-514).

[14.35] `i` is one variable shared by all workers of the package. A worker reads it once, when its item starts, and uses the value in `Item {i} of {n}` (EXP-514); `n` is the entry count of the table, fixed at the start. After `PackageItem` returns and the success line is queued, the worker does `i++`. An item that fails does not increment, and neither does one that is cancelled. The increment is not atomic, so two workers that finish together can write the same value back and one increment is lost (*inferred; not seen in the runs of the probe*).

So `i` is "1 + the number of items that had finished when this one started", not an index: items that start together say the same number, and a number can be missing or repeated. In `S2` (24 items, six in flight at least) thirteen items started before the first one finished and all said `Item 1 of 24`, then the numbers went `2, 3, 3, 4, …`. The port keeps one shared counter, reads it when an item starts and increments it when an item succeeds, and need not reproduce a lost increment.

### EXP-553: The status message object is shared

[14.0.7] `GetStatusMessage` is called once per `ExportProc` call, and the single object is reused for every text (EXP-503).

[14.35] The same single object is used by every worker, and by the thread that runs `ExportProc`, at the same time. A worker sets `Text` and then calls `Execute`, and nothing joins the two. When two workers interleave, `Execute` can send the text that the other worker has just set. The host then receives a text twice and another one never. This was seen in some runs: the first run of `S1` sent `Item 1 of 4: List - k-A01` twice and never named `k-A04`, and one of three runs of `S2` sent 24 texts that named 23 of its 24 items. The `completed` text that the failed-item handler (EXP-555) and the end of `ExportProc` set goes through the same object.

The port sends each worker's own text. A comparison of the messages accepts a text that is missing or repeated (EXP-558).

### EXP-554: The progress logger writes the success lines

[14.0.7] There is none: the worker writes the success line itself (EXP-515).

[14.35] `ExportProc` creates a `ProgressStreamLogger` on the log writer, after the package header (EXP-513) and before the loop, and starts it. It is created and disposed once per `ExportProc` call. Its life:

- `WriteLine(text)` puts the text on a concurrent queue and returns. It never blocks and never fails.
- `Start()` does nothing if a task already exists; otherwise it starts a task that repeats, until its cancellation token is cancelled: take one line from the queue, if there is one, and write it to the log with `WriteLine`. There is no wait, so the task keeps one processor busy while the loop runs (EXP-575).
- `Complete()` does nothing when there is no task. Otherwise it cancels the token, forgets the task, and then takes every line left in the queue and writes it, on the thread that called it. It never starts the task again.
- `Dispose()` only disposes the cancellation token source. A text queued afterwards is accepted and never written.

Only the success line of EXP-515 goes through the logger. The header, the error block, the cancel text and the end lines are written to the log directly, by the thread that has them, so they can come between the logger's lines.

`Complete()` is called: in the `finally` after the loop (all workers have finished, so every queued line is written before the lines that follow, `end of execution` or the removed-reference blocks); in the failed-item handler before it writes anything (EXP-555); and in the cancel branch before it writes anything (EXP-557). The three can overlap, and the first one to run takes the task, so the others drain what is queued and do not restart it.

The lines of the successes are in the log in the order the logger took them off the queue, which is the order the workers queued them, which is the order their items finished. Right after a `Complete()` the task may still be writing the line it had taken, so two lines can swap places (*inferred*).

### EXP-555: The first failed item stops the whole export

[14.0.7] A failed item asks the host whether to abort its package. Only the answer `true` stops that package, and the other packages and the referenced pass go on (EXP-516).

[14.35] A `CItemException` out of `PackageItem` is handled under one lock that every worker of the process shares. Inside it:

- when the progress state is *cancelled* already (an earlier failure or a `Cancel()`), the handler does nothing at all: no message, no log line, no counter (`S9`: the second of two failing items is not mentioned anywhere);
- otherwise, in this order: `progressLogger.Complete()` (EXP-554); `status` `Error of exporting Item id :{idName}  keyed_name : {keyedName}    type : {typeName}` and the same text in the log; the fault block of EXP-516 step 3 in the log (its `faultstring` is the pretty-printed text of WIRE-051); `errorQuestion` with the abort question of EXP-516 step 4, **whose answer is not read** (`S3` answers `yes` and `S4` answers `no`, with the same outcome); the progress state is set to *cancelled*, the same flag `Cancel()` sets; `end of execution : {now}` in the log; `status` `completed`; `loop.Stop()`.

The effects, from `S3`, `S4`, `S5`, `S9`, `S11` and `S13`:

- **No new item starts** in this package. Items that had not started never run. Items that were running go on to the end: they fetch, transform and **write their files**, and their success lines are not logged (EXP-570). The failing item writes no file.
- **The package ends at once.** `ExportProc` returns right after the loop, because the state is *cancelled*: no removed-reference blocks, no warning, no second `end of execution` and no `completed` (the handler has written them).
- **The remaining packages are skipped.** `ExportSolutions` leaves its package loop after this package (EXP-508). They get no manifest entry, no definition lookup, no directory, no message and no log line. The packages before it, and the failing one with its dependencies and referenced elements, are in the manifest.
- **The referenced pass is entered,** if `refsToExport` has any package, and does the little that EXP-543 describes.
- **The run ends normally.** `ExportSolutions` sends `currentPackage` with an empty text, sets the state to idle and saves the manifest (`imports.mf` with the packages visited so far). No exception reaches the host, which has only the messages to tell it. The host's answer to `errorQuestion` is lost (EXP-571).

The library's `--on-item-error` option therefore has no effect on 14.35: the question is sent and the export stops (EXP-571). Which message the host sees after it is `completed`, then, from the pass if there is one, `currentPackage` and `Export was canceled by user`, and the final empty `currentPackage`.

### EXP-556: Other exceptions end the run through the aggregate handler

[14.0.7] A `SystemException` anywhere in the block ends the run with the warning and the log text of EXP-520.

[14.35] A worker's exception that is not a `CItemException` (and is not one of the three that `Export` converts, EXP-400) escapes the iteration: an `IOException`, an `ArgumentException` from `Path.Combine` (EXP-417), an `UnauthorizedAccessException`, an `InvalidCastException`. The handler of EXP-555 is not involved: no question, no fault block, no counter, no `completed`. `Parallel.ForEach` stops starting iterations, waits for the running ones, and throws one `AggregateException` that holds every exception that escaped, in the order they were recorded (not the table order). Then:

- `ExportProc` leaves through its `finally`, which calls `Complete()` on the progress logger (the lines of the items that finished are written) and disposes it. No `end of execution`, no `completed`, no removed-reference blocks, and the state is not *cancelled*;
- `ExportSolutions` has a `catch` for `AggregateException` in front of the one for `SystemException`. It flattens the exception, joins the messages of the inner exceptions with a line end (`\r\n`), formats them with `ErrorMessageMessage` (EXP-504), sends that as `warning` and writes the same text to the log;
- the remaining packages **and the referenced pass are skipped** (unlike EXP-555: the exception jumps over them), and the empty `currentPackage` is not sent. The manifest is saved as it stands (EXP-520's `finally`).

Items that were running finish and write their files; those that never started do not. Examples: `S8` (one exception), `S14` (two: the warning holds both messages, in the order they were recorded), `S15` (an invalid character in a type name, no request made for it), `S20` (file-sharing violations).

### EXP-557: A cancel is looked at by every worker

[14.0.7] The flag is looked at at the start of each item's turn; the first that sees it writes the cancel text, `end of execution`, and returns (EXP-518).

[14.35] `Cancel()` stores the flag as before, from any thread. Every worker looks at it at the start of its iteration. A worker that finds it set takes a lock of its own (not the one of EXP-555), and inside it: calls `Complete()` on the progress logger, calls `loop.Stop()`, sends `status` `Export was canceled by user`, writes the same text and then `end of execution : {now}` to the log, and returns. It sends no `completed`.

Stopping the loop does not stop the iterations that have been handed to workers already, and each of those that starts after the flag does the same, so **the pair of lines can appear more than once**: between three and ten times in the runs of `S10`. Items that were running go on and write their files, and their success lines are not logged (EXP-570). After the loop `ExportProc` returns at once (the state is *cancelled*), so there are no removed-reference blocks and no `completed`. `ExportSolutions` ends its package loop and enters the referenced pass if there is one (EXP-543, `S12`), sends the empty `currentPackage`, resets the state and saves the manifest. A `Cancel()` after the last item has started is not seen by the loop: the run ends normally, and the state is reset in the `finally` block, so a `Cancel()` before the `try` block starts is overwritten, as in 14.0.7.

The port writes the pair once for the first worker that sees the flag, and starts no item after it. A comparison accepts any positive number of pairs (EXP-558).

### EXP-558: How two runs of 14.35 are compared

[14.35] Two exports of the same items, whether by the engine or the port, give logs, messages and files that agree in these parts and in no others. This is the comparison that the 14.35 fixtures and the live parity use (round 4 Q2; the fixture rule of `fixtures/README.md`).

1. **Fixed.** The log header (EXP-506); every `****Export {package}****` line and its `start of execution` line, in the order of the packages; the `currentPackage` messages in order; the manifest bytes; the exception that leaves `ExportSolutions`, if any; the set of packages visited and the directories created or wiped.
2. **A set, within a package.** The lines between `start of execution` and `end of execution`: the success lines (as a multiset of lines, EXP-515), the removed-reference blocks (as a multiset of blocks, EXP-517), the error block and the cancel pair. Their order is not compared. A success line may be missing when its item finished after a failure or a cancel (EXP-570). The cancel pair counts as present once or more.
3. **Messages.** The `status` texts `Item {i} of {n}: {type} - {name}` are compared by item, ignoring `{i}`, and a text may be missing or repeated (EXP-552, EXP-553). The messages of the other channels are compared as sequences, with the failed-item messages of EXP-555 once.
4. **Files.** The files of items that finished before any failure or cancel are present with the same bytes. A run with a failure or cancel may hold files of items that were in flight, and the set of those is not fixed. An item that failed has no file.
5. **A failed or cancelled run** has the shape of EXP-555 or EXP-557: no second package, the referenced pass entered or not, the closing messages.

The rule gives nothing for the timing: the engine's own runs differ from each other in these parts, and the fixtures record several runs where it matters.

## Reproduced bugs, 14.35

### EXP-570: The progress logger loses the lines of items that finish after an error or a cancel (bug)

[14.35] `Complete()` forgets the task and nothing starts it again (EXP-554), and the failed-item handler and the cancel branch call it while other items are still running. The success lines of those items are queued afterwards and never written, although their files are. In `S11` (twelve items; the failing one delayed so that four had finished before it and seven after) the log holds the success lines of the four items done before the error and none of the seven done after, and all eleven files exist. In `S3`, where all twelve were in flight when the error came, the log holds no success line at all. It is reproduced. See `bugs.md`.

### EXP-571: The host's answer to the error question is ignored (bug)

[14.35] The failed-item handler sends the abort question (EXP-555) and never reads the answer. `true` and `false` both stop the whole export (`S3`, `S4`). A host cannot choose to continue past a failed item, and the library's `--on-item-error` has nothing to act on. It is reproduced. See `bugs.md`.

### EXP-572: A stop does not stop what is running, and later failures are silent (bug)

[14.35] After a failed item or a cancel, items that are already running finish and write their files, while the export reports that it stopped (EXP-555, EXP-557). A second failed item, or a failure after a `Cancel()`, finds the state *cancelled* and is dropped without a message or a log line, so only the first failure of a run is reported (`S9`). The files of the items in flight are not in the log (EXP-570). It is reproduced. See `bugs.md`.

### EXP-573: The item numbers and the status texts race (bug)

[14.35] The index `i` is a shared variable that is read and incremented without a lock (EXP-552), and the status text is set and sent through one shared object without a lock (EXP-553). Items that start together show the same number, a text can be sent twice while another is never sent, and an increment can be lost. It is reproduced as far as the comparison of EXP-558 needs: shared counter, shared message, no lock. See `bugs.md`.

### EXP-575: The progress logger keeps a processor busy (deviation, not reproduced)

[14.35] The task of `ProgressStreamLogger` repeats "take a line, write it" with no wait while the loop runs (EXP-554), so it uses a full processor until `Complete()`. The only observable effect is the load, and the port's loop waits for the next line instead. It is a deviation. See `bugs.md`.

## Reproduced bugs

### EXP-540: Packages exported in the referenced pass are missing from the manifest (bug)

[14.0.7] Referenced packages are exported into their own directories and logged (EXP-519), but `imports.mf` lists only the packages of the main loop, because `ExportReferencedElements` never calls `AddPackage`. The manifest has `dependson` entries naming those packages, with their `referenced_element` children, but no `package` entry for them, so an import from the manifest does not import them. See EXP-511 and EXP-519. *Inferred from the code*; dev needs seeded referenced elements (ticket 67) to observe it.

[12.0] Same as 14.0.7.

[14.35] Same.

### EXP-541: A package-definition query that fails inside an export crashes on the log file (bug)

[14.0.7] `GetSolutions2Xml` writes its error to the log through a second writer on `LogFilePath` (EXP-507). When `ExportSolutions` calls it, its own writer (EXP-505) still holds the file open for writing with read sharing only, so the second open fails with `IOException`, `The process cannot access the file '{path}' because it is being used by another process.` The exception comes from `GetSolutions2Xml`, which `ExportSolutions` calls before its `try` block, so it escapes: the `error` message was already sent, the header is flushed when the writer is disposed, the first request fails, no manifest is saved and nothing else is created. The second open uses the raw `LogFilePath`, not the normalised path of EXP-505. *The sharing failure is proven with a .NET Framework probe of two `StreamWriter(path, true)` on one file; the faultcode ≠ 0 response was not provoked on dev.*

[12.0] Not present. `GetSolutions2Xml` runs before the engine opens its own log writer, so its second writer succeeds (EXP-507). The bug is 14.0.7's only.

[14.35] Same. The writer that `ExportSolutions` holds is a `StreamWriter` inside a synchronized wrapper; the second `StreamWriter` of `GetSolutions2Xml` fails to open the file for the same reason. *Inferred from the code; the faultcode ≠ 0 response was not provoked.*

### EXP-542: A missing package definition aborts the whole export (bug)

[14.0.7] `CItemException` is not a `SystemException`, so the handler of EXP-520 does not catch it. A package that has no current definition (EXP-509), a failing dependency query or a referenced element without id or type (EXP-510) escapes `ExportSolutions`, after the manifest is saved in `finally`: the packages after it, the referenced pass and the `currentPackage` clearing are skipped, no warning is sent, nothing is logged for it, and the host sees the exception. The packages before it keep their directories, and the failing package keeps its `package` entry (EXP-511) and, for a lookup that fails after `AddPackage`, no directory. The same failure on the query of the item (EXP-516) is handled per item.

[12.0] Same as 14.0.7.

[14.35] Same. The `CItemException` of the package-definition lookups is raised on the thread that runs `ExportSolutions`, outside the workers, and the aggregate handler does not take it.

### EXP-543: A cancel during the main loop still runs the referenced pass (bug)

[14.0.7] The main loop stops on *cancelled* (EXP-518), but the referenced pass that follows it is conditional only on `refsToExport` being non-empty. After a cancel it still wipes and recreates the first referenced package's directory, sends `currentPackage`, writes that package's log header and then, at its first item, the cancel text and `end of execution` (EXP-518), and stops after that one package. A table with no items never sees the flag. The directory of a dependency that is also a main package is wiped (EXP-519), so a cancelled run can delete output it had finished. *Inferred from the code.*

[12.0] Same as 14.0.7.

[14.35] Wider. The referenced pass is entered after a cancel as before, and also after a failed item (EXP-555), because both leave the flag *cancelled* and the pass tests only `refsToExport`. It wipes and recreates the first referenced package's directory, sends `currentPackage` `Exporting referenced items from '{dep}'`, and `ExportProc` writes `****Export {dep}****` and `start of execution`, then, at its first item, `Export was canceled by user` as `status` and in the log, and `end of execution`. No item of it is fetched, and the pass stops after that package. After a failed item the text `Export was canceled by user` is therefore misleading. Observed in `S5` (a failure in the first package) and `S12` (a cancel). A failed item inside the pass stops the export in the same way (`S13`).

### EXP-544: Package and dependency names are interpolated unescaped into XPath and AML (bug)

[14.0.7] The package name goes unescaped into the XPath of EXP-510, the manifest XPaths of EXP-511 and the AML of EXP-509, and the dependency name into the manifest XPath, the AML of EXP-510 and the lookups of the second pass. A name with an apostrophe makes the XPath malformed, which is a `SystemException` (`XPathException`), so the whole run ends with the warning and log text of EXP-520, with the manifest saved as it stood. For the manifest's `package` XPath the text is `'imports/package[@name='{name}']' has an invalid token.`, as the `.NET` XPath compiler words it; other malformed names give other `.NET` wordings. A name that closes the literal and adds a valid predicate is accepted and selects other nodes. The port interpolates exactly and reports the `.NET` message of the same defect. *Observed* (`r5`).

[12.0] Same as 14.0.7.

[14.35] Same (`ManifestFile` and the XPath expressions are unchanged).
