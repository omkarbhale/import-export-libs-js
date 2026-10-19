# Export: removing references to unknown packages

This document specifies what the export does when `RefToUnknownPacks` is `RemoveSilently` or `RemoveWithWarning`: which references in an exported item count as pointing into an unknown package, how they are removed, what is recorded about them, and the log blocks and warning at the end of a package's export. It owns rule ids `EXP-600` to `EXP-699`.

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`, never committed): `CItemHelper::RemoveReferencesToAnotherPackages` and its helpers, `RemovedReference`, and the loop in `ImportExportManager::ExportProc`;
- the framework's own `System.Xml` 4.8 (decompiled locally the same way), for the node-list behaviour of EXP-615, and a replay of that behaviour on the real framework (`fixtures/unknown-refs/enumeration/`);
- reads on the dev instance (12 SP9) for the package and dependency shape the examples use; no export or import was run for this document (the oracle needs the dev password, which this ticket did not have). The expected outputs in the examples are therefore derived from the rules and marked as such; the export fixture tickets (24 and 67) record the real engine on the catalogue's E06 case.

Everything below is `[14.0.7]` except the `[12.0]` variant that ends each rule. 14.35 gets its variants in its own tickets.

The `[12.0]` variants come from the 12.0 decompile (`.decomp/12.0/`), compared method by method with 14.0.7's: the removal code and its messages are the same in both builds.

## What an "unknown package" is

The engine calls a reference unknown when its target is in a non-core package that is neither the package being exported nor one it directly depends on. Three words need their exact meaning:

- **Core package** (EXP-616): a name with the prefix `com.aras.innovator.` that does not have the prefix `com.aras.innovator.solution.`. So `com.aras.defaults.*` and `com.aras.innovator.solution.*` packages are *non-core*, and so are customer packages.
- **Depends on** (EXP-608): the direct `PackageDependsOn` rows of the package being exported. Dependencies of dependencies are not followed.
- **Belongs to** (EXP-607): the id is one of the `PackageElement.element_id` values of the package. For a versionable item that is its `config_id`; for the others its `id`.

## Mode and scope

### EXP-600: The mode decides whether the removal runs at all

[14.0.7] `RefToUnknownPacks` is one of `RemoveSilently`, `RemoveWithWarning` and `DoNotRemove`. A context whose property was never set has `RemoveSilently`, the first value of the enumeration. The CLI's own default is chosen by the CLI tickets, not here.

`ExportProc` runs once per package exported: once for each package in the export set, and once for each referenced package when referenced items are exported too. At its start it makes one `Hashtable` (the table of removed references, EXP-611) for that run, or `null` when the mode is `DoNotRemove`. The table is passed to every `PackageItem` call of the loop, and `CExportItems.Export` calls `RemoveReferencesToAnotherPackages` only when it is not `null`, after the polymorphic-list replacement and before the namespace-node and empty-relationship clean-up.

So `DoNotRemove` skips everything in this document: no request of group 18 is sent, no file is changed, nothing is logged. Under the other two modes, every item exported goes through EXP-601 to EXP-606, even one with no relationships.

[12.0] Same as 14.0.7.

### EXP-601: Which relationship items are examined

[14.0.7] The first pass visits `Item` elements that are children of a `Relationships` element, anywhere in the exported document (the XPath `.//Relationships/Item` from the document node), in the order EXP-615 describes. That includes the envelope's single root item, items nested in the `Relationships` of related items inside `related_id`, and relationship items of relationship items.

The package name used is the one the run is exporting (`solutionName`), the item's names are those of the export set entry (`ExportItem.typeName`, `keyedName` and `idName`, which are the PackageElement's `element_type`, `name` and `element_id`).

For each visited item, the checks of EXP-602 to EXP-605 run in this order. The first one that removes the item ends the visit (the next item is taken). An item that none removes stays.

[12.0] Same as 14.0.7.

### EXP-602: A relationship item needs a type

[14.0.7] The visit starts by reading the item's `type` attribute:

- no `type` attribute: a `NullReferenceException` escapes the helper, and `CExportItems` turns it into a `CItemException` with faultcode `-1`, faultstring the .NET stack trace and detail `Object reference not set to an instance of an object. Can't export item.` (EXP-617);
- an empty `type`: a `CItemException` with faultcode `-1`, faultstring `Type of relationship is not defined` and detail `Type of relationship is not defined in the AML portion: {the item's outer XML}`.

Both abort the export of this item (EXP-617).

[12.0] Same as 14.0.7.

### EXP-603: A relationship whose type is in an unknown package is removed

[14.0.7] The type name `T` is looked up as a `RelationshipType` by name, which is request R2 (EXP-608), cached per name for the run. Let `rt` be the id of the first result item. The relationship item is removed when:

1. `rt` is not an element of the exported package (EXP-607), and
2. `rt` belongs to an unknown package (EXP-607).

The removal is the one of EXP-610. A table entry (EXP-611) is added with reason *type*:

- from: `[{package}].[{item type}].{item keyed name}`;
- to: `all items of type [{T}]`.

When the lookup fails the visit fails with the `CItemException` of that request, including faultcode `0` for a name that is no RelationshipType (the server's "No items of type RelationshipType found." reaches the log as the item's error). An answer without an `id` is a `NullReferenceException` (EXP-617).

[12.0] Same as 14.0.7.

### EXP-604: In a core package, a relationship item that is itself in an unknown package is removed

[14.0.7] This check runs only when the exported package is a core package (EXP-616) and the item survived EXP-603.

Let `r` be the relationship item's `id` attribute, or when that is empty or missing, the text of its `id` child element, or when there is none, the empty string. The empty string is not special: it is tested like any id. The item is removed when `r` is not an element of the exported package and belongs to an unknown package (EXP-607). The empty string is in no package, so it never removes the item, but the test still loads every candidate package's element ids (EXP-607), which is observable in the request log.

A table entry is added with reason *relationship*:

- from: `[{package}].[{item type}].{item keyed name}`;
- to: `[{T}].{r}`.

[12.0] Same as 14.0.7.

### EXP-605: A relationship item whose related item is in an unknown package is removed

[14.0.7] This check runs for the items that survived EXP-603 and EXP-604, and only for those that have a `related_id` child (the first one; `./related_id`). Without one the visit ends.

The related item's id `c` comes from `GetRelatedItemConfigId` (EXP-618). The item is removed when `c` is not an element of the exported package and belongs to an unknown package (EXP-607). A table entry is added with reason *item*:

- from: `[{package}].[{item type}].{item keyed name} (ID='{item id}')`, where the id is the export set entry's `idName`;
- to: `[{t}].{c}` when the `related_id` element has a `type` attribute `t` (any value, empty included), otherwise `ID='{c}'`.

[12.0] Same as 14.0.7.

### EXP-618: The related item's id

[14.0.7] Given the `related_id` element:

1. If it has no `Item` child, `c` is its text.
2. If it has one (the first), then:
   - when that child's `action` attribute is exactly `get`, `c` is the id found by the unique-key lookup (request group 12 of `evidence/libs-export-spec.md`, `exceptionIfPropMissing` false), which can be null;
   - otherwise `c` is the child's `id` attribute when its trimmed value is not empty (the value is used as written, untrimmed); when the attribute is missing or blank it is the unique-key lookup with `exceptionIfPropMissing` true, which throws when a key property is absent from the child;
   - the child's `type` attribute is then read (a missing one is a `NullReferenceException`, EXP-617) and the item type's versionability is asked (request group 4). When it is versionable, `c` is replaced by the child's `config_id` child text when it has one, else by the `config_id` the server returns for `c` (request group 13, which throws a `CItemException` with faultcode `-99` when it fails).
3. When `c` is null or empty, the visit fails with a `CItemException` of faultcode `-1`, faultstring and detail `Unable to find ID of the related item`.

The export's XSL leaves `<related_id type="X" …><Item type="X" action="get" select="id"><name>…</name></Item></related_id>` for related Methods and Identities (tickets 13 and 14), which is the `get` form: the id is found through the item's unique key, then mapped to the `config_id` for versionable types.

[12.0] Same as 14.0.7.

### EXP-606: Method references elsewhere are removed with their property element

[14.0.7] After the first pass, a second pass visits every `Item` element with `@type='Method'` and `@action='get'` anywhere in the document as it is then (`.//Item[@type='Method' and @action='get']`, again in the order of EXP-615). Method stubs inside relationship items that were removed are no longer in the document. Stubs in relationship items that stayed are visited too, so they are looked up a second time. For each stub:

1. Its outer XML is loaded into a new document, its `select` attribute is set to `config_id` (replaced in place, or appended when it had none), and the result is sent as one request, R6 (EXP-608). It is not cached. A fault of any code, faultcode `0` included, fails the visit with that `CItemException`. An answer without `Result/Item/config_id` is a `NullReferenceException` (EXP-617).
2. With `c` that config id: when `c` is an element of the exported package, or does not belong to an unknown package (EXP-607), nothing happens.
3. Otherwise let `P` be the stub's parent element and `G` the parent of `P`. When `G` exists, `P` is removed from `G` (the property element goes, and with it the stub; nothing else, not even an emptied `G`), and a table entry with reason *item* is added:
   - from: `[{package}].[{item type}].{item keyed name}` (no id suffix);
   - to: ` [Method].[{keyed_name of P}(ID={c})]`, with the leading space, and the `keyed_name` attribute of `P` (empty when missing).

   When `G` does not exist nothing is removed and nothing recorded.

The stubs come from the XSL's Method templates: the properties that point to a Method (an action's `method` and `on_complete`, a transition's `pre_action` and `post_action`, a report's, view's and `tp_XmlSchemaElement`'s) and related Methods.

[12.0] Same as 14.0.7.

## Which packages are "unknown"

### EXP-607: The test for "belongs to an unknown package"

[14.0.7] For an id `x` and the exported package `p`:

1. `x` must not be an element of `p`: the set of `p`'s element ids is fetched once per run with R1 and kept (EXP-609). The test is by exact, case-sensitive string equality. This is the `Contains` test every check makes first, so nothing more is asked about an id of `p`.
2. The candidate packages are the names of every `PackageDefinition` of the database (R3, once per run), in the server's order, without those that are core packages (EXP-616), without any name equal to a direct dependency of `p` (EXP-608), and without `p` itself. The comparisons are exact string equality, and a name that is listed twice stays twice.
3. For each candidate in that order, its element ids are fetched (R1, kept per name) and tested. The first candidate that holds `x` ends the test with true, so the packages after it are not fetched. When none does, the answer is false.

The candidate list and the dependency list are read before the loop, so R3, R4 and R5 are sent, on their first use, before the first candidate's R1, even when the list ends up empty.

An id that belongs to a core package or to a dependency of `p` is therefore never removed, and neither is an id that belongs to no package at all.

[12.0] Same as 14.0.7.

### EXP-608: The metadata the test reads

[14.0.7] All requests go through `applyAML` (a fault, `0` included, throws unless a rule says otherwise). Values in `{}` are interpolated without escaping (AGENTS.md rule 7), and the DOM re-serialises the literal (WIRE-004: double quotes, `<X />`, no whitespace before the root).

| Id | When | Literal | Read from the answer |
|---|---|---|---|
| R1 | first need for a package's element ids | `<Item type='PackageDefinition' action='get' select='id'><name>{p}</name><Relationships><Item type='PackageGroup' action='get' select='id'><Relationships><Item type='PackageElement' action='get' select='element_id'/></Relationships></Item></Relationships></Item>` | the text of every `Result/Item/Relationships/Item/Relationships/Item/element_id`, as a set (duplicates collapse) |
| R2 | first use of a relationship type name | `<Item type='RelationshipType' action='get' select='id'><name>{t}</name></Item>` | `Result/Item/id` of the first item |
| R3 | first candidate-list need | `<Item type='PackageDefinition' action='get' select='name'/>` | every `Result/Item/name`; those that are not core packages, in answer order. There is no `is_current` filter |
| R4 | first dependency-list need for `p` | `<Item type='PackageDefinition' action='get' select='id'><name>{p}</name></Item>` | `Result/Item/id` of the first item |
| R5 | right after R4 | `<Item type='PackageDependsOn' action='get' select='name'><source_id>{id of R4}</source_id></Item>` | every `Result/Item/name` |
| R6 | each Method stub (EXP-606) | the stub's outer XML with `select="config_id"` | `Result/Item/config_id` |

- A fault of code `0` on R5 means no dependencies. Any other fault on R5, and any fault on the others, throws. An R1 for a package that has no PackageDefinition throws with code `0`; an R4 likewise.
- A package that exists but has no groups or elements gives an empty set.
- `Result` is found by local name anywhere in the answer, so both the envelope form and IOM's single-item narrowing work.

[12.0] Same as 14.0.7.

### EXP-609: What is kept between items and runs

[14.0.7] Four caches serve the lookups: element-id sets by package name (R1), relationship type ids by name (R2), the non-core name list (R3) and dependency names by package name (R4 and R5). None expires. The first three are emptied whenever a `CItemHelper` is constructed, so each run starts clean. The fourth is not (EXP-619). All are shared by every package exported in the run: a referenced package's export reuses what the main package's export loaded, and the dependency list of each package name is asked once.

An error in the lookups of R1, R2, R4 and R5 is not cached: the next use asks again. The list of R3 is the exception (EXP-620).

[12.0] Same as 14.0.7.

### EXP-619: The dependency cache outlives the run (bug)

[14.0.7] The dependency cache is a `static readonly` table that no constructor resets. A second run in the same process that exports a package whose dependencies were read in an earlier run reuses the old list, even when the database or the connection changed. The CLI runs once per process, so it never shows; a library caller that exports twice in one process sees it. The port keeps this cache at module level, shared by all runs of one process, and does not reset it. Registered in `bugs.md`.

[12.0] Same as 14.0.7.

### EXP-620: A failed list of non-core packages is cached empty (bug)

[14.0.7] The list of R3 is created before the request is sent and filled after the answer. When R3 fails (a transport error, a fault of any code), the empty list stays as the cache for the run, so the failure reaches the first check that needed the list and every later check sees no candidate packages: nothing more is fetched and nothing more belongs to an unknown package. The port keeps the list in the same order of events. Registered in `bugs.md`.

[12.0] Same as 14.0.7.

## Removal and the table

### EXP-610: Removing a relationship item

[14.0.7] Removing a relationship item (EXP-603 to EXP-605) takes the item out of its parent; when the parent then has no child nodes at all, the parent (a `Relationships` element) is removed from its own parent. Only one level is tried, and an emptied `Relationships` that still holds anything else, comments included, stays. The document is parsed without preserving insignificant whitespace, so whitespace between elements does not count as a child. Later steps remove other empty relationships (ticket 15).

A removal can happen on an item that is no longer part of the document (EXP-615); it then edits the detached subtree and still produces its table entry.

[12.0] Same as 14.0.7.

### EXP-611: The table of removed references

[14.0.7] The table is a .NET Framework `Hashtable`. Its key is the string `from` followed by `to` (no separator) of the entry, and its value the entry: the two strings and the reason (*type*, *relationship* or *item*). An entry is added only when its key is not already present (`ContainsKey`, then `Add`), so nothing is ever overwritten or removed, and two removals with the same from and to count once. For the *type* and *relationship* forms the from has no item id, so two items of one type and keyed name share an entry; for the *item* forms of EXP-605 the id is part of it, and for EXP-606 it is not.

The table lives for one `ExportProc` run (one package), and entries added before an error stay in it (EXP-617).

[12.0] Same as 14.0.7.

### EXP-612: Insertion order decides the log order

[14.0.7] The log blocks are written in the enumeration order of the table's `Values`. For a `Hashtable` that is the hash order of the keys, not insertion order, and it depends on the exact sequence of `Add` calls (growth and collisions). It is reproduced by the Hashtable emulation (the research of ticket 07, written up as rules with the manifest and ordering rules), fed with this sequence of keys:

1. items in the export set's own enumeration order (the package's inner `Hashtable`, ticket 10);
2. within one item, first pass entries in the order EXP-615 gives, then second pass entries in its order;
3. keys that are already present are skipped (EXP-611).

The Hashtable's one non-deterministic regime (more than 100 collisions in one insertion, ticket 07) cannot occur with these keys.

[12.0] Same as 14.0.7.

## Log and warning

### EXP-613: The REMOVED REFERENCE log blocks

[14.0.7] When the item loop of `ExportProc` ends normally and the table has at least one entry, one block per entry is written to the log, in the order of EXP-612, before the `end of execution` line:

```text
<LF> --- REMOVED REFERENCE ---<CRLF>
From:<TAB>{from}<CRLF>
To:<TAB>{to}<CRLF>
Reason:<TAB>{reason}<CRLF>
```

The first line is `"\n --- REMOVED REFERENCE ---"` written with `WriteLine`, so a bare LF, a space, `--- REMOVED REFERENCE ---` and CRLF. The reason text is, by reason:

- *type*: `The item contains a reference to an item of type that belongs to an unknown package (i.e. neither a core package nor a package that the package depends on)`;
- *relationship*: `The item contains a reference to an relationship item that belongs to an unknown package (i.e. neither a core package nor a package that the package depends on)` (Aras's wording, with "an relationship");
- *item*: `The item contains a reference to an item that belongs to an unknown package (i.e. neither a core package nor a package that the package depends on)`.

The blocks are written only when the loop ran to its end. When the run is cancelled, or the error question is answered "abort" (ticket 16), `ExportProc` returns first: the removals already made stay in the files written, but no block and no warning appear. The UTF-8 log has no BOM (ticket 15/16 own the stream).

[12.0] Same as 14.0.7.

### EXP-614: The warning

[14.0.7] When the mode is `RemoveWithWarning` and the table has at least one entry, the warning channel gets, right after the blocks, once for this `ExportProc` run, the text:

```text
There are references to unknown packages that were removed during the export of the package '{package}'.<LF>See log file for more details (search for words 'REMOVED REFERENCE')
```

with the name of the package this run exported (the referenced package's own name in a referenced-items pass). The message is only delivered to the host's `warning` handler (ticket 16 specifies the channels); its answer is ignored. Under `RemoveSilently` the log blocks are written and there is no warning. Then `end of execution : {date}` and `completed` follow as usual.

[12.0] Same as 14.0.7.

## Walking the document while removing

### EXP-615: The loops see a live, lazily built node list (bug)

[14.0.7] Both passes (EXP-601, EXP-606) iterate the result of `SelectNodes` with `foreach` while removing nodes from the document. .NET Framework builds that list on demand, one element ahead of the loop, from iterators that follow the live tree. So a removal changes what the loop visits afterwards. Observed on the real framework:

- Elements already read (the one the loop is on and the next) are visited even when a removal has since detached them. An item in a removed subtree can be visited, removed again from the detached subtree and recorded in the table, though it is no longer in the document.
- Once the search for further matches has walked into a subtree that a removal detached, it cannot get back: it ends. Matches that come later in document order, and that were not read yet, are never visited, so their references stay in the file.

Example (first pass; `a` removed when visited): in `<Relationships><Item k="a"><Relationships><Item k="a1"/><Item k="a2"/></Relationships></Item><Item k="b"/><Item k="c"><Relationships><Item k="c1"/></Relationships></Item></Relationships>` the visits are `a, a1, a2, b, c`: `c1` is never visited. Without a removal they are `a, a1, a2, b, c, c1`. Removing `b` or `c` or `a1` changes nothing, and `a1` and `a2` are still visited after `a` was removed.

A correct engine would snapshot the matches before removing. Registered in `bugs.md`.

The port reproduces the enumeration exactly. The reference algorithm, which matches the real framework on 4,900 random trees (the recorded cases are in `fixtures/unknown-refs/enumeration/`), is:

**Descendant search** for elements named `N`, from a context node: keep one cursor and a `level` starting at 0. Step: if the cursor has a first child, move there and `level++`; otherwise, if `level` is 0, stop; else repeat "move to the next sibling; when there is none, `level--`, stop when it reaches 0, move to the parent, stop when there is none" until a next sibling is reached. After each step, a cursor on an element named `N` is a match. The cursor reads live links, so a node detached from the document has no parent and no sibling beyond its own subtree.

**Pass 2** (EXP-606) is that search over `Item` elements from the document node, keeping those whose attributes qualify.

**Pass 1** (EXP-601) is a two-stage query over live nodes: the descendant search over `Relationships` elements (call it `R`), and a children query that lists the `Item` children of each element of `R` and descends into the next `R` element when it comes before the current child in document order:

```text
state: stack = [], cur = none, ahead = none, needInput = true
getNext(): if ahead is set -> take it; else R.next() (a copy), or none when R is exhausted
decide(): ahead = getNext()
          if ahead is set and cur is After ahead (document order):   // ahead lies inside an earlier child
               push cur; cur = ahead; ahead = none
               return cur has a first child (then cur is at it)
          return true
advance(): loop
   if needInput:
       if stack is empty: cur = getNext(); if none -> done; if cur has no first child -> continue loop   (cur at first child)
       else: cur = pop(); if !decide() -> continue loop
       needInput = false
   else if !(cur moves to next sibling) or !decide(): needInput = true; continue loop
   if cur is an Item element: return cur
```

"After" compares document order by climbing to a common parent; two detached nodes with no common ancestor compare as unordered, which counts as not After.

**The list**: elements are read one at a time from `advance()` into a list. The loop asks for element `i` and the list reads up to element `i + 1` first. So when the loop body runs on element `i`, element `i + 1` is already read. Removals in the body happen after that.

[12.0] Same as 14.0.7.

## Errors

### EXP-617: Which errors escape, and what they leave behind

[14.0.7] `CExportItems.Export` turns `XmlException`, `NullReferenceException` and `XPathException` into a `CItemException` with faultcode `-1`, faultstring the exception's stack trace and detail the exception's message followed by ` Can't export item.` Every other exception from this area is a `CItemException` already (a failed request, EXP-602, EXP-618) and passes through unchanged. In `ExportProc` a `CItemException` is that item's error: it is logged, the error question is asked (ticket 16), and the loop goes on or the run is aborted. The failing item's file is not written, because the save comes after this step; its earlier removals stay in the table (EXP-611) and in the caches (EXP-609).

The `NullReferenceException` cases of this area are: a relationship item with no `type` (EXP-602), a `related_id` child item with no `type` (EXP-618), a RelationshipType answer without `Result/Item/id` (EXP-603), a Method answer without `Result/Item/config_id` (EXP-606), and the `RemoveRelationshipItem` of an item with no parent. The port reproduces them as errors with the same faultcode and the detail text `Object reference not set to an instance of an object. Can't export item.`

[12.0] Same as 14.0.7.

## Core packages

### EXP-616: The core package test

[14.0.7] A package name is a core package when it starts with `com.aras.innovator.` and does not start with `com.aras.innovator.solution.`, both prefix tests case-sensitive. The test is `ExportImportBase.IsCorePackage`, the same method the manifest uses, so it is the culture-sensitive `StartsWith` of MAN-031 with the code point differences recorded there, not an ordinal comparison (the replay of ordinary names cannot tell them apart; the soft hyphen and the other ignorable code points of MAN-031 can). The name `com.aras.innovator.solution.` itself is non-core, and `com.aras.innovator.` followed by any other text is core; every `com.aras.defaults.*` name is non-core here. `IsStandardPackage` and the output directory layout, which treat `com.aras.defaults.*` as standard, are specified with the file layout (ticket 15).

[12.0] Same as 14.0.7.

## Worked example

The catalogue's case E06 (ticket 05): export the package `com.aras.innovator.configurator` (core; its only dependency is `com.aras.innovator.core`) with `RefToUnknownPacks` set to `RemoveWithWarning`, with the ItemType `ScopeCacheDependency`. Two of its `Server Event` relationships point to Methods of `com.aras.innovator.solution.PlmEffectivity`, a non-core package that is not a dependency.

Predicted, from the rules (to be confirmed by fixture 24):

1. R1 for the package, then for each relationship item: R2 for its type name (`Property`, `Server Event`, …); the type ids are elements of core packages, so EXP-603 removes nothing, and candidates are loaded only when an id is not in the package itself.
2. The package is core, so EXP-604 runs with the relationship item's id (empty when the export dropped it) and loads the candidate packages' ids (R3, R4, R5, then R1 per candidate) once.
3. For each `Server Event` relationship, EXP-605: the nested Method stub is found by its name (unique-key lookup), mapped to its `config_id`, which is an element of `com.aras.innovator.solution.PlmEffectivity`, so the relationship item is removed (and the `Relationships` parent when it was the last). The table gets two *item* entries, from `[com.aras.innovator.configurator].[ItemType].ScopeCacheDependency (ID='A22EC0C6A1B940FB94654AB060F21459')`, to `[Method].{config id}`.
4. At the end of the run, two `REMOVED REFERENCE` blocks, in Hashtable order of the two keys, then the warning naming `com.aras.innovator.configurator`.

With `RemoveSilently` the same files and blocks result and there is no warning; with `DoNotRemove` none of R1 to R6 is sent and the relationships stay.

## Not in this area

- The unique-key lookup, `IsVersionable` and `GetConfigId` requests (groups 4, 12 and 13) and their caches: export requests (ticket 11).
- The messages channels, the error question and the log header and footer: orchestration (ticket 16).
- `RemoveNamespaceNodes` and `RemoveEmptyRelationships`, which run after this step: post-processing (ticket 15).
- 12.0 differences: none; every rule here has a `[12.0]` variant that says so (ticket 46). 14.35 differences: tickets 51 and 52.
