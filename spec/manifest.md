# Manifest, package ordering and package paths

This document specifies `imports.mf`, the manifest that export writes and import reads: its format, how it is read and saved, the lookups the engine makes in it, the order in which import processes packages, and how a package's folder is found. It also specifies .NET's `Hashtable` enumeration order, which decides the order of every table the engine builds.

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`): `ManifestFile`, `ExportImportBase`, `IOWrapper` and `ImportExportManager.GetSolutionPath`, never committed;
- probes of the real 14.0.7 `Libs.dll` on Windows PowerShell 5.1 (.NET Framework 4.8.1), recorded in `fixtures/manifest/14.0.7/probes/` with their scripts. Where a rule gives a result "observed" or lists vectors, they are in those files;
- the .NET XML byte rules of the XML core (reading, `Save`): item-file and manifest writer results, BOM sniffing and parse rules.

Names follow the C# members (`GetPackageNamesInImportOrder`) so that `source-map.json` can point at them. "The engine" means 14.0.7's `Libs.dll`. Strings in rules are written as they appear on the wire or in the file; `\` in a path is one backslash.

The `[12.0]` variants cover what the export reaches and the manifest class itself: the 12.0 reader (`XmlDocument.Load`, ticket 06 R8), the lack of path normalisation, and unchanged code elsewhere. They come from the 12.0 decompile (`.decomp/12.0/`) compared method by method with 14.0.7's. `GetPackagePath` and the ordering rules are identical in both builds. How the import side uses these rules in 12.0 is the import variants' business (ticket 47).

## The manifest

### MAN-001: The manifest vocabulary

[14.0.7] A manifest is an XML document whose root element is `imports`. The engine reads and writes only these elements, in this nesting:

```xml
<imports>
  <package name="com.aras.innovator.solution.PLM" path="PLM\Import">
    <dependson name="com.aras.innovator.core">
      <referenced_element id="ABC" type="ItemType" descr="Part" />
    </dependson>
    <dependson name="com.aras.innovator.admin" />
  </package>
  <package name="com.aras.innovator.core" path=".\" />
</imports>
```

- `package` has `name` and `path`. Export writes both (MAN-010). Import reads `name` to find the package and `path` to find its folder (MAN-030).
- `dependson` (child of `package`) has `name`, the name of a package this one depends on. Its children are the dependency's referenced elements.
- `referenced_element` (child of `dependson`) has `id`, `type` and `descr`: the id, ItemType name and keyed name of an item the package uses from the dependency.

Everything is matched by exact, case-sensitive element and attribute names, only as a direct child at that level, in no XML namespace. A `Package` or `PACKAGE` element, a `package` nested inside another element, a `dependson` nested inside another element, and every element of a document with a default namespace (`xmlns="urn:x"`) are all invisible to the engine. Other elements, attributes and comments are ignored on reading. List results come back in document order.

The engine is not validating: a manifest with another root name loads. Reads then find nothing (every lookup is the relative path `imports/package…` from the document, MAN-015), and a write appends to the document element whatever its name is (MAN-010). A `package` or `dependson` element without a `name` attribute makes the lookups that read the attribute throw `System.NullReferenceException` (MAN-015, MAN-020).

[12.0] Same as 14.0.7.

## Creating, reading and saving

### MAN-002: A new manifest is an empty `imports` document

[14.0.7] `new ManifestFile()` creates a new `XmlDocument` and loads `<imports/>` into it. Export builds its manifest this way, and so does the language-pack preprocessor for its temporary one. The document has no XML declaration and does not preserve whitespace.

[12.0] Same as 14.0.7.

### MAN-003: A manifest is read with ReadAllText and LoadXml

[14.0.7] `new ManifestFile(path)` takes the path through the file-system normalisation (MAN-004), reads the whole file with `File.ReadAllText`, and loads the text into a new `XmlDocument` with `LoadXml`. The reading rules are the XML core's, which are fixed by the .NET behaviour:

- the encoding is chosen by byte-order mark: UTF-8, UTF-16 and UTF-32 marks (either order) are detected and dropped, and no mark means UTF-8. The `encoding=` declaration is ignored for decoding. Bytes that are not valid UTF-8 become U+FFFD without an error (IMP-007 gives the count per sequence);
- whitespace-only text nodes are dropped (the document does not preserve whitespace), as IMP-018 says;
- a raw control character other than tab, CR and LF makes `LoadXml` throw `System.Xml.XmlException`; a malformed document throws one too, with the message and position of IMP-017.

A leading XML declaration or DOCTYPE in the manifest is accepted (nothing concatenates the text, unlike a package item file).

Failures are .NET exceptions that reach the caller unchanged. Observed: a path that does not exist throws `System.IO.FileNotFoundException` with the message `Could not find file '<full path>'.`; one whose folder does not exist throws `System.IO.DirectoryNotFoundException` with `Could not find a part of the path '<full path>'.`; an empty file throws `System.Xml.XmlException` with `Root element is missing.`; `<imports><package></imports>` throws one with `The 'package' start tag on line 1 position 11 does not match the end tag of 'imports'. Line 1, position 21.`; an empty path throws `System.ArgumentException` with `Empty path name is not legal.`; a null path throws `System.ArgumentNullException` with `Value cannot be null.\r\nParameter name: path`.

The engine reads the manifest only through this constructor and `ImportExportManager`'s own load of the same file. Import's manager constructor creates the `ManifestFile` only when the manifest path is not empty and the file exists (the import-run rules own that call).

[12.0] `new ManifestFile(path)` creates a new `XmlDocument` and calls `Load(path)`: the file is read by the XML reader, not by `File.ReadAllText`, and the path is not normalised (MAN-004). The reader differs from 14.0.7's (ticket 06, R8):

- it **honours the encoding declaration**: Windows-1252 bytes with a `windows-1252` declaration decode correctly;
- invalid UTF-8 **throws** `System.Xml.XmlException` (`Invalid character in the given encoding`) instead of giving U+FFFD;
- a UTF-16 file without a byte-order mark is detected, and `encoding="utf-16"` over UTF-8 bytes throws `There is no Unicode byte order mark. Cannot switch to Unicode.`;
- whitespace-only nodes are dropped and the other parse rules are as in 14.0.7.

The failures of a missing file or folder, an empty file, an empty path and a null path are the .NET exceptions of 14.0.7, with the path as the engine got it. `ImportExportManager`'s own load of the same file is the same call. `GenerateHashtableFromManifest` (ticket 66) reads the manifest the same way, with `File.Exists` and `Load` on the raw path.

### MAN-004: Every file-system operation first normalises the path

[14.0.7] `IOWrapper.NormalizeLongPath(path)` is applied to the path of every file-system operation the engine makes: reading and saving the manifest, reading package folders, creating and deleting folders, opening the log and writing item files. For a null or empty path it returns the path as is. Otherwise:

1. it removes from the start of the path every leading character that is `\` or `?` (it calls `TrimStart` with the characters of `\\?\`, not with that string as a prefix);
2. it computes the full path of the result against the process's current directory (`Path.GetFullPath`), which throws for a path that is empty or only white space, tab included (`System.ArgumentException`, `The path is not of a legal form.`), for a path with a character below U+0020, or `"`, `<`, `>`, `|`, `?` or `*` (`System.ArgumentException`, `Illegal characters in path.`), and for a `:` anywhere but as the second character after a drive letter (`System.NotSupportedException`, `The given path's format is not supported.`). It also throws `System.IO.PathTooLongException` for a trimmed path of 259 characters or more when it is absolute and 258 or more when it is relative, however short the full path would be (EXP-421). The full path folds `/` into `\`, resolves `.` and `..`, turns `X:rest` into the current directory of drive `X` (the root of `X` with the letter in upper case when `X` is not the current drive), and drops trailing dots and spaces of the whole path and trailing dots of a segment (probed, `GetFullPath` on the oracle host: `C:\a.\b` is `C:\a\b`, `C:\a \b` is unchanged);
3. when the full path is 255 characters or longer it returns `\\?\` followed by the full path; otherwise it returns the trimmed path from step 1, not the full path.

Observed: paths of 240 to 256 characters save and read; `?` and `\\?\` prefixes before a drive path are stripped and work; a relative path resolves against the current directory.

The port applies this on Windows. On other platforms there is no counterpart: paths are used as the host gives them (MAN-033).

[12.0] Not present. No path is normalised: every file-system operation of the manifest, the package folders and the log takes the path as built (EXP-421). The `.NET` exceptions for an illegal path come from the file functions themselves.

### MAN-005: Paths that start with `\` lose it, so UNC and drive-less paths break (bug)

[14.0.7] Step 1 of MAN-004 removes every leading backslash, so a path that starts with `\` becomes relative:

- a UNC path `\\host\share\dir\imports.mf` becomes `host\share\dir\imports.mf`, relative to the current directory;
- a path on the current drive such as `\Users\me\imports.mf` becomes `Users\me\imports.mf`.

Reading or saving then fails with `System.IO.DirectoryNotFoundException`, `Could not find a part of the path '<current directory>\host\share\…'.`, or silently uses a different file when a folder of that name exists below the current directory. The same happens to a package path in the manifest that is UNC or starts with `\` (MAN-030). A drive path works. Registered in `bugs.md`.

[12.0] Not present. A path that starts with `\` is handed to the file functions as it is, so UNC package folders and drive-less paths work. The bug is 14.0.7's only.

### MAN-006: Save writes the document with `XmlDocument.Save(path)`

[14.0.7] `ManifestFile.Save(path)` normalises the path (MAN-004) and calls `XmlDocument.Save(path)`, which overwrites the file. For a document made by `new ManifestFile()`:

- no byte-order mark and no XML declaration;
- two spaces of indentation per level, CR LF line breaks, and no line break after the last tag;
- an element without children is written `<x a="1" />`, with a space before `/>`: an empty manifest is `<imports />`, a `dependson` without elements is `<dependson name="x" />`;
- attributes keep the order they were created in (MAN-010, MAN-012, MAN-013), in double quotes. The legacy writer escapes `&` as `&amp;`, `<` as `&lt;`, `>` as `&gt;` and `"` as `&quot;`, writes `'` and tab as they are, LF as `&#xA;` and CR as `&#xD;`, and writes non-ASCII characters raw in UTF-8.

The vectors for these rules are the XML core's (a name with `&`, quotes, a line break and a non-ASCII character in `descr`). Reading a manifest the engine wrote and saving it again gives the same bytes.

If the document was loaded from a file that began with an XML declaration, `Save` keeps the declaration, writes the declared encoding with a byte-order mark (`utf-8` gives `EF BB BF`, `utf-16` gives `FF FE` and UTF-16LE text), and replaces a tab indentation with the two-space one. The declaration is written as it was read: `encoding="UTF-8"` keeps its case, `standalone` stays, and one without `encoding` is written without it and leaves the file in UTF-8 without a byte-order mark. `windows-1252`, `iso-8859-1` and `us-ascii` (any case) give single-byte text without a mark, with `?` for a character the code page lacks; the port refuses any other encoding name with `NotSupportedException`. No engine path loads a manifest and saves it again, so this is reachable only by a host that does so.

The legacy writer treats content that an engine manifest never holds as follows (probed, `fixtures/xml-core/vectors.json`, cases `2.*`): a comment or processing instruction is indented like an element; text, CDATA and white space are written as they are, with no indentation in their element and in everything below it, and `</x>` follows them directly; an element that holds no text is closed on a line of its own, so `<e></e>` is `<e>` and `</e>` on two lines at the indentation of `e`; a white space node of a document that preserves white space is written as it is, with no indentation added at all; a DOCTYPE is `<!DOCTYPE name[]>` and the root follows on the next line; a CDATA section that contains `]]>` throws `ArgumentException`.

Failures are the .NET exceptions of the file system, observed: a missing folder is `System.IO.DirectoryNotFoundException`, an empty path `System.ArgumentException` (`Empty path name is not legal.`), a null path `System.ArgumentNullException` (`Path cannot be null.\r\nParameter name: path`).

[12.0] `ManifestFile.Save(path)` calls `XmlDocument.Save(path)` on the raw path (no normalisation). The bytes are the same as in 14.0.7: the writer is the same call. Failures are the file functions' exceptions.

## Writing the manifest

### MAN-010: AddPackage adds a package once, with a derived path

[14.0.7] `AddPackage(name)` looks for `imports/package[@name='<name>']` (MAN-014). If it finds one it returns that element and changes nothing, so names are unique by exact, case-sensitive comparison (`My.Pkg` and `my.pkg` are two packages). Otherwise it creates `<package name="<name>" path="<path>">` and appends it to the document element (the last child, whatever the root is called), then returns it. `name` is written before `path`. The path is:

- `.\` when the package is a standard package (MAN-031);
- otherwise `<last segment>\Import`, where the last segment is the text after the last `.` of the name, found with the regular expression `([^\.]+)$`: a name without a dot is its own last segment (`nodots` gives `nodots\Import`), `My.Pkg` gives `Pkg\Import`, `a..b` gives `b\Import`, `x.y z` gives `y z\Import`.

A null name throws `System.NullReferenceException`.

Export adds a package for each package it exports, in the order of the table it walks (the export-orchestration rules and MAN-017 fix that order), and the language-pack preprocessor adds its one temporary package the same way.

[12.0] Same as 14.0.7.

### MAN-011: A package name that ends with `.` or is empty gets the path `\Import` (bug)

[14.0.7] The last-segment pattern of MAN-010 needs at least one character after the last dot. For a name that ends with `.` (`trailing.`, `a.b.`) or an empty name nothing matches and the segment is empty, so the path is `\Import`. Import resolves that path as rooted (MAN-030, rooted without a drive letter, and MAN-005 for what the engine then does with it), so the package's folder is looked up outside the working directory. A correct engine would use the name, or refuse it. Registered in `bugs.md`.

[12.0] Same as 14.0.7.

### MAN-012: AddDependsOn adds a dependency once and refuses a blank name

[14.0.7] `AddDependsOn(packageNode, name)`:

1. throws `System.ArgumentNullException` (parameter name `packageNode`) for a null package;
2. throws `System.ArgumentException` with the message `Name of 'dependson' package can't be 'null' or empty` when the name is null or has only whitespace (the set of `String.Trim`, which is the characters .NET's `Char.IsWhiteSpace` accepts: U+0009 to U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000);
3. looks for `dependson[@name='<name>']` below the package element (MAN-014) and returns it when found;
4. otherwise creates `<dependson name="<name>" />`, appends it to the package and returns it.

A name is not trimmed: ` a ` and `a` are two dependencies.

[12.0] Same as 14.0.7.

### MAN-013: AddReferencedElement adds an element once per id

[14.0.7] `AddReferencedElement(dependsOnNode, item)`:

1. throws `System.ArgumentNullException` for a null `dependsOnNode` (parameter name `dependsOnNode`) and for a null item (`referencedElement`);
2. looks for `referenced_element[@id='<item.idName>']` below the `dependson` element (MAN-014) and returns it when found, so a second item with the same id and another type or keyed name is dropped;
3. otherwise creates `<referenced_element id="…" type="…" descr="…" />` with attributes in the order `id`, `type`, `descr`, from the item's id, type name and keyed name, appends it and returns it. A null type or keyed name is written as an empty attribute (`type="" descr=""`).

The element is identified by the id only: an id of `''` is an element like any other.

[12.0] Same as 14.0.7.

### MAN-014: Names are put into XPath unescaped, so a quote breaks the lookup (bug)

[14.0.7] Every lookup in this area builds its XPath with `string.Format` and the name as it is, between single quotes, and evaluates it with .NET's XPath 1.0 engine:

| Where | Expression |
|---|---|
| `AddPackage`, `GetPackageNode` | `imports/package[@name='{name}']`, from the document |
| `AddDependsOn`, `GetDependsOn` | `dependson[@name='{name}']`, from the package element |
| `AddReferencedElement` | `referenced_element[@id='{id}']`, from the `dependson` element |
| the package-existence test of `MoveToOrderedList` (MAN-023) | `//Item[@type='PackageDefinition' and name='{name}']`, from the database document |

`SelectSingleNode` returns the first node in document order. So:

- a name with `'` is not a string, and the expression is usually invalid XPath. The call throws `System.Xml.XPath.XPathException`, observed with these messages: `This is an unclosed string.` (`'` and `a'`), `'<the expression>' has an invalid token.` (`'a`, `a''b`, `a'b`, `a'b'c`, `x')`: the message quotes the whole expression, for example `'imports/package[@name='a'b']' has an invalid token.`), and `Expression must evaluate to a node-set.` (`x'[1]`).;
- a name can also be valid XPath with another meaning. `a' and 'b` is the condition `@name='a' and 'b'`, which matches nothing, so `AddPackage` adds a package named `a' and 'b`. `x' or @name='My.Pkg`, `x' or ''='`, `x' or 1=1 or '` and `x'] | //package[@name='My.Pkg` match the first package (or, for the last, the first of the union in document order), so `AddPackage` returns an existing package and adds nothing. A dependency named `a' or @name='a` is found as the first `dependson` that makes the condition true;
- `"` and every other character, including `]`, `&` and `<`, are not special and work.

The port evaluates these expressions with an XPath 1.0 engine, not a string-equality shortcut, so that injection and failures behave alike, and throws `XPathException` with the messages above for those expressions. Which message an invalid expression gets depends on where .NET's parser gives up, so the port runs a parser that follows `XPathParser` (a token that cannot continue the expression is `has an invalid token`; a step or a predicate that cannot start is `Expression must evaluate to a node-set.`; a literal that never ends is `This is an unclosed string.` only if the parser scans that far; `Function 'f' in '<expression>' has an invalid number of arguments.`; `Namespace prefix 'p' is not defined.`; `'a:' has an invalid qualified name.`; `XsltContext is needed for this query because of an unknown function.` for an unknown function or a variable) before it evaluates the expression. It was measured on 60 names in each of the four shapes of the table (`xp.name*` in `fixtures/xml-core/vectors.json`) and on about 150 other expressions that do not parse, and agrees on all of them. Registered in `bugs.md`.

[12.0] Same as 14.0.7.

## Looking things up

### MAN-015: The lookups

[14.0.7]

- `GetPackageNode(name)` returns null, without evaluating anything, when the name is null or blank (MAN-012's whitespace set). Otherwise it returns the first node of `imports/package[@name='{name}']` (MAN-014), or null. With two packages of the same name the first wins.
- `GetAllPackageNames()` returns every `imports/package` element's `name` attribute in document order, as a new list, duplicates included (`P,P,Q`). A package without `name` throws `System.NullReferenceException`.
- `GetDependsOn(packageNode, name)` throws `System.ArgumentNullException` (`packageNode`) for a null package and the `ArgumentException` of MAN-012 for a blank name, and otherwise returns the first node of `dependson[@name='{name}']` below the package, or null.
- `GetAllDependsOnNames(packageNode)` throws `System.ArgumentNullException` (`packageNode`) for a null package, and otherwise returns the `name` attributes of its direct `dependson` children in document order. A child without `name` throws `System.NullReferenceException`. Duplicates are kept.
- `GetPackageDependencies(name)` returns the names of the dependencies of `GetPackageNode(name)` as an array, in document order, and an empty array when there is no such package or it has none. It reads the attribute with `GetAttribute`, so a `dependson` without `name`, or with `name=""`, gives `""` (this one does not throw).
- `GetReferencedElements(dependsOnNode)` throws `System.ArgumentNullException` (`dependsOnNode`) for null, and otherwise returns one `ExportItem` per direct `referenced_element` child, in document order, as a list. The item's keyed name is `descr`, its id `id` and its type name `type`; a missing attribute is `""`. Duplicate ids are kept.

All of them look only at direct children (MAN-001). A name with `'` fails as MAN-014 says.

[12.0] Same as 14.0.7.

### MAN-016: GetDependsOnInfo builds one table from a package's dependencies

[14.0.7] `GetDependsOnInfo(packageName)` returns a new `Hashtable` (MAN-017). It is empty when `GetPackageNode(packageName)` is null (a null or unknown name). Otherwise, for each name of `GetAllDependsOnNames` in document order it calls `GetDependsOn(packageNode, name)`, and adds the entry `name → GetReferencedElements(thatDependsOn)` with `Hashtable.Add`. Import uses this table to record a package's dependencies (the import-run rules).

- The operations on the table are therefore exactly one `Add` per `dependson` child, in document order, and nothing else: no overwrite and no removal. That sequence, with MAN-017, fixes the enumeration order of the table; enumerating `Keys` and enumerating the entries give the same order.
- A second `dependson` with the same name throws `System.ArgumentException` with `Item has already been added. Key in dictionary: 'd'  Key being added: 'd'` (two spaces before `Key being added`) and no table is returned. Export never writes duplicates (MAN-012); a hand-edited manifest can.
- A `dependson` without `name` throws `System.NullReferenceException`; one with a blank name throws the `ArgumentException` of MAN-012; one with a `'` in its name throws the `XPathException` of MAN-014.
- Because the value is found by `GetDependsOn`, the elements of the first `dependson` that matches the name's XPath are used, which is not the one the name came from when a name is an injection (MAN-014): in `a`, `a' or @name='a`, `b` the second key gets the elements of the first.
- A key keeps its text exactly, with no trimming or case folding (` a ` and `A` are keys).

Observed key orders (the table is built from `dependson` names `a` to `h`, in forward or reverse order, with the same result both ways): `b,c,a,f,g,d,e,h`. For `com.aras.innovator.core`, `com.aras.innovator.admin` the order is `com.aras.innovator.admin,com.aras.innovator.core`; with `solution.PLM` and `defaults.base` added it is `core,admin,solution.PLM,defaults.base`.

[12.0] Same as 14.0.7.

## Hashtable

### MAN-017: `Hashtable` enumeration order

[14.0.7] Every table the engine builds is a .NET Framework `Hashtable` made with `new Hashtable()` (default comparer) and string keys, enumerated with `foreach` over the table, its `Keys`, or its enumerator. The hosts run in 64-bit .NET Framework 4.x with randomized string hashing off. The enumeration order is a function of the keys and of the exact sequence of `Add`, indexer-set and `Remove` operations performed on the table: it is not insertion order, and inserting the same keys in another order can give another order. A table that the library builds is therefore built by replaying the engine's operation sequence, as each rule that builds a table states (MAN-016 here; the export rules for the tables export builds). The emulation is this:

**String hash.** All arithmetic is 32-bit signed with wrap-around. Set `h1 = h2 = 5381`. Walk the UTF-16 code units in pairs. For the unit `c` at an even index: stop if `c` is 0; `h1 = ((h1 << 5) + h1) ^ c`. For the unit `d` after it: stop if there is none or it is 0; `h2 = ((h2 << 5) + h2) ^ d`. The hash is `h1 + h2 × 1566083941`. A NUL therefore ends the hash (the runtime walks a NUL-terminated buffer). The 32-bit runtime hashes differently and is not used.

**Table.** Buckets hold a key, a value, the 31-bit hash and a collision flag. The load factor is 0.72 in 32-bit floating point.

- A new table has 3 buckets. `loadsize = (int)(0.72f × size)` (2 for size 3). `count` is the number of live entries and `occupancy` the number of buckets whose collision flag is set.
- `hash31 = hash & 0x7FFFFFFF`. The probe sequence starts at `hash31 mod size` and steps by `1 + ((uint32)(hash31 × 101) mod (size − 1))`, with the product wrapping at 32 bits, modulo `size`.
- To insert (`Add` or the indexer): first, if `count ≥ loadsize`, grow the table to `GetPrime(2 × size)` buckets; otherwise, if `occupancy > loadsize` and `count > 100`, rebuild it at the same size. Then walk the probe sequence for at most `size` steps:
  - remember the first deleted bucket that has its collision flag set;
  - at a bucket that never held a key, or a deleted one without the flag, store the entry there (or in the remembered deleted bucket, if any) and stop;
  - at a bucket holding an equal key (same hash, equal string, ordinal): `Add` throws `System.ArgumentException` (`Item has already been added. Key in dictionary: '<key>'  Key being added: '<key>'`); the indexer replaces the value and keeps the bucket;
  - at any other bucket that does not yet have its collision flag set, and while no deleted bucket was remembered, set the flag and add one to `occupancy`.
- Growing and rebuilding allocate fresh buckets, take the live entries in ascending order of their old bucket index, and insert each by the probe sequence of the new size. A bucket already holding an entry gets its collision flag set (adding to `occupancy`) before the walk moves on. Deleted buckets are dropped. `loadsize` is recomputed for the new size.
- `GetPrime(n)` is the smallest entry of this list that is at least `n`: 3, 7, 11, 17, 23, 29, 37, 47, 59, 71, 89, 107, 131, 163, 197, 239, 293, 353, 431, 521, 631, 761, 919, 1103, 1327, 1597, 1931, 2333, 2801, 3371, 4049, 4861, 5839, 7013, 8419, 10103, 12143, 14591, 17519, 21023, 25229, 30293, 36353, 43627, 52361, 62851, 75431, 90523, 108631, 130363, 156437, 187751, 225307, 270371, 324449, 389357, 467237, 560689, 672827, 807403, 968897, 1162687, 1395263, 1674319, 2009191, 2411033, 2893249, 3471899, 4166287, 4999559, 5999471, 7199369. Beyond the list it is the next odd number that is prime and not one more than a multiple of 101.
- To remove, walk the probe sequence from the key's start while the visited bucket has its collision flag set; at the bucket holding the key, if its flag is set it becomes a deleted bucket that keeps the flag, otherwise it becomes never-used. `count` goes down by one.
- **Enumeration** visits the buckets from the last index down to index 0 and yields each live entry.

The emulation is `src/manifest/netfx-hashtable.ts`. Verified against the real engine on these 14.0.7 vectors (`fixtures/manifest/14.0.7/hashtable/`, where the generator and the digest of the real output are): the key orders in MAN-016 (four sets, 2 to 12 keys), and, from the earlier research of the same algorithm, 1,200 random operation sequences (up to 3,273 operations, with removes, overwrites and non-BMP, lone-surrogate and NUL keys), 200 host-shaped nested tables, 102 tables built from 5,050 real item ids in 55 packages, and 430,786 string hashes.

[12.0] Same as 14.0.7.

### MAN-018: Past 100 probe collisions .NET switches to randomized hashing, which the port cannot follow (bug)

[14.0.7] When one insertion walks more than 100 occupied buckets, .NET Framework silently switches the table to a per-process randomized string hash and rebuilds it. The enumeration order then differs from run to run. Observed: 101 keys with equal hashes still give a fixed order and 102 give a different order on every run. It needs more than 100 keys whose probe chains coincide in one insertion, which in practice means identical 31-bit hashes; random 32-hex ids and real package names never reach it.

The port cannot reproduce a random order. It follows MAN-017 and, when an insertion would walk more than 100 occupied buckets, throws an error that names the table and the key instead of continuing, so a run never silently orders by something the engine would have randomised. This is the one place where the library deliberately departs from the engine's observable behaviour in a table's order. Registered in `bugs.md`.

[12.0] Same as 14.0.7.

## Package order for import

### MAN-020: GetPackageNamesInImportOrder returns the packages in dependency order

[14.0.7] `GetPackageNamesInImportOrder(importedPackages, databasePackages, warnings)` takes the names of the packages to import in the order requested, the document of package definitions the server returned (the import-run rules, `getSolutions`) or null, and a list that collects warning texts. It returns an `ArrayList` of the same names in the order import processes them, with dependencies first. It does not change the manifest.

It starts by copying the names into an `OrderedDictionary` in the given order (key and value both the name, compared ordinally and case-sensitively), which gives these results before anything else is done:

- a name that occurs twice throws `System.ArgumentException` with `Item has already been added. Key in dictionary: 'A'  Key being added: 'A'` (MAN-024);
- the list is empty: the result is an empty list.

Names not in the manifest are valid input: they have no package node and so no dependencies (MAN-015), and are processed in pass 1.

The method has three steps: pass 1 (MAN-021), the removal of the packages pass 1 accepted from the pending set, and pass 2 (MAN-022). The `result` list is the one that is returned; the pending set is the ordered dictionary.

[12.0] Same as 14.0.7.

### MAN-021: Pass 1 takes packages whose dependencies are already in the result

[14.0.7] Pass 1 visits the pending packages in the requested order, once each, and appends a package to the result when:

- `GetPackageDependencies(name)` is empty (MAN-015), or
- every one of its dependency names is already in the result (exact string comparison).

A dependency that is not being imported can never be in the result, so a package with such a dependency waits for pass 2 even when the dependency exists in the database. A package that depends on itself waits too. After the pass, every name in the result is removed from the pending set. The pending set keeps its order, so pass 2 visits the rest in the requested order.

Observed (requested order and dependencies → result, no database): `A>B; B` with `A,B` → `B,A`; `A;B;C` with `B,A,C` → `B,A,C`; `A>B,C; B>C; C` with `A,B,C` → `C,B,A` (pass 1 takes only `C`, pass 2 takes `B` then `A`); `A>B; A; B` (a package listed twice in the manifest, the first node's dependencies count) with `A,B` → `B,A`.

[12.0] Same as 14.0.7.

### MAN-022: Pass 2 places the rest by depth-first search

[14.0.7] Pass 2 visits the packages still pending, in the requested order. For each one, skipping it if it is already in the result (an earlier search may have placed it), it takes the `name` attribute of each `dependson` child of its package node, in document order, and calls `MoveToOrderedList(start, dependency)` for each (start being the package being processed). Then it appends the package to the result. A `dependson` without `name` throws `System.NullReferenceException`; one with `name=""` is the dependency `""`.

`MoveToOrderedList(start, pkg)`:

1. if `pkg` is already in the result, it returns;
2. if `pkg` equals `start`, it adds the circular-dependency warning (MAN-023) and returns (without adding anything to the result);
3. otherwise, if `pkg` is still pending, it calls `MoveToOrderedList(start, d)` for each dependency `d` of `pkg` in document order, then appends `pkg` to the result. `pkg` stays in the pending set, which is not changed by the search;
4. otherwise (`pkg` is not being imported) it looks for the package in the database document (MAN-023) and adds the missing-dependency warning if it is not there. It does not add anything to the result.

So a dependency that is not being imported is never in the result, a dependency on the package being placed gives a warning and the placing goes on, and a cycle that goes through the starting package ends at the second visit of it. Examples: `A>B; B>A` with `A,B` → `B,A` with a circular warning for `A`; with `B,A` → `A,B` with a warning for `B`; `A>A` with `A` → `A` with a warning for `A`; `A>B; B>C; C>D; D>A` with `A,B,C,D` → `D,C,B,A` (one warning, for `A`), with `B,A,C,D` → `A,D,C,B` (warning for `B`), with `D,C,B,A` → `C,B,A,D` (warning for `D`). A cycle that does not go through the starting package never ends (MAN-025).

[12.0] Same as 14.0.7.

### MAN-023: The warnings and the database test

[14.0.7] The two warnings are strings in the engine's message table (the messages rules own that table), formatted with the package name through `string.Format` with the invariant culture:

- circular dependency: `There is a circular dependency on package '{0}'`, with the name of the package that is both the start and the dependency;
- missing dependency: `One of imported packages depends on the package '{0}' that neither imported in this session nor exists in the database`, with the dependency's name. A dependency named `''` gives `''` between the quotes.

The caller writes each warning to the log, one line each, in order (the import-run rules). A warning is added every time the case occurs: a package that two packages depend on is reported twice (once for each depending package).

The database test is `//Item[@type='PackageDefinition' and name='{pkg}']` evaluated on `databasePackages` with `SelectSingleNode` (MAN-014): the package exists when some `Item` element at any depth has `type="PackageDefinition"` and some child `name` element whose full text (not trimmed) equals the name. An `Item` nested in another item's `Relationships` counts, an `Item` of another type or a name with extra spaces does not. When `databasePackages` is null and a dependency needs the test, the method throws `System.NullReferenceException`; when no dependency needs it, a null document is fine. A null `warnings` list throws `System.NullReferenceException` at the first warning; the engine always passes a list.

[12.0] Same as 14.0.7.

### MAN-024: Failure shapes of the ordering

[14.0.7] Besides the cases above, observed:

- a null `importedPackages` throws `System.NullReferenceException`; a null name inside it throws `System.ArgumentNullException` with `Key cannot be null.\r\nParameter name: key`;
- a duplicate name in `importedPackages` throws the `System.ArgumentException` of MAN-020, even when both entries are the same package given twice by the caller. Nothing has been added to `warnings` then. The exception reaches the import's own error handling (the import-run rules) as it is, and no package is imported. A correct engine would import the package once. Registered in `bugs.md`;
- a name or dependency with `'` throws the `XPathException` of MAN-014: `GetPackageNode` fails for an imported name, the database test for a dependency that needs it;
- a package that appears twice in the manifest uses its first node.

[12.0] Same as 14.0.7.

### MAN-025: A dependency cycle that does not pass through the starting package never ends (bug)

[14.0.7] `MoveToOrderedList` recurses without bound when it reaches a pending package that is part of a cycle but is not the package being placed. For example, with `A>B`, `B>A` and `C>A`, importing `C,A,B`: placing `C` calls `MoveToOrderedList(C, A)`, which calls it for `B`, which calls it for `A` again, and so on. The same happens for a package that depends on itself when another package is being placed (`A>B`, `B>B`: importing `A,B` recurses at `B`). The process dies with a stack overflow that no `catch` can handle. Observed: the host's process ends with `Process is terminated due to StackOverflowException.` on its error output and a failure exit code (253 through WSL), and nothing is returned, logged or cleaned up.

The depth at which the stack runs out depends on the host's thread stack size. A chain of 12,000 dependencies (`P0>P1>…>P11999`, importing `P0` to `P11999`) is ordered without trouble on the oracle host, so ordinary manifests never reach it.

The port counts the nesting depth of `MoveToOrderedList` (the call made by the ordering is at depth 1) and, when a call would be at a depth of 100,000, stops with an error whose message is `Process is terminated due to StackOverflowException.` (the engine's own text), without returning a partial order. The library therefore fails where the engine dies, but as a catchable error: the one deviation that cannot be avoided (round 5, line 9). A chain deeper than the bound but within what a host's stack can take would fail in the port and succeed in the engine; no real manifest is that deep. Registered in `bugs.md`.

[12.0] Same as 14.0.7.

## Package paths

### MAN-030: GetPackagePath finds a package's folder

[14.0.7] `ExportImportBase.GetPackagePath(packageNode, manifestFolder)` returns a path string, using Windows path rules whatever the platform (MAN-033):

1. `name` is the element's `name` attribute and `path` its `path` attribute. A missing attribute reads as `""`.
2. If `path` is empty or only whitespace (MAN-012's set), it becomes `.\`. A path with leading or trailing spaces that is not blank is kept as it is.
3. If `path` is not rooted, it becomes `Path.Combine(manifestFolder, path)`. A path is rooted when it starts with `\` or `/`, or when its second character is `:` (any character before it): `\x`, `/x`, `C:\x`, `D:x`, `a:b`, `1:\x` and the UNC forms are rooted, `ab:\x` and `:x` are not. A rooted path is used as it is, and `manifestFolder` is not looked at.
4. If the package is a standard package (MAN-031), `\` followed by `name` with every `.` replaced by `\` is appended to the result of step 3 (so `.\` ends in two backslashes before the name).
5. The result is returned.

`Path.Combine(folder, path)`, for a not-rooted `path`: returns `path` when `folder` is empty and `folder` when `path` is empty (not reachable here, step 2); otherwise `folder` followed by `path`, with one `\` between them unless `folder` ends in `\`, `/` or `:`. Both arguments are checked first. In this order: step 3's rooted test checks `path`, then `Combine` checks `folder` and `path`. A character below U+0020, or `"`, `<`, `>` or `|`, in a checked string throws `System.ArgumentException` with `Illegal characters in path.` (so a bad `folder` throws only when `path` is not rooted). `?` and `*` are accepted. A null `manifestFolder` throws `System.ArgumentNullException` with `Value cannot be null.\r\nParameter name: path1` when `Combine` runs. A null package node throws `System.NullReferenceException`.

Nothing is normalised: `.`, `..`, doubled separators and mixed `/` and `\` stay as written. Observed (manifest folder `C:\m` unless stated):

| `name` | `path` | Result |
|---|---|---|
| `My.Pkg` | `Pkg\Import` | `C:\m\Pkg\Import` |
| `My.Pkg` | `Pkg\Import`, folder `C:\m\` | `C:\m\Pkg\Import` |
| `My.Pkg` | `Pkg\Import`, folder `C:/m` | `C:/m\Pkg\Import` |
| `My.Pkg` | `Pkg\Import`, folder `C:/m/` | `C:/m/Pkg\Import` |
| `My.Pkg` | `Pkg/Import` | `C:\m\Pkg/Import` |
| `My.Pkg` | `C:\abs\x` | `C:\abs\x` |
| `My.Pkg` | `\\srv\share\x`, `\rooted`, `/rooted`, `D:rel` | the path itself |
| `My.Pkg` | `x`, folder `C:` | `C:x` |
| `My.Pkg` | `x`, folder `/home/u/m` | `/home/u/m\x` |
| `My.Pkg` | `x`, folder empty | `x` |
| `My.Pkg` | ` x ` | `C:\m\ x ` |
| `My.Pkg` | `..\y` | `C:\m\..\y` |
| `com.aras.innovator.core` | `.\` or empty or blank or missing | `C:\m\.\\com\aras\innovator\core` |
| `com.aras.defaults.Foo.Bar` | `.\` | `C:\m\.\\com\aras\defaults\Foo\Bar` |
| `com.aras.innovator.core` | `C:\abs` | `C:\abs\com\aras\innovator\core` |
| `com.aras.innovator.core` | `Imp\` | `C:\m\Imp\\com\aras\innovator\core` |
| `com.aras.innovator.` | `.\` | `C:\m\.\\com\aras\innovator\` |
| `com.aras.innovator` | `.\` | `C:\m\.\` (not a standard name) |

The rest of the probe vectors (illegal characters, drive and volume forms) are in `fixtures/manifest/14.0.7/probes/01-package-paths.out` and `08-path-chars-and-edges.out`.

[12.0] Same as 14.0.7.

### MAN-031: Which packages are standard

[14.0.7] `IsStandardPackage(name)` is true for a default package or a core package; a null name throws `System.NullReferenceException`.

- `IsDefaultPackage` is true when the name starts with `com.aras.defaults.`, compared ordinally and ignoring case (`COM.ARAS.DEFAULTS.x` and `Com.Aras.Defaults.x` count). `com.aras.defaults` without the final dot does not. This comparison does not ignore any character.
- `IsCorePackage` is true when the name starts with `com.aras.innovator.` and does not start with `com.aras.innovator.solution.`. Both tests are `String.StartsWith(string)` with no comparison argument, which compares with the current culture, case-sensitively (`COM.ARAS.INNOVATOR.x` and `com.aras.innovator.Solution.x` differ from the prefixes: the first is not core, the second is core). `com.aras.innovator` without the dot is not core.

So, for example, `com.aras.innovator.core` and `com.aras.innovator.solutionX.PLM` are core, `com.aras.innovator.solution.PLM` and `com.aras.innovator.solution.` are not, and a package that is neither is non-standard whatever it is called, which puts it under `<last segment>\Import` (MAN-010).

The culture-sensitive comparison is not ordinal. Its observable differences, identical under the en-IN, en-US, sv-SE, tr-TR and invariant cultures on the oracle host, are recorded in `fixtures/manifest/14.0.7/nls-startswith.json` and are all that the port reproduces:

- the code points in `ignorable` (the soft hyphen U+00AD, U+034F, variation selectors, and the many code points .NET's tables leave unassigned) are skipped wherever they occur, inside the prefix, before it or in front of the dot that ends it: `com.aras.innovator\u00AD.x` and `\u00ADcom.aras.innovator.x` are core;
- U+2024 (one dot leader) counts as `.`;
- U+3031, U+3033, U+3035, U+309D, U+30FC, U+30FD and U+FF70 right after the first `n` of `innovator` count as the second `n` (`com.aras.in` + U+3031 + `ovator.x` is core, `com.aras.inn` + U+3031 + `ovator.x` is not; probed on the oracle host);
- a code point in `afterPrefixBreaks` (combining marks) directly after the final `.` of a prefix attaches to it, so the text no longer starts with that prefix: `com.aras.innovator.\u0301x` is not core, and `com.aras.innovator.solution.\u0301x` does not start with the `solution.` prefix and is core;
- every other code point is compared by code unit, so `ı` (U+0131), the zero-width space U+200B and full-width letters do not match the letters they resemble.

The port does not follow other culture rules, which no manifest, package name or item name of the products can reach.

[12.0] Same as 14.0.7.

### MAN-032: GetSolutionPath adds the manifest lookup and the error text

[14.0.7] `ImportExportManager.GetSolutionPath(packageName, manifestFolder, manifest)` is what import calls for each package (the import-load rules). It:

1. throws `System.ArgumentNullException` (parameter name `manifestFile`) when the manifest is null;
2. gets `manifest.GetPackageNode(packageName)`; a null node is an error with the message `Node for package '{0}' doesn't exist in the manifest file`;
3. otherwise returns `GetPackagePath(node, manifestFolder)` (MAN-030).

Any exception from steps 2 and 3 except thread aborts, including the XPath one for a name with `'` (MAN-014) and the ones of `GetPackagePath`, is caught and thrown again as a plain `System.Exception` whose message is the original message followed by ` Enable to detemine path to {0}.` (with a leading space and the engine's spelling), with the original as inner exception. The result is, for example, `Node for package 'Missing' doesn't exist in the manifest file Enable to detemine path to Missing.`, `Illegal characters in path. Enable to detemine path to Bad.` and `'imports/package[@name='x'y']' has an invalid token. Enable to detemine path to x'y.`. A null, empty or blank package name gets the first message (`Node for package '' doesn't exist…`), because `GetPackageNode` returns null. Throwing an exception of the base type means that a caller cannot tell these causes apart except by the text.

The interface member `IImportExportManager.GetSolutionPath` is a forwarder to this method.

[12.0] Same as 14.0.7.

### MAN-033: Path strings keep their Windows form, and one layer maps them to the host

[14.0.7] The engine runs on Windows only, and every path it builds is a Windows path string: `\` separates, `C:\` and `\\host\` start absolute paths, and `/` is accepted as a separator by .NET's file functions but kept as written by `Combine`.

The port keeps that: `GetPackagePath`, `Combine`, the rooted test and the standard-package path of MAN-030, and the export's output folders, are computed on any platform as Windows path strings, so that their results are the engine's. The file layer is the only code that turns such a string into a host path, when a file or folder is actually opened:

- on Windows it passes the string on after MAN-004's normalisation;
- on other platforms it replaces every `\` with `/`, then uses the result as a relative or absolute POSIX path. The manifest folder it is given is already a POSIX path, so `Combine` yields mixed text such as `/home/u/m\Pkg\Import`, which this step turns into `/home/u/m/Pkg/Import`. A path that is rooted by a drive letter (`C:\abs`, `D:rel`) or by `\\host` has no POSIX meaning, and the layer stops with an error that names the path and says that it cannot be used on this platform. MAN-004 and MAN-005 do not apply, so `\Users\me` becomes `/Users/me`.

File and folder names compare as the host's file system does (case-insensitively on Windows and macOS by default, exactly on Linux). Names inside the manifest (package, dependency, element) always compare ordinally and case-sensitively, as in the lookups above.

[12.0] Same. Where the rule refers to MAN-004's normalisation on Windows, 12.0 has none: the string is passed on as built.
