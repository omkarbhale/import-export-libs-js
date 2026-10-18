# Language-pack import

Language-pack import (`lpimport`) turns a folder of translations that Aras exported into an ordinary import. `LanguagePackPreprocessor` reads the pack's configuration and its per-ItemType files, asks the server which languages it has, and writes a temporary package whose files are `edit` items that set the translated values. The host then imports that package like any other. This document specifies the preprocessor, the temporary package it makes, and the call sequence of the host that drives it. The rules are `LP-001` to `LP-099`. The language-resource export of 14.35 is `LP-100` onwards (wayfinder ticket 54).

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`): `LanguagePackPreprocessor`, `IOWrapper`, `ManifestFile` and `ResourceManager`, and of Aras's `ConsoleUpgrade.exe` 14.0.7 (sha256 `10c7ff72…8a3f8`, the host `lpimport` runs in; decompiled locally, never committed);
- probes that ran the real 14.0.7 `LanguagePackPreprocessor` on .NET Framework 4.8 (Windows PowerShell 5.1), loaded from a staged copy of the vendored `Libs.dll` and `IOM.dll`. The probes give it a fake IOM connection that answers the `Language` get from a script and records the requests, and a fake `ICItemHelper` that supplies only the `Innovator`. They run the constructor, which does all the work (LP-029), over language-pack folders built from cases, and then read what it left in the temp folder. Every behaviour below that reads "probed" was observed that way; rule text cites a case by its label. The probes, their outputs and the host's argument parser run through reflection are in `fixtures/language-pack/` (see its README);
- the oracle's `lpimport` command (`oracle/README.md`), which follows the host's sequence.

Recorded against dev: five `lpimport` runs of the whole engine on scratch `Forum` items (`fixtures/14.0.7/language-pack/`, wayfinder ticket 45). They show the real `Language` response (three items, `en` with a null `suffix`), the generated `edit` items accepted by the server (a `where` on `[Forum].id` setting the `de` and `fr` i18n labels, read back by value afterwards), a language list that selects only some languages (`de`; `de, fr`), a language the server lacks (`xx`: no translation, no `Fixes` file, an empty import that succeeds), and the kept temp package of `lpdebug`. In the import that follows, the engine looks the ItemType up once (`ItemType` get with its Properties and RelationshipTypes, then `is_versionable`), applies each `edit` as a plain `edit` for a non-versionable type, and logs the second item with an empty `keyed_name`. Not probed: a real Aras-exported pack (none was available, see that folder's README), versionable item types, and `merge` mode.

## Conventions used by every rule here

- **The language pack** is a folder that holds the configuration file (`ImportConfig.xml` in Aras's documentation, but any file name works, LP-010) and, next to it, a folder `xml` of per-ItemType row files (LP-020).
- **The preprocessor** is the engine class `LanguagePackPreprocessor`. Its constructor does the whole job (LP-029); the host only reads three properties afterwards.
- **Temp package** is the folder the preprocessor makes under the system temp folder (LP-030).
- **Paths** are Windows path strings whatever the platform, and one layer maps them to the host (MAN-033, EXP-420). `Path.Combine` follows MAN-030's description.
- **XML text.** Reading a file is IMP-007 (`ReadAllText`, then `LoadXml`, whitespace-only text dropped). Writing is the DOM's `OuterXml` as IMP-010 describes it.
- **Comparisons** of names, codes and keys are ordinal and case-sensitive unless a rule says otherwise.
- **Values are interpolated unescaped** (`AGENTS.md` rule 7): LP-025.

## The operation and its host

### LP-001: lpimport is a preprocessing step followed by an ordinary import

[14.0.7] The operation exists only in Aras's console tool, `ConsoleUpgrade.exe`. `import.exe` has no reference to `LanguagePackPreprocessor`. The tool's `Main` runs these steps in this order for `lpimport`:

1. parse the arguments (LP-002), prepare the log folder and file, and write the "parsed params" block to the log (it prints `import      LPImport`: the operation is still `LPImport` at this point);
2. connect and log in: `HttpConnectorExtension`, then `CItemHelper.Login()` with the version probe and gate (WIRE-002, WIRE-010 to WIRE-024). A failure here is outside the `try` of the later steps;
3. create the preprocessor: `new LanguagePackPreprocessor(IOWrapper, the CItemHelper, new ManifestFile(), lppath, lppackage, lpdebug)`. The constructor reads the configuration, queries the server's languages, writes the temp package and its manifest (LP-029);
4. switch the context to an import (`Action = Import`) and set its manifest file to the preprocessor's `TempManifestFilePath` (LP-032). Nothing else of the context changes;
5. create the `ImportExportManager` for that context (LP-004);
6. run the import (`ProcessImport`): the manifest's package names go to `ImportSolutions` (LP-004);
7. in a `finally`: `CItemHelper.logout()` (WIRE-040), then `Dispose()` of the preprocessor if one was created (LP-034).

The result is the import's (IMP-408, IMP-407). The library's `lpimport` command performs the same steps in the same order. The library's own client replaces step 2 (WIRE-002).

[12.0] There is no language-pack import. Its `ImportExport` enumeration holds only `Import` and `Export`, its decompile has no `LanguagePackPreprocessor`, and its `ConsoleUpgrade.exe` has no reference to one (scope check F12). The 12.0 import ticket records that.

[14.35] Not yet specified; the 14.35 language tickets add it. 14.35's preprocessor differs beyond null-value handling.

### LP-002: lpimport needs a release, a language-pack path and a package name

[14.0.7] `ConsoleUpgrade.exe` reads its arguments as `name=value` (the name in any case, the value optionally wrapped in single quotes, which are removed) or as bare words, and for `lpimport` it requires the following. Probed through the host's own parser (`05-host-arguments`); the library's own flags are the CLI ticket's (42), and only what it must accept and refuse for parity is here.

- The bare word `lpimport` (any case) selects the operation. When `import` and `lpimport` both appear, the last wins.
- After the options are read, these must be non-empty, checked in this order: server, database, login, password, `release`, `lppath`, `lppackage`. The first one empty prints (to the console, after a line feed, with no trailing line break) `Param error : {x} can't be empty` with `{x}` = `server url`, `database`, `login`, `Password`, `release param`, `language pack path` or `language pack package name`, and ends the run with code 1. `release` is required for `import` too.
- `dir` is neither required nor asked for: for `lpimport` the parser returns before it would prompt for the folder. `mfFile` is read and then replaced (LP-001 step 4).
- `lpdebug` takes a value: `lpdebug=true` (the value goes through `bool.TryParse`: `True`, `true`, `TRUE`, with white space around allowed). Any other value prints `\nfailed to parse  LPDEBUG {value}\n` (two spaces) and leaves it false. The bare word `lpdebug` is an unrecognised option, although the tool's help text lists it without a value.
- `merge`, `fastmode`, `description`, `verbose`, `log`, `timeout` and the certificate options mean what they mean for `import` (LP-004).
- An argument that is neither a known word nor a known option prints `\r\nunrecognized option {name}` and ends the run with code 1. The `name=value` form needs at least one character on each side of the `=`, and it splits at the last `=`: `lppath=` prints `unrecognized option lppath=`, and `lppath=C:\a=b\c.xml` prints `unrecognized option lppath=C:\a`.
- Fewer than four arguments prints the help text and ends the run with code 1.

The `lppath` and `lppackage` options given to an `import` are read and ignored.

### LP-003: A failure after login is logged and rethrown; the temp package is not cleaned up then

[14.0.7] An exception from steps 3 to 6 of LP-001 is caught in `Main`: its `ToString()` (type, message and stack trace) is appended as a line to the log file, and the exception is thrown again unchanged, so the tool ends with an unhandled exception and no return code. The `finally` still logs out. `ImportSolutions` returns 1 for its own failures instead of throwing (IMP-407), so what reaches this catch is the preprocessor's failures (LP-010 to LP-036) and the exceptions of the manager's constructor (a missing manifest cannot happen here: the preprocessor wrote it).

When the preprocessor's constructor throws, there is no preprocessor to dispose, so the temp package it had already made stays on disk whatever `lpdebug` says (LP-035).

The library reports these failures through its own error type and exit code (CLI ticket 42); the log line and the message text are what is specified.

### LP-004: The import that follows is a normal import of one package

[14.0.7] The manager is built for `Action = Import` with `ManifestFile` = the temp manifest. As for any import (IMP-402), its constructor requires the file to exist (`Manifest file '{0}' doesn't exist`), reads it, and takes the manifest's folder from the manifest file's parent folder, which is the temp folder (the `dir` option is not used). The manager then imports every package name of the manifest (`GetAllPackageNames()`: the language package alone), in the order the manifest gives (MAN-020), with `merge`, `fastmode`, `release` and `description` from the arguments (IMP-401). The package is found, loaded, ordered, checked, applied and registered by the import rules, and the generated `edit` items go through them like any other item.

What matters for the preprocessor's output: the import looks for the package at `GetSolutionPath` (MAN-032), reads the immediate subfolders of that folder (IMP-002) and, in each, the `*.xml` files (IMP-003). Whether that finds the `Fixes` folder depends on the package name (LP-033).

## Reading the pack

### LP-010: The configuration file is read with ReadAllText and LoadXml, and its root name does not matter

[14.0.7] `CopyLanguagePack(fixesFolder, configPath)` first tests `configPath` with `File.Exists` (after `NormalizeLongPath`, EXP-421). If there is no such file (a missing one, or a folder) it throws `System.IO.FileNotFoundException` with the message `File not found : {configPath}.` (the resource `FileNotFound`; the path as given, a full stop at the end). It then loads the file as IMP-007 describes (`ReadAllText`, `LoadXml`, whitespace-only text dropped, a byte order mark removed). A malformed file throws the `XmlException` of the parser unchanged (`Unexpected end of file while parsing Name has occurred. Line 1, position 25.`), and an empty file `Root element is missing.`; nothing wraps them.

Every lookup in the configuration (`languages`, `itemtype`) is made from the document element, whatever its name: `<ImportConfig>` and `<Whatever>` read the same (probed `root-other-name`). The file's own name is not used either: `MyPack.cfg` works (probed `config-other-file-name`). Aras's name for it is `ImportConfig.xml`.

`configPath` may be relative; it is resolved against the process's current directory. Forward slashes and `..` segments work. The row folder is `Path.Combine(Path.GetDirectoryName(configPath), "xml")`, so a bare file name (no folder part) gives the folder `xml` in the current directory (probed `path-bare-file-name`, `path-forward-slashes`, `path-with-dotdot`).

### LP-011: Requested languages come from the first `languages` element's `list`

[14.0.7] `GetRequestedLanguages` takes the first child element of the root named `languages` (later ones and nested ones are ignored, probed `languages-element-twice`, `languages-nested-not-read`). Its `list` attribute (the empty string when the attribute is missing; the name is case-sensitive, so `LIST` is not read, probed `languages-uppercase-attr-name`) is lower-cased (LP-013). When the result is empty nothing is requested, which means "all languages" (LP-014). Otherwise it is split on `,`, each part is trimmed (LP-013), and every part is a requested code, including an empty part: `de,,fr,` requests `de`, `fr` and the empty code (probed `languages-empty-items-in-list`).

A list that holds only spaces is not empty before the split, so it requests the empty code alone: no language has that code, nothing qualifies, and nothing is written (probed `languages-space-only-list`). A requested code that no server language has is ignored without a message (probed `languages-unknown-only`).

The requested codes are a set that is only asked "is this code in it?" and "is it empty?" (LP-014); nothing enumerates it (LP-015).

### LP-012: Item types and their property lists come from the `itemtype` elements

[14.0.7] `GetItemTypes` visits the child elements of the root named `itemtype`, in document order (nested ones are not read, probed `itemtype-nested-not-read`). Each gives an entry:

- the key is its `name` attribute, or the empty string when there is none (probed `itemtype-no-name`);
- the value is a list of property names. It is empty unless the first child element of the `itemtype` named `properties` has a `list` attribute that, after `Trim()` and lower-casing (LP-013), is not empty. Then the list is the text split on `,`, with no trimming of the parts and no part dropped (`name, label` gives `name` and ` label`).

An empty list means "every property" (LP-023). A later `itemtype` with the same `name` replaces the earlier entry completely (probed `itemtype-duplicate-last-wins`, `itemtype-duplicate-last-all`). The keys are compared ordinally, so `foo` does not select `Foo.xml` (probed `itemtype-name-case`). A `properties` element without `list`, with an empty one or with only spaces gives the empty list (probed `props-no-list-attr`, `props-list-empty`, `props-list-spaces-only`), and a second `properties` element is ignored (probed `props-element-twice`).

### LP-013: Lower-casing and trimming use .NET's invariant mapping and `String.Trim`

[14.0.7] `ToLower(CultureInfo.InvariantCulture)` is .NET Framework 4.8's simple case mapping: each code point on its own, the table in `fixtures/language-pack/invariant-lower.json` (973 BMP code units and 40 supplementary-plane code points, mapped as one code point). There is no context rule and no special casing: a final sigma `Σ` becomes `σ`, never `ς`, and `İ` (U+0130) stays `İ`. The result has the length of the input. JavaScript's `toLowerCase()` differs on exactly those cases, so the library uses the table. A requested language `É` becomes `é` (probed `languages-list-non-ascii-uppercase`).

`Trim()` removes the characters of `Char.IsWhiteSpace`, which MAN-012 lists. U+00A0 and U+3000 are removed (probed `languages-list-nbsp-and-ideographic-space`); U+200B is not, so a code with it in front matches nothing (probed `languages-list-zero-width-space-not-trimmed`).

### LP-014: The server's languages come from one Language get, filtered by the requested codes

[14.0.7] `GetSupportedLanguages` runs after the configuration is read and before the first row file, once per run. It builds `Innovator.newItem("Language", "get")`, sets the attribute `select` to `code,suffix`, and applies it over the host's connection. IOM writes the request body as `<Item isNew="1" isTemp="1" type="Language" action="get" select="code,suffix" />` (probed); WIRE-004 and WIRE-005 carry it (one `ApplyItem` call).

The loop runs for `0` to `getItemCount() - 1` over `getItemByIndex(i)`. IOM's count is the number of `Item`s of a successful response, `0` for the "no items" fault (faultcode 0), and `-1` for any other fault and for a response without items (probed `04-resolve-and-iom`: 3, 0, -1, -1, -1). For each item:

1. `code` = `getProperty("code")`, which is null when the item has no `code` element;
2. the item qualifies when the requested set holds `code` or is empty. Hashtable lookups compare strings ordinally: a server code `DE` does not match the requested `de`, and with all languages requested `DE` and `de` are two languages (probed `server-code-uppercase`, `server-code-uppercase-all`);
3. a qualifying item is added to the supported languages as `code` with `getProperty("suffix", "")`. The suffix is never used again, whatever it is or whether it exists (probed `server-suffix-missing`). The loop at the end of the method copies the suffixes into the requested table, which nothing reads afterwards.

Failures, probed:

- an item without `code` throws `System.ArgumentNullException` (`Key cannot be null.\r\nParameter name: key`) from the first lookup, whether or not codes are requested (`server-code-missing`, `server-code-missing-with-list`);
- two qualifying items with the same code throw `System.ArgumentException` (`An item with the same key has already been added.`). A duplicate that does not qualify is ignored (`server-code-duplicate`, `server-code-duplicate-not-requested`);
- **a failed get is not an error** (registered in `bugs.md`). A fault other than "no items", an empty `Result` and a response that is not even a SOAP envelope all give a count of 0 or -1, so no language is supported, no row produces a translation, and the preprocessor finishes successfully with an empty `Fixes` folder (probed `server-no-items-fault0`, `server-other-fault`, `server-empty-result`, `server-garbage-response`). The import that follows then imports a package without items and reports success. A correct engine would stop with the server's fault.

`en` qualifies like any code (when requested or when nothing is requested) but is never written (LP-023).

### LP-015: Nothing is ever removed, so every enumeration is in insertion order

[14.0.7] The preprocessor enumerates three `Dictionary<string, …>` objects: the supported languages (LP-014), a row's update parameters (LP-023) and its where parameters (LP-025). It only adds to them: no `Remove` or `Clear` is called on any dictionary in the class. A `Dictionary` that has had no removal enumerates in insertion order, so the order is: server response order for languages, document order for properties, attribute order for the where parameters. This confirms the Hashtable research (ticket 07, recommendation 5) for this class. The one `Hashtable` is the requested-language set; it is only asked membership and emptiness and is never enumerated (the loop that fills it enumerates the supported-language dictionary). So the Hashtable emulation of MAN-017 is not needed here.

Probed: the server answering `fr` before `de` gives the `fr` elements first (`server-order-fr-de`), and properties come out in document order, not sorted (`property-order-in-file`).

## Reading the rows

### LP-020: The row files are the `*.xml` files of the `xml` folder, and the item type is the file name with every `.xml` removed

[14.0.7] The row files are `Directory.GetFiles(<xml folder>, "*.xml")`: the files directly in the folder, with IMP-003's pattern (an extension that starts with `xml`, any case, so `Foo.xmlbak` and `Foo.XML` are listed), without recursion (probed `xml-folder-subfolder-ignored`) and in NTFS order (IMP-004). A file that does not match is ignored (`Foo.txt`). The folder is listed right after the Language get (LP-014), before any file is read. A missing folder throws `System.IO.DirectoryNotFoundException` (`Could not find a part of the path '{absolute path}'.`), and an `xml` that is a file `System.IO.IOException` (`The directory name is invalid.\r\n`); probed `config-only-no-xml-folder`, `config-xml-sibling-is-file`.

The item type of a file, called its name below, is derived from the path that `GetFiles` returned: the text after the last `\`, with **every** occurrence of the lower-case text `.xml` removed (ordinal, anywhere in the name, not only the extension). It gives:

| File | Name |
|---|---|
| `Foo.xml` | `Foo` |
| `Foo.xmlbak` | `Foobak` |
| `Foo.XML` | `Foo.XML` |
| `Foo.xml.xml` | `Foo` |
| `A.B.xml` | `A.B` |
| `A.xml.xml.B.xml` | `A.B` |
| `Sub Type.xml` | `Sub Type` |
| `.xml` | the empty string |

(probed `file-*`, `itemtype-name-with-spaces`). The name selects the file's configuration (LP-021), becomes the item type of the generated items (LP-024), the table in their `where` (LP-025) and the output file name (LP-026). Registered in `bugs.md`: a correct engine would remove only the extension. A file `.xml` has the empty name, which generates items without `type` or `action` attributes (probed `file-hidden-name`), and no real pack has one.

### LP-021: Files are filtered by the `itemtype` entries, and no entry at all makes every file fail

[14.0.7] When the configuration has at least one `itemtype` entry (LP-012), a file whose name is not a key is skipped without a message (probed `itemtype-other-only`). When it has none, the filter does not skip anything, and the next statement reads the file's entry with the indexer, which throws `System.Collections.Generic.KeyNotFoundException` (`The given key was not present in the dictionary.`) for the first file in the folder (probed `itemtype-none-with-file`, `itemtype-nested-not-read`). With no row file in the folder, a configuration without `itemtype` entries works and writes nothing (probed `itemtype-none-without-files`).

Registered in `bugs.md`: the guard is written as though "no entry" meant "all item types", which the empty property list does mean (LP-023), but the lookup then fails. By then the temp package exists (LP-035).

### LP-022: A row file is read as export XML and only `export/Item` is used

[14.0.7] Each file that passes LP-021 is loaded as IMP-007 describes (a declaration and a byte order mark are fine, probed `xml-file-with-declaration-and-bom`; a malformed file throws the parser's `XmlException` and an empty file `Root element is missing.`, unwrapped, probed `malformed-xml-file`, `empty-xml-file`). The items are the `Item` children of the root element when that is named `export`: `SelectNodes("export/Item")` from the document. Names are exact and without a namespace. Nothing is read from a file whose root has another name (`AML`), from an `Item` that is nested (below another element, or in `Relationships`) or from an `Item` in a namespace (probed `root-not-export`, `items-nested-not-selected`, `item-in-namespace`). The items are visited in document order.

### LP-023: Each item's translations are the language attributes of its selected `property` children

[14.0.7] For one `Item`, `GetUpdateParameters` visits the direct children named `property` (exact name, probed `property-element-name-case`; deeper ones are not read, `property-nested-not-selected`) and for each:

1. its name is the attribute `__name`, or the empty string when there is none;
2. when the item type's property list (LP-012) is not empty, the property is skipped unless the list contains the name (ordinal);
3. its translations are the supported languages (LP-014) in their order, for which the property has an attribute of exactly that name (the attribute name is case-sensitive, probed `translation-attr-case`), leaving out `en` in any case (`OrdinalIgnoreCase`); the value is the attribute's text as the DOM gives it (entity references decoded). Each language is a pair (code, value);
4. a property with no translations is left out. Otherwise it is added to the item's table under its name. A second property with the same name that also has translations throws `System.ArgumentException` (`An item with the same key has already been added.`), unless the property list excluded it (probed `prop-duplicate-both-translated`, `prop-duplicate-first-untranslated`, `prop-duplicate-excluded-by-list`).

**The selection compares different spellings** (registered in `bugs.md`). The list was lower-cased and left untrimmed (LP-012), but the name is taken as written. With a non-empty list, a property whose `__name` has an upper-case letter is never selected (`Label` is skipped by `name,label`; probed `props-list-name`, `props-list-uppercase-in-config`), and a part with a space around it never matches (`name, label` selects only `name`; probed `props-list-space-after-comma`). A list written in upper case works because it is lower-cased (`NAME` selects `name`). An empty list selects everything, so `Label` is used then (probed `props-list-empty`). A list part that is empty (`name,`) selects a property without `__name`, whose empty name then fails in LP-024 (probed `props-trailing-comma-no-name-attr`).

A translation whose value is the empty string is carried along here and dropped in LP-024; one with spaces only is kept (probed `translation-empty-string`, `translation-whitespace`).

## Making the fixes

### LP-024: Each item with a translation becomes an `edit` item of i18n elements

[14.0.7] For every `Item` of a file, in document order, the engine builds an IOM item with `newItem(name, "edit")` and sets the attribute `doGetItem` to `0`. IOM gives it the attributes `isNew="1" isTemp="1" type="{name}" action="edit"` in that order, then `doGetItem="0"` follows; `{name}` is the file's name with its spaces kept (LP-020). Then for each property of the item's table (LP-023) in its order, and in each, each translation in language order, a value that is not the empty string is set with `setProperty(propertyName, value, code)`. IOM writes it as an element in the i18n namespace:

```xml
<i18n:name xml:lang="de" xmlns:i18n="http://www.aras.com/I18N">Hallo</i18n:name>
```

The prefix is `i18n`, the namespace declaration is written on every element, `xml:lang` carries the code, and the property name follows the prefix as it was written (`Label` stays `Label`). The value is a text node, serialised as the DOM does: `&`, `<` and `>` as `&amp;`, `&lt;` and `&gt;`, quotes and apostrophes as they are, tab, CR and LF as they are, non-ASCII characters as they are (probed `value-markup-and-controls`, `value-non-ascii`, `value-looks-like-xml`). A value with a lone surrogate (a reference like `&#xD800;`) throws `System.ArgumentException` when the output is written (LP-026).

If no value was set (no translation, or all values empty), the item is dropped. It adds nothing and is not counted (probed `translation-all-empty-item-skipped`, `item-without-translations-then-with`, `item-with-no-properties`). Otherwise the item gets its `where` attribute (LP-025), is imported into the output document (LP-026) and counted.

The element name is created by the XML DOM, so a property name that is not a valid name fails there with `System.Xml.XmlException`. Probed: a name with a space, `:`, `<`, `/` or a second colon gives `The '{c}' character, hexadecimal value 0x{hex}, cannot be included in a name.` for the first such character. A name starting with a digit, or holding `.`, `-` or a non-ASCII letter, is accepted (probed `property-name-*`). The empty name (a property without `__name` that LP-023 selected) throws `System.ArgumentException` (`The local name for elements or attributes cannot be null or an empty string.`). The XML core ticket reproduces the DOM's name check; the rule here is that the failure leaves the preprocessor as it is, unwrapped, with the earlier files already written (LP-027).

### LP-025: The `where` clause is built from the Item's attributes, unescaped

[14.0.7] `GetWhereParameters` takes every attribute of the `Item` element in document order, except the attributes named exactly `keyed_name` and `type` (case-sensitive: `Type` and `KEYED_NAME` stay, probed `where-attributes-in-order`). The name is the attribute's qualified name (`a:id`, `xml:lang`, probed `where-prefixed-attributes`) and the value the attribute's text. The clause joins one `[{table}].{name}='{value}'` per attribute with ` AND `, where `{table}` is the file's name with every space replaced by `_` (probed `where-type-name-spaces`: `Sub  Type X` gives `[Sub__Type_X]`).

```text
[Foo].id='A1' AND [Foo].action='x'
```

The `where` attribute is always set, so an item without such attributes gets `where=""` (probed `where-no-attributes`, `where-no-attributes-at-all`). It is set after the i18n children, and is the last attribute of the `Item`.

Interpolated values are reproduced exactly (`AGENTS.md` rule 7, registered in `bugs.md`). The value is put between apostrophes without doubling any inside it, so an `id` of `a'b` gives `[Foo].id='a'b'`, a clause the server cannot parse or reads differently; markup is escaped only by the attribute serialiser of the output file (`&amp;`, `&lt;`, `&gt;`, `&quot;`), which the server decodes before it sees the clause (probed `where-value-quote-and-markup`). The table name is not escaped or quoted either.

### LP-026: The output file is the OuterXml of an `AML` document, written only when it holds an item

[14.0.7] Each file's items are collected under one `AML` element of a new IOM XML document: each is imported with `ImportNode(…, true)` and appended, in order. If the count is 0 nothing is written (probed `no-item-translated-no-file`, `property-nested-not-selected`). Otherwise the file `{fixes folder}\{name}.xml` is written with `File.WriteAllText(path, document.OuterXml)`:

- UTF-8 without a byte order mark;
- no XML declaration, no indentation and no line break at the end: one line, `<AML>`…`</AML>`;
- serialised as IMP-010 describes `OuterXml`;
- an existing file is overwritten.

Examples: `<AML><Item isNew="1" isTemp="1" type="Foo" action="edit" doGetItem="0" where="[Foo].id='A1'"><i18n:name xml:lang="de" xmlns:i18n="http://www.aras.com/I18N">Hallo</i18n:name></Item></AML>`; with two items, the second `Item` follows the first directly (probed `two-items-order`).

A document that cannot be serialised (a lone surrogate in a value, LP-024) throws `System.ArgumentException` (`The surrogate pair (0xD800, 0x62) is invalid. A high surrogate character (0xD800 - 0xDBFF) must always be paired with a low surrogate character (0xDC00 - 0xDFFF).`; the second value is the following character) before the file is created (probed `value-lone-surrogate-reference`). The file system's own exceptions (a name the file system refuses, a locked file) are not wrapped either.

### LP-027: Files are processed one after another, collisions overwrite and a failure leaves what was written

[14.0.7] Row files are processed in the listing order (LP-020), each fully (read, build, write) before the next. Nothing is validated up front, and nothing is rolled back: when a file fails, the files written for earlier ones stay in the `Fixes` folder (probed `second-file-fails-first-stays`: `A.xml` was written, `B.xml` threw), and the exception ends the constructor (LP-035).

Two files that give the same name (`Foo.xml` and `Foo.xml.xml`, LP-020) write the same output file; the one processed later replaces the other (probed `file-name-collision`: the second file in NTFS order wins). Both are read.

## The temporary package

### LP-029: The constructor does everything, in a fixed order

[14.0.7] `new LanguagePackPreprocessor(iOWrapper, cItemHelper, manifestFile, lpPath, lpPackage, lpDebug)`:

1. throws `System.ArgumentNullException` for a null `iOWrapper`, then `cItemHelper`, then `manifestFile` (parameter names as written, message `Value cannot be null.\r\nParameter name: {name}`, probed); nothing has happened yet;
2. keeps the helper and the manifest object;
3. when `lpPath` is null or empty: stops (LP-036). Otherwise it keeps `lpDebug` and calls `CopyToTempDirectory(lpPath, lpPackage)`, which does these, each its own rule:
   1. makes the temp folder (LP-030);
   2. builds the `Fixes` folder path and creates it (LP-031);
   3. reads the pack and writes the fixes: the configuration (LP-010 to LP-013), the Language get (LP-014), the rows (LP-020 to LP-027);
   4. adds the package name to `TempPackagesNames`;
   5. adds the package to the manifest and saves it (LP-032).

An exception stops the sequence there and leaves whatever the earlier steps made on disk (LP-035). The library may run the steps with its own control flow, but it keeps this order of effects (the Language get happens after the folders exist, and before any row file is touched).

### LP-030: The temp folder is `<temp>\LanguagePack_<random>`

[14.0.7] `GetTemporaryDirectory` builds `Path.Combine(Path.GetTempPath(), "LanguagePack_" + Path.GetRandomFileName())` and repeats until that folder does not exist, then creates it. On Windows `GetTempPath()` ends in a backslash. `GetRandomFileName()` returns 12 characters from `a-z` and `0-9` in the form `xxxxxxxx.xxx` (8, a dot, 3; probed: `LanguagePack_l0h2lszl.jzt` is typical). The port uses the host's temp folder (`os.tmpdir()`) and any random name of that form; fixtures replace the name with `LanguagePack_<random>`.

The folder is created through `IOWrapper.DirectoryCreateDirectory`, so `NormalizeLongPath` applies (EXP-421).

### LP-031: The Fixes folder is `<temp>\<package>\Import\Fixes`, made with Path.Combine

[14.0.7] The folder is `Path.Combine(tempFolder, lpPackage, "Import", "Fixes")` and is created with all its parents, before anything is read from the pack. The package name is therefore a folder name with `Path.Combine`'s rules (MAN-030), not a validated name:

- an ordinary name gives `<temp>\NAME\Import\Fixes` (probed `pkg-plain`). A name with spaces or a `/` works as a folder path (`a b`, `a/b` gives nested folders `a\b`);
- Windows file-system rules apply to the name (EXP-420): trailing dots and spaces are dropped from a folder name (`a.b.` makes `a.b`);
- an empty name is skipped by `Combine`, giving `<temp>\Import\Fixes` (probed `pkg-empty`); the host never passes one (LP-002);
- a rooted name is used as it is: `Combine` forgets everything before it, so `C:\x\Lp` gives `C:\x\Lp\Import\Fixes`, outside the temp folder, and the temp folder holds only the manifest (probed `pkg-rooted-path`). `Dispose` never deletes it (LP-034);
- `..` goes up: `Combine(temp, "..", "Import", "Fixes")` is the `Import\Fixes` folder next to the temp folder, outside it (probed `pkg-dotdot`);
- a name with a character `Combine` rejects (`|`, `<`, `>`, `"`, a control character) throws `System.ArgumentException` (`Illegal characters in path.`) before the `Fixes` folder is made, but after the temp folder is (probed `pkg-illegal-char-pipe`); a name such as `a:b` counts as rooted for `Path.Combine` (a `:` in second position), so the folder path is `a:b\Import\Fixes` and creating it fails with `DirectoryNotFoundException` (probed `pkg-colon`).

### LP-032: The temp manifest holds the one package, saved as `<temp>\imports.mf`

[14.0.7] After the fixes are written, the preprocessor adds `lpPackage` to the `ManifestFile` object the host gave it (`new ManifestFile()`, an empty `imports` document; MAN-002) and saves it as `Path.Combine(tempFolder, "imports.mf")`:

```xml
<imports>
  <package name="LIBSJS-SCRATCH-LP" path="LIBSJS-SCRATCH-LP\Import" />
</imports>
```

(CRLF line breaks, no byte order mark, no declaration, no line break at the end: MAN-006. Probed `pkg-plain`.) The package element is made by `AddPackage` (MAN-010), so its `path` is `<last segment>\Import` for an ordinary name, `.\` for a standard package (MAN-031), and `\Import` when the name ends in a dot (MAN-011). The name is put into an XPath unescaped (MAN-014): a name with an apostrophe throws `System.Xml.XPath.XPathException` (`'imports/package[@name='a'b']' has an invalid token.`), at this point, with the folder and the files already written (probed `pkg-quote`).

`TempManifestFilePath` is that path. `TempManifestFile` is the very object the host passed in, now holding the package. `TempPackagesNames` is a list with the one name. The manager reads the saved file anew; it does not use the object (LP-004).

### LP-033: The import finds the fixes only for a package name without a dot (bug)

[14.0.7] The preprocessor writes the fixes to a folder named by the **whole** package name (LP-031), but the manifest tells the import to look in the folder named by the name's **last segment** (MAN-010), and, for a standard package, in a different place altogether (MAN-030). The two agree only when the name has no `.`. Probed (`04-resolve-and-iom`) by reading the saved manifest back and resolving the package as the import does (`GetSolutionPath`, MAN-032):

| Package name | Folder the import reads | Has `Fixes\Foo.xml` |
|---|---|---|
| `LIBSJS-SCRATCH-LP`, `a b`, `a/b` | `<temp>\<name>\Import` | yes |
| `My.Pkg` | `<temp>\Pkg\Import` | no |
| `com.example.lang` | `<temp>\lang\Import` | no |
| `com.aras.innovator.solution.PLM` | `<temp>\PLM\Import` | no |
| `com.aras.innovator.core`, `com.aras.defaults.Lang` | `<temp>\.\\com\aras\innovator\core` (and `…\defaults\Lang`) | no |
| `a.b.` | `\Import` | no |
| a rooted name without dots | `<name>\Import` | yes |

For a name with a dot the import's `GetDirectories` fails on a folder that does not exist, and the package fails as IMP-011 (1) describes (`Could not find a part of the path '…'. Unable to get solutions files by path in .mf file …`). Aras's own packages have dotted names (`com.aras.innovator.solution.PLM`), so `lppackage` cannot be one of them: it must be a name without a dot. Registered in `bugs.md`: a correct engine would write the fixes where the manifest points.

### LP-034: Dispose deletes the temp folder unless lpdebug is set

[14.0.7] `Dispose()` deletes `tempManifestDirectoryPath` and everything below it (`Directory.Delete(path, true)`, through `NormalizeLongPath`), when `LPDebug` is false and the folder exists. With `lpdebug=true` the folder stays, which is the option's purpose ("remove temp files or not"), and the user finds the generated fixes there (probed `debug-true`, `debug-false`). Details, probed:

- it can be called again, and after the folder was removed by someone else, without error;
- a failure to delete (a locked file) throws `System.IO.IOException` from `Dispose`, which runs in the host's `finally`, and the folder stays partly deleted (probed: `The process cannot access the file 'extra.txt' because it is being used by another process.`);
- it deletes only the temp folder. A fixes folder that LP-031 placed outside it (a rooted name, `..`) is left (probed `pkg-rooted-path`, `pkg-dotdot`).

The `lpdebug` value is kept only when `lpPath` is not empty (LP-036).

### LP-035: A failed constructor leaves the temp package behind (bug)

[14.0.7] Every failure after step 3.1 of LP-029 (a missing configuration file, a malformed one, a missing `xml` folder, a row-file error, a duplicate property, a missing language code, an illegal package name, an apostrophe in it) leaves the temp folder and everything already written in it. The constructor never returned, so the host has no preprocessor to dispose, whatever `lpdebug` says (LP-003). Probed: each failing case above leaves exactly one `LanguagePack_*` folder, and the cases that throw before the folder is made (a null argument) leave none. Registered in `bugs.md`: a correct engine would remove the folder it made.

The library reproduces the leak and reports the folder's path in its error, so a user can find it.

### LP-036: With no language-pack path the constructor does nothing

[14.0.7] When `lpPath` is null or empty, the constructor stores the arguments and ends. No request is sent, no folder is made and `lpDebug` is not kept. `TempManifestFilePath` is then `Path.Combine("", "imports.mf")`, which is `imports.mf`, relative to the current directory; `TempPackagesNames` is empty; `Dispose()` does nothing (probed). The shipped host cannot reach this: it refuses an empty `lppath` (LP-002). It matters only to a caller that builds the class directly, as the oracle's tests do.
