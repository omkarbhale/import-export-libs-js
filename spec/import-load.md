# Import: package loading and build.xsl ordering

This document specifies how an import turns a package folder into the ordered list of items the engine imports: `ImportExportManager.LoadPackageDom`, the `build.xsl` stylesheet that orders them, and `GetItemsFromPackageDom`. It owns `IMP-001` to `IMP-099`. Reference checks, delayed resolution, merge and registration are other documents (`IMP-100` onwards).

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`, never committed): `ImportExportManager::LoadPackageDom`, `GetItemsFromPackageDom`, `IOWrapper`, `CItemHelper::ApplyXsl` and the embedded `build.xsl`;
- the probes in `fixtures/import-load/` (see its README). The real engine's `LoadPackageDom` and the engine's own `build.xsl` were run on .NET Framework 4.8 over the cases listed there. Rule text cites a case by its `name`;
- ticket 68's recordings of the engine's `build.xsl` and `ApplyXsl` in `fixtures/14.0.7/xsl/build/` (`transform.xml` is the text the transform writes, `applied.xml` the document after `ApplyXsl` loaded it again). The build ticket added five cases there (`empty-cdata-runs`, `item-order-misc`, `namespace-default-and-nested`, `nested-copy-namespaces`, `text-and-attribute-escapes`; inputs in `oracle/xsl-cases/build/`) and replays all of them in `src/import/build-xsl.test.ts`;
- for the `[14.35]` lines: the 14.35 decompile (`.decomp/14.35/`, never committed) compared with the 14.0.7 one for every method these rules map, and the same probes run against the vendored 14.35 `Libs.dll` (`load-package-dom.out.14.35.txt`, `build-xsl.out.14.35.txt`, and the `build-xsl-cui` cases for the two types 14.35 adds). `LoadPackageDom` and `ApplyXsl` are the same code in both builds; only `build.xsl` differs.
- for the `[12.0]` lines: the 12.0 decompile (`.decomp/12.0/`, never committed) compared method by method with the 14.0.7 one, and the 12.0 probes (`fixtures/import-load/*.12.0*`, `fixtures/import-run/probe-12.0.txt`, `fixtures/import-merge/12.0-probe/results.json`).

The stylesheet is not reproduced. Its logic is written below as ordering rules, and the library implements those rules (AGENTS.md rule 5). `plan import` (round 2, Q4) reports the model of IMP-033, so the same rules decide what is reported and what is imported.

Names: a *package folder* is the folder `GetSolutionPath` returns for a package (the `MAN-` rules own that path). A *file item* is an `Item` element that is a direct child of a package file's root `AML` element.

## Loading the package DOM

### IMP-001: LoadPackageDom builds one ordered `AML` document from a package folder

[14.0.7] `LoadPackageDom(solutionPath, logWriter)` returns an `AML` document and has these steps, each its own rule:

1. list the immediate subdirectories of the package folder (IMP-002 to IMP-006);
2. in each, in order, read each matching file (IMP-007), skip it when it has no `AML/Item` (IMP-008), stamp its first item (IMP-009) and append its serialization to one string (IMP-010);
3. wrap the string as `<AML>…</AML>`, load it, and run `build.xsl` over it (IMP-010, IMP-012);
4. return the transformed document, whose root `AML` holds the ordered items (IMP-020 to IMP-032).

The function is static and has no state. The log writer receives only the skipped-file warnings of IMP-008. Nothing is written to the console.

[12.0] The same function, with the same four steps, the same inputs and outputs, no state and no console output. The log writer receives only the skipped-file warnings. Six things differ, each in its own rule:

- a file is read by `XmlDocument.Load(path)`, not by text and `LoadXml` (IMP-007);
- the skipped-file warning has other wording (IMP-008);
- the first item gets `tempKeyName` only, no `tempFullName` (IMP-009);
- no path is normalised, so a UNC package folder loads (IMP-005, IMP-006);
- the failure suffix of a file that cannot be read has two spaces after `Unable to load` (IMP-011);
- the stylesheet has fifty-one groups (IMP-020).

Observed: the cases of `load-package-dom.cases.json` run through the 12.0 engine (`fixtures/import-load/load-package-dom.12.0.out.txt`, same recorder as the 14.0.7 file, `lpd.ps1`) give the 14.0.7 results except where these rules say otherwise. `load-package-dom.12.0-extra.cases.json` adds the cases that only 12.0's reader can tell apart.

[14.35] Same as 14.0.7. The steps, their order and the log writer's use are unchanged; `LoadPackageDom` is the same code, and only the stylesheet of step 3 differs (`IMP-020` to `IMP-029`). The 35 cases of `load-package-dom.cases.json` give the same result on the 14.35 `Libs.dll` (`fixtures/import-load/load-package-dom.out.14.35.txt`).

### IMP-002: Only the immediate subdirectories of the package folder are read

[14.0.7] The directories are `Directory.GetDirectories(solutionPath)`: every directory directly inside the package folder, with no attribute filter (hidden and read-only directories are listed, case `hidden`). A directory whose name ends in `.xml` is a directory like any other (case `order`). Files directly in the package folder, and anything deeper than one level below it, are never read (case `order`: `loose.xml` and `deep/deeper.xml`). A subdirectory with no matching files adds nothing, and a package folder with no subdirectories gives `<AML />` (case `empty-package`).

The directory names have no meaning to the engine, only their order does (IMP-004). Aras's exporter writes one folder per item type (`Method`, `ItemType`, …); any folder name works.

[12.0] Same as 14.0.7. Observed with the cases `order`, `hidden` and `empty-package` of `load-package-dom.12.0.out.txt`: the same directories, in the same order, give the same items.

[14.35] Same as 14.0.7.

### IMP-003: A file is read when its name matches `*.xml` in the .NET Framework sense

[14.0.7] The files of a subdirectory are `Directory.GetFiles(dir, "*.xml")`, files only, no recursion. In .NET Framework this pattern matches every file whose extension starts with `xml`, compared case-insensitively. That includes `.xml`, `.XML`, `.Xml`, `.xmlbak`, `.xmlx` and `.xml~`. It excludes `.xm`, `.txt` and a name such as `t.xml.bak`. `s.xml.xml` matches. A file named just `.xml` matches. In the probe `order` the folder `b` held `Z.xml a.xml B.xml a.xmlbak t.xml.bak x.XML s.xml.xml .xml m.xmlx n.xm o.txt p.xml~ q.Xml`; exactly `t.xml.bak`, `n.xm` and `o.txt` were not read.

Hidden and read-only files are read (case `hidden`).

[12.0] Same as 14.0.7 (`Directory.GetFiles(dir, "*.xml")`, observed with the case `order`: the same twelve files are read and the same three are not).

[14.35] Same as 14.0.7.

### IMP-004: Directories and files are visited in NTFS order, on every OS

[14.0.7] The engine does not sort. `GetDirectories` and `GetFiles` return NTFS directory order, which is the ordinal order of the upper-cased name. The library reproduces that order on every OS and never uses `readdir` order. Its comparison key for a name is built as follows.

1. Upper-case each UTF-16 code unit on its own with the .NET Framework 4.8 `ToUpperInvariant` mapping of the BMP, recorded in `fixtures/import-load/invariant-upper.json`. Where the table has no entry the unit is unchanged. Surrogates are never mapped, so a supplementary-plane letter does not change case (probe `listing-order`: `𐐀b` comes before `𐐨a`). Titlecase letters such as `ǅ` (U+01C5) are unchanged, so `ǆa`, `Ǆc`, `ǅa2` and `ǅb` list in that order. The mapping is a per-code-unit table, not the host's `toUpperCase`, which maps `ß` to `SS` and differs elsewhere.
2. Compare the upper-cased names as sequences of UTF-16 code units, unsigned.

The comparison is on the file or directory name, not the full path, and it is made inside one directory. Subdirectories are visited in that order, and the files of each in that order before the next subdirectory. Examples (case `order`): directories `10, 9, A, a b, a-b, b, Z, _x, ä, é`; files `.xml, a.xml, a.xmlbak, B.xml, m.xmlx, p.xml~, q.Xml, s.xml.xml, x.XML, Z.xml`.

Two names that differ only by case cannot exist together on NTFS. On a case-sensitive file system the library breaks the tie by the code units of the original names, so the result is deterministic.

The order is an NTFS property the Windows API does not promise. The library treats it as the engine's order because every recorded run shows it (`listing-order.json`, 52 names including accented letters, ligature digraphs and supplementary-plane letters).

[12.0] Same as 14.0.7: the same calls, the same NTFS order (case `order`).

[14.35] Same as 14.0.7.

### IMP-005: Path handling is host-native, and long paths are transparent

[14.0.7] `IOWrapper` passes every path through `NormalizeLongPath` before it touches the file system. A path of 255 characters or more (after `Path.GetFullPath`) is prefixed with `\\?\`. This changes nothing observable: the prefix reaches neither the log nor `tempFullName` (case `longpath`, a file path of about 270 characters). The library has no long-path mechanism of its own.

The paths the engine puts in its output are the host's own spelling:

- the file path in the IMP-008 warning is the directory path as `GetDirectories` returned it, plus the host separator and the file name. A relative `solutionPath` therefore gives a relative path there. A trailing separator on `solutionPath` is not doubled;
- `tempFullName` (IMP-009) is the absolute path of the file.

On Windows these have `\` separators. The library writes the host separator and does not translate to Windows form. This is a documented deviation: the engine's path text depends on the OS it runs on, and the rest of the output does not.

[12.0] Not present. Nothing passes the paths through `NormalizeLongPath`: `Directory.GetDirectories`, `Directory.GetFiles` and `XmlDocument.Load` get the package folder, and each path the enumeration returned, as they are. The path in the IMP-008 warning is spelled as in 14.0.7, and there is no `tempFullName` (IMP-009).

Long paths: on .NET Framework 4.8 under Windows PowerShell 5.1 the probe loads a file with a path of about 270 characters exactly as it does for 14.0.7 (case `longpath`), because that runtime accepts long paths without the prefix. A host built for an older runtime limit would fail at 260 characters with `PathTooLongException` (inferred from the runtime, not observed). The library has no long-path mechanism and no limit.

[14.35] Same as 14.0.7.

### IMP-006: A path that starts with backslashes loses them (UNC paths fail)

[14.0.7] `NormalizeLongPath` removes every leading `\` and `?` character from the path before anything else. (It calls `TrimStart` with the characters of `\\?\`, which is a set, not a prefix.) A UNC package folder `\\server\share\pkg` therefore becomes `server\share\pkg`, a relative path that `GetDirectories` resolves against the process's current directory. The call fails with `DirectoryNotFoundException`, shown by IMP-011 as `Could not find a part of the path '<cwd>\server\share\pkg'.` (case `unc`, run against `\\localhost\C$\…`). The `Unable to get solutions files…` suffix still shows the original UNC path.

The library reproduces this on Windows hosts by applying the same trim to the paths it hands to the file system. On other hosts a path does not start with `\`, and a leading `?` is a literal character that the trim removes in the same way. The engine reads a package from a UNC path only through this defect, so a UNC package folder is unsupported in 14.0.7.

Registered in `bugs.md`.

[12.0] Not present. A UNC package folder works: the case `unc` (`\\localhost\C$\…`) reads its item, where 14.0.7 fails with `DirectoryNotFoundException`. The defect is 14.0.7's only (`bugs.md`).

[14.35] Same as 14.0.7.

### IMP-007: A package file is read as text, then parsed with whitespace dropped

[14.0.7] A file is read with `File.ReadAllText(path)` and parsed with `XmlDocument.LoadXml(text)` on a plain `new XmlDocument()` (`PreserveWhitespace` false). Both steps are as follows.

Reading (`ReadAllText`, ticket 06 rules R1 to R3, probe `encodings`, `utf16-nobom`):

- a UTF-8 (`EF BB BF`), UTF-16LE (`FF FE`), UTF-16BE (`FE FF`), UTF-32LE (`FF FE 00 00`) or UTF-32BE (`00 00 FE FF`) byte order mark is detected and removed. With no mark the bytes are UTF-8. A file that holds only a mark, or nothing, reads as the empty text;
- invalid byte sequences become U+FFFD and the load goes on (Latin-1 `é` gives `caf�`). Each invalid byte is one U+FFFD: a lead byte that is not valid (`80` to `C1`, `F5` to `FF`), a lead byte whose next byte is not a continuation byte, and a valid beginning that stops short (`E2 82` followed by `(`, three bytes of a four-byte character). A lead byte followed by a continuation byte that its range forbids (`E0 80`, `ED A0`, `F0 80`, `F4 90`) is replaced together with that byte, so `E0 80 80` gives two U+FFFD and `ED A0 80`, an encoded surrogate, gives two. A valid beginning that the end of the file cuts off (`C3`, `E2 82`, `F0 9F 98` as the last bytes) gives nothing, no U+FFFD. UTF-16 and UTF-32 text decode the same way: a lone surrogate unit gives U+FFFD, and a final odd byte or unit is dropped;
- the `encoding` named in an XML declaration is never consulted (a `windows-1252` declaration over Latin-1 bytes decodes as UTF-8, giving U+FFFD);
- UTF-16 without a mark is not detected, and fails in the parser as IMP-011 describes.

Parsing (`LoadXml`, ticket 06 rules R5 to R7 as corrected by ticket 08, F1 and F2, probes `crlf-attrs`, `xml-space`, `charref-*`):

- whitespace-only text nodes are dropped, including those next to CDATA, except inside `xml:space="preserve"` content. `<e>  </e>` becomes an empty element;
- text with a non-whitespace character keeps all of its spaces;
- attribute values are kept raw: a literal tab, CR or LF in an attribute stays exactly as written. Text and CDATA keep CR and CRLF as written too. Nothing is normalized to LF or a space;
- a raw control character (U+0001 and so on, other than tab, CR and LF) or a raw U+FFFE or U+FFFF is a parse error;
- a character reference to such a character (`&#1;`, `&#xFFFE;`, `&#xD800;`) loads without error;
- a CDATA section, a comment and a processing instruction are kept in the DOM, and so is the difference between `<x/>` and `<x></x>` (the first is written `<x />` by every later `OuterXml` and `Save`);
- a DOCTYPE and an XML declaration load fine in the file by itself (IMP-010 explains why they then fail the import). The library loads a DOCTYPE with a name only, see IMP-016;
- an entity reference that is not declared is a parse error, as is any ill-formed document, an empty file and a file of only whitespace. IMP-017 gives the messages and the positions, and IMP-018 says exactly which white space is dropped.

[12.0] A file is parsed by `XmlDocument.Load(path)` on a plain `new XmlDocument()` (`PreserveWhitespace` false): the XML reader opens the file and decodes it itself, where 14.0.7 reads text first (ticket 06, R8). The parsing is the same as in 14.0.7: whitespace-only text is dropped except under `xml:space="preserve"`, raw tab, CR and LF in attribute values and CR and CRLF in text and CDATA are kept, raw control characters and U+FFFE or U+FFFF are errors, references to them load, CDATA, comments and processing instructions are kept, an undeclared entity reference, an ill-formed document, an empty file and a file of only whitespace are errors (observed: the cases `malformed`, `empty-file`, `whitespace-file`, `crlf-attrs`, `xml-space`, `charref-*`, `entity-nbsp` and `gt-in-text` give the 14.0.7 results). The decoding differs:

- **Byte-order marks and the encoding.** A UTF-8, UTF-16LE, UTF-16BE, UTF-32LE or UTF-32BE byte-order mark is detected and removed (cases `x-utf16le-bom`, `x-utf16be-bom`, `x-utf32le-bom`, `x-utf32be-bom`). With no mark the bytes are UTF-8, except that UTF-16 of either byte order is also recognised without a mark when the file starts with `<` (cases `utf16-nobom`, `x-utf16le-nobom`, `x-utf16be-nobom` load; 14.0.7 fails them with `Name cannot begin with the '.' character…` or `Root element is missing.`).
- **The declared encoding is honoured.** A `windows-1252` declaration over Latin-1 bytes decodes correctly (case `x-cp1252-decl`: `café`). The declaration is still a node of the document, so the import then fails with the declaration error of IMP-010, as in 14.0.7. A declaration of an unsupported name is `System.Xml.XmlException` `System does not support 'no-such-enc' encoding. Line 1, position 31.` (case `x-unknown-enc-decl`), and `encoding="utf-16"` over UTF-8 bytes is `There is no Unicode byte order mark. Cannot switch to Unicode.` (case `x-utf16-decl-over-utf8`).
- **Invalid bytes are an error, not U+FFFD.** A Latin-1 `é` in a file without a declaration, or in one that declares `utf-8`, is `System.Xml.XmlException` `Invalid character in the given encoding. Line 1, position {n}.`, `n` the position of the first bad character (54 and 92 in the cases `x-latin1-nodecl` and `x-utf8-decl-latin1-bytes`; also the case `encodings`, where the Latin-1 file stops the whole load). 14.0.7 turns the bad byte into U+FFFD and goes on.
- A file of only a UTF-8 byte-order mark has no root element: `Root element is missing.` (case `x-bom-only`, as in 14.0.7).
- **File names are not treated as URIs.** Names with `#`, `%`, `%20`, `&`, `+`, `;`, `,`, `=`, `@`, `[`, `]`, an apostrophe, a space or non-ASCII letters, and folders and a package folder named so, are read normally (cases `x-name-hash`, `x-name-percent`, `x-name-chars`, `x-dir-hash`, `x-dir-percent`, `x-solutionpath-hash`).

The exceptions from decoding are `XmlException`s, not `IOException`s, so IMP-011 does not wrap them: they leave `LoadPackageDom` with the reader's text, which names a line and position and no file.

[14.35] Same as 14.0.7.

### IMP-008: A file without `AML/Item` is skipped with a warning

[14.0.7] After parsing, the engine selects `AML/Item` from the document: the first `Item` child of a root element named `AML`. The names are matched exactly and without a namespace. The file is skipped, and contributes nothing to the result, when there is none. That is the case when:

- the root is not `AML`: `aml`, `Other`, or `AML` in a namespace (`<AML xmlns="urn:x">`);
- `AML` has no `Item` child: `<AML><Foo/></AML>`, or the item is nested deeper (`<AML><Foo><Item/></Foo></AML>`);
- every `Item` child is in a namespace (an `Item` in a namespace is not selected; a later `Item` without one is).

Each skip writes one line to the log writer, with the file path as enumerated (IMP-005) and no console output:

`WARNING: File '{path}' doesn't have any items by next xpath : 'AML/Item'. File is skipped.`

The line ends with CRLF on Windows (`TextWriter.WriteLine`); the library writes the platform newline of the log it is given. Probe `skips`: of six files only `f-ok.xml` was read, and the other five logged the warning in file order.

A file with `AML/Item` but also other content is read whole, including the other items (IMP-010).

[12.0] The same selection of `AML/Item` (observed with the case `skips`: the same five files are skipped and `f-ok.xml` is read) and the same log line, but with other wording:

`WARNING: File '{path}' doesn't have root tag 'AML/Item'. File is skipped.`

The path is spelled as in 14.0.7 (IMP-005) and the line ends as the log writer's `WriteLine` does.

[14.35] Same as 14.0.7.

### IMP-009: The first item of each read file is stamped with its file name and path

[14.0.7] On the selected `AML/Item` (the first one) the engine calls `SetAttribute` twice, in this order:

- `tempKeyName`: `Path.GetFileNameWithoutExtension(file name)`, which cuts from the last `.`. `a.b.xml` gives `a.b`, `x.xmlbak` gives `x`, `s.xml.xml` gives `s.xml`, and `.xml` gives the empty string (case `stamps`). The name keeps its case and any non-ASCII characters;
- `tempFullName`: the absolute path of the file (`FileInfo.FullName`), as IMP-005 says.

`SetAttribute` replaces the value of an attribute that already exists and leaves it where it was. A new attribute is appended after the existing ones. So `<Item tempKeyName="old" type="List" tempFullName="oldf">` keeps that attribute order with the two new values (case `stamps`, file `c.xmlbak`), and any other `Item` gets the two attributes at its end.

Only the first `Item` of a file is stamped. The other items of the file carry no stamp (case `stamps`, file `a.b.xml`: item `one` is stamped, `two` is not). `tempKeyName` is later the package element's name (`IMP-4xx`), so an item that is not first in its file is registered under an empty name, and the stamp is lost if `build.xsl` drops the stamped item (IMP-029).

[12.0] Only `tempKeyName` is set, with the same value as in 14.0.7 (`Path.GetFileNameWithoutExtension`: `a.b.xml` gives `a.b`, `x.xmlbak` gives `x`, `.xml` gives the empty string; case `stamps`). There is no `tempFullName`: no attribute of that name is added. An item that already carries one keeps it as it is (case `stamps`, file `c.xmlbak`: the output is `tempKeyName="c" type="List" tempFullName="oldf" …`, the old `tempKeyName` replaced in place and the `tempFullName` untouched), and IMP-422 explains that the loop then sends it. As in 14.0.7 only the first `Item` of a file is stamped and `SetAttribute` keeps the position of an existing attribute and appends a new one.

[14.35] Same as 14.0.7.

### IMP-010: The files are concatenated through `OuterXml` into one `AML` string

[14.0.7] For each read file (not skipped), in the order of IMP-004, the engine appends the `OuterXml` of the whole file document, not just of the stamped item, to one string. It then loads `"<AML>" + string + "</AML>"` into a new `XmlDocument` (whitespace dropped, as IMP-007). The consequences are the observable rules:

- the file's root `AML` element becomes a child of the wrapper `AML`: a file's items sit at `AML/AML/Item` of the wrapper. `build.xsl` selects them there (IMP-020);
- every `Item` that is a direct child of a file's root `AML` takes part, in file order then document order, not just the stamped one. Items outside `AML/Item` (nested, or other elements) are never selected;
- comments and processing instructions outside the root element, such as `<!-- c -->` before `<AML>`, are serialized into the string and are harmless there (case `comment-before-root`);
- `OuterXml` is the .NET serialization: double-quoted attributes, `<x />` for an empty element, `&lt; &gt; &amp;` and `&quot;` escaped, CR and LF in attribute values written as `&#xD;` and `&#xA;`, a tab left raw. The text parses back to the same DOM. A reference to a lone surrogate (`&#xD800;`) is the one value that cannot be serialized: `OuterXml` throws `ArgumentException` (`The surrogate pair (0xD800, 0x62) is invalid. …`, the second value being the following character), and nothing catches it (case `charref-D800`);
- **an XML declaration or a DOCTYPE in any package file fails the import.** The serialization keeps it, and it is no longer at the start of the string, so `LoadXml` rejects it. The messages are (cases `decl-first`, `decl-second`, `decl-bom`, `doctype`):
  - `Unexpected XML declaration. The XML declaration must be the first node in the document, and no white space characters are allowed to appear before it. Line 1, position 8.`
  - `Unexpected DTD declaration. Line 1, position 8.`

  Line and position count in the whole string. They name the third character of the offending token (the character after `<?` or `<!`), counting from 1 on the line. Only the single-line case is probed; the library follows `XmlTextReader`'s counting, in which each CRLF, CR or LF before the token starts a new line. For the first file the position is 8, because `<AML>` is five characters and `<?` two. For a later file it is 5 plus the lengths of the earlier serializations plus 3 (case `decl-second`: 158). The failure is wrapped as IMP-011.

  A byte order mark, and whitespace before the declaration, do not matter: the declaration is rejected either way. Whitespace before the root and a comment before the root are fine.

[12.0] The same concatenation of each read file's whole `OuterXml`, the same wrapper, the same `AML/AML/Item` shape, and the same rejection of an XML declaration or DOCTYPE. Two things differ:

- The serialization of the first item has one attribute less (no `tempFullName`, IMP-009), so the position in the message of a declaration or DOCTYPE in a later file is smaller. The messages are the same, and so is position 8 for the first file. Observed (case `decl-second`): `Unexpected XML declaration. The XML declaration must be the first node in the document, and no white space characters are allowed to appear before it. Line 1, position 75.` where 14.0.7 says 158. The rule is the one of 14.0.7 (5 plus the lengths of the earlier serializations plus 3), with 12.0's serializations.
- A declaration with an `encoding` is read with that encoding (IMP-007) before it fails here, so the failure of a file with a declaration can be an encoding error instead.

The other consequences of 14.0.7's list hold (cases `decl-first`, `decl-bom`, `doctype`, `comment-before-root`, `charref-D800` give the 14.0.7 results).

[14.35] Same as 14.0.7.

### IMP-011: LoadPackageDom failures: three paths, two exception types

[14.0.7] Errors leave `LoadPackageDom` as one of these.

1. **Listing the package folder** fails with an `IOException` (a missing folder is `DirectoryNotFoundException`, a path that is a file is `IOException`): `CItemException`, faultcode -1, with message `{runtime message}` followed by ` Unable to get solutions files by path in .mf file {solutionPath}`. The runtime message is the host's; the .NET text is `Could not find a part of the path '{absolute path}'.` for a missing folder and `The directory name is invalid.\r\n` for a path that is a file (cases `missing-dir`, `path-is-file`). The path in the suffix is the `solutionPath` as given. The library reproduces those two messages in English on every OS, with the absolute path where .NET puts one, and uses the host's own text for other `IOException` cases.
2. **Reading a file or listing its folder** fails with an `IOException`: `CItemException`, faultcode -1, with message `{runtime message}` followed by ` Unable to load {path}`, where `{path}` is the last file the loop reached (the empty string if none yet; a failure while listing a folder would name the previous file, inferred from the code, not probed). A file held open by another process gives `The process cannot access the file '{absolute path}' because it is being used by another process.` (case `locked`). An error that is not an `IOException`, such as `UnauthorizedAccessException`, and any `XmlException` from parsing a file, is **not** caught here. It leaves the function as it is: an `XmlException` message names the failure and a line and position within that file alone, not the file name (cases `malformed`: `The 'Item' start tag on line 1 position 7 does not match the end tag of 'AML'. Line 1, position 26.`, `empty-file`: `Root element is missing.`, `utf16-nobom`: `Name cannot begin with the '.' character, hexadecimal value 0x00. Line 1, position 2.`).
3. **Building and transforming the combined document** fails with an `XmlException` while loading the string (IMP-010) or reloading the transform result (IMP-012): `CItemException`, faultcode -1, message `{XmlException message}` followed by ` Unable to apply build.xsl.` An `XsltException` or `IOException` there would be followed by ` Error of build.xsl.`. Neither can arise, because `ApplyXsl` wraps every error of the transform itself as a `CItemException` (IMP-012), which passes through unchanged.

`faultstring` of the `CItemException` holds the .NET stack trace of the underlying error, and `faultdetail` is the message. The stack trace is not reproduced; the library stores its own stack text there, and no rule depends on it. The `CItemException` has `bInnError` true and the original error as its inner exception.

`ImportPackage` catches every exception from the load and turns it into the package failure (the `IMP-4xx` rules own that step).

[12.0] The same three paths, faultcode -1, `bInnError` true, the original as inner exception, and the same `ImportPackage` handling. The texts differ in one place and the catching in one:

1. Listing the package folder: the same message and suffix, ` Unable to get solutions files by path in .mf file {solutionPath}` (cases `missing-dir`, `path-is-file`, identical to 14.0.7's).
2. Reading a file: the suffix is ` Unable to load  {path}` with **two** spaces after `load` (14.0.7 has one), where `{path}` is the last file the loop reached. A locked file gives `The process cannot access the file '{path}' because it is being used by another process. Unable to load  {path}` (case `locked`). Only `IOException` is caught. The `XmlException`s of the decoder (IMP-007) are not, and nor is an `XmlException` from parsing, which names a line and position in that file only: `malformed`, `empty-file` and the encoding cases leave `LoadPackageDom` as they are.
3. Building and transforming: ` Unable to apply build.xsl.` after an `XmlException` while loading the combined string (the declaration cases), and ` Error of build.xsl.` for an `XsltException` or `IOException`, which cannot arise (IMP-012).

[14.35] Same as 14.0.7.

### IMP-012: build.xsl is applied by ApplyXsl, in four steps

[14.0.7] `ApplyXsl(doc, "build.xsl")` loads the stylesheet embedded in `Libs.dll` once (cached by name) and:

1. runs the transform with `doc` as the source, writing to a `StringWriter` with the invariant culture;
2. replaces, everywhere in that text, the exact string `xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"` with nothing (IMP-013);
3. loads the text into `doc` with `LoadXml`, replacing its content;
4. returns, having changed `doc` in place. `doc` has `PreserveWhitespace` false.

Any error in steps 1 and 2 (including a failure of the output writer) is caught and rethrown as a `CItemException`, faultcode -1, with message `{error message}` followed by ` Error of  applying export.xsl.` The text says `export.xsl` and has two spaces after `of`, whichever stylesheet ran (registered in `bugs.md`: the message names the wrong stylesheet). A character reference to an invalid character reaches the writer and fails here (cases `charref-1-text`, `charref-1-attr`, `charref-FFFE`): `'\u0001', hexadecimal value 0x01, is an invalid character. Error of  applying export.xsl.` (the character itself is written between the quotes). An error in step 3 is an `XmlException` that IMP-011 wraps.

The library does not embed or run the stylesheet. IMP-020 to IMP-032 give its effect, and IMP-014 gives the text it writes.

[12.0] Same as 14.0.7: `ApplyXsl` is the same code, with the same four steps and the same `CItemException` text ` Error of  applying export.xsl.` (two spaces after `of`, naming the wrong stylesheet). Observed with the cases `charref-1-text`, `charref-1-attr` and `charref-FFFE` of `load-package-dom.12.0.out.txt`.

[14.35] Same as 14.0.7: `ApplyXsl` is unchanged. The stylesheet it runs is 14.35's (`IMP-020` onwards); the text it writes follows `IMP-014` as before.

### IMP-013: The `xmlns:SOAP-ENV` replace also deletes it from element content

[14.0.7] Step 2 of IMP-012 is a plain text replace over the whole serialized output, so it removes that exact string wherever it occurs, including inside element text and CDATA, not only where it is a namespace declaration. A `method_code` whose script contains `xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"` loses it, and a `comments` element holding only that string comes out as `<comments></comments>` (probe `soap-env-in-content` in `build-xsl.cases.json`, ticket 06 X2). Attribute values are safe, because `"` is written as `&quot;` there. The same text with a different namespace URI, or `xmlns:i18n`, is not touched.

The replace leaves the space before the removed declaration, so an element that had one now has two spaces there (`… xmlns:i18n="…"  />`, probe `raw-namespace-comments-cdata`).

Registered in `bugs.md`.

[12.0] Same as 14.0.7: the text replace is in the same place and the bug is the same. Registered in `bugs.md`.

[14.35] Same as 14.0.7.

### IMP-014: What the transform writes: text rules the plan and the import share

[14.0.7] The output text of the `build.xsl` transform (before IMP-012 step 2) follows these rules. They are the XSLT output serialization of ticket 06 (X1, X4, X6) restricted to what `build.xsl` can produce.

- No declaration, no indentation, no added whitespace. The root is `<AML>` or `<AML />` when nothing was selected.
- A copied element with no children and no text is written `<x />`, whatever way it was written in the file (`<empty></empty>` becomes `<empty />`; `<ws>  </ws>` is empty already by IMP-007). An element whose only content is comments and instructions is `<x />` too. An element that holds a zero-length text node is `<x></x>`: the source tree keeps a CDATA section with no characters as such a node, and the built-in text rule copies it (the same mechanism as `EXP-204`; probe `empty-cdata-runs`: `<d><![CDATA[]]></d>` and two empty sections in a row give `<d></d>`). The root and every copy are written as the `*` template of IMP-032 describes.
- Text: `&` as `&amp;`, `<` as `&lt;`, `>` as `&gt;`. Quotation marks and apostrophes are literal. Any CR, LF or CRLF in text becomes CRLF.
- Attribute values: `&` `<` `>` and `"` as `&amp; &lt; &gt; &quot;`, CR as `&#xD;`, LF as `&#xA;` and tab as `&#x9;`. Attributes are in double quotes.
- Characters above U+007F are written as they are (the text is a string, not bytes).
- A character that XML 1.0 forbids makes the writer throw (IMP-012).
- Elements named `html_code`, `method_code`, `sqlserver_body`, `stylesheet`, `query`, `class_structure`, `report_query` and `xsl_stylesheet`, at any depth and in no namespace, have their text written as CDATA (the stylesheet's `cdata-section-elements`). A `]]>` inside becomes `]]]]><![CDATA[>`. An element with text of several runs separated by child elements gets one CDATA section per run. Adjacent text and CDATA nodes, also with a comment or an instruction between them, are one run and one section (`a<!--c-->b` gives `<![CDATA[ab]]>`, `p<i/>q` gives `<![CDATA[p]]><i /><![CDATA[q]]>`; probe `empty-cdata-runs`). An empty such element stays `<x />`, and one with an empty CDATA section keeps `<![CDATA[]]>`. Whitespace-only text no longer exists after IMP-007, except within `xml:space="preserve"`.
- Comments and processing instructions inside items are not copied (IMP-032).
- **Namespace declarations.** Every element that is copied also carries the namespace declarations in scope for it in the source that are not yet in scope, with the same prefix and URI, in the output. `xml` is never written. For a file item, copied into the new `<AML>` that declares nothing, the declarations come after all attributes, in two groups: first those inherited from the file root, in the order the root declared them, leaving out any prefix the item declares itself (even with the same URI); then the item's own declarations in the order it declared them. For a nested element only a declaration that differs from what the output already has in scope is written, own declarations in declaration order, so a repeated `xmlns:q="urn:q"` is not written again (probes `ns-order`, `ns-nested`, `ns-redeclare-same`, `ns-nested-ordering`, `ns-two-files-same-prefix`). A default namespace declaration on a nested element is copied (`<name xmlns="urn:x">`).

Vectors for each point are in `build-xsl.out.txt` (the `RAW:` lines).

[12.0] Same as 14.0.7. The `cdata-section-elements` list of `build.xsl` is the same in both builds (`html_code`, `method_code`, `sqlserver_body`, `stylesheet`, `query`, `class_structure`, `report_query` and `xsl_stylesheet`); the 12.0 `export.xsl` differs from 14.0.7's there, `build.xsl` does not (EXP-360 is the export's).

[14.35] Same as 14.0.7.

### IMP-015: GetItemsFromPackageDom gives one document per `AML/Item`

[14.0.7] `GetItemsFromPackageDom(dom)` throws `ArgumentNullException` for a null document (parameter name `packageDom`). Otherwise it returns a list: for each `Item` element that is a direct child of the root `AML` of `dom`, in document order, a new `XmlDocument` (`PreserveWhitespace` false) loaded from that element's `OuterXml`. The documents are built eagerly, so the list holds an independent copy of each item.

An item that `build.xsl` emitted more than once (IMP-026) appears once per copy. An empty `AML` gives an empty list. Nothing is removed or merged, and no item is skipped.

[12.0] Same as 14.0.7 (the same function: `ArgumentNullException` for a null document, one new document per `AML/Item`).

[14.35] Same as 14.0.7.

### IMP-016: A DOCTYPE with an internal subset or an external identifier is not loaded (bug)

[14.0.7] `XmlDocument.LoadXml` accepts any DOCTYPE. `<!DOCTYPE a>` (with or without an empty `[]`) becomes a document type node and changes nothing else. A DOCTYPE with declarations in square brackets adds the entities and attribute defaults they declare to the document, and one with `SYSTEM` or `PUBLIC` makes .NET read the named file (a missing file is a `FileNotFoundException`). The library loads the first kind only. Any other DOCTYPE throws `NotSupportedException` (not an `XmlException`) whose message names the DOCTYPE and this rule, unless the text ends first, which is the `XmlException` `Incomplete DTD content.` as in .NET.

A package file with any DOCTYPE fails the import in .NET too (IMP-010), with an `XmlException` for the `<!DOCTYPE` that no longer starts the text. The library fails it with the `NotSupportedException` when the file has such a DOCTYPE. A manifest with one is the case that differs, because the engine loads a manifest as it is (MAN-003). Real packages and manifests carry none. Registered in `bugs.md` as a deviation of the library.

### IMP-017: A malformed document throws an XmlException with .NET's text and position

[14.0.7] `LoadXml` and `InnerXml` throw `System.Xml.XmlException`. Its message is the text of the table with ` Line L, position P.` appended. `L` and `P` start at 1; `P` counts UTF-16 units from the start of the line, and each LF, CR and CRLF ends a line. The text `Root element is missing.` is the one message without a position. The table names the character `P` points at. Every row is in the vectors `wf.*`, `xd.*` and `op.ix*` of `fixtures/xml-core/vectors.json`, which are the complete reference (about three hundred inputs).

| Situation | Text | Position |
|---|---|---|
| Nothing but white space, comments, instructions and a DOCTYPE | `Root element is missing.` | none |
| Text outside the root (`x<a/>`, `<a/>x`, a byte-order mark character) | `Data at the root level is invalid.` | that character |
| A `<` outside the root with fewer than four characters left in the text (`<a>`, `<a/`, `<!-`) | `Data at the root level is invalid.` | the `<` |
| A second root element | `There are multiple root elements.` | the first character of its name |
| An end tag with nothing open | `Unexpected end tag.` | the character after `</` |
| An end tag with another name | `The 'a' start tag on line L position P does not match the end tag of 'b'.` (`L`, `P`: the start tag's name) | the end tag's name |
| The text ends inside content, a start tag or an end tag | `Unexpected end of file has occurred. The following elements are not closed: b, a.` (innermost first; with nothing open the list and its full stop are empty: `closed:  Line`) | the end of the text |
| The text ends in a name, after `=`, in a reference or in the XML declaration | `Unexpected end of file while parsing Name has occurred.`, `Unexpected end of file has occurred.`, `Unexpected end of file while parsing  has occurred.` (a numeric reference) | the end of the text; the `&` of a reference; the `?` when a declaration ends in `?` |
| A comment, CDATA section or instruction that does not end | `Unexpected end of file while parsing Comment` (`CDATA`, `PI`) `has occurred.` | the end of the text, but where the content starts when fewer than three characters follow it |
| An attribute value that does not end | `There is an unclosed literal string.` | the end of the text |
| A DOCTYPE that does not end | `Incomplete DTD content.` | the end of the text |
| A name that begins with a bad character | `Name cannot begin with the 'c' character, hexadecimal value 0xHH.` | that character |
| A bad character inside a name | `The 'c' character, hexadecimal value 0xHH, cannot be included in a name.` | that character |
| A raw character XML forbids | `'c', hexadecimal value 0xHH, is an invalid character.` | that character |
| `]]>` in text | `']]>' is not allowed in character data.` | its first `]` |
| `<` in an attribute value | `'<', hexadecimal value 0x3C, is an invalid attribute character.` | the `<` |
| An unquoted value, a missing `=`, a missing white space, a stray `/` | `'c' is an unexpected token. The expected token is '"' or '''.`, `... The expected token is '='.`, `... Expecting white space.`, `... The expected token is '>'.` | the character named (for `/`: the `/` when it follows the element name directly, else the character after it) |
| A second attribute with the same name or the same namespace and local name | `'b' is a duplicate attribute name.` (the qualified name) | the second attribute's name |
| A reference to an unknown entity | `Reference to undeclared entity 'n'.` | the first character of the name |
| `&` not followed by a name and `;` | `An error occurred while parsing EntityName.` (in an attribute value, only when no name follows the `&`; a name without `;` there gives `'c' is an unexpected token. The expected token is ';'.`) | the first character after the `&` (there: the character that is not `;`) |
| A bad numeric reference | `Invalid syntax for a decimal numeric entity reference.`, `... hexadecimal ...`; `Invalid value of a character entity reference.` when the number passes 2147483647 | the character that is not a digit; the digit that overflows |
| `--` in a comment | `An XML comment cannot contain '--', and '-' cannot be the last character.` | the first of the two |
| A prefix with no declaration | `'p' is an undeclared prefix.` | the name |
| A bad namespace declaration | `Invalid namespace declaration.` (a prefix bound to ""), `Prefix "xml" is reserved for use by XML and can be mapped only to namespace name "http://www.w3.org/XML/1998/namespace".`, `Prefix "xmlns" is reserved for use by XML.`, `Prefix 'p' cannot be mapped to namespace name reserved for "xml" or "xmlns".` (the xmlns namespace) | the opening quote; the declaration's name; the declaration's name; the first character of the value |
| `<?xml` after the start, or a DOCTYPE inside an element | `Unexpected XML declaration. The XML declaration must be the first node in the document, and no white space characters are allowed to appear before it.`, `Unexpected DTD declaration.` | the `x` after `<?`; the `D` after `<!` |
| A bad processing instruction | `'XML' is an invalid name for processing instructions.` (any case but `xml`) | the name |
| A bad XML declaration | `Syntax for an XML declaration is invalid.`, `Version number '1.1' is invalid.` (only `1.0` is) | the offending word; the value |
| A bad DOCTYPE | `Cannot have multiple DTDs.`, `DTD must be defined before the document root element.`, `'doctype' is an unexpected token. The expected token is 'DOCTYPE'.` | the `<`; the `<`; the word after `<!` |
| Markup that is none | `'ELEMENT' is an unexpected token. The expected token is '<!--' or '<[CDATA['.` | the word after `<!` |
| `xml:space` with another value than `preserve` or `default` | `'bogus' is an invalid xml:space value.` | the attribute's name |

A NUL character appears in these messages as a full stop. A character outside the Basic Multilingual Plane is shown whole, with its code point in `0xHH` (`0x1F600`), and never starts or continues a name. The classes of letters and name characters follow Unicode categories, because XML 1.0's fourth edition tables follow Unicode 2.0. They differ only for letters added to Unicode since then, which real item and package names do not use.

[12.0] Not yet specified. 12.0 reads with `XmlDocument.Load(path)` and `XmlTextReader`, which words these errors the same way.

### IMP-018: Which white space a loaded document keeps, and what InnerXml keeps

[14.0.7] `XmlTextReader` sorts a run of text between two pieces of markup (an element tag, a comment, an instruction, a CDATA section) as white space when every character is a space, tab, CR or LF that the text spells out, and decimal character references are not counted as spelled out. `PreserveWhitespace` false then keeps it only inside `xml:space="preserve"` (until an `xml:space="default"` below it); `PreserveWhitespace` true keeps all of it, outside the root element too (the nodes between the declaration, the DOCTYPE, comments and the root). Everything else is text. So `<a>  </a>` has no child and `<a>&#x20;</a>` has none either, but `<a>&#32;</a>` has the text `" "`, as have `<a>&#10;</a>` and a run that holds a decimal reference next to a hexadecimal one (`&#x20;&#32;`). A run with a named reference (`&amp;`) is text because it decodes to a non-blank character. A non-self-closed element that lost its white space is `<e></e>`, never `<e />`.

`XmlElement.InnerXml = text` reads the text as element content with `XmlTextReader` in fragment mode, whatever the document's `PreserveWhitespace`:

- all white space is kept, also next to other markup, and several elements and text may follow each other;
- an entity reference that is not one of the five predefined ones is not an error. It becomes a node that is written back as `&name;` (inside an attribute value it is still the error of IMP-017);
- a leading XML declaration is accepted and becomes a node inside the element. `OuterXml` writes it back. An `XmlWriter` that has written nothing yet leaves it out (the DAC condition writer of EXP-119); the item-file writer, which has written the start tags above it, refuses it with `ArgumentException` `Cannot write XML declaration. WriteStartDocument method has already written it.`, leaving the text before it (EXP-428);
- the namespace declarations in scope at the element apply to the text;
- as at the top of a document, a `<` with fewer than four characters left outside any element is `Data at the root level is invalid.` (IMP-017).

[12.0] Not yet specified.

## build.xsl as ordering rules

### IMP-020: build.xsl turns file items into one ordered sequence by running fifty-three groups in turn

[14.0.7] Its input is the wrapper document of IMP-010. The groups below run one after the other, each selecting some of the *file items* (direct children of a file root, across all files in file order) and copying each selected item into the output. An item is copied by the `*` template (IMP-032), except that an `ItemType` or `RelationshipType` item whose action is `add` is copied by the template of IMP-026. The output is the concatenation of the groups' results, so an item's place is decided by the first group that selects it, its position inside the group, and the duplicates of IMP-026.

Inside a group, items are in document order (file order, then position in the file), unless the group says it sorts. A sort is always stable: items with equal keys keep document order.

An item is selected at most once by the groups themselves; the only way it is written twice is IMP-026. An item selected by no group is dropped (IMP-029).

[12.0] The same procedure with **fifty-one** groups: G45 and G48 do not exist (IMP-021). The groups keep their 14.0.7 numbers, so G45 and G48 are never used, and a plan or a log names the same group in both engines. The selection by the first group, the document order, the stable sorts and the `*` template are as in 14.0.7, and so is the template of IMP-026. Observed: `fixtures/import-load/build-xsl.12.0.out.txt` runs the 34 cases of `build-xsl.cases.json` through the 12.0 stylesheet and differs from the 14.0.7 run only in the case `drops`, where `mp_MacPolicy|mp_PromoteItem|prom` is not emitted. `build-xsl.12.0-extra.cases.json` and `.out.txt` hold the cases for IMP-021 and IMP-022.

[14.35] Fifty-five groups: the fifty-three of 14.0.7 and the two of `IMP-021` that run between G12 and G13. Everything else in the rule is as in 14.0.7.

### IMP-021: The groups and their order

[14.0.7] The groups, in the order they run. `T` is the item's `type` attribute and `A` its `action` attribute. Each comparison is exact and case-sensitive, and an absent attribute equals nothing (IMP-023). "Add" means `A = 'add'`.

| Group | Selects | Order |
|---|---|---|
| G01 | `T = List`, add | document |
| G02 | `Sequence`, add | document |
| G03 | `Revision`, add | document |
| G04 | `Variable`, add | document |
| G05 | `Identity`, add | document |
| G06 | `Member`, add | document |
| G07 | `User`, add | document |
| G08 | `Permission`, add | document |
| G09 | `Method`, add | document |
| G10 | `EMail Message`, add | document |
| G11 | `Action`, add | document |
| G12 | `Report`, add | document |
| G13 | `Form`, add | document |
| G14 | `Workflow Map`, add | document |
| G15 | `Life Cycle Map`, add | document |
| G16 | `Grid`, add | document |
| G17 | `xPropertyDefinition`, add | document |
| G18 | `Permission_ItemClassification`, add | document |
| G19 | `Permission_PropertyValue`, add | document |
| G20 to G30 | add, for each of `CommandBarShortcut`, `CommandBarSeparator`, `CommandBarMenuSeparator`, `CommandBarDropDown`, `CommandBarCheckbox`, `CommandBarMenuCheckbox`, `CommandBarEdit`, `CommandBarButton`, `CommandBarMenu`, `CommandBarMenuButton`, `CommandBarSection`, in that order | document |
| G31 | `PresentationConfiguration`, add | document |
| G32 | `ItemType`, add, where the string value of its first `implementation_type` child is not `polymorphic` (IMP-024) | document |
| G33 | `ItemType`, add, where that value is `polymorphic` | document |
| G34 | `RelationshipType`, add | by `number(@dependencyLevel)` ascending (IMP-025) |
| G35 | `ItemType`, edit, with no earlier add sibling (IMP-027) | document |
| G36 | `Morphae`, add | document |
| G37 | `Field`, any action | document |
| G38 | `Property`, any action | document |
| G39 | `View`, any action | document |
| G40 | `SQL`, any action | document |
| G41 | `Form`, delete | document |
| G42 | `Metric`, add | document |
| G43 | `Chart`, add | document |
| G44 | `Dashboard`, add | document |
| G45 | `ac_PolicyAccessItemAttribute`, add | document |
| G46 | `mp_PolicyAccessEnvAttribute`, add | document |
| G47 | `mp_MacPolicy`, add | document |
| G48 | `mp_MacPolicy`, `A = mp_PromoteItem` | document |
| G49 | `qry_QueryDefinition`, add | document |
| G50 | `dr_RelationshipFamily`, add | document |
| G51 | `dac_DomainDefinition`, add | document |
| G52 | any type of the edit list (IMP-022), edit | document |
| G53 | any type that is not in the unlisted-types list (IMP-022), any action | by `@type`, NLS word sort (IMP-028) |

`Field`, `Property`, `View` and `SQL` are emitted whatever their action, including none (G37 to G40), after the `ItemType` groups and before the `Form` deletes. `ItemType` has no add-group for `edit`, apart from G35 and the duplicates of IMP-026, so the engine imports `ItemType` edits only when they stand in a file that has no earlier `ItemType` or `RelationshipType` add, or after an add.

Probe `order-basic` (`build-xsl.out.txt`) walks these groups.

[12.0] The table of 14.0.7 without two rows:

- **G45** (`ac_PolicyAccessItemAttribute`, add) does not exist. Such an item is selected by G53 instead (IMP-022);
- **G48** (`mp_MacPolicy` with `A = mp_PromoteItem`) does not exist. 12.0 lists `mp_MacPolicy` in both lists but selects only its `add` (G47) and its `edit` (G52), so a promote item is selected by no group and is dropped (IMP-029).

Every other row, with its position, is as in 14.0.7. Observed (`build-xsl.12.0-extra.out.txt`, case `promote-item`): of `mp_MacPolicy` items `p1` (`mp_PromoteItem`), `a1` (add), `e1` (edit), `d1` (delete), `n1` (no action), `m1` (merge) and `p2` (`mp_PromoteItem`), followed by a `qry_QueryDefinition` add `q1`, the output is `a1`, `q1`, `e1`: G47, G49 and G52. 14.0.7 emits `a1`, `p1`, `p2`, `q1`, `e1`.

[14.35] The table of 14.0.7 with two groups added, right after G12 (`Report`, add) and before G13 (`Form`, add):

| Group | Selects | Order |
|---|---|---|
| G12a | `cui_Control`, add | document |
| G12b | `cui_WindowSection`, add | document |

The groups of 14.0.7 keep their names and their order, and the new ones are named G12a and G12b, so that a group name means the same in the plan of every engine. Both types are also in the edit list and the unlisted-types list (`IMP-022`), so G52 takes their `edit` items and G53 no longer takes any of their items (`IMP-029`). Probe (`build-xsl-cui` cases): `Form, cui_WindowSection, Method, cui_Control, Report, List, cui_Control, Workflow Map, cui_WindowSection` (all adds) comes out `List, Method, Report, cui_Control, cui_Control, cui_WindowSection, cui_WindowSection, Form, Workflow Map` (case `cui-order`), and with two files all `cui_Control` adds of both files precede all `cui_WindowSection` adds (case `cui-order-two-files`). In 14.0.7 the same items came out at the end, after `Workflow Map`, from G53 sorted by type.

### IMP-022: A type counts as listed when `|type|` is a substring of a fixed list

[14.0.7] G52 and G53 test the type against two strings of `|`-separated names by a substring test: the type counts as in the list when `'|' + T + '|'` occurs inside it. This is `contains(list, concat('|', @type, '|'))`, not a comparison against each name.

- **Edit list** (G52): `List`, `Sequence`, `Revision`, `Variable`, `Identity`, `Member`, `User`, `Permission`, `Method`, `EMail Message`, `Action`, `Report`, `Form`, `Life Cycle Map`, `Workflow Map`, `Grid`, `xPropertyDefinition`, `Permission_ItemClassification`, `Permission_PropertyValue`, `PresentationConfiguration`, `Morphae`, `RelationshipType`, `Metric`, `Chart`, `Dashboard`, `ac_PolicyAccessItemAttribute`, `mp_PolicyAccessEnvAttribute`, `mp_MacPolicy`, `qry_QueryDefinition`, `dr_RelationshipFamily`, `dac_DomainDefinition`, and the eleven `CommandBar…` types of G20 to G30.
- **Unlisted-types list** (G53): the edit list plus `ItemType`, `Field`, `Property`, `View` and `SQL`. The two strings differ only by position: the unlisted-types string is the edit string with `ItemType` inserted between `PresentationConfiguration` and `Morphae`, and `Field`, `Property`, `View` and `SQL` (in that order) inserted between `RelationshipType` and `Metric`. The eleven `CommandBar…` types come last in both, in the order of G20 to G30. Each string begins and ends with `|`.

The delimiters are the string `|` between and around the names, so `|List|Sequence|` are neighbours. Consequences:

- a type with an exact name in a list matches;
- a type that is a `|`-joined run of names in the list order also matches. `List|Sequence` and `Sequence|Revision` count as listed, and a run in which one name differs, such as `Sequence|Foo`, does not (probe `typeless-and-bars`);
- the empty type, an absent type and a type of `|` are not in either list, so G53 emits them (probe `typeless-and-bars`). `CImportItems` rejects an item with no `type` attribute later (`IMP-1xx`), after `build.xsl` has placed it.

Registered in `bugs.md`.

[12.0] The same substring test with both lists lacking `ac_PolicyAccessItemAttribute`. The edit list is 14.0.7's without `ac_PolicyAccessItemAttribute` (every other name, including the eleven `CommandBar…` types, in the same order), and the unlisted-types list is that edit list plus `ItemType`, `Field`, `Property`, `View` and `SQL`. The type `ac_PolicyAccessItemAttribute` is therefore **not listed**, and G53 emits every item of it, whatever its action, including none: add, edit, delete, merge, purge. Where 14.0.7 imports its adds early (G45) and its edits with the edit group (G52) and drops every other action, 12.0 puts all of them in the last bucket, which is sorted by `@type` in the NLS order of IMP-030, stable, so in document order within the type and between the other unlisted types.

Observed (`build-xsl.12.0-extra.out.txt`, case `ac-policy-actions`): in one file, `Method` add, `ac_PolicyAccessItemAttribute` edit, `ad_Type` add, `ac_PolicyAccessItemAttribute` add, `ab_Type` add, then `ac_PolicyAccessItemAttribute` delete, merge, no action and purge, a `Dashboard` add, `mp_PolicyAccessEnvAttribute` add, `mp_MacPolicy` add and `Zebra` delete: the output is `Method`, `Dashboard`, `mp_PolicyAccessEnvAttribute`, `mp_MacPolicy`, then `ab_Type`, the six `ac_PolicyAccessItemAttribute` items in file order (edit, add, delete, merge, none, purge), `ad_Type`, `Zebra`. The case `ac-policy-two-files` shows the order across files (file order inside the type). 14.0.7 gives `Method`, `Dashboard`, the add, `mp_PolicyAccessEnvAttribute`, `mp_MacPolicy`, the edit, `ab_Type`, `ad_Type`, `Zebra`, and drops the delete, merge, no-action and purge items.

The `|`-run quirk of 14.0.7 is the same in the lists of 12.0, with their own names. Registered in `bugs.md`.

[14.35] Both lists have `cui_Control` and `cui_WindowSection` inserted between `Report` and `Form`, in that order (the string is `…|Report|cui_Control|cui_WindowSection|Form|…`); the rest of each list is as in 14.0.7. The test is the same substring test, so the neighbours that count as listed runs change: `Report|cui_Control`, `cui_Control|cui_WindowSection` and `cui_WindowSection|Form` are listed now, and `Report|Form`, which was a listed run in 14.0.7, is not (case `cui-substring-runs`: an add of type `Report|Form` is emitted by G53 in 14.35 and dropped in 14.0.7, an add of type `Report|cui_Control` or `cui_WindowSection|Form` the reverse; `Action|Report` is listed in both). An `edit` of `cui_Control` or `cui_WindowSection` is now emitted by G52, in document order with the other edit-list types (case `cui-edit`: `cui_Control, cui_WindowSection, List, Report` stay in file order, with `Zeta` after them from G53), where 14.0.7 emitted it from G53 sorted by type. Registered in `bugs.md`.

### IMP-023: Attribute tests are exact, and a missing attribute matches nothing

[14.0.7] Every `@type` and `@action` comparison in the groups is a case-sensitive string equality. `list`, `Method` with action `ADD`, and `sql` are different from `List`, `add` and `SQL`. Lower-case `list` and `sql` are not in any list, so G53 emits them (probe `drops`). `@action!='add'` of IMP-026 is true only for an item that has an action attribute with another value: an absent action is neither equal to `add` nor different from it. So an item with no action matches no add, edit or delete group. It is emitted only by G37 to G40 (types `Field`, `Property`, `View`, `SQL`) and by G53 (unlisted types).

[12.0] Same as 14.0.7 (the same tests; observed in the cases `drops` and `typeless-and-bars`).

[14.35] Same as 14.0.7.

### IMP-024: ItemType adds split by the first `implementation_type` child, exactly

[14.0.7] G32 and G33 decide by `string(implementation_type)`: the string value (all descendant text, concatenated) of the first `implementation_type` child element of the `ItemType` item, or the empty string if it has none. The comparison with `polymorphic` is exact: `Polymorphic` and `polymorphic ` (trailing space) are not polymorphic, an `implementation_type` nested inside another child element is ignored, and only the first of two `implementation_type` children counts. The monomorphic group G32 therefore also takes an item with no `implementation_type`. Probe `polymorphic-detail`: `p1 p2 p3 p5` in G32 and `p4 p6` in G33, each in document order.

[12.0] Same as 14.0.7 (case `polymorphic-detail`).

[14.35] Same as 14.0.7.

### IMP-025: RelationshipType adds are ordered by `dependencyLevel` as an XPath number, not-a-number first

[14.0.7] G34 sorts by the number of `@dependencyLevel`, ascending, stable. The conversion is XPath 1.0 `number()` of the attribute string. An absent attribute converts to NaN.

- Accepted: optional whitespace (space, tab, CR, LF) around the number, an optional leading `-`, and digits with an optional `.` and fraction. `5.`, `.5`, `-.5`, `00012` and `-0` are numbers. `-0` and `0` are equal.
- Everything else is NaN: `+5`, `1e3`, `1,5`, `Infinity`, `NaN`, `0x10`, `1 2`, `- 3`, `--3`, `3-`, `1.2.3`, non-ASCII digits and non-ASCII spaces (a no-break space, U+2003 and so on) around the number.
- NaN sorts before every number, and NaNs stay in document order. Equal numbers stay in document order.

Probes `numsort` (two files, `build-xsl.out.txt`, cases 3 and 4). In real packages the attribute holds a small integer (`0`, `1`, `2`) that the exporter writes.

[12.0] Same as 14.0.7 (cases `numsort`).

[14.35] Same as 14.0.7.

### IMP-026: An ItemType or RelationshipType add is followed by every later ItemType sibling that has another action

[14.0.7] The template for an `Item` of type `ItemType` or `RelationshipType` with action `add` copies the item (and its children), and then copies, right after it, each later sibling `Item` of type `ItemType` whose `action` attribute exists and is not `add`. The siblings are taken in document order from the add's own parent, which is the file root for a file item.

This is applied to every such add, however many there are, so one later sibling is copied once for each of them. It applies at any depth: an `Item` of that kind inside `Relationships` of a copied item is handled by the same template, and its later siblings are copied after it inside that same parent. Siblings of other types, and siblings without an `action`, are not copied. For a `RelationshipType` add the later siblings that are copied are likewise of type `ItemType`, not `RelationshipType`.

An example from probe `following-dup`, one file `A(add) B(add) E(edit) D(delete) N(no action) R(RelationshipType add) E2(edit)`: output `A E D E2 B E D E2 R E2`. `A` and `B` each carry copies of `E`, `D` and `E2`, and `R` carries `E2`. `E` and `D` are not otherwise emitted by any group, because each has an earlier add (IMP-027) and `D` is a delete. `N` is dropped (IMP-029). Probe `raw-nested-itemtype`: a nested `ItemType` add followed by a nested `edit` inside `Relationships` yields the `edit` twice inside the copied parent.

Because the later siblings are copied only after an add, an `ItemType` delete is imported when an add precedes it in its file, and never otherwise.

The engine then processes each copy as a separate item (IMP-015), so an `edit` that follows several adds is applied several times.

Registered in `bugs.md`.

[12.0] Same as 14.0.7: the template is the same and the duplicates are the same (cases `following-dup`, `raw-nested-itemtype`). Registered in `bugs.md`.

[14.35] Same as 14.0.7.

### IMP-027: An ItemType edit with no earlier ItemType or RelationshipType add in its file is imported by G35

[14.0.7] G35 selects `ItemType` items with action `edit` that have no earlier sibling (same file root) `Item` of type `ItemType` or `RelationshipType` with action `add`. Such an item is emitted by G35 and by no other group. An `edit` that has an earlier add is emitted only as a copy after an add (IMP-026). Earlier means earlier in the same file, not the same package: an `edit` in a file of its own is always selected. Probe `edit-without-preceding-add`: `E0` (before the add in file 1) and `E-file2` come out at G35, in file order, while `E-after-rt` (after a `RelationshipType` add in file 3) comes out after that add. `D0`, a delete with no earlier add, is dropped.

[12.0] Same as 14.0.7 (case `edit-without-preceding-add`).

[14.35] Same as 14.0.7.

### IMP-028: Items of unlisted types are sorted by type name, in the NLS word-sort order

[14.0.7] G53 sorts the selected items by their `@type` string (the empty string for an absent attribute), ascending, stable. The comparison is `CompareInfo.Compare(a, b, CompareOptions.None)` of the process's current culture; the library fixes that to the order of IMP-030. Items of one type keep their document order, which is file order then position, so an unlisted type's items from several files stay together and in package order.

[12.0] Same as 14.0.7: the same `xsl:sort select="@type"` and the same NLS order (case `sort-types`).

[14.35] Same as 14.0.7. The items of `cui_Control` and `cui_WindowSection` are no longer among the items G53 sorts (`IMP-022`).

### IMP-029: Items that no group selects are dropped without a message

[14.0.7] A file item is written to the output only in these cases, and every other file item is dropped:

- its type is `Field`, `Property`, `View` or `SQL`, with any action or none (G37 to G40);
- its type is not in the unlisted-types list of IMP-022, with any action or none (G53);
- its type and action are one of the pairs the add and special groups name (G01 to G36, G41 to G51): the add of each add-group type, `Form` with `delete`, `mp_MacPolicy` with `mp_PromoteItem`;
- its type is in the edit list of IMP-022 and its action is `edit` (G52);
- it is an `ItemType` with action `edit` that has no earlier add in its file (G35);
- it is an `ItemType` that carries an action other than `add` and follows an add in its file, and then only as a copy after that add (IMP-026).

No error, warning or log line reports a dropped item. The cases that matter in practice:

- any action other than `add` or `edit` on a type in the edit list: `delete`, `merge`, `purge`, `get` and `ADD`. That includes `List`, `Method`, `Form` (other than `delete`), `Morphae` and `RelationshipType`;
- an `ItemType` with no action, with `merge`, `get` and so on, unless it follows an add; and an `ItemType` `delete` unless it follows an add;
- an `mp_MacPolicy` with any action other than `add`, `mp_PromoteItem` and `edit`;
- an item with no action whose type is in the edit list;
- an item whose type counts as listed by the substring test of IMP-022 (`List|Sequence`), whatever its action.

The library reproduces the drop, and `plan import` lists every dropped item with the reason (IMP-033). A correct engine would import the item or report it; this one loses package content silently, so the missing `delete` of a `List` or `Method` is never an error.

Registered in `bugs.md`.

[12.0] The same rule with the groups of IMP-021 and IMP-022. Two differences in what is kept and what is dropped:

- an `mp_MacPolicy` with the action `mp_PromoteItem` is **dropped**, with every other action but `add` and `edit`. In 14.0.7 it is imported (G48). A package that promotes a Mac policy loses the promotion without a message;
- an `ac_PolicyAccessItemAttribute` is **never dropped**: G53 emits it with any action or none (IMP-022).

Every other case is as in 14.0.7 (observed with the case `drops`: the same items are dropped, apart from `prom`). The silent drop is the bug of 14.0.7 and is registered once for both builds.

[14.35] The cases of 14.0.7 and two more: an item of type `cui_Control` or `cui_WindowSection` is written only with the action `add` (G12a, G12b) or `edit` (G52). With any other action, or none (`delete`, `merge`, `purge`, `get`, `ADD`), it is dropped with no message (case `cui-other-actions`: all eight items of the two types are dropped, where 14.0.7 wrote all eight from G53). The two types join the lost-`delete` cases of 14.0.7. Registered in `bugs.md`.

### IMP-030: The NLS word-sort comparison, for the characters of type names

[14.0.7] The order of IMP-028 is the .NET Framework NLS "word sort" with no options. It is not ICU, not `localeCompare`, not code-unit order. The library implements it with sort keys as follows, for the repertoire it covers: U+0020 to U+007E, and U+00C0 to U+00FF without U+00D7 and U+00F7.

A string has one key, a byte string. Characters other than the hyphen `-` (U+002D) and the apostrophe `'` (U+0027) are *weighted characters*; those two are *specials*. The per-character weights are in `fixtures/import-load/nls-word-sort.json`.

- **Primary section P.** For each weighted character in order, its weight pairs (`p`: one two-byte pair, or two pairs for a ligature or expansion such as `æ` (as `ae`), `ß` (as `ss`), `Þ` (as `th`)).
- **Diacritic section D.** One byte per primary pair: the character's `d` byte, or `02` where it has none. Trailing `02` bytes of the whole section are removed.
- **Case section C.** One byte per primary pair: the character's `c` byte (`12` for an upper-case letter), or `02`. Trailing `02` bytes are removed.
- **Extra section X.** Empty for the repertoire.
- **Specials section S.** For each special in order: the two bytes of `0xFFFF` minus *n* (big-endian), where *n* is the number of primary pairs before it, followed by the special's two bytes (`8212` for `-`, `8012` for `'`).

The key is `P 01 D 01 C 01 X 01 S 00`, and two keys compare as unsigned bytes from the first, a shorter key that is a prefix of the other sorting first. A string of specials only has an empty P.

So, among the strings built of `a`, `b` and the specials: `ab` < `ab-` < `a'b` < `a-b` < `a--b` < `-ab`; `a` < `A` (lower case first); `a` < `á` < `b` and `ab` < `aB`; `a b` < `a.b` < `a_b` < `ab`. In printable ASCII the primary order of single characters is the symbols `space ! " # $ % & ( ) * , . / : ; ? @ [ \ ] ^ _ \` { | } ~` (in .NET's own order, not code order), then `+ < = >`, then the digits, then the letters `aA bB cC … zZ` with `-` and `'` being specials rather than symbols. The weight table has the exact values.

Culture. The engine sorts with the thread's `CurrentCulture`. The recorded behaviour is the invariant order, which is also en-IN's (the recording machine), en-US's and de-DE's. The library does not reproduce cultures whose word sort differs (`sv-SE`, `da-DK`, `tr-TR`, and any other that reorders the Latin letters). On those cultures the real engine's order differs from the library's.

Characters outside the repertoire. They also sort by NLS rules in the real engine, but the table of this spec does not cover them. The library refuses to plan an import whose G53 types contain one, with an error that names the type and the character, rather than guess an order. A type name made of ASCII letters, digits, spaces and underscores, which is all that Aras's own item types are, is covered. Extending the table is a variant or fix ticket: record the characters' sort keys with `probe/sk.ps1` and extend `nls-word-sort.json`.

The reference model in `spec/import-load.test.ts` reproduces the order of all 3,195 recorded type names (random strings of the repertoire, with the specials) exactly.

[12.0] Same as 14.0.7: the sort is the same call on the same key, and the same repertoire and the same culture limit apply.

[14.35] Same as 14.0.7.

### IMP-031: Where the order depends on the file system or the sort, it is emulated and not read from the OS

[14.0.7] Two things in this document depend on the .NET platform and are emulated on every OS: the NTFS directory order (IMP-004) and the NLS type sort (IMP-030). The library never calls `readdir` order, `Intl.Collator`, `localeCompare` or `String.prototype.sort` on code units for either. Both rules have recorded vectors, so any host can verify the emulation: `listing-order.json` and `nls-word-sort.json`.

[12.0] Same as 14.0.7.

[14.35] Same as 14.0.7.

### IMP-032: The generic copy template copies elements, attributes and text, and drops comments

[14.0.7] The `*` template copies any element and is the only template other than IMP-026's. It writes the element with its name, its attributes in document order (`copy-of @*`), the namespace declarations of IMP-014, and then the results of applying templates to the element's children:

- an element child is copied by the same rule (so IMP-026 applies to nested `ItemType` and `RelationshipType` adds);
- a text node, including CDATA content, is copied as text. Whether it is written as text or as CDATA is decided by the element it is in (IMP-014);
- a comment and a processing instruction are not copied.

Attributes keep the order in the file, including the stamps (IMP-009) and prefixed attributes (`a:x="1"`). There is no attribute filtering: `tempKeyName` and `tempFullName` stay on the item until `ImportProc` removes them (`IMP-4xx`), and `doGetItem` and the rest are added afterwards.

Probe `raw-namespace-comments-cdata` shows a comment and a processing instruction dropped, an empty element written `<empty />`, a CDATA section split on `]]>`, and an attribute with a namespace prefix kept.

[12.0] Same as 14.0.7: the `*` template is the same (cases `raw-namespace-comments-cdata`, `ns-*`). The only attributes on the item are those of the file and, from IMP-009, `tempKeyName` (no `tempFullName`).

[14.35] Same as 14.0.7.

### IMP-033: The import plan is what these rules produce, as a sequence and a list of dropped items

[14.0.7] `plan import` runs IMP-001 to IMP-032 on the package folders, offline, and reports for each package, in import order (the `MAN-` rules own that order):

- the **sequence**: one entry per item the transform writes, in output order. Each entry has its position, `type`, `action`, `id` (the attributes as written, absent when absent), the group that wrote it (`G01` to `G53`, or `copy of <entry position>` for the duplicates of IMP-026), and its source: the file path, and the item's position in that file. The `tempKeyName` of the stamped item is the file name without extension;
- **repeats**: the entries of IMP-026, each pointing to the add that carries it, so the reader sees which edits and deletes run more than once, and nested copies inside an emitted item;
- the **dropped** items: every file item no group selected and no add carried. Each has its type, action, id, source and a reason that names the check it failed: `action not selected for this type` for a listed type, `ItemType has no action or the action is not edit or add`, `no group selects this type and action`. A file skipped by IMP-008 is listed as skipped, with the warning text;
- the **warnings** of IMP-008 and the failures of IMP-011, in the order they happen, the way the import would log them.

The library produces the sequence and the dropped list from the same code as the import, so the plan never disagrees with the order the import uses. The plan does not call the server and does not check references (`IMP-1xx` do that). It stops at the first load failure, as the import does.

The library model is `planPackage(solutionPath, { engine })` in `src/import/plan.ts`, which returns `ImportPlan`: `sequence` (each entry with `position` from 1, `type`, `action`, `id`, `group` and `source` `{ file, itemIndex, tempKeyName }`, where `itemIndex` counts the file's items from 1 and `tempKeyName` is set only on the first item), `repeats` (each with the item, `carriedBy` the add with its sequence `position` when it has one, and either its own `position` or, for a copy nested in an emitted item, `insideEntry`), `dropped` (item, `reason`, `source`), `skipped` (file and warning) and `warnings` (the log lines in the order written). An engine whose stylesheet is not built yet is refused with `NotSupportedException`. A type name outside the repertoire of IMP-030 is refused with `TypeNameOutsideRepertoireError`, which names the type and the character.

The output format (text and `--json`) belongs to the CLI ticket.

[12.0] Same as 14.0.7, built from the rules of 12.0: the groups of IMP-021 (no G45, no G48), the unlisted `ac_PolicyAccessItemAttribute` of IMP-022 and the drop of `mp_PromoteItem` of IMP-029. A dropped `mp_PromoteItem` is listed with the reason `action not selected for this type`. The source of an entry is the file and the position in it; 12.0 stamps no path on the item, so the plan takes the path from its own listing of the files (IMP-005).

[14.35] The plan names the two extra groups `G12a` and `G12b` and lists the dropped `cui_Control` and `cui_WindowSection` items of `IMP-029` with the reason `action not selected for this type`. Everything else is as in 14.0.7.

## What the import loop does with the order

### IMP-040: Nothing is removed from the dictionary that CImportItems enumerates

[14.0.7] In merge mode `CImportItems.Import` builds `Dictionary<string, List<string>>`, with an initial capacity of the number of `.//Item[@action='add']` nodes. It is filled while walking those nodes in document order: the first add node with a non-empty `id` for a type creates that type's entry, later ones append to its list. Entries and list items are only added; nothing is removed or cleared, and the dictionary is never rebuilt. The `foreach` that follows therefore enumerates the types in the order of their first add node with an `id` (the order .NET's `Dictionary` gives when nothing has been removed), and each type's ids in document order. The library keeps an insertion-ordered map and does not emulate a hash order. The enumeration order decides the order of the per-type `idlist` requests in merge mode (`IMP-3xx`).

[12.0] Same as 14.0.7: `CImportItems.Import` builds the same dictionary the same way (observed in the merge probe, `fixtures/import-merge/12.0-probe/results.json`, cases `M.typeOrderFollowsFirstAdd` and `M.nestedAddsGroupedByType`).

[14.35] Same as 14.0.7: `CImportItems.Import` builds the same `Dictionary` in the same way, and nothing is removed from it.