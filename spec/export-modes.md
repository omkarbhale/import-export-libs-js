# The console export modes: what an export covers

`ImportExportManager.ExportSolutions` is given a ready table of package names to items (EXP-500). Aras's own console tool, `ConsoleUpgrade.exe`, builds that table in one of three ways, and `aras-pkg export` offers the same three as modes (`--use-import`, `--from-manifest` and `--all-packages`, wayfinder ticket 66, decided as option (b) of the scope check on 2026-10-14). This document specifies them in two parts:

- **The engine's part**, `ImportExportManager.GenerateHashtableFromManifest` (`EXP-700` to `EXP-799`): it is code of `Libs.dll`, so it has variants for the three builds.
- **The console tool's part** (`HOST-100` to `HOST-199`): the loops of `ConsoleUpgrade.ProcessExport` and the options that choose between them. They live in `ConsoleUpgrade.exe`, not in `Libs.dll`, so the source map does not list them; they are rules of the host, like those of `cli-export.md`.

Sources:

- the decompile of `Libs.dll` for the three builds (`.decomp/12.0/`, `.decomp/14.0.7/`, `.decomp/14.35/`) and of the three `ConsoleUpgrade.exe` (`.decomp/console-<engine>/`, regenerated locally with `ilspycmd -p`; the toolsets are the captain's, `Desktop\ImportExport\12\ConsoleUpgrade`, `…\23\ConsoleUpgrade` and `Desktop\Delete me\PackageImportExportUtilities35\ConsoleUpgrade`). The `Libs.dll` beside each console exe is the vendored build (same MVID);
- the export-modes probe (`oracle/export-modes-probe/`, recorded in `fixtures/export-modes/<engine>-probe.json`): the real `GenerateHashtableFromManifest` of each build and the real `ConsoleUpgrade.ProcessExport` of each toolset, run offline on the inputs the fixture holds. `ProcessExport` is internal; the probe drives it by reflection and hands it an `IImportExportManager` that forwards everything to the engine's manager except `ExportSolutions`, which records the table it is given in the order a .NET `Hashtable` enumerates it. A rule says *observed* where it quotes a scenario of the probe by name. The scenarios `*-real-*` replay the recorded answer of the dev server's package-definition request (ticket 24, `fixtures/14.0.7/export/_blobs/316a9c3d…`: 55 packages and some 2,000 elements), and the scenarios `ui-*` run the loop on every input folder the import fixtures of ticket 25 recorded.

Conventions are those of `export-run.md`: **the table** is the `selItemsTable` of EXP-500; its enumeration order, which decides the order of packages, items, log lines and `imports.mf` (EXP-508, EXP-514), comes out of the sequence of its insertions, and each rule below says that sequence. Values the engine writes into an XPath are never escaped (AGENTS.md rule 7).

## The engine: GenerateHashtableFromManifest

### EXP-700: the table of every package, with the elements of the packages a manifest names

[14.0.7] `GenerateHashtableFromManifest(manifestFilePath)` returns a `Hashtable` or null:

1. When the manifest file does not exist it returns null (EXP-701), without a request.
2. It loads the manifest (EXP-701), then calls `GetSolutions2Xml` (EXP-507): one request for all package definitions of the database, with its messages (the `warning` of a database with no definitions) and its second-writer log write on a fault.
3. For each `name` element under a `PackageDefinition` item of the answer, in document order (EXP-702), it makes the inner table: the elements of that definition when the manifest names the package (EXP-703), an empty `Hashtable` when it does not. It then adds the name to the outer table with `Add`, so the outer table holds **every** package definition of the database, in the insertion order of the document, and a package the manifest does not name has an empty inner table (`ExportProc` skips an empty table, EXP-508).
4. The outer key is the `InnerText` of the `name` element and the inner key is the `InnerText` of the element's `element_id`, both exactly as the server sent them (no trimming). The item is `new ExportItem(name, element_id, element_type)` (EXP-002).

The manifest decides only *which* packages get their elements; it is not read for order, paths, dependencies or anything else. Observed `gm-subset-out-of-document-order` (six packages, the manifest names `pkg.p5`, `pkg.p2`, `pkg.p3`): all six packages are in the table, the three named ones with five elements and the others empty, and the enumeration order is the `Hashtable`'s (`p5, p2, p1, p3, p6, p4`), neither the manifest's nor the document's. `gm-real-three-packages` replays the dev answer with three packages named: 55 packages in the table, three of them filled; `gm-real-reverse-manifest-order` names twelve packages in reverse order and gets the same table as in forward order for those twelve.

[12.0] Same.

[14.35] Same.

### EXP-701: the manifest is found with File.Exists and loaded before the database is asked

[14.0.7] The file test is `IOWrapper.FileExists(path)`, which takes the path through `NormalizeLongPath` (MAN-004) and calls `File.Exists`. A path that does not exist, is a folder, is empty or is null gives false, so the method returns null. A path .NET cannot name makes `NormalizeLongPath` throw before `File.Exists` is reached: `C:\no|such\imports.mf` is an `ArgumentException` (`Illegal characters in path.`), as for MAN-004. The port applies that on a Windows host only (MAN-033). Observed `gm-no-file`, `gm-path-is-directory`, `gm-path-empty`, `gm-path-null` (all null, no request) and `gm-path-illegal-character`.

The manifest is loaded by `IOWrapper.XmlDocumentLoad(path)`: `File.ReadAllText` on the normalised path and `LoadXml` into a new `XmlDocument` (MAN-003). A manifest that is not XML, or is empty, fails with the `XmlException` of MAN-003 (`Data at the root level is invalid. Line 1, position 1.`, `Root element is missing.`), and **no request has been sent**: the manifest is read first. Observed `gm-not-xml`, `gm-empty-file` (0 requests).

[12.0] `File.Exists(path)` on the path as given, with no normalisation (MAN-004), so a path with an illegal character is simply a file that does not exist: null, not an exception (observed `gm-path-illegal-character`). The load is `CItemHelper.CreateNewXmlDocument()` and `XmlDocument.Load(path)`, the reader of MAN-003 `[12.0]` (it honours the encoding declaration and fails on invalid bytes).

[14.35] Same as 14.0.7.

### EXP-702: a package is selected by an XPath over the manifest, built from its name unescaped

[14.0.7] The names come from `//Item[@type='PackageDefinition']/name` on the answer of the database, in document order. For each, the manifest is asked `//package[@name='{name}']` (`SelectSingleNode`, the name interpolated as the server sent it, never escaped); the package is selected when that finds a node. The match is exact: `//package` is any `package` element at any depth, the comparison is ordinal and case-sensitive, white space counts, and a `package` element of the manifest with a `path`, a `dependson` child or anything else is the same as one without. Observed `gm-manifest-name-case-differs` (`PKG.P2` selects nothing), `gm-name-with-surrounding-space` (` padded ` selects only an element named ` padded `), `gm-nested-package-element` (a `package` below another element is found), `gm-name-empty` (a definition with an empty name is selected by `name=""`) and `gm-name-with-ampersand`, `gm-name-with-double-quote` (names with `&` and `"` work).

The query is made for **every** package definition, selected or not, before its elements are read. A name with an apostrophe makes the XPath invalid, and the whole call fails with `System.Xml.XPath.XPathException`, `'//package[@name='it's']' has an invalid token.`, whether or not the manifest names that package: one such definition in the database makes `GenerateHashtableFromManifest` unusable. Observed `gm-name-with-quote` and `gm-quote-name-not-selected-still-fails` (the offending definition comes last and is not named by the manifest). This is the engine's own unescaped interpolation, reproduced (AGENTS.md rule 7; bug EXP-702).

[12.0] Same.

[14.35] Same.

### EXP-703: the elements of a selected package are read with an XPath over the answer, by name

[14.0.7] For a selected package the elements are `SelectNodes(".//Item[@type='PackageDefinition' and name='{name}']/Relationships/Item[@type='PackageGroup']/Relationships/Item[@type='PackageElement']")` on the answer, in document order, with the name interpolated unescaped. The query matches **every** definition of that name, so two definitions with one name contribute both their elements (but see EXP-704), and it spans all the groups of a definition: elements of two groups come in one table, in document order of the groups and then of the elements. For each element:

1. `element_id` is the `InnerText` of its `element_id` child, then `name` of its `name` child, then `element_type` of its `element_type` child. A child that is missing is a `NullReferenceException` (`Object reference not set to an instance of an object.`) when the XPath finds no node; a child that is present and empty is the empty string, and an element with empty values is added (observed `gm-element-empty-values`: key, id, type and name are all empty);
2. `inner.Add(element_id, new ExportItem(name, element_id, element_type))`: the inner table is keyed by the element id, whatever the type, so two elements of one definition with one id are an `ArgumentException` (EXP-704).

The elements are inserted in document order into a table whose enumeration order is the `Hashtable`'s: observed `gm-elements-in-two-groups` (ids `ID-B`, `ID-A` in the first group and `ID-C` in the second come out as the table enumerates them), `gm-all-selected-grown-tables` (tables of 7 to 42 items, which grow and rehash several times) and `gm-real-three-packages` (666 elements of `com.aras.innovator.core`, compared by digest). A definition that has no group, or a group with no element, gives an empty inner table (`gm-package-without-groups`). The XPath is only evaluated for selected packages: a bad element of a package the manifest does not name is not read (observed `gm-element-not-selected-bad-element`, `gm-duplicate-element-id-package-not-selected`).

[12.0] Same.

[14.35] Same.

### EXP-704: what fails, and that nothing is returned from a failed call

[14.0.7] The call builds the table in a local variable and returns it only at the end, so each of these failures leaves the caller nothing:

- **No package definitions** (the answer is faultcode 0, so `GetSolutions2Xml` returns null after its `warning`, EXP-507): the `SelectNodes` on the null document is a `NullReferenceException`. Observed `gm-no-package-definitions`: the `warning` "The database contains no package definitions. Please select another database and try again" and then the exception (bug EXP-704).
- **A package name twice** (two definitions with one name, as an old generation left current would give): the second `outer.Add` is an `ArgumentException`, `Item has already been added. Key in dictionary: 'pkg.p1'  Key being added: 'pkg.p1'`. It fails even when the manifest does not name the package, because the `Add` is not conditional (observed `gm-duplicate-package-definition`, `gm-duplicate-definition-selected`: the elements of both definitions were read first and, for the selected one, merged, which only matters if their ids collide).
- **An element id twice in one selected package** (in one group or across groups): `ArgumentException` with the same text and the id (observed `gm-duplicate-element-id`, `gm-duplicate-element-id-across-groups`).
- **A missing child** of an element: `NullReferenceException` (observed `gm-element-without-name`, `gm-element-without-id`, `gm-element-without-type`).
- **An invalid name** in either XPath: `XPathException` (EXP-702).

A fault other than 0 on the request is handled inside `GetSolutions2Xml` (EXP-507): the `error` message, the log write and a null return, which is the first case's `NullReferenceException`.

[12.0] Same.

[14.35] Same.

## The console tool: the three loops

### HOST-100: three ways to choose what to export, exclusive with each other and with the item sources

[14.0.7] `ConsoleUpgrade.exe` chooses the table by two switches: the argument `useimport` sets `SUExportContext.UseImport`, and the context's manifest file (`mffile=`) says which manifest to use. `aras-pkg export <outDir>` offers the three ways as options, each a source of the items in the sense of HOST-001:

| Option | Console tool | Table |
|---|---|---|
| `--use-import <manifest>` | `useimport` | the items the manifest's package folders would add (HOST-110 to HOST-113) |
| `--from-manifest <manifest>` | `mffile=<manifest>` | the engine's `GenerateHashtableFromManifest` (HOST-120) |
| `--all-packages` | (no manifest) | every package of the database with all its elements (HOST-121) |

The three are exclusive with each other and with `Type:id` arguments, `-` and `--package`: a command line that gives two of them is a usage error (exit 64) that names them (`--use-import and --from-manifest cannot be combined: each chooses what to export`, `--all-packages cannot be combined with items, '-' or --package: it chooses what to export`). The output folder stays the first argument and is required.

The console tool's own help says the manifest defaults to `imports.mf` in `dir`. The code does not: with no `mffile` argument the context's manifest path is the empty string, `File.Exists("")` is false, and the tool exports every package. The CLI has no such default (HOST-101).

[12.0] Same.

[14.35] Same.

### HOST-101: the manifest of a mode must exist, checked before any server call

[14.0.7] `--use-import` and `--from-manifest` take the path of a manifest, resolved against the current directory to an absolute path. The file is checked with the other local checks of HOST-005 (step 5, with the items), before the password is read or anything is sent: an empty path, a path that does not exist and a path that is not a file are usage errors (exit 64): `--from-manifest 'x.mf': the manifest file does not exist`. The console tool would silently fall back to every package for a missing manifest (EXP-700 returns null, HOST-120); the CLI makes that explicit: the user who wants every package says `--all-packages`.

The file is not read here. A manifest that is not XML fails later, in the manager's constructor (HOST-102), and a manifest the loop cannot use fails in the loop.

[12.0] Same.

[14.35] Same.

### HOST-102: the sequence for the modes: the context names the manifest, and the manager is built before the table

[14.0.7] HOST-009 gives the sequence for items the user names. For the three modes it is the console tool's, in which the manager exists before the table is built:

1. the context is the one of HOST-009 with `ManifestFile` set to the manifest of `--use-import` or `--from-manifest` (not set for `--all-packages`), and `UseImport` true for `--use-import` only. The log header says so: `Manifest file: <path>` and `Export using import structure: True` (EXP-506);
2. the connection and the login, as in HOST-009;
3. the manager is built, `new ImportExportManager(context, messages, helper)` (EXP-502). Its constructor loads the context's manifest when the file exists, so a manifest that is not well-formed XML fails here, with the `XmlException` of MAN-003, before any table is built (observed `cf-bad-manifest`: the constructor throws). This is the failure exit (1);
4. the table is built by the mode (HOST-110, HOST-120, HOST-121), which may send the package-definition request itself, and may fail (the rules of EXP-704 and HOST-112). A failure ends the run like any exception of the run: exit 1, the logout of step 6 still done;
5. `ExportSolutions(context, table)` runs (EXP-500), which asks for the package definitions once more (EXP-507);
6. logout.

The exit code is that of HOST-009. A run of a mode has no refusal by name: the modes do not look items up, so the `Export refused` lines of HOST-014 to HOST-016 do not occur.

[12.0] Same.

[14.35] Same.

### HOST-110: --use-import builds the table from the package folders an import would read

[14.0.7] `ProcessExport` with `UseImport` true:

1. `mfDirPath` is `Path.GetDirectoryName(manifest)` (null for a root, empty for a bare file name);
2. a `StreamWriter` on the context's log file in append mode is opened (`IOWrapper.NewStreamWriter`, after the path rules of MAN-004) and **kept open for the whole loop**; it is disposed when the loop ends or fails. The log is therefore created, and any text of the loop is in it before the engine's header (EXP-506), which the export appends afterwards;
3. `new ManifestFile(manifest)` reads the manifest again (MAN-003; the manager's constructor read it too);
4. for each `GetAllPackageNames()` entry, in document order, duplicates included: `GetSolutionPath(name, mfDirPath, manifest)` (MAN-032), `LoadPackageDom(solutionPath, logWriter)` (IMP-001, which writes its warnings of IMP-008 to the same writer), and `GetItemsFromPackageDom` (IMP-015);
5. the items are filtered and added (HOST-111) to a new inner table, and the package is added to the outer table with `Add` after its items (HOST-112).

Nothing is sent to the server. The import's `build.xsl` ordering and the loading rules (IMP-001 to IMP-015) apply as for `import`, so a package folder that cannot be loaded fails here as it does for an import (observed `ui-fs-xml-declaration--step-1--input`: `CItemException` `Unexpected XML declaration. … Unable to apply build.xsl.`; `ui-missing-package-folder`: `Could not find a part of the path '…\NoSuchFolder'. Unable to get solutions files by path in .mf file …`; `ui-missing-manifest`: `FileNotFoundException`).

[12.0] Same loop, with the 12.0 file handling: `Path.GetDirectoryName` and `new StreamWriter(logFile, true)` on the raw paths (no normalisation, EXP-505 `[12.0]`), and the 12.0 loading of the package folders (IMP-005 and IMP-008 `[12.0]`: encodings honoured, another text for a skipped file). Observed in `fixtures/export-modes/12.0-probe.json` (`ui-r15-latin1-file--step-1--input` fails with `Invalid character in the given encoding. Line 3, position 21.`; the warning reads `doesn't have root tag 'AML/Item'`). The port loads 12.0's package folders with the 12.0 rules (wayfinder ticket 50), so the mode is offered for 12.0 (HOST-113).

[14.35] Same loop, with 14.35's file handling (`IOWrapper` with the normalisation inlined) and 14.35's loading of package folders. The port's 14.35 loading is built (wayfinder ticket 60), and the mode is offered for 14.35 (HOST-113).

### HOST-111: only the importable items with action add are taken, keyed by id, named by their file

[14.0.7] Each `GetItemsFromPackageDom` document holds one top-level `Item`: its root element (`SelectSingleNode("Item")` on the document). For each, in the order `GetItemsFromPackageDom` gives them (IMP-015):

- `action`, `id`, `type` and `tempKeyName` are read with `GetAttribute`, which gives the empty string for a missing attribute;
- an item whose `action` is not exactly `add` is skipped (`edit`, `merge`, `delete`, `get`, a missing `action`). Nested items are not looked at: only top-level items count, and an item an `add` carries inside it is part of that item (observed `ui-own-conflicts-and-filters`: the nested `Property` of an `ItemType` is not an entry);
- `ExportImportBase.IsImportableType(type)` (IMP-423) must hold: items of type `Member` and `Server Event` are skipped (observed: they do not conflict either);
- the entry is `inner.Add(id, new ExportItem(tempKeyName, id, type))`. The `tempKeyName` is the stamp IMP-009 puts on the **first item of each file** (the file's name without its extension), so the keyed name of every other item of a file is the empty string; the engine names the exported file of an item with an empty keyed name by its id (EXP-002). An item with no `id` has the key and the id `""`: the first one is added and a second is a conflict (observed `ui-own-conflicts-and-filters`: the entry `||List|`).

**A conflict.** The key is the id alone, so an item with a taken id, whatever its type, is not added, and the loop writes to the log writer (`WriteLine`, CRLF) the line

```text

Conflict: id = {id}; itemName = '{tempKeyName}' type = '{type}' and itemName = '{keyedName of the first}' type = '{type of the first}'
```

(a line feed first, then the text, then CRLF; the second half names the item that was kept). The first item is kept. Observed `ui-own-conflicts-and-filters`: three conflicts (the same id twice, the empty id twice, and the same id with another type), each as above; the log is those lines (after any IMP-008 warning of the load, which comes first).

[12.0] Same.

[14.35] Same.

### HOST-112: the table is filled package by package, in manifest order, and a failure leaves nothing

[14.0.7] The insertion sequence, which decides the enumeration order of the table:

1. the outer table gets the packages in the order of the manifest's `package` elements (`GetAllPackageNames`: document order, duplicates included), each added with `Add` **after** its inner table is complete;
2. an inner table gets its items in the order of HOST-111, with `Add` (an indexer is never used, so a taken key is the conflict and not a replacement).

The enumeration order is the `Hashtable`'s, not the manifest's: observed `ui-order-six-packages` (six packages of 18 items each, listed alpha, bravo, charlie, delta, echo, foxtrot, come out of the table in a different order, and so do the items of each).

A package with no `add` item has an empty inner table and stays in the outer one (`ExportProc` skips it, EXP-508). A manifest with no package gives an empty table, and the export then has nothing to do. A `package` element with no `path` attribute gets the folder `GetPackagePath` derives from its name (MAN-030); observed `ui-package-without-path-attribute`: the package `nopath` is in the table with 0 items.

A repeated package name in the manifest is read twice and then fails: the second `outer.Add` is an `ArgumentException`, `Item has already been added. Key in dictionary: 'own'  Key being added: 'own'` (observed `ui-duplicate-package-in-manifest`). Whatever the loop raised leaves the table unbuilt, the log writer is disposed (its text is kept in the file) and the export does not run.

[12.0] Same.

[14.35] Same.

### HOST-113: the engines that have --use-import

[14.0.7] The mode runs on 14.0.7.

[12.0] The mode runs on 12.0, with 12.0's loading of package folders (IMP-005 to IMP-011 `[12.0]`). `--from-manifest` and `--all-packages` run on 12.0 too: they read only the answer of the package-definition request.

[14.35] The mode runs on 14.35, with 14.35's loading of package folders (IMP-005 to IMP-011 `[14.35]`). The live parity of the mode on dev (`mode-use-import-scratch`, `mode-use-import-absent-items`; `roadmap/live-parity-14.35.md`) and the probe of ConsoleUpgrade's loop on 14.35 (`fixtures/export-modes/14.35-probe.json`) both agree with the port. `--from-manifest` and `--all-packages` run on 14.35 too.

### HOST-120: --from-manifest is the engine's GenerateHashtableFromManifest

[14.0.7] `ProcessExport` with `UseImport` false calls `GenerateHashtableFromManifest(Context.ManifestFile)` (EXP-700) and exports the table it returns. When the engine returns null (the file does not exist) the console tool goes on with the all-packages loop (HOST-121). The CLI has checked the file (HOST-101), so a null here means the file disappeared after the check, and the run fails with `the manifest '…' does not exist` (exit 1) instead of falling back.

The table holds every package of the database, with the elements of the packages the manifest names (EXP-700), so a manifest that names no package of the database selects nothing: all inner tables are empty, no package folder is made and the export then fails on saving `imports.mf` in the output folder that does not exist (`Could not find a part of the path '<outDir>\imports.mf'.`, EXP-511; exit 1). The manifest needs only `package` elements with a `name`; an `imports.mf` that an export wrote is such a manifest, so `--from-manifest` re-exports the packages a previous export covered, with all their current elements.

Observed `cf-real-three-packages` and `cf-small-subset` (the table is that of EXP-700 and the engine asked for the package definitions once), `cf-bad-manifest` (the constructor fails, HOST-102).

[12.0] Same.

[14.35] Same.

### HOST-121: --all-packages builds the table from the database alone

[14.0.7] The loop of the console tool when it has no manifest to select from:

1. `GetSolutions2Xml()` (EXP-507). A null answer is a `NullReferenceException` on the first query, after the engine's warning (EXP-704);
2. for each name under `.//Item[@type='PackageDefinition']/name`, in document order: a new inner table, filled with the elements of that definition (the query and the three child reads of EXP-703, in the same order), and the name added to the outer table with `Add`.

It is `GenerateHashtableFromManifest` with every package selected and no manifest query, so the table is the one EXP-700 gives for a manifest that names every package, with the same failures (a name with an apostrophe in the element query, a repeated definition, a repeated element id, a missing child: EXP-702 to EXP-704). Observed `ca-real-all-packages` (the dev answer: 55 packages, in the table's order, compared by count and digest), `ca-small-all-packages`, `ca-grown-tables`, `ca-elements-in-two-groups`, `ca-name-with-quote`, `ca-duplicate-package-definition`, `ca-duplicate-element-id`, `ca-element-without-name` and `ca-no-package-definitions`.

The request for the package definitions is sent twice in a run, once here and once by `ExportSolutions`.

[12.0] Same.

[14.35] Same.

### HOST-130: the summary names the mode and lists every package of its table

[14.0.7] The summary of HOST-030 has `source` `use-import`, `from-manifest` or `all-packages` for the modes. Its `packages` are the packages of the table in the order the engine enumerates it, with the number of items of each, **empty ones included** (a table that holds the whole database has packages the run does not export), and `items` is their total. A run that fails before the table exists lists none.

[12.0] Same.

[14.35] Same.
