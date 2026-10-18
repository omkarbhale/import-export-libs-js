# Export post-processing, serialization and file layout

This document specifies what the export does after the XSL transform has produced an item's AML, and how that AML reaches the disk: the post-XSL steps, the output folders and file names, the file-system rules they run into, and the exact bytes of an item file. The rules are `EXP-400` to `EXP-428`.

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`, never committed): `CExportItems.Export` and its helpers, `CItemHelper.ApplyXsl` and the DOM helpers, `ImportExportManager.CreateOutputDir`, `ExportImportBase` and `IOWrapper`;
- offline probes of the vendored 14.0.7 DLL, which call the engine's own methods on small documents and write real files on NTFS: `oracle/export-write-probe/`, recorded in `fixtures/export-write/probe-14.0.7.txt` (probe ids such as `RPM3` below point into it) and `fixtures/export-write/ntfs-upcase-bmp.txt`;
- the .NET XML byte rules measured on .NET Framework 4.8.1 (ticket 06; the writer rules `W1` to `W12` and the transform rules `X1` to `X6` it names are restated here where the export needs them).

Other engines' variants are added by the variant tickets. What happens before the transform is specified elsewhere (fetch requests, pre-XSL rewrites, `export.xsl` itself); the removal of references to unknown packages, which runs between `EXP-407` and `EXP-410`, and the per-item and per-package orchestration, log and messages are specified in their own areas.

All exceptions below are .NET Framework exceptions. Where an exception reaches the log, its message is part of the observable behaviour.

## The post-XSL sequence

### EXP-400: What runs after the transform, and how failures are mapped

[14.0.7] For one exported item, `CExportItems.Export` runs these steps in this order on the item's DOM, once the item's request and pre-XSL rewrites are done:

1. `ApplyXsl(doc, "export.xsl")` (EXP-401).
2. `RemovePermissionIdWhenItMatchesToDefaultPermission` on the whole document (EXP-403).
3. `CdataFilterXml(doc, "condition_xml")` when the exported item's type is `mp_MacPolicy`, then `CdataFilterXml(doc, "implementation_query")` when it is `dr_RelationshipFamily` (EXP-405). The type is the requested item's type name, not the type of any nested item.
4. `ReplaceReferencesToPolyLists` (EXP-407).
5. Removal of references to unknown packages, only when the host chose a removal mode (specified with the unknown-package rules).
6. `RemoveNamespaceNodes` (EXP-410), then `RemoveEmptyRelationships` (EXP-412).
7. The item's type folder is created if it does not exist (EXP-417), and the file is written (EXP-418 to EXP-428). Nothing is written before this step, so a failure in steps 1 to 6 leaves no file for the item (a file of an earlier export of the same name stays).

Every step works on the same DOM object, which is IOM's `PreserveWhitespace = true` document, so whitespace-only nodes that survive the transform stay in it and shape the output (EXP-425).

`XmlException`, `NullReferenceException` and `XPathException` thrown by any step of `Export`, including the pre-XSL steps, become a `CItemException` with faultcode `-1`, faultstring the .NET stack trace (its frames are not reproduced), and faultdetail the exception's message followed by ` Can't export item.` (one leading space). The orchestration area decides how the log shows it. A `CItemException` thrown inside a step (EXP-401) passes through unchanged. Any other exception, such as `ArgumentException`, `IOException` or `UnauthorizedAccessException`, is not mapped: it leaves `Export` as it is.

## ApplyXsl

### EXP-401: The transform output is stripped of one namespace declaration and reloaded into the same DOM

[14.0.7] `ApplyXsl(doc, "export.xsl")` transforms `doc` (the SOAP response envelope, as a DOM) with the compiled `export.xsl` into a string, with an invariant-culture writer. It then removes **every occurrence** of the literal text `xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"` from that string (nothing else, and no space around it is touched), and loads the result into `doc` with `LoadXml`, replacing its content. `doc` keeps `PreserveWhitespace = true`, so the transform output's whitespace-only text nodes become DOM nodes (probe `AX3`).

The string is the transform's serialization (method `xml`, no declaration, no indent). The copied namespace declarations of the transform (`xmlns:SOAP-ENV` on each top-level `Item` copy, and any other namespace in scope, such as `xmlns:i18n` from the envelope) are in it; only the SOAP-ENV one is removed here. `xmlns:i18n` stays on the top-level `Item` until EXP-410 (probes `AX1`, `AX6`).

Failures:

- A null `doc` throws `ArgumentNullException` (parameter `xmlDoc`, so the message ends `Parameter name: xmlDoc`).
- Any exception while loading or running the transform, or while stripping, becomes a `CItemException` (faultcode `-1`) whose faultdetail is the exception's message followed by ` Error of  applying export.xsl.` (one leading space, two spaces after `of`). An unknown stylesheet name is such a failure, with the message `Unable to get 'Aras.Tools.SolutionUpgrade.<name>' from compiled resource. Probably it's not compiled as resource or exist at all.` (probe `AX10`).
- The reload is outside that handler. When the transform produced no element (an input that is not a response envelope, or an envelope with an empty `Result`), `LoadXml` throws `XmlException` with the message `Root element is missing.`, which EXP-400 maps (probes `AX4`, `AX5`). Output that is not well formed fails the same way, with the load error's message. A `]]>` that the transform wrote unescaped (the `FileSelectorTemplate` `reference` case of the transform rules) is such an error: `']]>' is not allowed in character data. Line 1, position <n>.`

The compiled transform is cached for the process. This is not observable.

### EXP-402: The namespace strip also deletes that text from element content

[14.0.7] Because the strip of EXP-401 is a plain string replacement on the serialized output, it also deletes the same text where it occurs inside element text or CDATA: a `method_code` containing `a xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" b` is exported as `a  b`, and a `comments` element holding exactly that text is exported as `<comments></comments>` (an element emptied this way is written `<x></x>`, not `<x />`, because the reload gives it an empty text node; probe `AX1`). Attribute values are not affected, because the serializer writes their quotes as `&quot;`. The port reproduces this.

## RemovePermissionIdWhenItMatchesToDefaultPermission

### EXP-403: A permission equal to the type's default is dropped

[14.0.7] For every element named `Item` that has no namespace, at any depth of the document and in document order, the step looks at the element's **first** direct child named `permission_id` (a second one stays, and so does one nested deeper or spelled in another case; probes `RPM9`, `RPM10`, `RPM13`). With that child `P`:

1. The item's `type` attribute (empty when the attribute is missing) is looked up with `GetItemType` (EXP-045: the request, the cache keyed by request text, and null for any `CItemException`, which is not cached).
2. When the lookup is null, `P` is removed.
3. Otherwise, in the response's `Result` (the `Result` child of the envelope's `Body`, each in the SOAP namespace or none), the first `Item/is_relationship` and the first `Item/use_src_access` are read. Both are read before either is used. When their texts are exactly `1` and `1`, `P` is removed.
4. Otherwise the text of the first `Item/Relationships/Item[@type='Allowed Permission']/related_id/Item[@type='Permission']/id` is compared, ordinally and without trimming, with the text of `P`. When equal, `P` is removed (`" PERM1 "` does not equal `PERM1`; probe `RPM11`).

Removal is `RemoveChild`, so the whitespace nodes around `P` stay and the output keeps a blank line there (probe `RPM17`, and EXP-425). The step visits every item that has a `permission_id`, including items nested in `Relationships` and the `mode="fix"` items the transform adds. The lookups are one request per distinct type, in document order of first use.

A `permission_id` that does not match the default stays, with its attributes (probes `RPM2`, `RPM4`).

### EXP-404: A type without default permission data throws a NullReferenceException

[14.0.7] When the lookup of EXP-403 succeeds but the data is incomplete, the step throws `NullReferenceException` (message `Object reference not set to an instance of an object.`), which EXP-400 maps to a per-item failure:

- the response has no `Item/is_relationship` or no `Item/use_src_access` (probes `RPM7`, `RPM8`), even when the other one is `1`;
- neither of the two is `1` together and the type has no default `Allowed Permission` with a `Permission` `id` (probe `RPM6`).

A relationship type with `is_relationship` and `use_src_access` both `1` never reaches the default-permission comparison, so it passes without a default (probe `RPM5`).

## CdataFilterXml

### EXP-405: The filter_xml text of MAC policies and relationship families is re-wrapped in CDATA

[14.0.7] `CdataFilterXml(doc, name)` visits every `Item` element without namespace, at any depth and in document order. For each one it takes the first direct child named `name` (`condition_xml` or `implementation_query`, EXP-400 step 3) and, with `S` the child's `InnerXml` string (its children serialized without indentation, a CDATA node as `<![CDATA[…]]>`), does the following in order, each `InnerXml =` re-parsing the string it is given into the child's content:

1. If `S` does not contain `<filter_xml><![CDATA[`, every `<filter_xml>` in `S` is replaced by `<filter_xml><![CDATA[` and the result becomes the child's `InnerXml`.
2. If the child's `InnerXml` now does not contain `]]]]><![CDATA[></filter_xml>`, every `</filter_xml>` in it is replaced by `]]]]><![CDATA[></filter_xml>` and the result becomes the child's `InnerXml`.
3. The child's `InnerXml` is set to `WebUtility.HtmlDecode` of its current `InnerXml`.

All matches are literal text (no pattern characters). Step 3 always runs and always re-parses, even when nothing changed; an empty child stays `<name />` (probe `CDF5`).

Both element names use the same code, so for `implementation_query` the `filter_xml` steps rarely match and only step 3 acts.

Vectors (the input is the element's content as XML text, the output the file bytes of that element; each probe `CDF<n>` is in the probe file):

- `CDATA[<filter_xml>a&b</filter_xml>]` (a CDATA node) becomes the two CDATA nodes `<![CDATA[<filter_xml><![CDATA[a&b]]]]><![CDATA[></filter_xml>]]>` in the file, which an import reads back as the text `<filter_xml><![CDATA[a&b]]></filter_xml>` (`CDF1`).
- Text that is already wrapped is unchanged (`CDF2`, `CDF8`).
- Every `filter_xml` pair of one child is wrapped (`CDF6`); a CDATA node followed by text keeps the text (`CDF11`).
- Text whose markup is escaped, `&lt;filter_xml&gt;&lt;a x="1"&gt;t&amp;amp;u&lt;/a&gt;&lt;/filter_xml&gt;`, matches no wrap, and step 3 turns it into real elements `filter_xml > a` (with text `t&u`), which the writer indents (`CDF3`).

### EXP-406: HtmlDecode rewrites entity-like text inside the CDATA and can fail the item

[14.0.7] Step 3 of EXP-405 decodes the `InnerXml` string, which still contains CDATA markers, so it also decodes text that is inside a CDATA section: `&amp;nbsp;` becomes `&nbsp;`, `&#160;` becomes U+00A0, `&lt;b&gt;` becomes `<b>` and `&eacute;` becomes `é` (probe `CDF7`). Plain text that holds a bare `&`, such as `plain &amp; text`, decodes to `plain & text`, and loading it throws `XmlException` (`An error occurred while parsing EntityName. Line 1, position 8.`), which EXP-400 maps to a per-item failure (`CDF10`). `HtmlDecode` decodes the HTML 4 named entities (case-sensitive, plus `&apos;`) and decimal or hexadecimal references in the Basic Multilingual Plane, once; it leaves astral references, unknown names and references without `;` as they are. The port reproduces this.

## ReplaceReferencesToPolyLists

### EXP-407: A list property whose data source is a polymorphic ItemType is written as a List lookup

[14.0.7] The step first gets the poly-type names (EXP-408), then selects every `Item` that has type attribute `Property` and a child `data_type` equal to `list`, being a direct child of a `Relationships` element that is itself a child of an `Item` (any depth, no namespace; a Property outside `Relationships` is ignored, `RPL11`). For each one, in document order:

1. `data_source` is its first direct child of that name. Its `keyed_name` attribute is read. A missing `data_source` or `keyed_name` attribute throws `NullReferenceException`, which EXP-400 maps (probes `RPL4`, `RPL5`).
2. The property is changed only when the `keyed_name` is not blank (trimmed length above zero) and equals, ordinally and case-sensitively, one of the poly-type names (`RPL3`, `RPL6`).
3. A changed property gets a new `data_source` in place of the old one: the element has the single attribute `keyed_name` with the same value, and one child `Item` with attributes `type="List"`, `action="get"`, `select="id"`, `page="1"` and `pagesize="1"` (in that order), whose one child `name` has the `keyed_name` value as text (`RPL1`, `RPL8`). The old element, with every attribute it had and its text, is gone. Only the first `data_source` of a property is replaced (`RPL11`).

The new nodes carry no whitespace. In a document with whitespace nodes (EXP-425) the replaced block is written inline (`RPL12`). Properties whose `data_type` is not `list`, or whose `Item` is not a `Property`, are never touched (`RPL10`).

### EXP-408: The poly-type names are fetched when the first item reaches this step

[14.0.7] `GetPolytypeNames` (EXP-046) is called at the start of `ReplaceReferencesToPolyLists`, before any property is looked at. Because the step runs for every exported item, the first item of any type triggers the fetch, even when it has no list property, and a failure of the fetch fails that item here (a `CItemException`, which EXP-400 passes through).

### EXP-409: After a failed fetch this step converts nothing for the rest of the process

[14.0.7] The latched empty list of EXP-047 makes every later call of this step find no poly-type names, so no `data_source` is replaced (EXP-407, step 2) and the items are exported with their references to polymorphic types unconverted. The bug is registered once, as EXP-047.

## RemoveNamespaceNodes

### EXP-410: Prefixed attributes are removed from Item elements

[14.0.7] For every element named `Item` that is in no namespace, at any depth, every attribute whose prefix is not empty after trimming is removed. That includes namespace declarations with a prefix (`xmlns:i18n`, `xmlns:SOAP-ENV`) and `xml:lang` or `xml:space` on the `Item`, and attributes in any other namespace. It does not remove unprefixed attributes, nor `xmlns="…"` declarations (the prefix of a default declaration is empty), nor attributes of other elements (`<name xml:lang="de">` stays, probe `RNN6`).

An `Item` in a namespace, for example under a default `xmlns="urn:x"` of its own or an ancestor's, is not matched at all and keeps every attribute (`RNN1`, `RNN2`). The same holds for `x:Item`. The attributes are collected first and then removed, so attribute order of the rest is unchanged (`RNN3`, `RNN5`).

In practice this removes the `xmlns:i18n` declaration that the transform copied onto each top-level `Item` (EXP-401). Whitespace and element layout are not touched.

### EXP-411: The test for "no prefix" is dead code

[14.0.7] The removal condition is "the prefix is null, or the prefix trimmed is not empty". .NET reports an unprefixed attribute's prefix as the empty string, never null, so the first half is never true, and only the second half acts. The effect is the rule of EXP-410: namespace declarations with a prefix go, `xmlns=""` and plain attributes stay. The port reproduces the effect, and does not strip unprefixed attributes.

## RemoveEmptyRelationships

### EXP-412: Relationships elements with no child element are removed

[14.0.7] The set of every `Relationships` element in no namespace, at any depth, that has **no child element** is selected once, before any removal. Each is removed from its parent. A `Relationships` that has only whitespace, text, a comment or CDATA also has no child element, so it is removed with that content (probe `REL4`). Removing does not cascade: a `Relationships` that becomes empty because its only item's own `Relationships` was removed stays (`REL3`). A `Relationships` in a namespace (`p:Relationships`) is not matched (`REL9`).

The parent keeps what it had: when it held nothing else it becomes `<Item type="a"></Item>` (an open and close tag) because it was not empty when parsed, not `<Item … />` (`REL1`, `REL2`, `REL8`). The whitespace nodes next to the removed element stay, so a document with whitespace nodes keeps a blank, indented line there (`REL6`, EXP-427). A null document throws `ArgumentNullException` with parameter `doc`.

## Output layout

### EXP-413: Standard packages are the Aras core and default packages

[14.0.7] A package is standard when it is a default package or a core package:

- default: its name starts with `com.aras.defaults.` compared ignoring case;
- core: its name starts with `com.aras.innovator.` and does not start with `com.aras.innovator.solution.`, both compared with the current culture's case-sensitive comparison.

So `com.aras.defaults` (no final dot) and `com.aras.innovator` are not standard, `COM.ARAS.DEFAULTS.x` is, `COM.ARAS.INNOVATOR.core` is not, and `com.aras.innovator.solution` and `com.aras.innovator.solutionX` (no dot after `solution`) and `com.aras.innovator.Solution.PLM` (a capital S) are core and therefore standard (probe `STD`). A null name throws `NullReferenceException`.

The culture-sensitive comparison also ignores some code points, such as U+00AD (`com.aras.innov\u00ADator.x` is core). The port compares ordinally, which differs only for such names; it does not reproduce the ignorable code points.

### EXP-414: The package folder is named by the package's last segment unless the package is standard

[14.0.7] `CreateOutputDir(packageName)` computes a relative part and joins it to the working directory:

- for a standard package, the package name with every `.` replaced by `\` (`com.aras.innovator.core` → `com\aras\innovator\core`; the case of the name is kept);
- for any other package, the last segment followed by `\Import`. The last segment is the longest run of characters other than `.` at the very end of the name (a regular expression `([^\.]+)$`, so a trailing `.` or an empty name gives an empty segment). So `com.aras.innovator.solution.PLM` → `PLM\Import`, `a.b.` → `\Import`, `a..b` → `b\Import`, and a name without a dot is its own segment.

The result is the working directory, a `\`, and the relative part, with no separator logic: a working directory that ends in `\` gives a doubled separator, which the operating system collapses, and a relative working directory gives a relative path (probes `COD`, `COD2`, `COD3`). An empty last segment makes the folder `<working directory>\Import`. Segments follow the file-system model of EXP-420: a `/` in a name makes nested folders, a trailing space, `:` or a control character fails there (EXP-420).

The result is the folder the package's items are written into: it becomes the helper's `Folder` for the package's export (the orchestration area specifies the call order).

### EXP-415: An existing package folder is deleted recursively before it is created again

[14.0.7] If the folder of EXP-414 exists (a case-insensitive match, EXP-420), it is deleted with all its content, recursively and without any check of what it holds, and then created empty. A folder with other files, subfolders or a manifest in it loses them (probe `COD`, `-- wipe test`). The folder's name is then spelled as the new request spells it: wiping `…\Core` for `com.aras.innovator.core` leaves `…\core` (probe `case-insensitive wipe`). Only the leaf folder is deleted; its parents and siblings stay.

A read-only file in the folder makes `Directory.Delete` throw `UnauthorizedAccessException` (`Access to the path '<file name>' is denied.`), and so does any other file the process cannot delete; the exception is not mapped (EXP-400). When a file, not a folder, has the folder's name, creating it throws `IOException` (`Cannot create "<path>\" because a file or directory with the same name already exists.`, probe `FILEDIR`).

### EXP-416: Packages with the same last segment wipe each other's output

[14.0.7] Because EXP-414 reduces every non-standard package to its last segment, two packages such as `com.x.PLM` and `org.y.PLM` share the folder `PLM\Import`. The folder is created, wiped and recreated for each package in turn (EXP-415), so the second package's export deletes the first package's files. The same happens for standard packages that differ only in case, and between a referenced package's export and a main package of the same last segment. Nothing warns of it, and the manifest still lists both packages. The port reproduces this.

### EXP-417: Item files go into a folder named by the item's type

[14.0.7] An item is written to `<Folder>\<typeName>\<file name>`, where `<Folder>` is the package folder (EXP-414), `<typeName>` is the exported item's type name exactly as requested, and the file name is EXP-418. The type folder is created when `DirectoryExists` of `<Folder>\<typeName>\` is false, with `CreateDirectory` (which creates missing parents). The type name is not sanitized:

- the case of an existing folder is not changed: types `Method` and `METHOD` use one folder (spelled by whichever was created first);
- `/` and `\` start nested folders (`a/b`);
- an empty type name writes the files straight into `<Folder>\`, `.` does the same, and `..` writes into the parent of `<Folder>`;
- a trailing `.` is ignored by the operating system (`Dot.` is `Dot`);
- a type name ending in a space makes `CreateDirectory` create the folder without that space and the following write fail with `DirectoryNotFoundException` (`Could not find a part of the path '<Folder>\<type> \<file>'.`);
- `:` in a name throws `NotSupportedException` (`The given path's format is not supported.`) and any of `" < > |`, `*`, `?` or a control character throws `ArgumentException` (`Illegal characters in path.`);
- a folder named `NUL` cannot be written to (`DirectoryNotFoundException`), but `CON`, `aux` or `LPT1` work as folder names.

Real ItemType names are identifiers, possibly with spaces. The exceptions are `IOException` or `SystemException` classes, not `CItemException`, so EXP-400 does not map them (probes `TW`).

### EXP-418: The file name is the keyed name, or the requested id when the keyed name cannot be a file name

[14.0.7] The file name is `<name>.xml`. `<name>` is the item's keyed name, except that it is the item's id name (the id the item was requested with, before any config id or current-version resolution) when the keyed name is null or empty, or contains any character of `Path.GetInvalidFileNameChars()`: `"`, `<`, `>`, `|`, the characters U+0000 to U+001F, `:`, `*`, `?`, `\` and `/`. A keyed name made of spaces, or with leading or trailing spaces or dots, is valid as it stands (` .xml`, `..xml`). The id name is used without any check. Because `.xml` always ends the name, the file name never ends in a space or dot, so the stripping of trailing spaces and dots of EXP-420 does not apply to files.

## Duplicates and the Windows file-system model

### EXP-419: A file with the same name as an earlier one is overwritten silently

[14.0.7] The engine never checks whether the file exists. The writer truncates and rewrites it (EXP-423), so when two items of one type and package have the same file name, the later one replaces the earlier one, and only its file remains. Names collide under EXP-420, which compares case-insensitively: `y.XML`, `y.Xml` and `Y.xml` are one file, which keeps the spelling of its first creation (`y.XML`) and the content of the last write (probe `T1`). Items with the same keyed name and different ids are typical, such as items with the same name of different configurations. The export reports each as successfully exported. The port reproduces this.

### EXP-420: The port applies Windows file-system rules on every OS

[14.0.7] The engine runs on Windows and NTFS, and the library reproduces its observable result on every OS (round 1, Q5). So the port resolves every path of EXP-414 to EXP-419 and EXP-423 as a Windows path, with these rules, before it maps the result onto the host file system. These are the rules that were measured; the exceptions are the .NET exception classes and messages the engine's caller sees.

- **Separators.** `\` and `/` both separate path segments. Empty segments are dropped (`a\\b` is `a\b`). A segment `.` is the same folder and `..` is the parent.
- **Trailing dots and spaces.** A trailing `.` of any segment is removed (`Dot.\` is `Dot\`, `dot..` is `dot`). A trailing space of the last segment is removed. A segment that ends in a space and is followed by a separator is not trimmed: creating the folder makes the name without the space, but the later write to the path with the space fails with `DirectoryNotFoundException`. A file name that ends in a space, dot or both is stored without them (`tr.xml ` and `tr.xml.` are `tr.xml`), which cannot happen for item files (EXP-418).
- **Invalid characters** in a path throw as in EXP-417.
- **Case.** Names are compared case-insensitively, with the volume's NTFS upcase table, applied per UTF-16 code unit (a surrogate pair is never folded, and Unicode normalization forms `é` and `e` + U+0301 are different names). The table of the Windows 10 volume the probe ran on is in `fixtures/export-write/ntfs-upcase-bmp.txt`: 973 code units that fold onto another one, `XXXX ~ YYYY` meaning that `XXXX` and `YYYY` collide, over U+0020 to U+FFFF. It differs from JavaScript's `toUpperCase`: for example U+00B5 (µ) and U+039C (Μ), U+0131 (ı) and `I`, U+017F (ſ) and `S`, U+212A (K) and `k`, U+03C2 (ς) and Σ, and `ß` and `ẞ` do not collide on NTFS, and U+1F88 and U+1F80 do (27 Greek titlecase pairs that `toUpperCase` does not fold). A volume formatted by another Windows version can have a different table, so the port carries this table as data and does not use the host's case mapping. When a case-insensitive match exists, the existing spelling is kept.
- **Reserved names.** A file named `<device>.xml` is an ordinary file. A bare device name as a file cannot occur (EXP-418). As a folder name, `NUL` fails and `CON`, `aux` and `LPT1` do not (EXP-417).
- **Length.** A path segment longer than 255 UTF-16 code units throws `PathTooLongException` (`The specified path, file name, or both are too long. The fully qualified file name must be less than 260 characters, and the directory name must be less than 248 characters.`), and so does a path given to the engine with 259 characters or more (EXP-421). A path under that limit is written even when its full path is over 300 characters.

The directory listing order that import relies on is specified with import and is not part of this rule.

## NormalizeLongPath

### EXP-421: Every file-system call goes through NormalizeLongPath

[14.0.7] `IOWrapper` passes the path of each call it makes (`DirectoryExists`, `DirectoryCreateDirectory`, `DirectoryDelete`, `XmlDocumentSaveWithSettings`, the manifest, log and other readers and writers) through `NormalizeLongPath` first:

1. A null or empty path is returned as it is.
2. Every leading `\` and `?` character is removed from the path (`TrimStart` of the character set `\` and `?`), giving the trimmed path.
3. `Path.GetFullPath` of the trimmed path gives the full path. It resolves relative paths against the process's current directory, resolves `.` and `..`, turns `/` into `\` and throws for illegal input: `ArgumentException` (`The path is not of a legal form.`) when nothing is left (`\\?`, `\\`, `?`), `PathTooLongException` (EXP-420) and the exceptions of EXP-417.
4. When the full path is 255 characters or longer, the result is `\\?\` followed by the full path. Otherwise the result is the **trimmed path**, not the full path (so `.\x\y.xml`, `x\y.xml`, `C:/a/b.xml` and `C:\a\..\b` are returned as given).

Probes `NLP`, `NLPB`, `NLPT`, `NLPL` (the relative rows were run from a work folder whose path is about 55 characters): an absolute path whose full path is 254 characters is not prefixed, and one of 255 to 258 characters is (the result is 4 characters longer). The prefix is added to the full path, so a relative path of 254 characters or more is prefixed once the current directory is added. `Path.GetFullPath` throws `PathTooLongException` for an **input** (the trimmed path) of 259 characters or more when it is absolute, and of 258 or more when it is relative, however short the full path would be. So the prefix only ever helps for inputs shorter than that, and the engine cannot write a path given with 259 or more characters on this runtime. The limit belongs to the runtime the probe ran on (.NET Framework 4.8.1 under Windows PowerShell 5.1); a host application that opts into long paths may behave differently.

A path written `\\?\C:\a\b` or `\?\C:\a` is returned as `C:\a\b` and `C:\a`.

### EXP-422: A UNC path loses its leading backslashes and becomes relative

[14.0.7] Step 2 of EXP-421 removes the two leading backslashes of a UNC path, so `\\server\share\dir\f.xml` is returned as `server\share\dir\f.xml`, a relative path. The engine then opens it against the process's current directory, so an output folder or manifest given as a UNC path is read from or written to `<current directory>\server\share\…` instead (probes `NLP`, `NLPU`, `UNCW`: the write fails or lands in the wrong place). `\\?\UNC\server\share\f.xml` becomes `UNC\server\share\f.xml` the same way. When the full path (after resolving against the current directory) is 255 characters or longer, the prefixed result is built from that resolved path. The port reproduces this on Windows-style paths: a path that starts with `\\` is resolved relative to the working directory.

## The item file

### EXP-423: The item file is written with a BOM through an indenting XmlWriter

[14.0.7] `XmlDocumentSaveWithSettings(doc, path)` (the path is normalized by EXP-421) opens a `StreamWriter` on the path with `append: false`, which creates the file or truncates an existing one, with the encoding UTF-8 plus BOM (`EF BB BF`). It creates an `XmlWriter` on it with `Indent = true`, `IndentChars = " "` (one space) and `OmitXmlDeclaration = true`, and every other setting default: new line characters `\r\n`, new line handling `Replace`, new lines on attributes off. It then calls `XmlDocument.Save` with that writer, and disposes the writer and the stream. The file is the BOM followed by the document's serialization. There is no XML declaration and no newline after the root's end tag.

The same writer settings and encoding are the only ones used for item files; the document is the DOM of EXP-400.

### EXP-424: Text, attributes, line breaks and empty elements

[14.0.7] The writer follows these rules, measured on .NET Framework 4.8.1:

- **Indentation unit:** one space per nesting level, with `\r\n` before each indented element, comment or processing instruction.
- **Text:** `&` is written `&amp;`, `<` `&lt;` and `>` `&gt;` (so `]]>` becomes `]]&gt;`). `"`, `'` and the tab character stay as they are. Each LF, CR or CRLF in text becomes `\r\n`.
- **Attributes:** always double-quoted, in DOM order, with namespace declarations in the order the DOM holds them. `&` is `&amp;`, `<` `&lt;`, `>` `&gt;` and `"` `&quot;`. Tab, LF and CR are written `&#x9;`, `&#xA;` and `&#xD;` (upper-case hexadecimal), so CRLF is `&#xD;&#xA;`. `'` stays.
- **Empty elements:** an element whose `IsEmpty` flag is true is written `<x />` (a space before the slash). An element without children and with the flag false is written `<x></x>`. The DOM remembers which form was parsed.
- **Non-ASCII** text and attribute values are written as the UTF-8 bytes of the characters, never as references (U+00A0, U+0085, U+2028, astral characters and U+FFFD included).

Example: `<AML><Item type="Method" id="ABC" action="add"><name>x</name><e/><e2></e2><e3 a="1"/></Item></AML>` is written as the BOM and `<AML>\r\n <Item type="Method" id="ABC" action="add">\r\n  <name>x</name>\r\n  <e />\r\n  <e2></e2>\r\n  <e3 a="1" />\r\n </Item>\r\n</AML>` (`\r\n` being the two bytes).

After EXP-401 every element the transform wrote without content is `<x />`; `<x></x>` in a file comes from an element that got an empty text node in the transform, from the strip of EXP-402, or from the post-XSL steps (EXP-427).

### EXP-425: Mixed content stops the indentation for the rest of its element

[14.0.7] When the content of an element holds a text node, a whitespace-only node, a significant-whitespace node or a CDATA node, the writer stops indenting from that node on, for the rest of that element's content and its descendants. The children already written stay indented. The element's end tag then follows without a line break or indent. Siblings and ancestors are not affected. Whitespace nodes are written as they are, except that their line breaks become `\r\n`. This is how a response's whitespace, kept in the document (EXP-400), reaches the file.

- `<AML><Item type="a"><name>x</name>\n<b/><c><d/></c></Item><Item type="b"><c/></Item></AML>` is written `<AML>\r\n <Item type="a">\r\n  <name>x</name>\r\n<b /><c><d /></c></Item>\r\n <Item type="b">\r\n  <c />\r\n </Item>\r\n</AML>`.
- A whitespace node directly under the root unindents the whole file: `<AML> <Item type="a"><name>x</name></Item><Item type="b"><c /></Item></AML>`.
- An already pretty-printed source keeps its own whitespace, re-terminated as `\r\n`; the writer's one-space indent does not appear.
- An element with only text is written on one line (`<c>only</c>`, `<a> </a>`), and an element after text in its parent is indented but the text and what follows are not: `<d><e/>tail</d>` becomes `<d>\r\n  <e />tail</d>`.

Removing a node in a post-XSL step leaves its neighbouring whitespace nodes in place, so the result can hold a line with only indentation: after the removal of `permission_id` (EXP-403) the item is `<Item …>\r\n  <name>n</name>\r\n  \r\n </Item>` (probe `RPM17`).

### EXP-426: CDATA, comments, processing instructions and document-level nodes

[14.0.7]

- **CDATA** is written as `<![CDATA[…]]>`, with LF, CR and CRLF in the body written as `\r\n`. An empty CDATA node stays `<![CDATA[]]>`. Adjacent CDATA nodes stay separate. A body that contains `]]>` (only possible when the DOM was built by code or by EXP-405) is split as `]]]]><![CDATA[>`. A CDATA node counts as content for EXP-425.
- **Comments and processing instructions** in element-only content are written on their own indented line, like elements, and do not stop the indentation.
- **Document level:** a DOM that holds an XML declaration node would write it (a declaration cannot exist after EXP-401); whitespace after the root element is written, with its line breaks as `\r\n`, but the transform output has none.

### EXP-427: Nodes the post-XSL steps create or change keep or lose their empty flag as the DOM does

[14.0.7] The post-XSL steps change the DOM with .NET DOM calls, and each decides the empty-element form (EXP-424):

- a new element has the flag true and is written `<x />`; one that is given text is written `<x>text</x>`;
- setting `InnerText` to an empty string on an element that was parsed as `<p/>` leaves `<p></p>`;
- setting `InnerXml` to an empty string gives `<x />`;
- removing a node's last child leaves the parent's flag unchanged, so a parent that had content becomes `<x></x>` (EXP-412);
- removing all children keeps the element's previous flag.

### EXP-428: An error while writing leaves a partial file

[14.0.7] The file is created before the document is serialized, and the writer is disposed in a `finally`, so a serialization failure keeps what was written until then. A character reference to a lone surrogate (`&#xD800;`) loads fine, and when the file is written it throws `ArgumentException` (`The surrogate pair (0xD800, 0x79) is invalid. A high surrogate character (0xD800 - 0xDBFF) must always be paired with a low surrogate character (0xDC00 - 0xDFFF).`, the second number being the following character): the file then holds the BOM and the text written before the failing node, here `<AML>\r\n <Item type="a">\r\n  <name>` (36 bytes, probe `SUR`). The exception is not a `CItemException`, so EXP-400 does not map it; it leaves `Export`.
