# Import language selection

14.35 adds a `Languages` setting to the import. Before the first item is sent, the `ImportExportManager` constructor scans every package of the manifest for the languages its files use. It can expand `*` to those languages, it checks that the selected ones are installed in the database, and it records which languages each package uses. Then `ImportSolutions` deletes, from every item of a package, the nodes that carry an `xml:lang` of a language the package uses and the selection leaves out. This document specifies that option, how the hosts set it, the scan, the checks and the deletion. The rules are `IMP-600` to `IMP-699`. The 14.35 changes to language-pack import (`LP-040` onward and the `[14.35]` variants of `LP-001` to `LP-036`) are in `spec/language-pack.md`; the exports of 14.35 that select languages are wayfinder ticket 54's.

Sources:

- the 14.35 decompile of `Libs.dll` (`.decomp/14.35/`, `Libs 14.35.0.43890`, never committed): `ImportExportManager` (the constructor, `ThrowIfNoSelectedLanguagesInDatabase`, `CheckWorkItem`, `ImportPackage`, `TryToFlushAmlBatch`), `LanguageCodesExtractor`, `CItemHelper.GetLanguagesFromInnovator`, `ImportWorkItem`, `IOWrapper`, `SolutionUpgradeContext`; Aras's `ConsoleUpgrade.exe` 14.35 (sha256 `237f412b…736a9`) and `import.exe` 14.35, decompiled locally and never committed. The 14.0.7 and 12.0 decompiles were checked for the same members: neither has a language setting, a scan or a deletion on import;
- `fixtures/import-languages/14.35/` (see its `README.md`): probes that run the real 14.35 engine from a staged copy of the vendored `oracle/native/14.35/Libs.dll` and `IOM.dll` on .NET Framework 4.8 (Windows PowerShell 5.1), against a stub connection that records the AML IOM hands it and answers from a script. No server was contacted. Where a rule says *probed* it cites a case label of `01-extractor.out` … `03-import-skip.out` (the scan and the deletion), `02-manager-ctor.out` (the constructor) or `07-host-arguments.out` (the console host's parser). **What the stub answered is the probe's model of the server, not evidence of what Aras answers**; the import fixtures of wayfinder ticket 75 record that.

## Conventions used by every rule here

- **Languages** is `ISolutionUpgradeContext.Languages`, a `string[]`. It is `null` unless a host sets it. **A code** is a language code (`de`, `zh-cn`). **The selection** is the array the manager holds after the constructor (IMP-620).
- **The scan** is the constructor's pass over the manifest's packages (IMP-610). **A package's used languages** are the codes the scan found in its files (IMP-611).
- Codes are compared exactly: ordinal and case-sensitive (`Except`, `Contains`, XPath `=`) unless a rule says otherwise. Lower-casing is `ToLowerInvariant`, which LP-013 describes (`İ` stays, a final `Σ` becomes `σ`).
- **CRLF** is `\r\n`. `Environment.NewLine` in a message is CRLF: the engine runs on Windows and the library reproduces it on every OS.
- **XML text.** Reading a file is IMP-007. The AML is serialised as IMP-010 describes. A request is the AML as IOM hands it to the connection (WIRE-004).
- Values interpolated into XPath or SQL are reproduced exactly (`AGENTS.md` rule 7): IMP-633, LP-044.

## The option and its hosts

### IMP-600: Languages is a setting of the context that only 14.35 has

[14.35] `ISolutionUpgradeContext` and `SolutionUpgradeContext` have a read/write property `string[] Languages`, with no default (`null`) and no validation. The import reads it in two places: the constructor (IMP-620 to IMP-623) and `ImportPackage` (IMP-630). The constructor may also write it (IMP-620). Nothing else of the import reads it; the log header (IMP-403) does not mention it.

| `Languages` | What the import does |
|---|---|
| `null` | the scan runs (IMP-610), nothing else (IMP-635) |
| empty array | the scan runs; no `Language` request, nothing is deleted (IMP-635) |
| `["*"]` and nothing else | replaced by the languages the packages use (IMP-620), then checked and applied like any other selection |
| anything else | checked against the installed languages (IMP-621), then applied (IMP-630) |

[14.0.7] No such setting. `ISolutionUpgradeContext` has none, the constructor does not scan, and every `xml:lang` node of every item is sent.

[12.0] Same as 14.0.7.

### IMP-601: ConsoleUpgrade reads `langs` and refuses a list without `en`

[14.35] `ConsoleUpgrade.exe` reads the option `langs=<list>` (the name in any case, the value optionally in single quotes; the argument rules are LP-002's) into `Languages`. Probed through the host's own parser (`07-host-arguments`; the library's own flags are the CLI tickets', only the behaviour a parity run must show is here):

- the value is split on `,`, empty entries are dropped, and duplicates are removed with an exact comparison, keeping the first and the order: `langs=,de,,en,` gives `de`, `en`; `de,de,en` gives `de`, `en`; `de,DE,en` keeps both. Nothing is trimmed, so `langs=de, en` (one argument) gives `de` and ` en`;
- a list that ends up empty (`langs=,,`) is an empty array, the same as no `langs` at all. `langs=` with nothing after the `=` and the bare word `langs` print `\r\nunrecognized option …` and end the run with code 1, as any unrecognised argument does;
- **`en` is required.** After the other checks, when the array is not empty, its first entry is not exactly `*` and no entry equals `en` ignoring case, the host prints `'en' language is required for 'langs' list` (no line break) and ends the run with code 1. So `langs=de` is refused, `langs=EN,de` passes, `langs=*,de` passes (first entry `*`), and so does `langs=de,*,en`. The values are kept as typed: `EN` stays `EN` (and the installed check then refuses it, IMP-621);
- for `lpimport` the check is not made. The parser returns before it, so `lpimport … langs=de` is accepted and `Languages` is `["de"]` (IMP-640);
- the later of two `langs` options wins.

The host passes the array unchanged to the manager through `Languages`. `ConsoleUpgrade.exe` 14.35 also uses `Languages` for its export modes (wayfinder ticket 54).

[14.0.7] The host has no `langs` option: `langs=de` prints `\r\nunrecognized option langs` and ends the run with code 1.

[12.0] Same as 14.0.7.

### IMP-602: import.exe takes the selection from a list of the languages the packages use

[14.35] The GUI tool `import.exe` builds its `SolutionUpgradeContext` with `Languages` = the checked entries of a list box. The list is filled whenever the selection of packages changes with `LanguageCodesExtractor.GetUsedLanguagesByPackages` of the checked packages (IMP-615), `en` moved to the front and always checked; the user cannot uncheck it. So a GUI import always includes `en` and only languages that the checked packages use. The scan that feeds it (`ExtractLanguageCodesFromPackages`) is the same one the constructor runs (IMP-610).

The library has no GUI. It reproduces the engine behaviour the GUI relies on (IMP-610 to IMP-635), not the list box. A library user chooses the selection with the CLI option `--languages <codes|*>` of `import` and `import-language-pack` (IMP-480), which reads the list as IMP-601 does and refuses what the console host refuses, and gets the same checks of the engine as the console host.

[14.0.7] `import.exe` has no language list.

[12.0] Same as 14.0.7.

## The scan of the packages

### IMP-610: The constructor scans every package of the manifest, for imports only

[14.35] When `context.Action` is `Import`, the `ImportExportManager` constructor does this after it has read the manifest (IMP-402 steps 1 to 4) and before it looks at `Languages`:

1. for each package name of `ManifestFile.GetAllPackageNames()`, in the manifest's order, it builds a package (name, folder). The folder is `GetSolutionPath(name, Path.GetDirectoryName(context.ManifestFile), manifest)` (MAN-032). This is `GetDirectoryName` of the manifest path **as given**, not the full parent folder IMP-402 takes for the import itself; for a relative manifest path both resolve to the same folder, and a bare file name gives `""`, which `Combine` drops (probed `relative manifest paths`: `sub\imports.mf`, an absolute path and `imports.mf` all work). The packages are built lazily, one at a time, as the scan reaches them;
2. it clears the extractor's cache (IMP-613) and scans the packages in that order (IMP-611).

This happens whatever `Languages` is, including `null` (probed `languages-null`: `static cache "P1" => "de", "fr"` with no `Language` request). It happens for every manifest the import is given, so a language-pack import scans its temporary package too (IMP-640). It does not happen for any other `Action`.

A failure in step 1 or 2 ends the constructor with that exception (IMP-612). Nothing the constructor does later (IMP-620, IMP-621) has happened by then.

[14.0.7] No scan. The constructor ends after IMP-402's steps; a missing package folder or an unreadable file is found only when the package is imported (IMP-011).

[12.0] Same as 14.0.7.

### IMP-611: A package is scanned by reading every `*.xml` file under its folder

[14.35] For one package the scan lists `Directory.GetFiles(folder, "*.xml", SearchOption.AllDirectories)` (after `NormalizeLongPath`, MAN-004): every file at any depth below the package folder, **including the folder's own files**, whose extension starts with `xml`, compared ignoring case (IMP-003's pattern; probed `file-name-patterns`: `a.xml`, `b.XML`, `c.xmlbak`, `g.Xml` and `sub\f.xml` were read, `d.txt` and `e.xml.txt` were not). The import of the package itself reads only the files of the immediate subfolders (IMP-002), so the scan reads files the import never would.

Each file is read as IMP-007 describes (`ReadAllText`, `LoadXml`; a byte order mark, a declaration and a DOCTYPE are fine, probed `bom-and-declaration`, `doctype-in-file`). The files of one package are read in parallel (`Parallel.ForEach`); the order is not defined and nothing depends on it. From each document the scan takes the attribute nodes of `//Item/*/@xml:lang` with the XPath of that text: an `xml:lang` attribute of an element that is a **direct child of an element named `Item`**, at any depth of the document. The names are exact, with no namespace. Probed (`selection-rules`):

- selected: `<Item><i18n:label xml:lang="de"/></Item>` (a child), an `Item` inside `Relationships` or anywhere in a document whatever its root is, and an attribute with an empty value (the empty string is a code);
- not selected: an `xml:lang` on the `Item` element itself, a grandchild of the `Item`, an attribute `lang` or `xml:space`, an element named `item` (case), and an `Item` that is in a namespace (`<AML xmlns="urn:x">`).

Every selected value is lower-cased (IMP-614) and added to the package's list. The package's used languages are that list without duplicates, in no defined order. They are stored under the package's name (IMP-613). A package with no `xml:lang` has an empty list (probed `package-without-xml`).

[14.0.7] Same as no scan (IMP-610).

[12.0] Same as 14.0.7.

### IMP-612: A file the import would never read can fail the constructor (bug)

[14.35] Any exception of the scan ends the constructor with it, before `ImportSolutions` can run:

- the package folder is missing: `System.IO.DirectoryNotFoundException` (`Could not find a part of the path '{folder}'.`); it is a file: `System.IO.IOException` (`The directory name is invalid.\r\n`). These are raised by the listing, outside the parallel loop, so they are not wrapped (probed `missing-folder`, `folder-is-a-file`, `missing-package-folder`);
- a file does not parse (an empty file, two roots, a file that is not XML, an unclosed element): the parser's `XmlException` (`Root element is missing.`, `There are multiple root elements. Line 1, position 6.`, `Data at the root level is invalid. Line 1, position 1.`) wrapped in **`System.AggregateException`**, with the message `One or more errors occurred.` and the `XmlException` as its only inner exception. When several files fail, the inner exceptions are all those that failed before the loop stopped; their number and order are not defined (probed `three-malformed-files` gave three). A file that is not an XML document but is named `*.xml` fails the same way wherever it is (probed `bad-file-no-languages-option`: a `readme.xml` holding the text `not xml`, with `Languages` null).

Packages are scanned one after another, so the packages before the failing one are in the cache (IMP-613) and the failing one and the later ones are not (probed `malformed-file-in-second-package`: `P` has `de`, `Q` has nothing). Nothing is rolled back, and nothing is logged by the constructor: the manager is not built.

Registered in `bugs.md`: the 14.0.7 import reads only the immediate subfolders' files (IMP-002), so a package with a malformed or stray `*.xml` at a deeper level, or directly in the package folder, imports in 14.0.7 and cannot even start in 14.35. `Languages` need not be set. The bug is the same for an unrelated package of the manifest: the scan covers all of them, not only those the host will import.

[14.0.7] No scan; such files do not matter.

[12.0] Same as 14.0.7.

### IMP-613: The used languages are kept by package name in a cache shared by every manager

[14.35] `ImportExportManager.LanguageCodesExtractor` is a **static** property: one `LanguageCodesExtractor` object for the process. Its cache is a dictionary from a package's name to its list of used codes (IMP-611).

- `ExtractLanguageCodesFromPackages` clears the cache first, then adds each package after its scan. When two packages have the same name (the manifest holds two `package` elements of one name), the first one's list is kept and the second one is scanned anyway and dropped (probed `same-package-name-twice-first-wins`); a failure in the second one still ends the constructor;
- `GetUsedLanguagesByPackage(name)` returns the list, or an empty array for a name that is not in the cache (probed `by package "Unknown"`);
- a later import manager replaces the cache (probed `re-extract-clears-the-cache`); a manager for another action does not touch it (probed `static cache survives a later export manager`).

`ImportPackage` reads the cache with the package name it was given (IMP-630), so a manager that is built and run in a process where another manager rebuilt the cache in between would read the other one's lists. The library may hold the cache per manager; the difference is observable only to a caller that builds two managers and runs the first after the second was built.

[14.0.7] No such cache.

[12.0] Same as 14.0.7.

### IMP-614: Used codes are lower-cased, but nodes are matched by their exact text (bug)

[14.35] The scan lower-cases every `xml:lang` value it finds (`ToLowerInvariant`, LP-013): `DE`, `De` and `de` give the one code `de`; `ZH-CN` gives `zh-cn`; `İ` stays `İ` (probed `case-lowered-and-merged`). The deletion (IMP-631) looks for nodes with `@xml:lang='{code}'`, which is an exact comparison against the text in the file. So a file that writes `xml:lang="DE"`:

- contributes `de` to the used languages, so `*` expands to `de` (IMP-620), and a selection `["de"]` passes the installed check (IMP-621) for a file that never said `de`;
- when `de` is not selected, `de` is in the skip set (IMP-630), the XPath `@xml:lang='de'` does not match `DE`, and **the `DE` node is sent** (probed `uppercase-in-file-is-lowered-in-the-selector`: with `Languages` = `["en"]` the `DE` label stayed and the lower-case `fr` one was deleted).

Registered in `bugs.md`: a correct engine would compare the file's code in the same case it stored. Selecting `DE` instead does not help: the installed check lower-cases the installed codes and not the selection (IMP-622), so `DE` is "not installed" (probed `languages-uppercase-selected`).

[14.0.7] Not applicable (no scan).

[12.0] Same as 14.0.7.

### IMP-615: GetUsedLanguagesByPackages is the sorted union, sorted by the host's culture

[14.35] `GetUsedLanguagesByPackages(names)` returns the codes of all the named packages' lists (IMP-613), without duplicates (exact), ordered ascending by the default string comparer. A name that is not in the cache contributes nothing, and an empty list of names gives nothing (probed `by packages P2,P1,P2`, `by packages none`). The sort is **culture-sensitive** (`Comparer<string>.Default`), so it follows the thread's current culture of the host process; the probe ran under en-US. It is used in IMP-620 and IMP-602.

Observed order under en-US (`01-extractor.out`, `sort-order`, `sort-order-realistic`): digits before letters, `a_b`, `ab`, `a-b`, a hyphen counts for little and only breaks a tie after the letters (`de`, `de-ch`, `dex`; `zh`, `zhcn`, `zh-cn`, `zh-tw`; `en`, `en-us`), and an accented letter sorts next to its base letter (`e`, `é`, `en`). For codes made of the ASCII letters, digits and `-`, the order is: compare the codes with every `-` removed, ordinally; when they are equal, the code without a hyphen comes first. The library uses that rule, and it holds the exact probe order as a test; other characters are not reproduced.

[14.0.7] Not applicable.

[12.0] Same as 14.0.7.

## The selection

### IMP-620: A selection of `*` alone is replaced by the languages the packages use

[14.35] When `Action` is `Import`, `Languages` is not null, its length is exactly 1 and its only entry is exactly `*`, the constructor replaces the property with `LanguageCodesExtractor.GetUsedLanguagesByPackages(all package names of the manifest)` (IMP-615), as an array. The names are the manifest's, in its order, every one, whether or not the host will import it. The replacement is written to the context: after the constructor, `context.Languages` holds the expanded array (probed `languages-star`: `["*"]` → `["de", "en", "fr"]`, the codes of `de,fr,en` sorted; `languages-star-two-packages`: the union of two packages).

- when the packages use no language the result is an empty array, and the rest of the import behaves as for an empty selection (IMP-635; probed `languages-star-package-without-languages`: `[]`, no request);
- `en` is in the result when some package uses it. It is not added otherwise, and nothing is removed;
- any other array containing `*` is not expanded: `["*", "de"]`, `["de", "*"]` and `["*", "*"]` are used as they are, and the installed check names `*` as not installed (probed, IMP-621);
- for an `Action` other than `Import`, `*` is left as it is (the language-resource exports have their own expansion, LP-111).

The expanded codes are lower case (IMP-614), so they match the installed ones (IMP-622). They can still contain a code the database lacks: `*` over a package that uses `es` when `es` is not installed fails the next check (probed `languages-star-not-installed`).

[14.0.7] Not applicable.

[12.0] Same as 14.0.7.

### IMP-621: Every selected language must be installed, or the constructor fails

[14.35] After IMP-620 the constructor stores the context and calls `ThrowIfNoSelectedLanguagesInDatabase(context.Languages)`. It does nothing for `null` and for an empty array: no request is sent. Otherwise:

1. it asks for the installed languages (IMP-622): `GetLanguagesFromInnovator()`, whose request is `<Item isNew="1" isTemp="1" type="Language" action="get" select="code,name" />`;
2. the missing codes are the selection `Except` the installed codes (exact, case-sensitive): the entries of the selection that no installed code equals, each once, in the order of the selection (probed `languages-not-installed-duplicates`: `xx`, `yy`, `xx`, `de`, `yy` with `de` installed gives `xx,yy`);
3. when any is missing it throws `CItemException` with faultcode `0`, an empty faultstring, and faultdetail and message
   `Some of the selected languages are not installed for current Aras Innovator: {codes}.` CRLF `Please, install missing languages or remove them from import package before proceeding.`
   where `{codes}` is the missing codes joined with `,` (an entry that is the empty string, or has spaces, is printed as it is: `Some … Innovator: .` and `…:  de,fr .`). To write the text the engine enumerates the missing codes a second time, and with them asks for the installed languages **again**: a failing check sends the `Language` request twice (probed: every failing case shows two requests, a passing one shows one);
4. when none is missing, nothing else happens. The constructor ends, with `context.Languages` unchanged.

The check applies to every `Action`, not only `Import` (probed `export-action-checks-languages`: `["xx"]` is refused for `Export`). It does not look at what the packages use: a selection may name a language that no package uses, and the import deletes nothing for it.

Because the context was written before the check, a refused selection leaves the expanded array in `context.Languages` (probed `languages-star-not-installed`). The host (`ConsoleUpgrade.exe`) catches the `CItemException`, appends its `ToString()` to the log, prints `Error: {message}` (no line break) and ends the run with code 1; the message is the faultdetail above.

Case matters twice. The installed codes are lower-cased (IMP-622) and the selection is not, so `DE` is refused when `de` is installed, and an installed `DE` matches the selection `de` (probed `languages-uppercase-selected`, `languages-uppercase-installed`). Spaces are not trimmed, so `" de"` is refused (probed `languages-with-spaces`).

[14.0.7] Not applicable.

[12.0] Same as 14.0.7.

### IMP-622: GetLanguagesFromInnovator is a lazy Language get that lower-cases the codes

[14.35] `CItemHelper.GetLanguagesFromInnovator()` is an iterator. Nothing is sent until it is enumerated, and **each enumeration sends the request again** (IMP-621 enumerates it once or twice). When enumerated it:

1. builds `newItem("Language", "get")` with the attribute `select` = `code,name` and applies it (`Item.apply`, one `ApplyItem` request, WIRE-004);
2. when the answer is not an error and `getItemCount() != 0`, yields for each item, in the answer's order, a `LanguageInfo` with `Code` = `getProperty("code")` lower-cased with `ToLowerInvariant` and `Name` = `getProperty("name")` (null when absent, probed `language-get-item-without-name`);
3. otherwise yields nothing: a fault of any code (the "no items" one included), an empty `Result` and a response that is not a SOAP envelope all give an empty list, **without an exception** (probed `language-get-fault0`, `language-get-other-fault`, `language-get-empty-result`, `language-get-garbage`). IOM's count is `-1` for a response without items and `0` for the "no items" fault (LP-014).

An item with no `code` makes `ToLowerInvariant` throw `System.NullReferenceException` when that item is reached, from inside the enumeration; the constructor ends with it (probed `language-get-item-without-code`, also when every selected language was found before it: the check builds the set of installed codes first, so the whole list is read). Two items with the same code are fine here (probed `language-get-duplicate-code`; LP-014 and LP-044's dictionaries are not used).

[14.0.7] The method does not exist (`ICItemHelper` has no `GetLanguagesFromInnovator`). The language-pack preprocessor does its own `Language` get (LP-014).

[12.0] Same as 14.0.7.

### IMP-623: A failed Language get makes every selected language "not installed" (bug)

[14.35] Because IMP-622 turns any failure into an empty list, a server fault, a permission problem or a dropped connection during the `Language` get is not reported as itself: IMP-621 says that **every** selected language is not installed, with the text above, whatever the cause (probed: faultcode 0, faultcode 1, an empty result and a non-SOAP response all give `…installed for current Aras Innovator: de.`). The message sends the user to install languages that exist.

Registered in `bugs.md`: a correct engine would stop with the server's fault. The library reproduces the message and the second `Language` request that writes it (IMP-621 step 3), so a fixture that drives a fault sees the same two requests.

[14.0.7] Not applicable.

[12.0] Same as 14.0.7.

## The deletion

### IMP-630: A package's skip set is the languages it uses minus the selection

[14.35] `ImportPackage` computes the skip set once per package, after the package definition and its dependencies were written and before the first item (IMP-406):

- when `Languages` is `null` or empty it is the empty set;
- otherwise it is `GetUsedLanguagesByPackage(packageName)` (IMP-613, with the name the package has in the list given to `ImportSolutions`) `Except` the selection: the used codes that no entry of the selection equals, each once. The comparison is exact, so a used code `de` is not removed by a selection entry `DE`, and `en` is in the skip set when the package uses `en` and the selection does not hold it (a selection `["de"]` deletes the `en` nodes; probed `languages-de-removes-en-and-fr`).

The skip set is computed from the package's own list, not the union of all packages: with two packages in one run, each is cut with its own set (probed `per-package-skip-sets`: `["de","en"]` deleted `fr` from the item of `P1` and `es` from the item of `P2`).

[14.0.7] Not applicable.

[12.0] Same as 14.0.7.

### IMP-631: Each item's skipped-language nodes are deleted after the item was checked and before it is sent

[14.35] `CheckWorkItem(package, buildDom, delayedResolutionManager, logWriter, langsToSkip, workItem)` first does what the 14.0.7 loop does inline before an item is sent: the one-time deletion of the package's SQL items (IMP-425) and `DoChecking` (IMP-100), and then, for each code of the skip set, in the set's order:

1. it builds the XPath text `//node()[@xml:lang='{code}']`, with the code put in unescaped (IMP-633);
2. it selects with it from the item's document, with an `XmlNamespaceManager` that holds only the built-in `xml` prefix;
3. it removes each selected node from its parent (`ParentNode.RemoveChild`).

`//` starts at the document root, so the selection covers the whole item: every element of the item document, at any depth, whose `xml:lang` attribute equals the code exactly. That includes the nodes inside `Relationships`, the elements of a property whose value has markup, and the `i18n:` elements, with their children and everything below. The order of the codes does not change the result: removing a node removes what is below it, and a code whose nodes are all gone selects nothing. Nothing is logged for a removal, and no message is sent. Probed (`languages-de-en-removes-fr`, `languages-en-removes-de-fr`, `any-element-and-nested`, `item-with-empty-lang`):

- `Languages` = `["de","en"]` over a package using `de`, `fr`, `en`: the `fr` label is gone, the `de` and `en` ones are sent;
- a node `<p xml:lang="fr"><q xml:lang="fr">deep</q></p>` is deleted whole; `<r xml:lang="de">keep</r>` and an element with no `xml:lang` stay;
- the used code `""` (an element with `xml:lang=""`, IMP-611) is in the skip set when not selected, and `@xml:lang=''` deletes such elements.

The deletion comes **after** `DoChecking`: the reference checks, the lookups and the delayed-resolution entries that the checks make see the item with its skipped-language nodes still in it. What the checks record for the delayed resolution is the subject of the delayed rules (IMP-200 onward) and of ticket 53, not repeated here.

The item is then sent as it now stands: the final `applyAML` of the `doImport` (IMP-340) carries the item without the deleted nodes (probed `sent`). The item's id, action, `where`, `doGetItem` and the remaining children are untouched.

[14.0.7] Not applicable. `CheckWorkItem` does not exist; the import loop inlines the checks and sends every node.

[12.0] Same as 14.0.7.

### IMP-632: In batch mode the deletion happens at the same point, and again after a fallback

[14.35] With `AmlBatchMode` the loop calls `CheckWorkItem` for each item before it is queued, so the document that the batch concatenates (`<AML>…</AML>`) already lacks the deleted nodes (probed `batch-success`: one `<AML>` request whose two items hold only `de`). When the batch fails, the engine restores each queued item's original XML (`RestoreOriginalXml`, which loads the XML saved when the work item was made, before any deletion), runs `CheckWorkItem` on it **again**, with the same skip set, and sends it alone. So the one-by-one retry also lacks the nodes (probed `batch-falls-back-to-one-by-one`: the `<AML>` was refused, then each item was sent alone with only `de`). The same applies to the second `CheckWorkItem` after a failed check in batch mode. The checks run twice for such an item; the rest of the batch mode is wayfinder ticket 53's.

[14.0.7] Not applicable.

[12.0] Same as 14.0.7.

### IMP-633: The skip code is put into the XPath unescaped, so an apostrophe in a used code fails the package (bug)

[14.35] The XPath of IMP-631 is `"//node()[@xml:lang='{0}']".FormatWithArgs(code)` (invariant culture) with no escaping. A used code that contains an apostrophe makes the expression invalid, and `XPathException` (`'//node()[@xml:lang='d'e']' has an invalid token.`) leaves `CheckWorkItem`. Nothing in the loop catches it for an ordinary import; the package fails with the message of IMP-407 and the run returns 1 (probed `apostrophe-in-a-used-code`: `Import package 'P1' failed with message: … invalid token`). The same code with `*` is refused earlier, because the expanded selection contains a code that is not installed (probed `apostrophe-in-a-used-code-star`).

A code with another special character (`"`, `[`, `]`) either works or fails by the same rule of XPath; the library does not escape. Registered in `bugs.md` with `AGENTS.md` rule 7: the interpolation is reproduced as it is. The code can only come from a package file, since a selected code must be installed (IMP-621) and the skip set holds used codes (IMP-630).

[14.0.7] Not applicable.

[12.0] Same as 14.0.7.

### IMP-634: A skipped language on the Item element removes the item itself (bug)

[14.35] The selection `//node()[@xml:lang='x']` also matches the root `Item` element of the work item when it carries `xml:lang="x"`, and `ParentNode.RemoveChild` then removes the document element. This needs `x` in the skip set, which needs some **child** of an `Item` with `xml:lang="x"` in the same package (IMP-611 does not read the `Item`'s own attribute) and `x` not selected. The document is then empty, `doImport` fails with `NullReferenceException`, and IMP-304 wraps it: `Object reference not set to an instance of an object. Can't merge item  ` (two spaces; no id or where is read) with faultcode `-1`. The package fails and the run returns 1 (probed `xml-lang-on-the-item-itself-and-used`; without the child's `fr` the item is sent whole, probed `xml-lang-on-the-item-itself`).

Registered in `bugs.md`: a correct engine would only delete the language nodes below the item.

[14.0.7] Not applicable.

[12.0] Same as 14.0.7.

### IMP-635: No selection changes nothing, and the selection does not add anything

[14.35] With `Languages` = `null` or an empty array, nothing is deleted (probed `baseline-languages-null`, `languages-empty-removes-nothing`): the skip set is empty (IMP-630), the installed check is skipped without a request (IMP-621), and nothing else reads the property. The scan (IMP-610) still ran and can still fail (IMP-612). A selection that holds every language the package uses, or `*` (IMP-620), also deletes nothing (probed `languages-star-removes-nothing`, `languages-all-used-removes-nothing`).

The selection only ever removes: an item whose language is selected is sent as it is, with its other languages' nodes, and a selected language that no package uses is ignored. The selection never adds, translates or renames anything.

[14.0.7] Every `xml:lang` node of every item is sent, as no selection exists.

[12.0] Same as 14.0.7.

## Language-pack import

### IMP-640: A language-pack import is scanned and cut like any package

[14.35] `ConsoleUpgrade.exe` builds the manager for an `lpimport` over the preprocessor's temporary manifest (LP-001, LP-004), so everything above applies to the generated package, with these consequences (probed `05-lp-then-import.out`):

- the scan reads the generated `Fixes` files. The i18n elements the preprocessor writes (LP-024) are direct children of the `Item`, so their `xml:lang` codes are the package's used languages: with a pack that translates `de` and `fr`, `langs=*` expands to `de`, `fr` (never `en`, which LP-023 leaves out), and the installed check applies to them;
- `langs=de` (accepted for `lpimport` without `en`, IMP-601) makes the skip set `fr`, and every generated `edit` item is sent without its `fr` elements: `["de"]` over that pack sent `<i18n:name xml:lang="de" …>Hallo</i18n:name>` only. An item left with no translation at all is still sent, as an `edit` with its attributes and no children (`langs=en` over that pack sent `<Item … where="[Foo].id='A1'"></Item>`, probed `plain-package-languages-en-only`);
- a package name with a `.` makes the scan fail in the constructor: the preprocessor wrote the fixes where LP-033 says, the manifest points elsewhere, and the folder the scan lists does not exist, so `System.IO.DirectoryNotFoundException` ends the constructor. 14.0.7 failed later, inside `ImportSolutions`, as IMP-011 (1) (LP-033). The host does not catch it as a `CItemException`: it appends the exception's `ToString()` to the log and rethrows it, so the run ends with an unhandled exception and no return code. Its `finally` still logs out and disposes the preprocessor (LP-034).

[14.0.7] The preprocessor's package is imported like any (LP-004); there is no scan and no selection.

[12.0] There is no language-pack import.
