# Import delayed resolution

When the reference checks find a reference to an item that does not exist yet, the engine does not fail the import. It edits the item document, so that the item can be imported without the reference, and queues AML that adds the reference back at the end of the package. This document specifies that machinery, `DelayedResolutionManager`: what each unresolved reference does to the document, the AML it queues, and how the queue is applied. The rules are `IMP-200` to `IMP-299`.

The checks that find the references are `spec/import-checks.md` (`IMP-100` to `IMP-199`): they produce the list of unresolved references and call the manager (`IMP-100`, `IMP-103`). The loop that creates the manager and runs the queue is import orchestration (wayfinder ticket 22).

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`): `DelayedResolutionManager`, its callers `CItemHelper.DoChecking` and `ImportExportManager.ImportProc`, and the producers of the references (decompiled locally, never committed);
- probes that ran the real 14.0.7 `DelayedResolutionManager` on .NET Framework 4.8 (Windows PowerShell 5.1), loaded from a staged copy of the vendored `Libs.dll` and driven by reflection with hand-built item documents and a recording `ICItemHelper`. Every behaviour below that reads "probed" was observed that way: the processing of each code, the queued text, the document afterwards, the log lines, and the queue run. The server side of the queued AML (what Aras does with `id=''` or with `where='System.Xml.XmlAttribute'`) was not probed. It needs the scratch import fixtures (wayfinder ticket 25).

## Conventions used by every rule here

- **An unresolved reference** is a pair: an integer `faultcode` and a document node (the problem node). The checks build the list in document order of their passes (`IMP-101`). The manager receives the list as an untyped collection of these pairs.
- **The item document** is the DOM of one item of the package, the document the checks ran on and `doImport` sends afterwards. Its root is the `Item` element. The manager edits it in place, and keeps no reference to it afterwards.
- **The queue** is the manager's only state: an ordered list of AML strings, appended by the processing rules and read by `IMP-240`.
- **DOM serialisation.** A node's outer XML (`OuterXml`) is what the .NET DOM writes: attributes in their document order, double-quoted and escaped, an empty element as `<x />`, and an element that had its last child removed as `<x></x>`, with the whitespace nodes left in the document kept as they are. The XML core rules (wayfinder tickets 6 and 27) own this serialiser. The AML strings below are made of fixed text and node outer XML.
- **Values are interpolated unescaped** (`AGENTS.md` rule 7, `IMP-204`). A value is put between single quotes, or between tags, exactly as the DOM returns it.
- **"Missing attribute"** means `Attributes["x"]` is null. A `GetAttribute("x")` call returns the empty string for it instead. Which of the two the engine uses decides the failures below, so the rules say which.

## The manager

### IMP-200: One manager per package, holding one queue

[14.0.7] `ImportExportManager.ImportProc` (one call per package) creates a `DelayedResolutionManager` after the package's items are listed and before the first item. Its queue starts empty and lives until the package ends. Every item's `DoChecking` pass (`IMP-100`) receives the same manager, so the queue collects the entries of all items of the package, in the order the items are imported. This includes the second pass the import loop makes for an item whose first `doImport` fails (`IMP-250`).

The queue is applied by `ExecuteDelayedResolution` (`IMP-240`), once, after the last item of the package. It is not applied when the import is cancelled (the loop returns first) or when an item fails (the exception leaves `ImportProc`): the queue is simply dropped. The queue is never cleared, shared or carried to the next package, and it is not deduplicated.

The constructor only creates the empty queue.

## Processing the references

### IMP-201: ProcessForDelayedResolution handles each reference by its code, in list order

[14.0.7] `ProcessForDelayedResolution(references, log)` is called by `DoChecking` only when the list is not empty (`IMP-100`). For each reference, in list order, it:

1. writes the warning line of `IMP-202`;
2. then, by `faultcode`:

| Code | Reference (`IMP-103`) | Rule |
|---|---|---|
| 10001 | a `related_id` element | `IMP-210`, `IMP-211` |
| 10000 | a `data_source` element | `IMP-220` to `IMP-222` |
| 10004 | a `foreign_property` element | `IMP-220`, `IMP-222` |
| 10005 | a relationship `Item` element (`DiscussionTemplate`) | `IMP-212`, `IMP-213` |
| 10002, 10003, 0 and any other value | various | `IMP-230`: nothing |

Each reference is completed before the next is looked at, so a later reference sees the edits of the earlier ones (`IMP-250`). The first reference that fails ends the call (`IMP-203`). The result is `void`.

### IMP-202: A warning line is written for every reference before it is processed

[14.0.7] For each reference, whatever its code, the manager writes one line to the import log: the message `WARNINGTheFollowingPortionOfTheAMLContainsUnresolvedReferenceThatWillBeTriedToResolveAtTheEndOfThePackageImport`, with the problem node's `OuterXml` (as it is at that moment, so after any edit by an earlier reference) in place of `{0}`, then the log's line terminator. The message text is, with LF characters where `\n` stands:

```text
WARNING: The following portion of the AML \n{0}\ncontains unresolved reference that will be tried to resolve at the end of the package import
```

The text has a space after `AML`, and its two line feeds stay line feeds. On Windows the terminator `WriteLine` adds is CR LF (probed); the log rules of the orchestration fix it for the port. The line is written before the node is looked at, so it appears even when the reference then fails. A reference whose node is null (the checks never produce one) raises a `NullReferenceException` here, not wrapped.

### IMP-203: A failure in a code's processing is wrapped, ends the call and rolls nothing back

[14.0.7] The three processing routines (`IMP-210`, `IMP-212`, `IMP-220`) each run their whole body in a `try`. Any exception inside it, whatever its type, is replaced by a plain `System.Exception` whose message is `WrongFormatOfTheAMLThatContainsTag` with the problem node's `OuterXml` (taken when the exception is caught) in place of `{0}`, and whose inner exception is the original:

```text
Wrong format of the AML that contains tag {0}
```

It is not a `CItemException`, so the `catch (CItemException)` of the import loop (`ImportProc`) does not take it: it leaves `DoChecking` and `ImportProc` and is handled by the orchestration (wayfinder ticket 22).

The failures the routines can hit are structural, a node missing where a rule expects it. Each rule names them. The usual ones are a `NullReferenceException` (a missing attribute read with `Attributes[...]`, a missing `data_type`, a detached node) and an `InvalidCastException` (the parent is not an element, which happens for the document's root item). The original type is not part of the wrapped message.

Nothing is undone. Edits made to the document and entries queued by earlier references stay. The failing reference itself has changed nothing: each routine reads everything it needs before it queues or edits. References after the failing one are not processed. A reference's edits are never repeated: processing the same node twice makes the second attempt fail, because its relationship is already detached (`IMP-250`).

### IMP-204: The queued AML is built by string concatenation

[14.0.7] Each queue entry is a string made of fixed text and values taken from the document: attribute values read from the owning item (`type`, `id`), the problem node's `OuterXml`, and for data sources the `keyed_name` attribute and the node's text. No value is escaped. The outer XML parts are well formed, but the pieces the engine quotes by hand are not:

- a `type` or `id` value that contains an apostrophe ends the attribute early and makes the entry malformed (probed with `type="Pa'rt"`: `<Item type='Pa'rt' …`);
- a `keyed_name` or a data-source id that contains `&` or `<` is written raw, because the engine reads the decoded text of the DOM and puts it back without encoding it (probed: `keyed_name="A &amp; B"` is queued as `keyed_name='A & B'`).

A malformed entry is not detected when it is queued. It fails when it is run (`IMP-240`). The port builds the same strings, with the same quotes, and does not escape.

## Related items: code 10001

### IMP-210: A missing related item is detached from its relationship and queued as an edit of the owner

[14.0.7] The reference's node is a `related_id` element (`IMP-103`). Let `rel` be its parent, which must be an element (the relationship `Item`), and `owner` the parent of `rel`'s parent (the item whose `Relationships` hold `rel`; it is an element or null). The routine:

1. starts the entry with `<Item type='` followed by the value of `owner`'s `type` attribute and `'`. A missing `type` attribute, or an absent `owner` (the relationship is the root item, whose parent's parent does not exist), raises the `NullReferenceException` of `IMP-203` and nothing has been changed;
2. adds the owner's address:
   - when `owner` has an `id` attribute, or has no `where` attribute: ` id='` followed by the `id` attribute's value and `'`. With neither attribute the read of `id` raises a `NullReferenceException`;
   - otherwise (a `where` and no `id`): the `where` form of `IMP-211`.

   An `id` attribute counts when it is present but empty (` id=''`). When both are present, `id` wins;
3. adds ` action='edit' doGetItem='0' version='0'><Relationships>`;
4. sets `rel`'s `action` attribute to `add`. An existing `action` attribute keeps its position, otherwise the attribute is appended after the others (probed: `<Item type="Part BOM" id="R1" action="add">`);
5. adds `rel`'s outer XML, taken after step 4 (so with `action="add"`, and with the whole relationship: its other children, nested relationships, and the `__find_latest_generation_` attribute that the checks may have put on `related_id`, `IMP-150`), then `</Relationships></Item>`;
6. queues the entry, and removes `rel` from its parent. The parent (`Relationships`) stays, even when it is now empty, and so do whitespace nodes around `rel` (probed: `<Relationships></Relationships>`).

Probed result, for an owner `<Item type='Part' id='AAA' action='add'>` holding `<Item type='Part BOM' action='add'><related_id keyed_name='x' type='Part'>BBB</related_id></Item>`:

```text
<Item type='Part' id='AAA' action='edit' doGetItem='0' version='0'><Relationships><Item type="Part BOM" action="add"><related_id keyed_name="x" type="Part">BBB</related_id></Item></Relationships></Item>
```

The owner in the document is not edited, and keeps its own `action`. At the end of the package the server receives the relationship as an `add` under an `edit` of the owner, with `version='0'`. When the `related_id` carries the floating-reference attribute, it travels with the relationship (`IMP-242`).

### IMP-211: A relationship owner addressed by where is queued with the text System.Xml.XmlAttribute (bug)

[14.0.7] In the `where` form of `IMP-210` step 2 the engine intends ` where='` followed by the `where` expression. It writes the `ToString()` of the attribute object instead, which for an XML attribute is its type name. The entry therefore reads ` where='System.Xml.XmlAttribute'` (probed), and the real `where` clause is lost. The owner's `type`, `action='edit'`, `doGetItem='0'` and `version='0'` are as in `IMP-210`.

The server receives an edit of the owner's type addressed by that text instead of the real clause (not probed live). This is a reproduced bug (registered in `bugs.md`). A correct engine would write the attribute's value.

## Relationship items: code 10005

### IMP-212: A DiscussionTemplate relationship that could not be resolved is queued as an edit of its owner

[14.0.7] The reference's node is a relationship `Item` element (a `DiscussionTemplate`, `IMP-110`). Let `container` be its parent (must be an element) and `owner` the parent of `container`. The routine:

1. starts the entry with `<Item type='` followed by `owner.GetAttribute("type")` (the empty string when `owner` has no `type`) and `'`;
2. adds ` id='` followed by `owner.GetAttribute("id")` and `'`. A missing `id` gives ` id=''` (`IMP-213`);
3. adds ` action='edit' doGetItem='0' version='0'><Relationships>`, the node's outer XML as it stands, and `</Relationships></Item>`;
4. queues the entry, and removes the node from `container`.

Unlike `IMP-210`, the node's `action` is not changed: the check that recorded the reference has already set it (`IMP-110` sets `edit` or `merge` when the relationship's item exists, and leaves `add` when it does not). Probed result, for `<Item type='Discussion Forum' id='AAA' action='add'>` holding `<Item type='DiscussionTemplate' id='T1' action='add'><name>x</name></Item>`:

```text
<Item type='Discussion Forum' id='AAA' action='edit' doGetItem='0' version='0'><Relationships><Item type="DiscussionTemplate" id="T1" action="add"><name>x</name></Item></Relationships></Item>
```

The failures are structural. A node whose parent is not an element (the document's root item, probed) raises an `InvalidCastException`, and a detached node (no parent) a `NullReferenceException`, both wrapped (`IMP-203`). An `owner` that is not an element or is missing (the container is the root) fails the same way. A missing `type` or `id` does not fail.

### IMP-213: The where branch of the relationship routine can never be taken (bug)

[14.0.7] `IMP-212` is written like `IMP-210`: it chooses the `id` form when the owner has an `id`, the `where` form when it has a `where` and no `id`. The test, though, is `GetAttribute("id") != null`, and `GetAttribute` returns the empty string for a missing attribute, never null. So the test is always true. The `where` form is dead code, and an owner addressed only by `where` (or with no address) is queued with ` id=''` (probed: `<Item type='Discussion Forum' id='' action='edit' …>`). The server receives an edit by an empty id (not probed live). This is a reproduced bug (registered in `bugs.md`). A correct engine would test for the attribute's presence, as `IMP-210` does.

## Data sources and foreign properties: codes 10000 and 10004

### IMP-220: An unresolved data_source or foreign_property is queued as an edit of its Property, and set to the zero id

[14.0.7] The reference's node, `fp`, is a `data_source` element (10000) or a `foreign_property` element (10004). Let `prop` be its parent (must be an element: a `Property` item) and `owner` the parent of `prop`'s parent (the ItemType; an element or null). The routine:

1. takes `text` = `fp`'s outer XML;
2. reads `data_type` = the text of the first child element of `prop` named `data_type` (a child, not any descendant). A `prop` with no such child raises a `NullReferenceException` (probed, wrapped by `IMP-203`);
3. when `fp`'s local name is `data_source`, rewrites `text` by `IMP-221`. A `foreign_property` never is rewritten;
4. queues, with `owner.GetAttribute(…)` and `prop.GetAttribute(…)` (the empty string for a missing attribute, so none of them fails; an absent `owner` raises a `NullReferenceException`):

   ```text
   <Item type='{owner type}' id='{owner id}' action='edit' doGetItem='0'><Relationships><Item type='Property' id='{prop id}' action='edit'>{text}</Item></Relationships></Item>
   ```

5. sets `fp`'s text to the zero id (`IMP-222`).

Neither `Item` carries `version` here, and the Property is edited by its id (` id=''` when it has none; probed). The queued entry is built from `text`, which was taken before the zero id was written.

### IMP-221: A bare data_source is rewritten as a get of the list, sequence or ItemType

[14.0.7] `IMP-220` step 3 replaces `text` only when both hold:

- `data_type` is, compared as a case-sensitive string with no trimming, one of `list`, `filter list`, `color list`, `sequence` or `item`. Anything else, including `mv_list` types, `LIST` and `foreign`, leaves `text` as the node's outer XML (probed);
- `fp` has no child element named `Item` (`fp.SelectSingleNode("Item")` is null). When it has one, `text` also stays as the outer XML, nested item included.

The rewritten text is, with `T` and `K` as below and the id being the decoded text of `fp` (`InnerText`):

```text
<data_source type='{T}'><Item type='{T}' keyed_name='{K}' action='get'><id>{id}</id></Item></data_source>
```

- `T` is `List` when `data_type` contains `list` (so for `list`, `filter list` and `color list`), `Sequence` for `sequence`, and `ItemType` for `item`;
- `K` is `fp`'s `keyed_name` attribute, or the empty string when it has none.

The formatting is culture independent. The other attributes of `fp`, including a `type` it carried, are not copied. Values are not escaped (`IMP-204`). Probed results:

- `<data_source keyed_name='My List' type='List'>LID1</data_source>` with `data_type` `list` queues `<data_source type='List'><Item type='List' keyed_name='My List' action='get'><id>LID1</id></Item></data_source>`;
- `<data_source keyed_name='S1'>SID</data_source>` with `sequence` queues the same shape with `Sequence`;
- a `filter list` without `keyed_name` queues `keyed_name=''`.

The nested `get` names the source by its id, so at the end of the package, when the list, sequence or ItemType has been imported, the edit of the Property points it at the real item (not probed live).

### IMP-222: The reference is replaced by the zero id in the imported document

[14.0.7] After queuing, `IMP-220` sets the `InnerText` of `fp` to `00000000000000000000000000000000` (32 zeros, the engine's constant `FakedDataSource`). `InnerText` assignment replaces every child of `fp`, text and nested elements alike, by a single text node, and keeps its attributes (probed: `<data_source keyed_name="Part" type="ItemType">0000…</data_source>`). The `Property` item stays in the document with this `data_source` and is imported with it, so the property is created pointing at the zero id, and the queue entry of `IMP-220` later edits it to the real reference (not probed live).

The same value is what the data-source check ignores (`IMP-140` selects only `data_source` values that are neither empty nor the zero id), so a second pass over the same document does not report the node again.

## References that are only logged

### IMP-230: Codes 10002, 10003, 0 and unknown ones change nothing

[14.0.7] A reference with the code `10002` (a `source_id` of a `RelationshipType`), `10003` (a `related_id` of a `RelationshipType`), `0` (a reference the checks could not classify) or any other value gets only the warning line of `IMP-202`. The document and the queue are not touched, and the call goes on to the next reference (probed for 10002, 10003, 0 and 10006). The node stays in the document, and the import goes on without any delayed fix for it.

## Running the queue

### IMP-240: ExecuteDelayedResolution applies the queue in order and stops at the first failure

[14.0.7] `ExecuteDelayedResolution(helper, log)` runs once for the package (`IMP-200`). For each queue entry, in queue order:

1. computes the AML to send: if the entry contains the text `__find_latest_generation_` (a case-insensitive search of the whole entry, ordinal comparison; the entry's own tags, attributes and text values all count), the result of `ReplaceRelatedIdOnLatestId` (`IMP-241`) when it is not null, and otherwise the entry. Without the text it is the entry;
2. writes the log line `DELAYEDRESOLUTIONAapplyingAML` with the AML in place of `{0}`, then the line terminator:

   ```text
   DELAYED RESOLUTION: applying AML {0}
   ```

3. calls `helper.applyAML` with it (`WIRE-006`: one `ApplyItem` request, a `CItemException` on any fault, faultcode `0` included). The response is not looked at.

An empty queue does nothing (no log line). There is no `try`: the first exception ends the call. The entries before it have been applied and stay applied, there is no transaction across entries, and the entries after it are not sent. The failing entry's log line has already been written (probed with a recording helper that fails on the second call: two lines written, two requests, then the exception). The exception is a `CItemException` for a server fault, an `XmlException` when an entry is not well-formed (below), or whatever the helper raises. How the import orchestration reports it is wayfinder ticket 22's.

An entry that is not well-formed fails in one of two places, with the same class of error: with the text of step 1 present, in the parse of `IMP-241` before the log line (probed: no line, no request for it, an `XmlException` whose message is the parser's); without it, inside `applyAML`, because IOM loads the AML string before sending it (`WIRE-006`; the log line is written first). An entry made by `IMP-204` from a value with an apostrophe or `&` ends up in one of these.

### IMP-241: ReplaceRelatedIdOnLatestId parses the entry and looks for a floating related_id

[14.0.7] `ReplaceRelatedIdOnLatestId(helper, aml)` is called only for entries that contain the marker text (`IMP-240`). It:

1. loads `aml` into a new, empty DOM. The parser's `XmlException` for a malformed `aml` escapes unwrapped;
2. selects the first node, in document order, matching `/AML/Item/Relationships/Item/related_id`. When there is none, or it has no `__find_latest_generation_` attribute, it returns null;
3. otherwise (never reached, `IMP-242`) removes the attribute, reads the node's text as the id and its `type` attribute as the type (a missing `type` raises a `NullReferenceException`), sets the node's text to `helper.GetCurrentIdOfVersion(id, type)` and returns the document's outer XML.

The attribute is put on a `related_id` by the checks to mark a reference to a floating relationship whose target does not exist yet (`IMP-150`), so that the delayed run can replace the id by the target's current generation. Step 3 is that replacement. Probed by calling the method directly with an AML whose root is `AML`: the attribute is removed, the id replaced by the helper's answer, and `GetCurrentIdOfVersion` receives the id and the type.

### IMP-242: The floating-reference replacement never runs, so the marker attribute is sent as it is (bug)

[14.0.7] The path of `IMP-241` step 2 starts at `/AML`, but every entry the manager queues (`IMP-210`, `IMP-212`, `IMP-220`) starts with `<Item`: its root element is `Item`. So the selection never matches, `ReplaceRelatedIdOnLatestId` always returns null (after the parse), and `IMP-240` sends the entry unchanged. Step 3 is unreachable, and `GetCurrentIdOfVersion` is never called from here (probed: a recording helper saw no call for an entry that holds the attribute).

The effects are:

- the `related_id` of a floating relationship is queued with its unresolved id and the attribute `__find_latest_generation_="yes"` still on it (probed). The server receives an attribute it does not know, and the id that did not resolve in the document;
- the only observable work of the method is the parse of `IMP-241` step 1: a malformed entry that holds the marker fails there, before its log line is written (`IMP-240`).

This is a reproduced bug (registered in `bugs.md`). The port parses and returns null, as the engine does, and does not implement step 3. A correct engine would match `/Item/Relationships/Item/related_id`.

## Interplay

### IMP-250: References are processed one by one on a live document, and the queue is not deduplicated

[14.0.7] Because each reference is completed before the next (`IMP-201`) and the document is edited in place:

- a node already detached by an earlier reference is still processed when it is still in the list: its enclosing relationship has gone, but the subtree is intact. Probed with a `Discussion Forum` holding a `DiscussionTemplate` relationship, which holds a `FeedTemplate` relationship with an unresolved `related_id`, references `[10005 on the template, 10001 on the related_id]`: both are queued. The first entry is an edit of the forum carrying the template with its nested relationship, the second an edit of the template carrying the nested relationship again, so the nested relationship is sent twice. With the order reversed the nested relationship is queued first, as an edit of the template, and the forum's entry carries the template without it;
- a reference processed twice fails: after `IMP-210` removes `rel`, a second 10001 for the same node finds `rel` detached and raises the wrapped `NullReferenceException` (probed);
- a failure leaves the earlier effects in place (`IMP-203`).

The same item can go through `DoChecking` twice (`IMP-100`: the first pass without the full check, the second after a failed `doImport`), and the manager is the same. The second pass reports only what the first left in the document (the zero id of `IMP-222` keeps a processed `data_source` out of it), and every entry it adds is queued after the first pass's. Duplicated entries are run in order, and two entries that add the same relationship are both sent.
