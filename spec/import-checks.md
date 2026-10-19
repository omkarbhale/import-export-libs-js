# Import reference checks

Before an item is imported, the engine checks that every item it refers to exists on the server, and queues the references that do not for delayed resolution (`IMP-200` to `IMP-299`). This document specifies the checking: `DoChecking`, `RecurseCheck` and the checks it runs, the metadata lookups they share, `IsVersionable` and `GetCurrentIdOfVersion`.

Sources: the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`, never committed) and `evidence/libs-import-spec.md` §2 "RecurseCheck", checked against the dev server for the response shapes the checks read. For the `[14.35]` lines, the 14.35 decompile (`.decomp/14.35/`) compared with it, and the probes `n01` to `n03`, `n09` of `fixtures/import-run/` (`probe-14.35.txt`, run against the real 14.35 `Libs.dll`): the checks are the same code in both builds except for how they use the request cache (`IMP-102`). For the `[12.0]` lines, the 12.0 decompile (`.decomp/12.0/`, never committed) compared method by method with the 14.0.7 one, and the 12.0 probes (`fixtures/import-load/*.12.0*`, `fixtures/import-run/probe-12.0.txt`, `fixtures/import-merge/12.0-probe/results.json`).

Conventions:

- **Item document.** The checks run on one package item's document: the `XmlDocument` that `GetItemsFromPackageDom` made for it (`IMP-0xx`), whose root is the `Item` element (with `doGetItem="0"`). `.//Item` is read from the document node, so it includes the root item.
- **Requests.** Every request is an AML string sent with `CItemHelper.applyAML` (WIRE-006). A fault, including faultcode `0`, throws a `CItemException` (WIRE-051). Values read from the document are interpolated into the strings without escaping (AGENTS.md rule 7): a value holding a quote or `&` changes or breaks the request. When the string is not well-formed, IOM's `loadAML` throws the XML parser's exception, which is not a `CItemException`. When its root is not one `Item`, IOM throws `System.Exception` with the text `Not a single item`.
- **Responses.** A response is the SOAP envelope document (WIRE-004). Results are read at `Envelope/Body/Result/Item/…`, with `Envelope`, `Body` and `Result` matched by local name in the SOAP namespace or in no namespace; the lookups written `.//*[local-name(.)='Result']/Item/…` match a `Result` anywhere.
- **Log lines.** `WriteLine` on the package's log writer (the line terminator and buffering are `IMP-4xx`'s). Message texts are `ResourceManager` messages, quoted below.

## Entry point

### IMP-100: DoChecking runs the full check or only the data-source check, then hands the unresolved list on

[14.0.7] `DoChecking(manager, itemDoc, log, doFullCheck)`:

1. writes `********** Start of reference checking ************`;
2. makes an empty list of unresolved references (IMP-103);
3. when `doFullCheck` is true runs `RecurseCheck` (IMP-101) into the list, otherwise only `CheckDataSourceReferences` (IMP-140), unwrapped (IMP-104 does not apply, so its failures reach the caller as they are);
4. when the list is not empty, calls `DelayedResolutionManager.ProcessForDelayedResolution(list, log)` (`IMP-2xx`), which edits the item document before the import;
5. writes `************* End of reference checking ************`.

If a check throws, the end line is not written and the list is not handed on. The import orchestration decides the flag (`IMP-4xx`): it is false only for `delete` items on the first attempt, and true when the retry after a failed import checks the item again.

[12.0] Same: the same two log lines around the checks, the same flag, the same hand-over to `ProcessForDelayedResolution` and the same behaviour when a check throws. The log lines are the same text (observed in every scenario of `fixtures/import-run/probe-12.0.txt`).

[14.35] Same as 14.0.7.

### IMP-101: RecurseCheck runs its checks in a fixed order

[14.0.7] `RecurseCheck(itemDoc, log, unresolved)` runs, in this order, on the same document, each seeing the edits the earlier ones made:

1. `CheckRelationshipItems` (IMP-110);
2. `CheckGetItems` (IMP-120);
3. `CheckPropertiesAndRelationshipTypes` (IMP-130);
4. `CheckDataSourceReferences` (IMP-140);
5. `CheckRelatedItems` (IMP-150);
6. the RelationshipType `source_id` and `related_id` check (IMP-160);
7. the Relationship View `grid` check (IMP-161).

Checks 1, 2, 4 and 5 append to `unresolved` in that order, so the list holds the 10005 entries first, then those of `CheckGetItems` in document order, then 10000, then 10001 (IMP-103). The first failure ends the run (IMP-104). A null argument throws `ArgumentNullException` before anything else and is not wrapped; the import path never passes one.

[12.0] Same: the same seven checks in the same order.

[14.35] Same as 14.0.7.

### IMP-102: Responses are cached by request string, per helper, for successes only

[14.0.7] A `CItemHelper` owns one dictionary from AML string to response document, `_requestedItems`, with ordinal, case-sensitive keys. It is created with the helper and never emptied or invalidated, so it lives for the whole import run, across packages and items; a type created or changed by an earlier item of the run is still seen as it was when first read. Every lookup in this document, and the other cached lookups of the engine (the unique-key and float-property lookups, the export's `GetItemType(name)`), share it.

A lookup checks the dictionary under the exact string it is about to send. On a hit the stored response is used and nothing is sent. On a miss the request is sent and, only when it succeeds, its response is stored. A fault is never stored, so a request that failed, including a faultcode `0` "not found", is sent again every time it is made. The checks that log the outcome write `-> was obtained from server` / `-> was obtained from cache` (`CheckRelationshipItems`, `CheckGetItems`) or `  was obtained from server` / `  was obtained from cache` (the others, with two leading spaces).

[12.0] Same: the same `_requestedItems` dictionary, the same keys, the same rule that only successes are stored, the same log words (observed in `fixtures/import-run/probe-12.0.txt`: `was obtained from server` on a first request, `was obtained from cache` on the next).

[14.35] The cache is one `ConcurrentDictionary` from the AML string to a lazily run request, owned by the `CItemHelper` and keyed as before (ordinal, case-sensitive). It is shared by the same lookups as in 14.0.7 and is not emptied during the run. The lookups differ in how they use it.

- **Hit and miss.** On a hit the stored document is used and nothing is sent. On a miss the request is stored first, then run, so a failure leaves an entry behind unless the lookup removes it. A request that throws is remembered by the lazy value: every later read of that entry throws the same exception without a request.
- **Removal.** `CheckGetItems`, `CheckDataSourceReferences`, `CheckRelatedItems`, the RelationshipType and grid checks and `CheckRelationshipItems` (`IMP-120`, `IMP-140`, `IMP-150`, `IMP-160`, `IMP-161`, `IMP-110`) remove the entry for the request when it throws a `CItemException`, whatever the faultcode, before they act on the faultcode. `GetTypeAmlInner` (`IMP-132`) does the same. `GetLabelOfItemType` (`IMP-447`) also removes it for an `XmlException`, an `XPathException` and a `NullReferenceException`. So, as in 14.0.7, a request that failed with a fault is sent again next time (probe `n09`: `IsVersionable` of a missing type sends twice).
- **Entries that stay.** `GetUniqueProperties` (`IMP-321`) never removes its entry, and the `add` of `GetPackageGroupIdOrCreateIfNotExists` (`IMP-446`) does not remove the entry it leaves. The lookups of the previous bullet remove it only for a `CItemException`, so a request that failed in another way (a request that does not parse) stays too. Every later lookup of such an entry rethrows its exception with no request (`IMP-183`, probe `n09`), except that the group lookup's handler removes the entry the first time it rethrows it (`IMP-446`): the keyed-properties entry is never removed.
- **Log lines.** `CheckGetItems`, `CheckDataSourceReferences`, `CheckRelatedItems` and the RelationshipType and grid checks no longer write `was obtained from cache` on a hit (probe `n01`), and write `was obtained from server` before the request is sent, not after it (`IMP-181`). `CheckRelationshipItems` and `GetTypeAmlInner` still write both lines, after the answer.

The helper that built the cache is the only one: a new `CItemHelper` starts with an empty cache.

### IMP-103: An unresolved reference is a code and a node; the codes are 10000 to 10005 and 0

[14.0.7] An unresolved reference (`UnresolvedReference`) is a faultcode and the document node the problem is at. The checks record them as follows; the code decides what `ProcessForDelayedResolution` does (`IMP-2xx`).

| Code | Recorded by | Node |
|---|---|---|
| 10000 | `CheckGetItems` for a get under `data_source`; `CheckDataSourceReferences` | the `data_source` element |
| 10001 | `CheckGetItems` for a get under `related_id`; `CheckRelatedItems` | the `related_id` element |
| 10002 | `CheckGetItems` for a get under `source_id` of a RelationshipType | the `source_id` element |
| 10003 | `CheckGetItems` for a get under `related_id` of a RelationshipType | the `related_id` element |
| 10004 | `CheckGetItems` for a get under `foreign_property` | the `foreign_property` element |
| 10005 | `CheckRelationshipItems` | the relationship `Item` element |
| 0 | `CheckGetItems` for any other parent | the parent node |

The enum `eUnresolvedError` that names these codes is never used; the engine writes the integers.

[12.0] Same: the same codes recorded by the same checks (`eUnresolvedError` is unused here too).

[14.35] Same as 14.0.7.

## Failure

### IMP-104: Any failure of RecurseCheck becomes a faultcode -1 CItemException ending in "Recurse check has failed."

[14.0.7] Everything the seven checks throw is caught by one handler in `RecurseCheck`: a `CItemException` of any faultcode, an `XmlException`, an `XPathException`, `InvalidCastException`, `NullReferenceException`, IOM's exceptions. It throws a new `CItemException` with faultcode `-1`, the original as inner exception, `faultdetail` and `Message` equal to the original's `Message` followed by ` Recurse check has failed.` (a leading space), and `faultstring` equal to the original's .NET stack-trace text. The original's `faultcode` is lost, so the faultcode `0` that some checks treat as "not found" never leaves `RecurseCheck`.

The import path reads only `Message` (the warning of the retry, the failure text of the package, the run log), never `faultstring`, so the port does not reproduce a stack trace and may leave `faultstring` empty. `Message` of the original, where the checks create it:

- a `CItemException` raised by `applyAML` has the text of WIRE-051 (`Server error`, the request, `Responce`, the response);
- a four-argument `CItemException` (`CItemException(code, string, detail, inner)`) has its `faultdetail` as `Message`;
- `XmlException(text)` has just the text;
- the .NET texts the port must reproduce, where a rule below says a check raises the exception: `Object reference not set to an instance of an object.` (`NullReferenceException`), and `Unable to cast object of type 'System.Xml.XmlComment' to type 'System.Xml.XmlElement'.` (`InvalidCastException`, IMP-130; the node type named is the offending node's). The text of an `XPathException` or `XmlException` for malformed XPath or XML is the .NET parser's and is pinned by the XML core's fixtures, not here.

[12.0] The same handler, with the same faultcode `-1`, the same suffix ` Recurse check has failed.` and the same loss of the original faultcode. The `Message` of an exception raised by `applyAML` differs, because 12.0 builds it from the response alone (WIRE-051 [12.0]): it is the whole response document's outer XML, with no `Server error`, `Request:` and `Responce:` parts, so the wrapped message reads `<SOAP-ENV:Envelope …>…</SOAP-ENV:Envelope> Recurse check has failed.` The other sources of `Message` (the four-argument `CItemException`, `XmlException(text)` and the .NET texts) are the same.

[14.35] Same handler and rules. The `Message` of the original `CItemException` that `applyAML` raises is the 14.35 text of `WIRE-051`, which pretty-prints the request and the response (wayfinder ticket 69 specifies it), so the texts quoted above change with it (probe `s05`, `s06`: `Server error`, then `Request (formatted):` and `Response (formatted):`, no longer `Request:` and `Responce:`). The suffix ` Recurse check has failed.` and the other texts quoted here are unchanged.

### IMP-180: The detail texts the checks attach to a fault never reach the error (bug)

[14.0.7] Three places set `faultdetail` on a `CItemException` caught from a lookup and rethrow it: `GetTypeAmlInner` (`Unable to get definition of {type}: {name}`, IMP-132), the RelationshipType check (`Bad {source_id|related_id} {keyed_name} for {name}`, IMP-160) and the grid check (`Bad Grid {keyed_name} for {name}`, IMP-161). `Message` of an exception from `applyAML` does not change when `faultdetail` does, and IMP-104 builds its error from `Message`, so none of these texts is ever shown or logged. The wrapped error says `Server error … Responce: … Recurse check has failed.` instead. A port that logs the intended text instead would differ.

`GetTypeAmlInner` builds its text from the `type` attribute object rather than its value, so even the property it sets reads `Unable to get definition of System.Xml.XmlAttribute: {name}`; it is visible only in the `faultdetail` field of the exception object, which nothing on the import path reads.

[12.0] Same bug. The three places set `faultdetail` as in 14.0.7 (with the same texts, `Unable to get definition of {type}: {name}`, `Bad {source_id|related_id} {keyed_name} for {name}` and `Bad Grid {keyed_name} for {name}`), `GetTypeAmlInner` builds its text from the attribute object, and `IMP-104` builds its error from `Message`, so none of them is shown. The wrapped error differs only in the form of `Message` (IMP-104 [12.0]). Registered in `bugs.md`.

[14.35] Same as 14.0.7.

### IMP-181: A cache miss logs "obtained from server" before the request is sent (bug)

[14.0.7] Not present: the line is written after a successful answer (`IMP-120`, `IMP-140`, `IMP-150`, `IMP-160`, `IMP-161`).

[14.35] In `CheckGetItems` (`-> was obtained from server`), `CheckDataSourceReferences`, `CheckRelatedItems` and the RelationshipType and grid checks (`  was obtained from server`) the line is written by the code that runs the request, before the request is sent. A request that then fails, with any fault, has the line in the log all the same (probe `n02`: the nested get is refused with fault 5, and the log reads `checking item with get action:…` then `-> was obtained from server`; probe `n02b` for the data source). `GetTypeAmlInner` and `CheckRelationshipItems` still write the line after the answer. A correct engine would log after the answer. Registered in `bugs.md`.

### IMP-182: A forced re-request of a type definition does not replace the cached one (bug)

[14.0.7] Not present: the forced request replaces the cached definition (`IMP-132`).

[14.35] `GetTypeAmlInner` with `force` runs the request and returns its answer, but adds it to the cache only when no entry exists (`IMP-132`), so the stale definition that made the check re-request stays cached. Every later item whose relationship type that definition lacks hits the stale entry, fails the test of `IMP-130` step 4, and sends the definition again. Probe `n03`: the first answer for `Part` lacks `Part BOM`, the later ones have it, and three `Part` items give four definition requests, where 14.0.7 gives two (the second request replaced the entry). A correct engine would replace the entry. Registered in `bugs.md`.

### IMP-183: A failed unique-property or group lookup is remembered (bug)

[14.0.7] Not present: a failed request is not stored (`IMP-102`).

[14.35] `GetUniqueProperties` and the `add` of `GetPackageGroupIdOrCreateIfNotExists` keep the lazy request that failed (`IMP-102`). The next lookup of the same string rethrows its exception with no request (every later one for the keyed properties; the group lookup removes its entry when it rethrows, `IMP-446`). For `GetCurrentIdByUniqueKey` (`IMP-321`) a unique-key lookup that failed once, with faultcode `0` included, gives the same answer for the rest of the run without asking the server again, so an ItemType that is created later in the run is still taken for one with no keyed properties. For the group (`IMP-446`) a refused `add` is repeated from the cache by the next call, which then removes it. Probe `n09`. A correct engine would not remember a failure, as the other lookups do. Registered in `bugs.md`.

## The checks

### IMP-110: CheckRelationshipItems resolves DiscussionTemplate relationships that exist

[14.0.7] The check handles one relationship type, `DiscussionTemplate` (the engine's list `relationshipTypesForCheckingOnDelayedResolution`). Each element `.//Item/Relationships/Item[@type='DiscussionTemplate']`, in document order, is handled as follows. Let `type` and `id` be its `type` and `id` attributes (`""` when absent). When either is empty it is skipped without a request.

1. Build `<Item type='{type}' id='{id}' action ='get' select='id' levels='0'></Item>` (note the space before `=` of `action`) and write `checking item with get action:{that string}`.
2. On a cache hit (IMP-102) write `-> was obtained from cache` and go to the next element. Nothing else happens.
3. Otherwise send it. A fault other than faultcode `0` is thrown. For faultcode `0`, record 10005 (IMP-103) with the relationship element and go on.
4. On success (the item exists) write `-> was obtained from server` and cache the response. Let `nested` be the `Item` elements below the relationship element (`.//Item`). When there are none, go on: it is not unresolved.
5. When there are nested items: set the relationship element's `action` attribute to `edit`, and for each nested `Item` whose `action` attribute is `add` set it to `merge`, except that, when the relationship's `id` is `9D257D4D16AC480493571BBF816D13BE` and the nested item's `type` is `FeedTemplate`, it is set to `edit`. Then record 10005 with the relationship element.

So an existing template with children is both rewritten and queued, and a missing one is queued unchanged. The fixed id is the built-in discussion template; the comparison is exact (upper case). Step 5 sets the attribute through `GetNamedItem("action").Value`: a relationship element with no `action` attribute throws `NullReferenceException`, after the response was cached, and fails the check (IMP-104).

[12.0] Steps 1 to 4 are the same, as are the request (with the space before `=` of `action`), the cache, the log lines and the 10005 entries. Step 5 differs: **every** nested `Item` whose `action` is `add` becomes `merge`, with no exception. A `FeedTemplate` below the built-in template `9D257D4D16AC480493571BBF816D13BE` is `merge` like the others, where 14.0.7 makes it `edit`. The relationship element's own `action` is still set to `edit`, a relationship with no `action` attribute still throws `NullReferenceException` after the response was cached, and the entry 10005 is still recorded.

Observed (`s64-discussion-template` in `fixtures/import-run/probe-12.0.txt`; the same scenario in `probe-14.0.7.txt`): a `Discussion Forum` with a `DiscussionTemplate` of the built-in id holding `FeedTemplate` add `FT1`, `Other` add `O1` and `FeedTemplate` edit `FT2`, and a second template `T2` holding `FeedTemplate` add `FT3`. The queued edits of the forum carry `FT1 action="merge"` in 12.0 and `FT1 action="edit"` in 14.0.7; `O1` and `FT3` are `merge` in both and `FT2` stays `edit`.

[14.35] The decision is as in 14.0.7 (steps 1 and 5, the same attribute edits, the same 10005 record). The cache handling differs (probe `n04`, `n04b`):

- a hit (an entry for the request exists) writes `-> was obtained from cache` and does nothing else, as before;
- on a miss the request is stored and sent; a fault removes the entry, a fault other than 0 is thrown and faultcode `0` records 10005, as before;
- on success it writes `-> was obtained from server`. When the relationship has no nested `Item` the check ends there and the entry stays. When it has, the check makes its edits (step 5) and then throws a faultcode-0 `CItemException` with the text `ThisItemTypeItemHasItemsWithReferencesOnNonExistingItems` for the type, which the check's own handler turns into the 10005 record, as 14.0.7 does; and the handler **removes the entry**, which 14.0.7 never did (`IMP-111`).

### IMP-111: A relationship is rewritten only the first time its id is checked (bug)

[14.0.7] Because step 2 of IMP-110 returns on a cache hit and the cache is never emptied (IMP-102), the edit/merge rewrite happens only for the first relationship element carrying that `id` in the whole run, and a later element with the same id, in this or another item or package, is left as it is, without being recorded as 10005 either. A correct engine would rewrite each element on its own merits.

[12.0] Same bug: the same early return on a cache hit and the same never-emptied cache. Registered in `bugs.md`.

[14.35] Partly fixed. The entry of a template that had nested items is removed (`IMP-110`), so every element with that id is rewritten and recorded 10005 (probe `n04`: both forums' templates become `edit` with their nested `FeedTemplate` adds changed to `merge`, and both are queued; in 14.0.7 only the first forum's was). The entry of a template with **no** nested items stays, and a later element with the same id that does have nested items hits it and is left as it is, without a record (probe `n04b`), as in 14.0.7. A correct engine would rewrite each element on its own merits. Registered in `bugs.md`.

### IMP-120: CheckGetItems sends each nested get verbatim and records the missing ones

[14.0.7] Each element `.//Item[@action='get']` of the document, in document order, nested ones included, is handled in turn:

1. Let `aml` be the element's `OuterXml` (the .NET serialization, WIRE-004). Write `checking item with get action:{aml}`.
2. On a cache hit (IMP-102) write `-> was obtained from cache`. Otherwise send `aml` itself (not a rewritten request), cache the response and write `-> was obtained from server`.
3. A fault other than faultcode `0` is thrown. For faultcode `0` the reference is unresolved; its node is the element's parent, and the code is chosen by the parent's name:
   - `related_id`: 10003 when the parent's parent has `type="RelationshipType"`, otherwise 10001 (also when it has no `type`);
   - `source_id`: 10002 when the parent's parent has `type="RelationshipType"`; otherwise the code stays 0;
   - `data_source`: 10000;
   - `foreign_property`: 10004;
   - any other parent: 0.

The root item counts when its own action is `get`: its parent is the document, which matches no name, so it is recorded with code 0 and the document as its node. The engine skips an element with no parent; none can occur. Nothing is changed in the document here; the entries are acted on by `ProcessForDelayedResolution` (`IMP-2xx`).

[12.0] Same: the same elements, the same request (the element's `OuterXml`), the same log lines and the same codes by parent name.

[14.35] Same selection, order, request (the element's `OuterXml`), unresolved codes (`IMP-103`) and fault handling as 14.0.7, with the cache differences of `IMP-102` (probes `n01`, `n02`):

- a hit writes nothing after the `checking item with get action:` line (14.0.7 wrote `-> was obtained from cache`);
- a miss writes `-> was obtained from server` before the request is sent (`IMP-181`), so a request that then fails has the line too;
- a `CItemException` removes the entry before the faultcode is looked at.

### IMP-130: CheckPropertiesAndRelationshipTypes checks that each relationship type belongs to the item's type, recursively

[14.0.7] On the document it is given (the item document, then one relationship element each time it recurses), with `type` the root element's `type` attribute:

1. An empty or missing `type` throws `XmlException` with the text `type attribute is missing`.
2. Read the type definition (IMP-132) with `<Item type='ItemType' action='get' select='id'><name>{type}</name><Relationships><Item type='Property' action='get' select='name'/><Item type='RelationshipType' action='get' select='name'/></Relationships></Item>`. It is sent for every item and every nested relationship item, even when there is nothing to check, so a type that is not on the server fails here with faultcode `0` (IMP-104).
3. Visit each child node of the root, of any node kind, in order. For `Relationships` (the element, matched by name) visit each of its child nodes as an element: a child that is not an element, such as a comment or non-whitespace text, throws `InvalidCastException` (whitespace-only text is dropped when the document is loaded). An element that is not named `Item` throws `XmlException` with `Relationships tag can contain only Item tags, but found {name}`.
4. For each such `Item`, with `t` its `type` attribute (`""` when absent), look in the type definition's response for `Item/Relationships/Item[@type='RelationshipType' and name='{t}']`. When it is there, go on. When it is not, request the definition again with the cache bypassed (IMP-132) and look again, using the new response from then on; when it is still not there throw `CItemException` (faultcode `-1`, faultstring `RecurseCheck`, detail `Bad Relation type {t} for {type}`).
5. Recurse on a new document made from that relationship `Item`'s outer XML. Its own `type` must therefore be set and name an ItemType, and its own `Relationships` are checked against that type.

A `t` that holds a quote makes the XPath malformed.

[12.0] Same: the same type check, the same request, the same recursion and the same failures. The texts of the failures are the same (`type attribute is missing`, `Relationships tag can contain only Item tags, but found {name}`, `Bad Relation type {t} for {type}`; faultstring `RecurseCheck`).

[14.35] Same as 14.0.7, with the type-definition cache of `IMP-132`: the re-request of step 4 is not stored (`IMP-182`), so each later item whose relationship type the cached definition lacks sends the definition again (probe `n03`: three `Part` items and a definition that lacks the relationship type at first give four definition requests, where 14.0.7 gives two).

### IMP-131: The property check compares a name with itself and so never fires (bug)

[14.0.7] The `else` arm of step 3 of IMP-130 is for a child node named `Property`: it looks for `Item[@type='Property' and name='{x}']` in the type definition, where `x` is the child's element name, which is always `Property`. It would pass when the ItemType has a property named `Property` and otherwise throw `CItemException` (faultcode `-1`, faultstring `RecurseCheck`, detail `Bad property name Property for type {type}`). Property values of an item are child elements named after the property, so the property names of the document are never checked: only an item whose element is literally `<Property>` reaches it. A correct check would look up each child element's name. The definition request already asks for the properties, but nothing else reads them.

[12.0] Same bug: the same comparison of the element name with itself, the same text `Bad property name Property for type {type}`. Registered in `bugs.md`.

[14.35] Same as 14.0.7.

### IMP-132: Type definitions are read through GetTypeAmlInner and GetMetaDataInfo

[14.0.7] `GetTypeAmlInner(aml, log, force=false)` writes `aml` to the log when a log writer is given, and returns the cached response for that exact string (IMP-102) unless `force`; otherwise it sends it, caches the response (replacing any earlier one) and writes `  was obtained from server`. A hit writes `  was obtained from cache`. A `CItemException` of faultcode `0` gets a `faultdetail` of `Unable to get definition of {type attribute}: {first name child, or empty}` (IMP-180) and is rethrown; every other exception is rethrown as it is.

`GetMetaDataInfo(type, name, select, log)` builds `<Item type='{type}'`, then ` select='{select}'` when `select` is not empty, then ` action='get'>`, then `<name>{name}</name></Item>` (no whitespace), and calls `GetTypeAmlInner` with it. `GetItemType(name, select, log)` is `GetMetaDataInfo` for `ItemType` and `GetRelationshipType(name, select, log)` for `RelationshipType`. `IsVersionable` and `CheckRelatedItems` pass no log writer, so those requests are not logged.

[12.0] Same: `GetTypeAmlInner`, `GetMetaDataInfo`, `GetItemType` and `GetRelationshipType` build the same requests and use the same cache and the same log words. The fault detail `Unable to get definition of System.Xml.XmlAttribute: {name}` is the same (IMP-180).

[14.35] `GetTypeAmlInner(aml, log, force)` writes `aml` to the log when a log writer is given, as before. Without `force`, an entry for `aml` is used and `  was obtained from cache` is written. Otherwise a lazy request is created and added **only if no entry exists yet** (`TryAdd`), then run, and `  was obtained from server` is written after the answer. A forced request on an existing entry therefore runs and returns its own answer to the caller, but the old document stays in the cache (`IMP-182`). A `CItemException` removes the entry for `aml` (an older successful one too, in the forced case), then gets the faultcode-0 detail of `IMP-180` and is rethrown, as in 14.0.7. `GetMetaDataInfo`, `GetItemType` and `GetRelationshipType` are unchanged.

### IMP-140: CheckDataSourceReferences checks the list, sequence or ItemType a property points at

[14.0.7] Each element selected by `.//Item[@type='Property' and data_source and data_source!='' and data_source!='00000000000000000000000000000000' and not(data_source/Item)]`, in document order, is handled with `data_type` the text of its first `data_type` child (`""` when none) and `data_source` its first `data_source` child:

1. `foreign`: skipped.
2. `item`: write `checking <data_source> reference to the ItemType`. When the `data_source` has no `keyed_name` attribute the property is skipped silently. Otherwise the request is `<Item type='ItemType' action='get' select='id'><name>{keyed_name}</name></Item>`.
3. Anything else: when `data_type` is `color list`, `filter list` or ends with `mv_list` (a culture-sensitive comparison, which differs from an ordinal one only for ignorable characters) it becomes `List`. Write `checking <data_source> reference to list/sequence`. The request is `<Item action='get' type='{data_type}' select='id'><id>{text of data_source}</id></Item>`. Any other `data_type` goes in as it is, in the case it has: `list` and `sequence` are sent in lower case, and an empty one gives `type=''`.
4. Write the request string, look it up in the cache and send it when missing, writing `  was obtained from server` or `  was obtained from cache` (IMP-102). A fault other than faultcode `0` is thrown; faultcode `0` records 10000 (IMP-103) with the `data_source` element.

The `data_source!=''` and `!=` tests are node-set comparisons: they hold when some `data_source` child has text that differs.

The port compares the data type ordinally for the `mv_list` test, which differs from the engine's culture-sensitive `EndsWith` only for a `data_type` that has a character the collation ignores (such as U+00AD or U+200B) after `mv_list`; the engine takes that for a multi-value list and the port does not.

[12.0] Same: the same selection, the same `data_type` handling and the same request.

[14.35] Same selection, texts and decisions as 14.0.7, with the cache differences of `IMP-102`: step 4 writes the request string, then looks it up; a hit writes nothing more (14.0.7 wrote `  was obtained from cache`), a miss writes `  was obtained from server` before the request is sent (`IMP-181`), and a `CItemException` removes the entry before faultcode `0` records 10000 (probes `n01`, `n02b`).

### IMP-150: CheckRelatedItems checks plain related_id references, and makes floating ones follow the current version

[14.0.7] Each element `.//Item[@type!='RelationshipType']/related_id[not(Item)]` is handled in turn (an `Item` with no `type` attribute is not selected). Let `type` and `keyed_name` be the element's own attributes (`""` when absent) and `id` its text. When either is empty the element is skipped. Otherwise:

1. Write `checking for related items`, then the request `<Item type='{type}' action='get' levels='0'><id>{id}</id></Item>` (no `select`, so the whole item is read), then send it through the cache (IMP-102), writing `  was obtained from server` or `  was obtained from cache`.
2. When `IsVersionable(type)` is true (IMP-170), read the behavior of the relationship, named by the `type` attribute of the `related_id`'s parent `Item`: `GetRelationshipType(parentType, "behavior")` is `<Item type='RelationshipType' select='behavior' action='get'><name>{parentType}</name></Item>` (IMP-132), and the behavior is the text of `.//*[local-name(.)='Result']/Item/behavior`. When it contains `float` (a culture-sensitive substring test), replace the text of `related_id` with `GetCurrentIdOfVersion(id, type)` (IMP-151), which makes the reference point at the current generation. A response without a `behavior` element throws `NullReferenceException`.
3. When the get of step 1 fails with faultcode `0` (the related item does not exist yet), do the same lookup of `IsVersionable` and behavior, and when the behavior contains `float` add the attribute `__find_latest_generation_="yes"` to `related_id`. Either way record 10001 (IMP-103) with the `related_id` element, and go on.
4. A fault with another faultcode from any request of steps 1 to 3 is thrown.

The handler of step 3 is the one around steps 1 and 2 as well, so a faultcode `0` from `IsVersionable` (the related type is not on the server) or from the relationship lookup (`parentType` is not a RelationshipType name) in step 2 is taken for a missing related item; step 3 then repeats the lookup that failed, which is sent again (IMP-102) and now throws, ending the check (IMP-104).

The port tests the behavior for `float` ordinally, which differs from the engine's culture-sensitive `IndexOf` only for a behavior with a character the collation ignores inside the word (such as `fl\u00ADoat`): the engine finds it and the port does not.

[12.0] Same: the same selection, request, versionable test, behavior lookup and `__find_latest_generation_` marker.

[14.35] Same selection, requests and decisions as 14.0.7 (the request of step 1, the `IsVersionable` and behavior lookups only for a versionable related type, the `float` test, the marker attribute and the 10001 record), with the cache differences of `IMP-102`: a hit writes nothing after `checking for related items` and the request, a miss writes `  was obtained from server` before sending (`IMP-181`). The handler removes the entry of the `get` for any `CItemException`, including one raised by the `IsVersionable` or behavior lookups after the `get` succeeded, so that `get` is sent again next time.

### IMP-151: GetCurrentIdOfVersion returns the id of the current generation

[14.0.7] `GetCurrentIdOfVersion(id, type)`, which every caller shares (IMP-150, and the merge's `SetItemIdToLastGeneration`, `IMP-3xx`):

1. Send `<Item type='{type}' select='config_id, is_current' action='get'><id>{id}</id></Item>` with `applyAML`, not through the cache. A faultcode `0` is swallowed, leaving no response. Any other `CItemException` is thrown. Any other exception becomes `CItemException` (faultcode `-1`, inner exception attached, faultstring its stack trace, `Message` its message followed by `Unable to find a current version of the item (ID='{id}'; Type='{type}')`).
2. With a response: `current` is true when `Item/is_current` is present and its text equals `1` ignoring case; the working id becomes the text of `Item/config_id`, and a missing `config_id` throws `NullReferenceException`. Without a response the working id stays `id` and `current` is false.
3. When `current` is true the result is `id`.
4. Otherwise send `<Item type='{type}' select='id' action='get'><config_id>{working id}</config_id></Item>`. Any exception, a faultcode `0` included, becomes the `CItemException` of step 1 (`-1`, with the same message). The result is the text of the first `Item/id` of the response; none throws `NullReferenceException`.

When the item's generation is not the current one, the result is the id of the current generation of that config. An id that matches nothing, neither as an item id nor as a `config_id`, is an error, not the same id back.

[12.0] Same: the same two requests, the same swallowing of faultcode `0` and the same errors. The suffix `Unable to find a current version of the item (ID='{id}'; Type='{type}')` is the same.

[14.35] Same as 14.0.7.

### IMP-160: A RelationshipType's source_id and related_id must name existing ItemTypes

[14.0.7] Let `name` be the text of the document's first `.//Item[@type='RelationshipType']/name` (anywhere in the document, which may belong to another RelationshipType than the one being checked). Each element of `.//Item[@type='RelationshipType']/source_id[not(Item)] | .//Item[@type='RelationshipType']/related_id[not(Item)]`, in document order, with `type` and `keyed_name` its attributes, is skipped when either is empty. Otherwise: write `checking RelationshipType's source_id,related_id`, then `<Item levels='0' action='get' type='ItemType'><id>{text}</id></Item>`, send it through the cache (IMP-102) and write the outcome (`  was obtained from server` or `  was obtained from cache`).

Unlike the other checks, a missing item is an error, not an unresolved reference: any fault, faultcode `0` included, is thrown. A faultcode `0` first gets the detail `Bad {source_id or related_id} {keyed_name} for {name}` (IMP-180). When no RelationshipType in the document has a `name`, the detail line itself throws `NullReferenceException`, which replaces the fault. References that hold a nested `Item` are not selected; those are `CheckGetItems`'s (10002 and 10003).

[12.0] Same: the same selection, request and failures (including the `NullReferenceException` when no RelationshipType has a name).

[14.35] Same as 14.0.7, with the cache differences of `IMP-102`: a hit writes nothing after the request line, a miss writes `  was obtained from server` before sending (`IMP-181`), and the entry is removed before the faultcode-0 detail of `IMP-180` is set and the fault is rethrown.

### IMP-161: A Relationship View's grid must name an existing Grid

[14.0.7] Each element of `.//Item[@type='RelationshipType']/Relationships/Item[@type='Relationship View']/grid`, in document order, with `type` and `keyed_name` its attributes, is skipped when either is empty. Otherwise: write `checking Grids types`, then `<Item levels='0' action='get' type='Grid'><id>{inner text}</id></Item>`, send it through the cache (IMP-102) and write the outcome. Any fault is thrown, a faultcode `0` first getting the detail `Bad Grid {keyed_name} for {name}` (IMP-180), where `name` is the same document-wide RelationshipType name as in IMP-160, with the same `NullReferenceException` when there is none. A grid element that holds a nested `Item` is not excluded; the request then carries the concatenated text of its descendants.

[12.0] Same.

[14.35] Same as 14.0.7, with the cache differences of `IMP-102` described for `IMP-160`.

## Versioning

### IMP-170: IsVersionable reads is_versionable of the ItemType once per type

[14.0.7] `IsVersionable(typeName)` calls `GetItemType(typeName, "is_versionable")` (IMP-132), which sends `<Item type='ItemType' select='is_versionable' action='get'><name>{typeName}</name></Item>`, with no logging. The response is cached under that string (IMP-102), so one request is made per distinct type name for the life of the helper; a type that is not found (faultcode `0`) is not cached and the request is repeated on every call, and the exception reaches the caller unchanged. The result is true when `Item/is_versionable` is present and its text equals `1`, ignoring case, and false for any other text. When the element is absent it throws `CItemException` (faultcode `-1`, faultstring and detail `Can't determine whether item versionable or not`).

The rule applies to every caller: the checks (IMP-150), the import orchestration (`IMP-4xx`), the merge (`IMP-3xx`) and the export.

[12.0] Same: one request per type name for the life of the helper, the same result test and the same `Can't determine whether item versionable or not`.

[14.35] Same as 14.0.7: one request per distinct type name for the life of the helper, a missing type (faultcode `0`) is not remembered and is requested every time (probe `n09`), and the result and the `Can't determine whether item versionable or not` error are as before. The cache mechanism is `IMP-132`.