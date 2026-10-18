# Import orchestration, package registration, the audit row and SQL items

This document specifies what `ImportExportManager.ImportSolutions` does around the per-item import: the log, the order of the packages, the per-package buffered log, the loop over a package's items, the cancel and failure paths, every message and log line, and the return codes. It also specifies what the engine records in the database around the items: the package definition (`PackageDefinitionManager`), its dependencies and referenced elements, the package groups and elements, the `DatabaseUpgrade` audit row (`WriteReleaseData`), and the delete-then-add handling of SQL items (`DeleteSqlItems`). The rules are `IMP-400` to `IMP-499`.

What happens inside one item is other documents: loading and ordering the items (`spec/import-load.md`, `IMP-001`–`IMP-099`), the reference checks (`spec/import-checks.md`, `IMP-100`–`IMP-199`), the delayed resolution (`spec/import-delayed.md`, `IMP-200`–`IMP-299`) and merge, `doImport`, the skip of existing items and `DoesItemAlreadyExist` (`spec/import-merge.md`, `IMP-300` to `IMP-352`). This document stops at the calls to those and picks up when they return or throw. The package order is `MAN-020` to `MAN-025`, and the package path is `MAN-030` to `MAN-033`.

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`, never committed): `ImportExportManager` (`ImportSolutions`, `ImportPackage`, `ImportProc`, `GetSolutions2Xml`, `LogInputParameters`, `LogError`), `PackageDefinitionManager`, `CItemHelper` (`WriteReleaseData`, `DeleteSqlItems`, `GetPackageGroupIdOrCreateIfNotExists`, `GetLabelOfItemType`, `ItemExistById`, `Islocked`, `Unlock`, `GetConfigId`), `ExportImportBase.IsImportableType`, `SUImportContext`, `ResourceManager`;
- `fixtures/import-run/`, the probe of the real 14.0.7 engine. It runs `ImportExportManager.ImportSolutions`, `PackageDefinitionManager` and the `CItemHelper` methods above from a staged copy of the vendored `Libs.dll` on .NET Framework 4.8 (Windows PowerShell 5.1). The connection is a stub that never touches a network: it records the AML IOM hands it and answers from a small model of the server. Package folders, the manifest and the log are real files. Where a rule says *observed* it quotes `probe-14.0.7.txt` by scenario name (`s01-basic` …). **What the stub answered is the probe's model of the server and not evidence of what Aras answers.** Everything a rule says about the server's replies (what an `add` returns, what an empty element in a `get` matches, what `id=''` does) is *inferred* until the import fixtures of wayfinder ticket 25 record it.

Conventions used below:

- **The package log** is the in-memory log of one package (`IMP-406`). **The log** is the engine's log file (`EXP-505`). **A message** is one of the channels of `EXP-503`; import uses `status`, `warning` and `error` (`IMP-471`). **The console** is the engine host's standard output (`IMP-421`).
- **`{x}`** is a value interpolated by `string.Format` with the invariant culture, or by string concatenation. Values put into AML or XPath are never escaped (`AGENTS.md` rule 7), except where a rule says the engine builds the AML through the DOM (`IMP-445`).
- **CRLF** is `\r\n`. A text that holds `\n` alone says so. `WriteLine` ends a log line with CRLF (`EXP-505`).
- **A recorded request** is the AML as IOM hands it to the connection (`WIRE-004`): attributes in double quotes, an empty element as `<x />`. Where the text of a fault or an exception message repeats the request, it repeats the engine's own concatenated text with single quotes instead (`WIRE-051`).
- **A CItemException with faultcode 0** is the server's "no items found" answer (`WIRE-052`). The engine tests `faultcode == 0` to mean "does not exist".

## The run

### IMP-400: ImportSolutions takes a list of package names and an import context

[14.0.7] `ImportSolutions(packagesToImportList, importContext)` is the whole import of one or more packages of the manifest. Its inputs:

- `packagesToImportList`: an untyped collection of package names, in the order the host wants them. The engine reorders it (`IMP-404`). A null list is not checked: it fails later, inside the guarded block, with a `NullReferenceException` that `IMP-407` turns into the failure return `1` (*observed*, `s32-null-context`: the package-list request is sent, then the run ends with `Object reference not set to an instance of an object.`).
- `importContext`: the `SUImportContext` of `IMP-401`. A null one throws `ArgumentNullException` (parameter `importContext`) before anything else happens: no log is opened, no request is sent, no message is sent (*observed*, `s32-null-context`).

Then the run goes in this order: the progress state is set to *in progress* (`IMP-409`), the status message object is created (`GetStatusMessage`), the log is opened (`IMP-403`), and the guarded block does the rest (`IMP-403` to `IMP-408`). The manager has been built around a logged-in helper and the context (`IMP-402`).

### IMP-401: SUImportContext holds the import settings

[14.0.7] `SUImportContext` has five plain properties and no validation:

| Property | Type | Default | Effect |
|---|---|---|---|
| `bMerge` | bool | false | Chooses merge mode: the banner text (`IMP-421`), whether an existing item is skipped (`IMP-424`) and the `mergeMode` argument of `doImport` (`IMP-427`). Logged in the header (`IMP-403`). |
| `bFast` | bool | always false | The setter discards its value and the getter returns `false`. The engine reads it, so the fast mode never exists: `flag2` of `IMP-427` depends only on the action. Logged as `Fast import mode: False`. |
| `Release` | string | null | The `target_release` of the `DatabaseUpgrade` row (`IMP-451`). Logged in the header. |
| `Description` | string | null | The `description` of the row (`IMP-451`). Not logged. |
| `bVault` | bool | false | Stored and never read. No file or vault upload exists on the import path. |

A null `Release` or `Description` is concatenated as the empty string (`IMP-451`). The context is read by the engine only, never changed.

*Observed* (`s31-bfast`): `bFast` set to `true` reads back `False`; the other defaults are as above.

`SolutionUpgradeContext` (`EXP-501`) is the shared context. Import reads these of its settings: `Action` (must be `Import`, `IMP-402`; its name is logged), `ManifestFile` (`IMP-402`), `LogFilePath` (`IMP-403`), `Verbose` (`IMP-421`), `Timeout` (`WIRE-031`) and, for the header only, `WorkingDirectory`, `Url`, `DataBase`, `UserName`, `LPPath` and `LPPackage` (`IMP-403`). Import never reads `Password`.

### IMP-402: The manager for an import checks its manifest and takes the manifest's folder

[14.0.7] The constructor `ImportExportManager(context, messagesFactory, itemHelper)` checks its arguments as `EXP-502` says (a null `itemHelper` first, then a null `context`; the factory is not checked). When `context.Action` is `Import` it then:

1. tests the context's `ManifestFile` with `File.Exists` (after the long-path normalisation of `EXP-505`). A missing file, a null or empty path, or a directory throws `CItemException` with faultcode `-1`, an empty `faultstring` and `faultdetail` `Manifest file '{ManifestFile}' doesn't exist` (the message is the same text). Nothing else has happened by then: no log, no request (*observed*, `s25-manifest-missing`);
2. replaces the manifest directory with the parent folder of the manifest, as a full path (`Directory.GetParent(path).FullName`, so a relative manifest path is resolved against the current directory). The context's `WorkingDirectory` is not used for an import; it is only logged;
3. applies the timeout (`WIRE-031`);
4. loads the manifest into the `ManifestFile` property. The file exists by step 1, so the property is always set. A file that is not well-formed XML fails the constructor (`MAN-003`).

The manifest folder is what `GetSolutionPath` resolves relative package paths against (`MAN-030`, `MAN-032`).

### IMP-403: The log is opened first and starts with a header

[14.0.7] After the progress state is set, `ImportSolutions` opens the log through `IOWrapper.NewStreamWriter(LogFilePath, append: true)`, with the rules of `EXP-505` (long-path normalisation, append, UTF-8 without BOM, no auto-flush, read sharing only, disposed when `ImportSolutions` ends). This happens **outside** the guarded block, so an open failure escapes `ImportSolutions` as it is: a missing directory is a `DirectoryNotFoundException`, an empty path an `ArgumentException`, and no message is sent and no request made (*observed*, `s27-log-dir-missing`). The progress state stays *in progress*.

Inside the guarded block, the first things written are the header and one line (*observed*, `s01-basic`):

```text
Tool version: 14.0.7.35492
Action: Import
Manifest file: {ManifestFile}
Log file: {LogFilePath}
Working directory: {WorkingDirectory}
URL: {Url}
Database: {DataBase}
User: {UserName}
Innovator version: {InnovatorVersionFullString}
Language pack: {LPPath}
Language pack name: {LPPackage}
Fast import mode: False
Merge import mode: {bMerge}
Import release: {Release}
<empty line>
Start of importing packages
```

- The first eleven lines are the header of `EXP-506` with the action name `Import` (a bool is `True` or `False`; null or empty is nothing). The import context adds `Fast import mode`, `Merge import mode` and `Import release` instead of the four export lines; `Description` is not written. The block is written by one `WriteLine`, so an empty line follows the last header line.
- `Innovator version` reads the server version that only `Login` sets (`WIRE-021`). On a helper that never logged in it throws a `NullReferenceException` inside the guarded block, which `IMP-407` handles. Nothing of the header is written then (*observed*, `s37-not-logged-in`: the log holds only the error block of `IMP-407` and the run returns `1`).
- `Start of importing packages` is the catalogue text `StartOfImportingPackages` (`IMP-470`).

If the log already holds text, the header is appended after it (*observed*, `s26-log-appends`).

### IMP-404: The packages are put in dependency order, and the ordering warnings are logged

[14.0.7] `ImportSolutions` calls `GetSolutions2Xml` (`IMP-405`) and then `ManifestFile.GetPackageNamesInImportOrder(packagesToImportList, solutions2Xml, warnings)` (`MAN-020` to `MAN-025`), which returns the names in the order to import and fills `warnings` with texts.

- Each warning is written to the log as its own line, in order, before the first package starts (*observed*, `s15-ordering-warnings`: `One of imported packages depends on the package 'LIBSJS-SCRATCH-Missing' that neither imported in this session nor exists in the database`). No message is sent for them.
- When the returned list is empty, `ImportSolutions` returns `1` at once: nothing else is written, no message is sent, no request is made (*observed*, `s11-empty-list`: the log ends after `Start of importing packages`). This is the case of an empty request list.
- A name that is not in the manifest is **not** refused here: it stays in the list when it has no dependencies (`MAN-020`). Its failure comes from `GetSolutionPath` when its turn arrives, after the package's `DatabaseUpgrade` row was written (`IMP-406`, *observed*, `s12-unknown-package`: `Node for package 'LIBSJS-SCRATCH-Nope' doesn't exist in the manifest file Enable to detemine path to LIBSJS-SCRATCH-Nope.`).
- An exception thrown by the ordering (a duplicate name, a dependency cycle that never ends, `MAN-024`, `MAN-025`) is a failure of the whole run (`IMP-407`).

### IMP-405: GetSolutions2Xml supplies the database's packages to the ordering

[14.0.7] `GetSolutions2Xml` is the method of `EXP-507`. The import calls it once, before the ordering, and passes its result as the database packages. Its three outcomes:

- **a response document**: used by the ordering to know which packages exist in the database and what they depend on (`MAN-022`, `MAN-023`);
- **null, because the server has no package definitions** (faultcode `0`): a `warning` message `The database contains no package definitions. Please select another database and try again` is sent, and the import goes on. The ordering accepts a null document as long as no package needs it (*observed*, `s13-no-package-definitions`: the package imports and returns `0`). A package whose dependency needs the database list would then fail (`MAN-023`);
- **a fault other than 0**: `IMP-410`.

The request is the one of `EXP-507`. The helper is `CItemHelper.getSolutions` (also mapped there).

### IMP-406: A package is imported between two audit-row writes, with its own buffered log

[14.0.7] For each name of the ordered list, in order, `ImportSolutions` calls `ImportPackage(importContext, log, name)`. `ImportPackage` has its own log: a `StreamWriter` over a `MemoryStream`, UTF-8 without BOM, decoded back to text when the package ends. It does:

1. writes `start of execution : {now}` (the date-time format of `EXP-505`) to the package log;
2. writes `Updating '{name}' package to 'inprogress' release status` and calls `WriteReleaseData(name, 0, Release, Description)` (`IMP-450`);
3. calls `ImportProc(name, packageLog, importContext)` (`IMP-420` to `IMP-431`);
4. writes `Updating '{name}' package to success release status` and calls `WriteReleaseData(name, 1, Release, Description)`;
5. in a `finally` block, whatever happened: writes `end of execution : {now}`, flushes, and appends the whole package log to the log in one write.

If steps 2 to 4 throw, the `catch` block (`IMP-407`) runs before step 5.

Consequences:

- Nothing of a package reaches the log file until the package ends, whether it succeeded or failed. The log of a package is one contiguous block, and the blocks of the packages come in order (*observed*, `s07-fail-second-package`). A crash of the process loses the running package's lines.
- The `DatabaseUpgrade` row is written before the package's folder is looked at (`IMP-450`).
- The `WriteReleaseData` return value (the row's id) is not used.

The texts are in `IMP-470`; the package log carries every line `ImportProc` and the checks write (`LoadPackageDom` skip warnings, the reference-check blocks of `IMP-100`, and the delayed-resolution lines of `IMP-202`).

### IMP-407: The first failing package ends the run, and the failure is wrapped, logged and reported

[14.0.7] Any exception thrown by steps 2 to 4 of `IMP-406` (including a failure of the `WriteReleaseData(…, 1, …)` call) runs this `catch` block of `ImportPackage`:

1. write `Updating '{name}' package to failed release status` to the package log;
2. call `WriteReleaseData(name, 2, Release, Description)` (`IMP-450`);
3. throw an `InvalidOperationException` whose message is CRLF, the catalogue text `ImportPackagePackageNameFailedWithMessageUpdatingPackageNameToFailedReleaseStatus` and CRLF, and whose inner exception is the original. The text is `Import package '{0}' failed with message:\n\n{1}\nUpdating {2} to failed release status` with `\n` alone, `{0}` and `{2}` the package name and `{1}` the **`Message`** of the original exception.

`ex.Message` of a `CItemException` is the text it was built with (`WIRE-051`, the whole `Server error` text for a server fault). A suffix that a method appends to its `faultdetail` afterwards (` Fails to init solution to PackageDefinition: …`, ` Can init group in PackageDefinition.`, ` Unable to get label of … ItemType.`) does **not** change `Message`, so it never reaches the failure text. An exception the engine wraps in a new `CItemException(-1, …, message + suffix, inner)` carries the suffix in its message (*observed*, `s18-pkgdef-fault`, `s61-label-direct`).

Then `finally` of `IMP-406` writes the package log. The exception reaches the guarded block of `ImportSolutions`, which:

- writes the error block to the log, after the failed package's block: `LogError` writes the catalogue text `ErrorMessageMessageEnd` with `Message` of the `InvalidOperationException`: `\t\t****ErrorMessage****\r\n{0}\r\n\t\t********************` followed by CRLF;
- sends an `error` message with the catalogue text `ErrorMessageMessage` (`          ****ErrorMessage****\r\n       {0}`: ten, then seven leading spaces) and the same `Message`;
- returns `1`. The status message `completed` is not sent and the progress state is not reset.

So the run stops at the first package that fails. The packages before it stay imported, with their rows at status 1. The failed package keeps what its items already changed: nothing is rolled back (no transaction exists). The packages after it are never started and get no row. The same handling applies to the failures that do not come from `ImportPackage` (`IMP-404`, `IMP-405`, `IMP-403`): the exception is caught by the guarded block and gives the error block, the `error` message and `1`.

*Observed* (`s06-delete-retry-fails`, `s07-fail-second-package`, `s12-unknown-package`, `s18-pkgdef-fault`, `s20-element-exists-other`): the error `Message` starts with CRLF and ends with CRLF, the log holds the package block (with `Updating … failed release status` and `end of execution`) and then the error block, and the return value is `1`.

### IMP-408: A finished run reports completed and returns 0

[14.0.7] When every package ended without an exception (including a cancelled one, `IMP-409`), `ImportSolutions` sends a `status` message `completed` through the status message it created at the start, sets the progress state to *idle* and returns `0`. The log writer is disposed when the method returns, so the log is flushed then.

The return codes are therefore `0` (all packages ended, even cancelled) and `1` (an empty list, or any failure). The statuses of the audit rows carry the detail (`IMP-450`).

### IMP-409: A cancel is recorded as a success (bug)

[14.0.7] `Cancel()` sets the progress state to *cancelled*. `ImportSolutions` sets the state to *in progress* when it starts (`IMP-400`), so a `Cancel()` made before the call is lost (*observed*, `s10-cancel-before-start`: everything imports). While a run is going:

- `ImportProc` tests the state before each item (`IMP-422`). On *cancelled* it sends a `status` message `Import was canceled by user`, writes the same text to the package log, and **returns normally**. The items after it are not imported, the delayed-resolution queue is dropped (`IMP-200`), and the log line `completed` is not written.
- `ImportPackage` has not seen an exception, so it writes `Updating '{name}' package to success release status` and sets the row to status 1 (`is_latest` 1, and the other rows of the package cleared, `IMP-451`). A cancelled package is recorded as a successful one.
- The state is not reset between packages, so every later package of the list also starts, writes its `inprogress` row, creates or finds its package definition (`IMP-440`) and its dependencies (`IMP-441`), sends `Building  solution` and `Adding PackageDefinintion for …`, then stops at its first item with the same message and a success row. Package definitions are created for packages that import nothing.
- `ImportSolutions` ends as a normal run: `completed` and return `0`; the state is reset to *idle*.

*Observed* (`s09-cancel`, `s09b-cancel-last-item`): a `Cancel()` made while the first item of A is being sent stops A after that item and also stops B at its first item; both rows end at status 1. A `Cancel()` made during A's last item lets A finish normally and stops B at its first item.

The state is read and written without synchronisation across threads (a host calls `Cancel()` from another thread); the port reads the flag at the same points.

### IMP-410: A failing package-definition query crashes on the log file (bug)

[14.0.7] `GetSolutions2Xml` handles a fault other than 0 as `EXP-507` says: it sends an `error` message with the fault text and then opens a **second** writer on `LogFilePath` to log it. `ImportSolutions` still holds its own writer on the file (`IMP-403`), so the second open fails with `IOException` `The process cannot access the file '{LogFilePath}' because it is being used by another process.` Unlike in export (`EXP-541`) the exception is caught by the guarded block of `ImportSolutions`: `LogError` writes the error block with the `IOException` message, an `error` message with that message is sent (a second one, after the fault text), and the run returns `1`. No package is started.

*Observed* (`s14-package-list-fault`): two `error` messages (the `ErrorMessageStringDetailCode` text with the whole `Server error` request and response, then the `ErrorMessageMessage` text with the `IOException` message); the log holds the header, `Start of importing packages` and one error block with the `IOException` message. The fault text itself is never logged.

The port reproduces the outcome (the same two messages and the same log), not the operating-system lock: it fails the second write by rule, with the message text above. A correct engine would write the fault text through the open writer. Registered in `bugs.md`.

### IMP-411: A failure while writing the failed status replaces the original error (bug)

[14.0.7] The `catch` block of `ImportPackage` calls `WriteReleaseData(name, 2, …)` before it throws (`IMP-407`). If that call throws, the new exception leaves the `catch` block and **replaces** the original one: the `InvalidOperationException` with the package name is never built, and the original error is lost. The `finally` block still runs, so the package log (with `Updating … failed release status`) is written. The guarded block reports the second exception's `Message`: the error block, the `error` message and `1`.

The same happens when the very first `WriteReleaseData(name, 0, …)` fails (the `add` of the row is refused): the `catch` block tries status 2, fails the same way, and the report shows the second request (*observed*, `s30-release-first-fails`: the reported request has `upgrade_status` 2).

*Observed* (`s08-fail-and-release-write-fails`): the item failure (`boom`) is gone; the reported error is the refusal of the status-2 write. Registered in `bugs.md`.

## The items of a package

### IMP-420: ImportProc imports one package's items, in order

[14.0.7] `ImportProc(packageName, log, importContext)` does these steps, each its own rule:

1. the banner (`IMP-421`);
2. when `Verbose`, writes `Building  solution` (two spaces) to the console; always sends the `status` message `Building  solution`;
3. resolves the package folder with `GetSolutionPath(packageName, manifest folder, manifest)` (`MAN-032`), then `LoadPackageDom(folder, log)` (`IMP-001`) and `GetItemsFromPackageDom` (`IMP-015`). The log writer given to `LoadPackageDom` is the package log;
4. sends `status` `Adding PackageDefinintion for {package}` (sic: `PackageDefinintion`), creates `PackageDefinitionManager(helper, package, doCreate: true)` (`IMP-440`), and records the dependencies (`IMP-441`). Each warning that returns is written to the package log as `WARNING (importing '{package}' package): {warning}`, before the first item;
5. counts the importable adds (`IMP-423`) and, when not `Verbose`, writes an empty line to the console;
6. creates the package's `DelayedResolutionManager` (`IMP-200`);
7. runs the item loop (`IMP-422` to `IMP-431`);
8. after the last item: sends `status` `Delayed resolution of unresolved references ...`, writes the same text to the console, calls `ExecuteDelayedResolution` (`IMP-240`), writes `completed` to the console and to the package log, and sends `status` `completed`.

The package folder is looked at after the audit row is written (`IMP-406`) and before the package definition exists: a package whose folder cannot be loaded has a row (at status 2) and no package definition.

The request order of a package whose two items (a List and a Method, both adds, not merge) import is, with the first requests of `IMP-404` and `IMP-405` before it: `DatabaseUpgrade` get, `DatabaseUpgrade` add (`IMP-450`); `PackageDefinition` get, add (`IMP-440`); then per item the existence test (`IMP-424`), the checks and the import (`IMP-427`), the type's versionable test, the type's label, the package group get and add, the element get and add (`IMP-429`); and at the end `DatabaseUpgrade` get, lock test, edit and the clearing edit (`IMP-450`). *Observed*, `s01-basic`.

### IMP-421: The console gets a banner, progress dots and the completion line

[14.0.7] `ImportProc` writes to the console as well as the log and the messages. The console is the standard output of the host. `WriteLine` ends with the host's line terminator (CRLF on Windows, observed) and `Write` adds nothing. The port exposes these writes as console output and leaves the stream to the CLI (round 5: engine messages go to stderr).

| When | Console | Package log |
|---|---|---|
| start, `bMerge` | `       ****Import with merge option {package}****` (seven leading spaces) | the same line |
| start, not merge | `       ****Import   {package}****` (seven leading spaces, three after `Import`) | the same line |
| `Verbose`, before loading | `Building  solution` | |
| not `Verbose`, before the loop | an empty line | |
| each importable add, `Verbose` | `Importing {keyedName}  type {type}   {n}  of  {m}` (two spaces before `type`, three before `{n}`, two around `of`) | |
| each importable add, not `Verbose` | `.` (no line end); after every 60th add (`n` a multiple of 60) a `\n` alone | |
| each other item, `Verbose` | `Post actions` | |
| after the loop | `Delayed resolution of unresolved references ...`, then `completed` | `completed` |

`{keyedName}` is the file name of the item (`tempKeyName`, `IMP-009`), the same value the status message shows. The dot is written before the skip test of `IMP-424`, so a skipped item still prints its dot. Nothing is written to the console on failure or on cancel: the texts of `IMP-407` and `IMP-409` go to the log and the messages.

*Observed* (`s01-basic`, `s02-merge-verbose`, `s04-post-actions`, `s28-dots`): for the unmerged, non-verbose run of two adds the console is `       ****Import   LIBSJS-SCRATCH-A****`, an empty line, `..`, then `Delayed resolution of unresolved references ...` and `completed` directly after the dots on the same line. With 61 adds the 60th dot is followed by a bare `\n` and the 61st dot starts the next line.

### IMP-422: Each item is read, described in the log and checked for cancel

[14.0.7] For each document of the package's item list (one per `AML/Item` of the loaded DOM, `IMP-015`), in order, the loop does:

1. if the progress state is *cancelled*: `IMP-409`;
2. selects the root `Item` element and sets its attribute `doGetItem` to `0`. If the item already has `doGetItem`, its value is replaced in place; otherwise the attribute is appended after the existing ones (so it comes after `action`, `id`, `type`, as in the recorded requests of `s01-basic`);
3. reads the attributes `action`, `id`, `type`, `tempKeyName` and `tempFullName` with `GetAttribute`, which gives the empty string for a missing one, and removes `tempKeyName` and `tempFullName` (`IMP-009`);
4. builds the descriptor `text6` from three parts: `  id : {id}  ` when the id is not empty, else a single space; `  keyed_name : {tempKeyName}  ` when the key is not empty, else a single space; and `  type : {type}  ` when the type is not empty, else a single space. `text6` is the three parts one after another;
5. writes two lines to the package log: `Processing ({action}) {text6}` and `File full name '{tempFullName}'`.

*Observed* (`s01-basic`, `s33-add-with-where`): `Processing (add)   id : L0000000000000000000000000000001    keyed_name : Colors    type : List  ` (a trailing space pair) and, for an item with no id, `Processing (add)    keyed_name : ByWhere    type : Method  `.

`text6` keeps the id the item had when it was read. A later rewrite of the item's `id` (a versionable item moved to its current generation by `DoesItemAlreadyExist` or by merge, `IMP-320`, `IMP-351`) does not change the text of the lines that follow.

### IMP-423: Importable adds are counted and shown as progress

[14.0.7] Before the loop, `GetImportableItemsCount` counts the item documents whose root `action` attribute is exactly `add` (ordinal) and whose `type` is importable (`IMP-431`) into `m`. In the loop, an item with the same two properties is an *importable add*: `n` is incremented and:

- the `status` message `Item {n} of {m}: {type} - {tempKeyName}` is sent (built with `string.Format` and the invariant culture; the same text as the catalogue entry `ItemIndexOfCountTypeNameKeyedName` of `EXP-504`);
- the console shows the verbose line or the dot (`IMP-421`).

Every other item (an `edit`, `delete` or `merge`, no action, a `Member`, a `Server Event`) is a *post action*: it sends the `status` message `Post actions` (and the console line when `Verbose`) and is not counted. Skipped and failed items are counted as soon as they are reached, so `n` can stop short of `m` on a failure.

*Observed* (`s04-post-actions`, `s35-other-actions`): one List add and three post actions give `Item 1 of 1: List - Colors` and three `Post actions`.

### IMP-424: In non-merge mode an existing add is skipped

[14.0.7] The skip is `IMP-350`: if `bMerge` is false and the item's `action` is exactly `add`, the loop calls `DoesItemAlreadyExist(item, null)` (`IMP-351`) before anything else is done to the item. When it returns true, the loop writes `Item successfully skipped {text6}` (the descriptor of `IMP-422`) to the package log and does nothing else with the item: no checks, no import, no `SQL` deletion step (`IMP-425`). The registration of `IMP-429` still happens for it, with the id the loop read before the test. In merge mode the call is never made.

What the call does is `IMP-351`; this document relies on three of its outcomes:

- it throws `CItemException` `Error - empty 'id' or 'type'` when the item has no `id` attribute or no `type`, so **an add that names its target by `where` fails in non-merge mode** (*observed*, `s33-add-with-where`: the package fails at that item, and the row ends at status 2);
- for a versionable type it can rewrite the `id` attribute and the `source_id` of the item's relationships;
- otherwise it sends the type's versionable lookup (`IMP-170`) and then `ItemExistById` (`IMP-352`).

*Observed* (`s03-skip-existing`): the List add that exists is skipped (`Item successfully skipped   id : L…`) and registered, the Method add imports.

### IMP-425: The first non-skipped SQL item of a package deletes all SQL items of the package

[14.0.7] Before the checks, in the `else` branch of `IMP-424` (so not for a skipped item), the loop tests `type` against `sql` ignoring case. For the first such item of the package (a local flag, set once per `ImportProc` call), it:

1. writes `##### Delete SQL Items of the package '{package}' from the database #####` to the package log;
2. calls `DeleteSqlItems` with **all** `AML/Item` nodes of the package DOM (the whole package, in DOM order, not only the SQL ones: `IMP-460`);
3. sets the flag and writes `##### Done deleting SQL Items of the package '{package}' from the database #####`.

The deletes therefore come at the first SQL item's turn and cover every SQL item of the package, including those that come later in the order. Each is re-added only when its own turn comes and it is imported (*observed*, `s23-sql`: the deletes are sent between the first SQL item's existence test and its checks). This happens in merge mode too. A failure of `DeleteSqlItems` is a failure of the package (`IMP-407`).

### IMP-426: A skipped SQL item is deleted and never added back (bug)

[14.0.7] In non-merge mode an SQL item that exists is skipped (`IMP-424`) and so is not imported. If a later SQL item of the same package is not skipped, `IMP-425` deletes **every** SQL item of the package from the database, the skipped one included, and nothing adds the skipped one back. After the run, a package that held two SQL items of which only the second was missing from the database has the second one only.

*Observed* (`s36-sql-skipped-first`): `Q…1` exists and is skipped; the delete requests name both `Q…1` and `Q…2`; only `Q…2` is added. If every SQL item is skipped, no delete is sent. Registered in `bugs.md`.

### IMP-427: The checks and the import run next, and a failed delete is retried once

[14.0.7] For an item that is not skipped:

1. `flag2` is `!bFast && action != "delete"` (ordinal), which is true for every action but `delete` (`bFast` is always false, `IMP-401`);
2. `DoChecking(delayedResolutionManager, item, packageLog, flag2)` runs (`IMP-100`): the full reference check when `flag2` is true, only the data-source check for a delete;
3. `doImport(item, bMerge)` runs inside a `try` (`IMP-300`: it sends the item).

If `doImport` throws a `CItemException` and `flag2` is true, the exception is rethrown. If `flag2` is false (a **delete**), the loop:

- sends a `warning` message with the catalogue text `WarningTryToResolve` and the exception's `Message`: `          ****Warning! Import of an item failed. Trying to resolve the error... ****\r\n       {0}` (ten leading spaces on the first line, seven on the second);
- runs `DoChecking(…, doFullCheck: true)`; a `CItemException` from it is rethrown;
- runs `doImport` again, **not** guarded: a failure now is the item's failure (`IMP-407`).

An exception that is not a `CItemException` is never retried. The retry applies only to deletes, since `bFast` never makes `flag2` false.

Only the types that `build.xsl` keeps with a `delete` action can reach this path: `Field`, `Property`, `View` and `SQL` (any action), `Form`, and an `ItemType` delete that follows an add in its file (`IMP-021`, `IMP-026`, `IMP-029`).

*Observed* (`s05-delete-retry-ok`, `s06-delete-retry-fails`): the first delete of a View fails with a server fault; the log shows an empty reference-check block (the data-source check) and then a full block; the warning message holds the whole `Server error` text; the second attempt is accepted (status 1) or refused (the package fails, status 2, `1` returned).

### IMP-428: The id is read again and the success is logged

[14.0.7] After a successful import (not after a skip), the loop reads the `id` attribute of the root `Item` again (the empty string when it has none) into the id used for registration, because the import or the existence test may have rewritten it. It then writes `Item successfully applied({action}) {text6}` to the package log, with the original `action` and the `text6` of `IMP-422`.

A skipped item keeps the id it was read with: the registration of a skipped versionable item uses the original id, not the rewritten one (*observed*, `s22-versionable`).

### IMP-429: An added item is registered in the package definition

[14.0.7] After the item is imported or skipped, if the original `action` is `add` and the type is importable (`IMP-431`), the loop registers the item as an element of the package:

1. writes `Adding item into PackageDefinition with id = {id} and type = {type}`;
2. asks `IsVersionable(type)` (`IMP-170`). If true, writes `Getting config_id  of versionable item  id  {id} type {type}` (two spaces after `config_id` and after the second `id`) and replaces the id by `GetConfigId(id, type)` (`IMP-448`);
3. asks `GetLabelOfItemType(type)` (`IMP-447`);
4. calls `AddElement2Group(tempKeyName, type, label, id)` (`IMP-445`). When it returns true it writes `Item successfully added in packdefinition  id  {id} type {type}`; when false, `Item already exist in packdefinition  id  {id} type {type}` (two spaces after `packdefinition` and after `id`). The id is the config id for a versionable item.

The element's **name** is the item's file name (`tempKeyName`, `IMP-009`), not its `keyed_name`; an item file that is named differently from the item gives an element of that name. The element's group is named after the type's English label, or the type name when it has none.

Only the `add` action registers. A post action, whatever its type, does not (*observed*, `s04-post-actions`, `s35-other-actions`), and neither does a delete, so deleting an item leaves its element in the package definition.

*Observed* (`s01-basic`, `s19-element-exists-same`, `s21-label-i18n`, `s22-versionable`).

### IMP-430: An add made by where is registered with an empty id (bug)

[14.0.7] An add that names its target by `where` has no `id` attribute (merge mode accepts it, `IMP-424`). The registration of `IMP-429` runs with the empty id: `Adding item into PackageDefinition with id =  and type = {type}`, `IsVersionable`, the label, and `AddElement2Group` with an empty `element_id`. Every such item queries the same global element (`IMP-445`): the first creates a `PackageElement` with an empty `element_id`, and later ones are found in the same group and reported as already existing, or fail with `Duplicate package element` if their type or group differs. A correct engine would register the id the server assigned, or none.

*Observed* (`s34-merge-where`): the log lines above, and the element add request with `<element_id></element_id>`. What the server stores for an empty `element_id` was not probed. Registered in `bugs.md`.

### IMP-431: Members and Server Events are imported but not counted or registered

[14.0.7] `ExportImportBase.IsImportableType(type)` is false exactly for the type names `Member` and `Server Event` (ordinal, case-sensitive), true for any other string. It decides which adds are counted (`IMP-423`) and registered (`IMP-429`); it does not stop the items from being imported (*observed*, `s04-post-actions`: the Member and the Server Event are checked and sent, counted by neither the total nor the registration).

## The package definition and its elements

### IMP-440: The package definition is found or added

[14.0.7] `new PackageDefinitionManager(helper, packageName, doCreate: true)` runs `InitSolution(true)` of `EXP-509`: a `get` for the current definition by name and, on faultcode `0`, an `add`:

```xml
<Item type='PackageDefinition' action='add'><name>{package}</name></Item>
```

(the request has no `doGetItem`, so the server answers with the new item). The id is the text of the first `.//Item[@type='PackageDefinition']/id` **element** of the answer, which later requests carry as `source_id`. A fault other than 0 on the `get`, or any fault on the `add`, is rethrown with ` Fails to init solution to PackageDefinition: {package}` added to its `faultdetail` only; another exception becomes `CItemException(-1, <stack>, <message> + that suffix, <inner>)` (`EXP-509`; `IMP-407` for what the import report shows). A missing `id` element is a `NullReferenceException` wrapped the same way.

The name is concatenated unescaped (an apostrophe or `&` makes malformed AML; IOM throws `XmlException`, which the wrap above turns into `CItemException(-1)`).

*Observed* (`s01-basic`, `s18-pkgdef-fault`; the `add` answer's `id` element is the probe's model, *inferred* for the server).

### IMP-441: The manifest's dependencies are recorded after the package definition

[14.0.7] `AddDependencyInfo(dependencies, warnings)` takes the table `ManifestFile.GetDependsOnInfo(package)` (`MAN-016`: dependency name to the list of its referenced elements, a `Hashtable` in the order of `MAN-017`). For each key, in the order of `foreach (string key in dependencies.Keys)`:

1. `AddDependsOn(key)` returns the dependency's row id (`IMP-442`);
2. when the key's list is not null and not empty, `AddReferencedElements(depId, list, warnings)` records them (`IMP-443`).

The warnings of `AddReferencedElements` are strings; `ImportProc` writes each to the package log as `WARNING (importing '{package}' package): {text}` after the whole table is processed and before the first item (*observed*, `s16-dependencies`). A package without `dependson` entries sends no request.

### IMP-442: A dependency row is found or added, and a failed lookup is swallowed

[14.0.7] `AddDependsOn(name)` sends:

```xml
<Item type='PackageDependsOn' select='id' action='get'><name>{name}</name><source_id>{package definition id}</source_id></Item>
```

- On success, the result is the `id` **attribute** of the first `//Item[@type='PackageDependsOn']` of the answer.
- On a `CItemException` with faultcode `0` it sends `<Item type='PackageDependsOn' action='add' doGetItem='0'><name>{name}</name><source_id>{package definition id}</source_id></Item>` and takes the id from that answer the same way. A failure of the `add` propagates.
- On a `CItemException` with any **other** faultcode the exception is swallowed: nothing is added, no warning is written, the dependency id is the empty string, and the caller goes on (*observed*, `s17-dependency-get-fault`: the referenced element is then added with an empty `source_id`).
- An answer without the item, or an item without `id`, is a `NullReferenceException`; an exception that is not a `CItemException` (malformed AML from a name with an apostrophe or `&`) propagates. These fail the package.

The names are interpolated unescaped.

### IMP-443: Referenced elements are recorded when their item exists

[14.0.7] `AddReferencedElements(depId, elements, warnings)` walks the list in order. For each element (id, type, keyed name from the manifest's `referenced_element`, `MAN-013`):

1. `ItemExistById(id, type)` (`IMP-448`). When it is false, a warning `Item of type '{type}' with id '{id}' is not added as a referenced element for package '{package}' because the item was not found in the target database` is added to the list and the element is skipped. Any `CItemException` counts as not found, not only faultcode `0`;
2. otherwise it sends `<Item type='PackageReferencedElement' action='get' select='id'><id>{id}</id></Item>`. On a `CItemException` with faultcode `0` it sends `<Item type='PackageReferencedElement' action='add' doGetItem='0'><element_id>{id}</element_id><element_type>{type}</element_type><element_description>{keyed name}</element_description><source_id>{depId}</source_id></Item>`. Another faultcode is rethrown. Found elements are not touched.

*Observed* (`s16-dependencies`): of two elements, the one that exists is added and the other produces the warning and no request.

### IMP-444: The referenced element is looked up by its item's id, which can never match (bug)

[14.0.7] The `get` of `IMP-443` puts the **referenced item's id** in the `id` of a query on `PackageReferencedElement`, but the rows of that type have ids of their own: the element's id is its `element_id` property. The query is therefore expected to find nothing, and the `add` follows on every run. Re-importing a package that has `dependson` entries with referenced elements adds the same rows again. A correct engine would test `element_id` (and `source_id`) of the row. *Inferred* from the request and the item model: the dev database holds no `PackageReferencedElement` rows, and the probe's stub does not model the server's matching, so no run showed the duplicates. Registered in `bugs.md`; the fixtures of wayfinder ticket 25 settle it.

### IMP-445: An element is added to a package group, and the global duplicate check decides

[14.0.7] `AddElement2Group(keyedName, type, groupName, id)` returns whether it added the element:

1. `groupId = GetPackageGroupIdOrCreateIfNotExists(packageDefinitionId, groupName)` (`IMP-446`);
2. sends `<Item type='PackageElement' select='id, source_id, element_type' action='get'><element_id>{id}</element_id></Item>` (unescaped). The query is **not** limited to this package: it finds the element of any package;
3. reads `Item/source_id` and `Item/element_type` of the first item of the answer. A missing item or node is a `NullReferenceException`, not a `CItemException`, and fails the package;
4. when `source_id != groupId` or `element_type != type`, throws `CItemException(-2, "Duplicate package element", message, null)`, where the message is `The package '{package}' already contains the PackageElement with name='{keyedName}' and id='{id}' but of different type: DB - type='{db type}', group_id='{db group}';   being imported - type='{type}', group_id='{groupId}'` (three spaces after the semicolon). The text says "different type" even when only the group differs. The exception is rethrown by the `catch` below because its faultcode is not 0. It fails the package;
5. otherwise returns `false` (the element is already in this group with this type);
6. if step 2 throws a `CItemException` with faultcode `0` (no such element anywhere) it builds the `add` through the DOM from the template `<Item type='PackageElement' action='add' doGetItem='0'><source_id /><element_id /><element_type /><name /></Item>`, sets the four texts to `groupId`, `id`, `type` and `keyedName` (so, unlike every other request here, **these values are XML-escaped**; a null name is empty), sends it and returns `true`. Another faultcode is rethrown.

A request for the same element id from a second package therefore either finds it in another group (step 4: an item that is in two packages makes the second import fail after the item was imported) or in the same group (step 5).

*Observed* (`s19-element-exists-same`, `s20-element-exists-other`, `s51-pdm-element`, which also shows `A&amp;B&lt;C "q" 'r'` for a keyed name `A&B<C "q" 'r'`, and an `XmlException` for an `&` in the id).

### IMP-446: A package group is found or created, once per helper

[14.0.7] `GetPackageGroupIdOrCreateIfNotExists(packageDefinitionId, groupName)` sends

```xml
<Item type='PackageGroup' select='id' action='get'><name>{groupName}</name><source_id>{packageDefinitionId}</source_id></Item>
```

and, on a `CItemException` with faultcode `0`, `<Item type='PackageGroup' action='add' doGetItem='0'><name>{groupName}</name><source_id>{packageDefinitionId}</source_id></Item>`. The result is the `id` **attribute** of the first `Item` of the answer, or the empty string when the item has none.

- The answer (of the `get`, or of the `add` under the `get`'s text) is cached in the helper by the `get` request text, with no invalidation. The group is therefore looked up once per (package definition, group name) in the life of the helper, across packages (*observed*, `s62-group-direct`: the second call sends nothing).
- A fault other than 0 on the `get`, or any fault on the `add`, is rethrown with ` Can init group in PackageDefinition.` added to its `faultdetail`; any other exception (a missing item is a `NullReferenceException`; malformed AML) becomes `CItemException(-1, <stack>, <message> + ' Can init group in PackageDefinition.', <inner>)`.
- Null arguments give empty elements (`s62-group-direct`).

### IMP-447: The group is named after the ItemType's English label

[14.0.7] `GetLabelOfItemType(type)` sends `<Item action='get' select='label' type='ItemType' language='en'><name>{type}</name></Item>` (unescaped), caches the answer in the helper by that text, loads the first `//Result/Item` into a new IOM item and returns `getProperty("label", null, "en")`, or the type name when that is null.

The `language='en'` makes the server answer with the multilingual element `i18n:label` (`xmlns:i18n="http://www.aras.com/I18N"`, `xml:lang="en"`), which is what IOM's language lookup matches. A plain `label` element, with or without `xml:lang`, is not matched and the type name is used (*observed*, `s21-label-i18n`, `s21-label-plain`, `s21-label-noLang`). The i18n shape is the server's documented output and is *inferred* for the dev server.

Errors: a `CItemException` is rethrown with ` Unable to get label of {type} ItemType.` added to its `faultdetail` (any faultcode, 0 included); an `XmlException`, an `XPathException` or a `NullReferenceException` becomes `CItemException(-1, <stack>, <message> + that suffix, <inner>)`. A type with `&` or `'` that breaks the AML ends here (*observed*, `s61-label-direct`).

### IMP-448: Small lookups the import uses

[14.0.7] These `CItemHelper` methods are used by `IMP-429`, `IMP-443` and `IMP-450`:

- `ItemExistById(id, type)` is `IMP-352`: true on a normal answer, false on **any** `CItemException`. Malformed AML (an apostrophe in the type) is an `XmlException` and propagates (*observed*, `s60-helper-direct`).
- `Unlock(id, type)` is `IMP-322`.
- `Islocked(id, type)` sends `<Item type='{type}' action='get' levels='0' select='locked_by_id'><id>{id}</id></Item>` and is true when `Result/Item/locked_by_id` has a non-empty text. A fault, faultcode 0 included, propagates as it is. An `XPathException`, `NullReferenceException` or `XmlException` becomes `CItemException(-1, …, <message> + ' Unable to to check whether item is locked.', <inner>)` (sic: `to to`).
- `GetConfigId(id, type)` sends `<Item type='{type}' select='config_id' action='get'><id>{id}</id></Item>` and returns the answer's `config_id`, null when absent. Any error answer throws `CItemException(-99, m, m, null)` with `m` = `Failed to get config_id for item (type={type}; id={id})`.

## The audit row

### IMP-450: Each package has a DatabaseUpgrade row that moves from in progress to success or failure

[14.0.7] `WriteReleaseData(packageName, status, targetRelease, description)` maintains one `DatabaseUpgrade` item per (target release, package name, type 1). `ImportPackage` calls it with status `0` (in progress, before the items), `1` (success, after them) and `2` (failed, in the failure path, `IMP-407`). Its steps:

1. sends `<Item action='get' type='DatabaseUpgrade'><target_release>{targetRelease}</target_release><name>{packageName}</name><type>1</type></Item>`;
2. on a `CItemException` with faultcode `0` it **adds** the row (`IMP-451`) and returns the id of the new item; another faultcode is rethrown;
3. otherwise it takes the `id` attribute of the first `.//Item[@type='DatabaseUpgrade']` (a missing item or attribute is a `NullReferenceException`) and **edits** the row (`IMP-451`).

The add and the edit are therefore two different shapes. A package imported again for the same release reuses its row. For a different `Release` a new row is added (*inferred*: the `get` names the release; the server's matching was not probed).

*Observed* (`s40-release-direct-new-st0`, `s41-release-direct-found-*`): the sequences of `IMP-451`.

### IMP-451: The requests of the audit row

[14.0.7] The status decides the `is_latest` element: `1` for any status above `0`, `0` for status `0`, and none for a negative status. The upgrade status is the integer in the invariant culture. Values are concatenated unescaped; a null `targetRelease` or `description` is empty.

**Row absent** (step 2 of `IMP-450`), in this element order:

```xml
<Item type='DatabaseUpgrade' action='add' doGetItem='0'><upgrade_status>{status}</upgrade_status>[<is_latest>…</is_latest>]<name>{package}</name><os_user>{os_user}</os_user><description>{description}</description><applied_on>__now()</applied_on><target_release>{release}</target_release><type>1</type></Item>
```

The row's id is the `id` attribute of the first `.//Item[@type='DatabaseUpgrade']` of the answer.

**Row present** (step 3), in this order:

1. `Islocked(id, 'DatabaseUpgrade')` (`IMP-448`); if true, `Unlock(id, 'DatabaseUpgrade')`;
2. the edit, with the elements in this order (`os_user` after `applied_on`, unlike the add): `<Item type='DatabaseUpgrade' id='{id}' action='edit' doGetItem='0'><upgrade_status>{status}</upgrade_status>[<is_latest>…</is_latest>]<name>{package}</name><description>{description}</description><applied_on>__now()</applied_on><os_user>{os_user}</os_user><target_release>{release}</target_release><type>1</type></Item>`;
3. when `status != 0` (so also for a negative one), the clearing edit, with a tab before the element: `<Item type='DatabaseUpgrade' action='edit' doGetItem='0' where="type='1' and name='{package}' and not id='{id}'">` TAB `<is_latest>0</is_latest></Item>`. It sets `is_latest` to 0 on every other row of the package, whatever its release. The return value is `id`.

Consequences for one first import of a package for release `R`: an `add` with status 0 and `is_latest` 0 at the start; at the end an `edit` with status 1 and `is_latest` 1, then the clearing edit. Each following import for `R` finds the row and edits it back to status 0 (`is_latest` 0, the other rows untouched) and then to 1 or 2 (`is_latest` 1, the others cleared). A failed import leaves its row `is_latest` 1 with status 2 and clears the others, so the last attempt is always the latest.

A fault from any of these requests propagates as it is, with no wrapper (*observed*, `s43-release-direct-faults`, `s45-release-direct-get-fault`). Malformed AML (a `&` in the package name or description) is an `XmlException` from IOM's `loadAML` and propagates (*observed*, `s42-release-direct-quote`: `An error occurred while parsing EntityName. Line 1, position 61.`). An apostrophe in the package name makes a well-formed request whose `where` is broken for the server: `name='O'Brien'` (not probed on the server).

The server's treatment of an empty `target_release` in the first `get` (null `Release`) was not probed.

*Observed*: `s01-basic`, `s29-null-release`, `s40-release-direct-new-st0` to `s45-release-direct-get-fault`.

### IMP-452: os_user is the identity of the process

[14.0.7] `{os_user}` is `WindowsIdentity.GetCurrent().Name` read at each write: `DOMAIN\user`, or `MACHINE\user` for a local account. It is not escaped. There is no such identity on Linux and macOS. The port writes `DOMAIN\user` on Windows and `<hostname>\<user>` elsewhere, with an option to override the value (round 2 Q6, round 5). The override is a deliberate departure: a probe of this engine can only show the Windows value. The recorded fixtures replace the value of the probe's machine with `<WINUSER>`.

### IMP-453: The add-failure text for the row is looked up under a wrong key (bug)

[14.0.7] When the `add` of a row fails with a `CItemException`, `WriteReleaseData` appends `ResourceManager.GetMessage("CannotAddInstanceOfDatabaseUpgradeItemType")` to the exception's `faultdetail` before rethrowing. The catalogue entry is stored under the key ` CannotAddInstanceOfDatabaseUpgradeItemType`, **with a leading space**, so the lookup finds nothing and returns the empty string (`EXP-504`). The text `Can't add instance of databaseUpgrade ItemType.` never appears; `faultdetail` is unchanged (*observed*, `s44-release-direct-add-fault`: `faultdetail=add refused`). The import report shows `Message`, which the suffix never changes anyway (`IMP-407`). Registered in `bugs.md`.

## SQL items

### IMP-460: DeleteSqlItems deletes every SQL item of the package, by the attribute id

[14.0.7] `DeleteSqlItems(items)` (a node list; null throws `ArgumentNullException` for `allItems`) walks the items in order. For each element:

1. `type` is the `type` attribute (empty when missing). When it is empty, it throws `CItemException(-1, "Item has no type", "The following item has no type - {outerXml}", null)`, which ends the call;
2. when the type is not `sql` ignoring case, the item is skipped;
3. `id` is the `id` attribute (empty when missing). When it is empty and the item has no child element named `id`, it throws `CItemException(-1, "Item has no ID", "The following item has no id and can't be deleted - {outerXml}", null)`;
4. it sends `<Item type='{type}' id='{id}' action='delete' />` with the **attribute** values as written (the type keeps its case: `Sql`, `sql`), unescaped.

The items are deleted one at a time, so a failure leaves the earlier deletes done (*observed*, `s63-sql-direct`: a fault on the first stops the rest; an item with neither id fails after the delete of the one before it; an item with no type fails before any SQL item after it). The `outerXml` is the item as the .NET DOM writes it (`<Item type="SQL" />`). A fault from the delete, faultcode 0 included, propagates (no `catch`). Malformed AML (an apostrophe in the id) is an `XmlException`.

### IMP-461: An id given as a child element is deleted as the empty id (bug)

[14.0.7] Step 3 of `IMP-460` accepts an SQL item whose id is only a child element (`<id>…</id>`), but step 4 always sends the attribute. The request is `<Item type='sql' id='' action='delete' />`. A correct engine would send the child's text. What the server does with `id=''` was not probed: it may refuse (and fail the package) or delete nothing. Either way the item is not deleted, and it is still imported afterwards (in non-merge mode it fails first: `IMP-424`).

*Observed* (`s23-sql`: the delete is sent with `id=""`; the item's import then fails with `Error - empty 'id' or 'type'`). Registered in `bugs.md`.

## Messages

### IMP-470: The import messages come from the catalogue

[14.0.7] Every text goes through `ResourceManager.GetMessage(key, args)` (`EXP-504`: invariant culture, a missing key gives the empty string, a null argument formats as empty). The templates the import uses (`\r\n` and `\n` literal; a tab is `\t`):

| Key | Template |
|---|---|
| `ImportPackageName` | `       ****Import   {0}****` (seven leading spaces, three after `Import`) |
| `ImportWithMergeOptionPackageName` | `       ****Import with merge option {0}****` (seven leading spaces) |
| `BuildingSolution` | `Building  solution` (two spaces) |
| `AddingPackageDefinintionForPackageName` | `Adding PackageDefinintion for {0}` |
| `WARNINGImportingPackageNamePackageWarn` | `WARNING (importing '{0}' package): {1}` |
| `ItemOfTypeWithIdIsNotAddedAsAReferencedElementForPackageBecauseTheItemWasNotFoundInTheTargetDatabase` | `Item of type '{0}' with id '{1}' is not added as a referenced element for package '{2}' because the item was not found in the target database` |
| `ProcessingActionKeyIdType` | `Processing ({0}) {1}` |
| `FileFullNameFullName` | `File full name '{0}'` |
| `ImportingKeyedNameTypeNumberOfCount` | `Importing {0}  type {1}   {2}  of  {3}` |
| `PostActions` | `Post actions` |
| `ItemSuccessfullySkippedKeyIdType` | `Item successfully skipped {0}` |
| `DeleteSQLItemsOfThePackagePackageNameFromTheDatabase` | `##### Delete SQL Items of the package '{0}' from the database #####` |
| `DoneDeletingSQLItemsOfThePackagePackageNameFromTheDatabase` | `##### Done deleting SQL Items of the package '{0}' from the database #####` |
| `WarningTryToResolve` | `          ****Warning! Import of an item failed. Trying to resolve the error... ****\r\n       {0}` |
| `ItemSuccessfullyAppliedActionKeyIdType` | `Item successfully applied({0}) {1}` |
| `AddingItemIntoPackageDefinitionWthIdAndType` | `Adding item into PackageDefinition with id = {0} and type = {1}` |
| `GettingConfigIdOfVersionableItemIdType` | `Getting config_id  of versionable item  id  {0} type {1}` |
| `ItemSuccessfullyAddedInPackdefinitionIdType` | `Item successfully added in packdefinition  id  {0} type {1}` |
| `ItemAlreadyExistInPackdefinitionIdType` | `Item already exist in packdefinition  id  {0} type {1}` |
| `DelayedResolutionOfUnresolvedReferences` | `Delayed resolution of unresolved references ...` |
| `Completed` | `completed` |
| `ImportWasCanceledByUser` | `Import was canceled by user` |
| `StartOfImportingPackages` | `Start of importing packages` |
| `StartOfExecutionDateTime`, `EndOfExecutionDateTime` | `start of execution : {0}`, `end of execution : {0}` |
| `UpdatingPackageNamePackageToInprogressReleaseStatus` | `Updating '{0}' package to 'inprogress' release status` |
| `UpdatingPackageNamePackageToSuccessReleaseStatus` | `Updating '{0}' package to success release status` |
| `UpdatingPackageNamePackageToFailedReleaseStatus` | `Updating '{0}' package to failed release status` |
| `ImportPackagePackageNameFailedWithMessageUpdatingPackageNameToFailedReleaseStatus` | `Import package '{0}' failed with message:\n\n{1}\nUpdating {2} to failed release status` |
| `ErrorMessageMessage` | `          ****ErrorMessage****\r\n       {0}` (ten, then seven leading spaces) |
| `ErrorMessageMessageEnd` | `\t\t****ErrorMessage****\r\n{0}\r\n\t\t********************` |
| `TheDatabaseContainsNoPackageDefinitionsPleaseSelectAnotherDatabaseAndTryAgain`, `ErrorMessageStringDetailCode` | `EXP-504` |
| `FailsToInitSolutionToPackageDefinitionPackageName`, `CanInitGroupInPackageDefinition`, `UnableToGetLabelOfTypeItemType`, `UnableToToCheckWhetheItemIsLocked`, `FailedToGetConfigIdForItemTypeId`, `ThePackageAlreadyContainsThePackageElementWithNameAndIdButOfDifferentTypeDBTypeGroupIdBeingImportedTypeGroupId`, `ItemHasNoType`, `TheFollowingItemHasNoType`, `ItemHasNoID`, `TheFollowingItemHaNoIdAndCannotBeDeleted` | the texts quoted in `IMP-440`, `IMP-445` to `IMP-448` and `IMP-460` |

The line `Processing (…)` uses `ProcessingActionKeyIdType`; the status message `Item {n} of {m}: {type} - {key}` is formatted directly in `ImportProc` with the same text as `ItemIndexOfCountTypeNameKeyedName`.

### IMP-471: What the import sends to the host

[14.0.7] The import sends only `status`, `warning` and `error` messages (`EXP-503`); it never sends `currentPackage` or `errorQuestion`, and it ignores every answer. The factory is asked for them as follows: `GetStatusMessage` once at the start of `ImportSolutions` and once per `ImportProc`; `GetWarningMessage` and `GetErrorMessage` once each per `GetSolutions2Xml` call; `GetWarningMessage` for each retry (`IMP-427`); `GetErrorMessage` once when the run fails (`IMP-407`). A message object is reused, so the observable behaviour is the sequence of (channel, text) pairs:

| Channel | Text | When |
|---|---|---|
| `status` | `Building  solution` | each package, before loading (`IMP-420`) |
| `status` | `Adding PackageDefinintion for {package}` | each package, before its definition |
| `status` | `Item {n} of {m}: {type} - {key}` | each importable add (`IMP-423`) |
| `status` | `Post actions` | each other item |
| `warning` | `WarningTryToResolve` text | the retry of a delete (`IMP-427`) |
| `status` | `Import was canceled by user` | a cancel (`IMP-409`) |
| `status` | `Delayed resolution of unresolved references ...` | each package that was not cancelled or failed |
| `status` | `completed` | the end of each such package, and the end of the run (`IMP-408`) |
| `warning` | `The database contains no package definitions. …` | `IMP-405` |
| `error` | `ErrorMessageStringDetailCode` text, then `ErrorMessageMessage` text | `IMP-410` |
| `error` | `ErrorMessageMessage` text | any other failure (`IMP-407`) |

*Observed* (`s01-basic`, `s09-cancel`, `s13-no-package-definitions`, `s14-package-list-fault`, `s05-delete-retry-ok`, `s07-fail-second-package`).

## The host

### IMP-480: The host builds the context, the helper and the manager, and starts the run

[14.0.7] A host performs, in this order (the CLI of wayfinder tickets 40 and 42 is a host):

1. builds a `SolutionUpgradeContext` with `Action = Import`, `ManifestFile`, `LogFilePath`, `Verbose` and the connection settings (`IMP-401`);
2. builds the `CItemHelper` around an `HttpServerConnection` and logs in (`WIRE-001`, `WIRE-010`), which also sets the server version the log header needs (`IMP-403`);
3. builds the `ImportExportManager(context, messagesFactory, helper)` (`IMP-402`);
4. builds an `SUImportContext` (`bMerge`, `Release`, `Description`) and calls `ImportSolutions(packageNames, importContext)`;
5. reads the result (`IMP-408`) and logs out (`WIRE-040`).

The engine chooses nothing the host leaves open: the log path is required (`IMP-403`), `Release` and `Description` can be null (`IMP-401`), the host's message factory answers nothing the import reads (`IMP-471`), and the console is the host's standard output (`IMP-421`). The library's CLI defaults these (round 2 Q6, round 5): `--release`, `--description` and `--no-merge` set the import context; the log goes to a default path unless `--log` is given; `--os-user` overrides the `os_user` value (`IMP-452`).

[12.0] Not yet specified; the 12.0 variant ticket adds it.

[14.35] Not yet specified; the 14.35 variant tickets add it.
