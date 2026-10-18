# Import reference checks

Before an item is imported, the engine checks that every item it refers to exists on the server, and queues the references that do not for delayed resolution (`IMP-200` to `IMP-299`). This document specifies the checking: `DoChecking`, `RecurseCheck` and the checks it runs, the metadata lookups they share, `IsVersionable` and `GetCurrentIdOfVersion`.

Sources: the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`, never committed) and `evidence/libs-import-spec.md` §2 "RecurseCheck", checked against the dev server for the response shapes the checks read.

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

### IMP-102: Responses are cached by request string, per helper, for successes only

[14.0.7] A `CItemHelper` owns one dictionary from AML string to response document, `_requestedItems`, with ordinal, case-sensitive keys. It is created with the helper and never emptied or invalidated, so it lives for the whole import run, across packages and items; a type created or changed by an earlier item of the run is still seen as it was when first read. Every lookup in this document, and the other cached lookups of the engine (the unique-key and float-property lookups, the export's `GetItemType(name)`), share it.

A lookup checks the dictionary under the exact string it is about to send. On a hit the stored response is used and nothing is sent. On a miss the request is sent and, only when it succeeds, its response is stored. A fault is never stored, so a request that failed, including a faultcode `0` "not found", is sent again every time it is made. The checks that log the outcome write `-> was obtained from server` / `-> was obtained from cache` (`CheckRelationshipItems`, `CheckGetItems`) or `  was obtained from server` / `  was obtained from cache` (the others, with two leading spaces).

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

## Failure

### IMP-104: Any failure of RecurseCheck becomes a faultcode -1 CItemException ending in "Recurse check has failed."

[14.0.7] Everything the seven checks throw is caught by one handler in `RecurseCheck`: a `CItemException` of any faultcode, an `XmlException`, an `XPathException`, `InvalidCastException`, `NullReferenceException`, IOM's exceptions. It throws a new `CItemException` with faultcode `-1`, the original as inner exception, `faultdetail` and `Message` equal to the original's `Message` followed by ` Recurse check has failed.` (a leading space), and `faultstring` equal to the original's .NET stack-trace text. The original's `faultcode` is lost, so the faultcode `0` that some checks treat as "not found" never leaves `RecurseCheck`.

The import path reads only `Message` (the warning of the retry, the failure text of the package, the run log), never `faultstring`, so the port does not reproduce a stack trace and may leave `faultstring` empty. `Message` of the original, where the checks create it:

- a `CItemException` raised by `applyAML` has the text of WIRE-051 (`Server error`, the request, `Responce`, the response);
- a four-argument `CItemException` (`CItemException(code, string, detail, inner)`) has its `faultdetail` as `Message`;
- `XmlException(text)` has just the text;
- the .NET texts the port must reproduce, where a rule below says a check raises the exception: `Object reference not set to an instance of an object.` (`NullReferenceException`), and `Unable to cast object of type 'System.Xml.XmlComment' to type 'System.Xml.XmlElement'.` (`InvalidCastException`, IMP-130; the node type named is the offending node's). The text of an `XPathException` or `XmlException` for malformed XPath or XML is the .NET parser's and is pinned by the XML core's fixtures, not here.

### IMP-180: The detail texts the checks attach to a fault never reach the error (bug)

[14.0.7] Three places set `faultdetail` on a `CItemException` caught from a lookup and rethrow it: `GetTypeAmlInner` (`Unable to get definition of {type}: {name}`, IMP-132), the RelationshipType check (`Bad {source_id|related_id} {keyed_name} for {name}`, IMP-160) and the grid check (`Bad Grid {keyed_name} for {name}`, IMP-161). `Message` of an exception from `applyAML` does not change when `faultdetail` does, and IMP-104 builds its error from `Message`, so none of these texts is ever shown or logged. The wrapped error says `Server error … Responce: … Recurse check has failed.` instead. A port that logs the intended text instead would differ.

`GetTypeAmlInner` builds its text from the `type` attribute object rather than its value, so even the property it sets reads `Unable to get definition of System.Xml.XmlAttribute: {name}`; it is visible only in the `faultdetail` field of the exception object, which nothing on the import path reads.

## The checks

### IMP-110: CheckRelationshipItems resolves DiscussionTemplate relationships that exist

[14.0.7] The check handles one relationship type, `DiscussionTemplate` (the engine's list `relationshipTypesForCheckingOnDelayedResolution`). Each element `.//Item/Relationships/Item[@type='DiscussionTemplate']`, in document order, is handled as follows. Let `type` and `id` be its `type` and `id` attributes (`""` when absent). When either is empty it is skipped without a request.

1. Build `<Item type='{type}' id='{id}' action ='get' select='id' levels='0'></Item>` (note the space before `=` of `action`) and write `checking item with get action:{that string}`.
2. On a cache hit (IMP-102) write `-> was obtained from cache` and go to the next element. Nothing else happens.
3. Otherwise send it. A fault other than faultcode `0` is thrown. For faultcode `0`, record 10005 (IMP-103) with the relationship element and go on.
4. On success (the item exists) write `-> was obtained from server` and cache the response. Let `nested` be the `Item` elements below the relationship element (`.//Item`). When there are none, go on: it is not unresolved.
5. When there are nested items: set the relationship element's `action` attribute to `edit`, and for each nested `Item` whose `action` attribute is `add` set it to `merge`, except that, when the relationship's `id` is `9D257D4D16AC480493571BBF816D13BE` and the nested item's `type` is `FeedTemplate`, it is set to `edit`. Then record 10005 with the relationship element.

So an existing template with children is both rewritten and queued, and a missing one is queued unchanged. The fixed id is the built-in discussion template; the comparison is exact (upper case). Step 5 sets the attribute through `GetNamedItem("action").Value`: a relationship element with no `action` attribute throws `NullReferenceException`, after the response was cached, and fails the check (IMP-104).

### IMP-111: A relationship is rewritten only the first time its id is checked (bug)

[14.0.7] Because step 2 of IMP-110 returns on a cache hit and the cache is never emptied (IMP-102), the edit/merge rewrite happens only for the first relationship element carrying that `id` in the whole run, and a later element with the same id, in this or another item or package, is left as it is, without being recorded as 10005 either. A correct engine would rewrite each element on its own merits.

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

### IMP-130: CheckPropertiesAndRelationshipTypes checks that each relationship type belongs to the item's type, recursively

[14.0.7] On the document it is given (the item document, then one relationship element each time it recurses), with `type` the root element's `type` attribute:

1. An empty or missing `type` throws `XmlException` with the text `type attribute is missing`.
2. Read the type definition (IMP-132) with `<Item type='ItemType' action='get' select='id'><name>{type}</name><Relationships><Item type='Property' action='get' select='name'/><Item type='RelationshipType' action='get' select='name'/></Relationships></Item>`. It is sent for every item and every nested relationship item, even when there is nothing to check, so a type that is not on the server fails here with faultcode `0` (IMP-104).
3. Visit each child node of the root, of any node kind, in order. For `Relationships` (the element, matched by name) visit each of its child nodes as an element: a child that is not an element, such as a comment or non-whitespace text, throws `InvalidCastException` (whitespace-only text is dropped when the document is loaded). An element that is not named `Item` throws `XmlException` with `Relationships tag can contain only Item tags, but found {name}`.
4. For each such `Item`, with `t` its `type` attribute (`""` when absent), look in the type definition's response for `Item/Relationships/Item[@type='RelationshipType' and name='{t}']`. When it is there, go on. When it is not, request the definition again with the cache bypassed (IMP-132) and look again, using the new response from then on; when it is still not there throw `CItemException` (faultcode `-1`, faultstring `RecurseCheck`, detail `Bad Relation type {t} for {type}`).
5. Recurse on a new document made from that relationship `Item`'s outer XML. Its own `type` must therefore be set and name an ItemType, and its own `Relationships` are checked against that type.

A `t` that holds a quote makes the XPath malformed.

### IMP-131: The property check compares a name with itself and so never fires (bug)

[14.0.7] The `else` arm of step 3 of IMP-130 is for a child node named `Property`: it looks for `Item[@type='Property' and name='{x}']` in the type definition, where `x` is the child's element name, which is always `Property`. It would pass when the ItemType has a property named `Property` and otherwise throw `CItemException` (faultcode `-1`, faultstring `RecurseCheck`, detail `Bad property name Property for type {type}`). Property values of an item are child elements named after the property, so the property names of the document are never checked: only an item whose element is literally `<Property>` reaches it. A correct check would look up each child element's name. The definition request already asks for the properties, but nothing else reads them.

### IMP-132: Type definitions are read through GetTypeAmlInner and GetMetaDataInfo

[14.0.7] `GetTypeAmlInner(aml, log, force=false)` writes `aml` to the log when a log writer is given, and returns the cached response for that exact string (IMP-102) unless `force`; otherwise it sends it, caches the response (replacing any earlier one) and writes `  was obtained from server`. A hit writes `  was obtained from cache`. A `CItemException` of faultcode `0` gets a `faultdetail` of `Unable to get definition of {type attribute}: {first name child, or empty}` (IMP-180) and is rethrown; every other exception is rethrown as it is.

`GetMetaDataInfo(type, name, select, log)` builds `<Item type='{type}'`, then ` select='{select}'` when `select` is not empty, then ` action='get'>`, then `<name>{name}</name></Item>` (no whitespace), and calls `GetTypeAmlInner` with it. `GetItemType(name, select, log)` is `GetMetaDataInfo` for `ItemType` and `GetRelationshipType(name, select, log)` for `RelationshipType`. `IsVersionable` and `CheckRelatedItems` pass no log writer, so those requests are not logged.

### IMP-140: CheckDataSourceReferences checks the list, sequence or ItemType a property points at

[14.0.7] Each element selected by `.//Item[@type='Property' and data_source and data_source!='' and data_source!='00000000000000000000000000000000' and not(data_source/Item)]`, in document order, is handled with `data_type` the text of its first `data_type` child (`""` when none) and `data_source` its first `data_source` child:

1. `foreign`: skipped.
2. `item`: write `checking <data_source> reference to the ItemType`. When the `data_source` has no `keyed_name` attribute the property is skipped silently. Otherwise the request is `<Item type='ItemType' action='get' select='id'><name>{keyed_name}</name></Item>`.
3. Anything else: when `data_type` is `color list`, `filter list` or ends with `mv_list` (a culture-sensitive comparison, which differs from an ordinal one only for ignorable characters) it becomes `List`. Write `checking <data_source> reference to list/sequence`. The request is `<Item action='get' type='{data_type}' select='id'><id>{text of data_source}</id></Item>`. Any other `data_type` goes in as it is, in the case it has: `list` and `sequence` are sent in lower case, and an empty one gives `type=''`.
4. Write the request string, look it up in the cache and send it when missing, writing `  was obtained from server` or `  was obtained from cache` (IMP-102). A fault other than faultcode `0` is thrown; faultcode `0` records 10000 (IMP-103) with the `data_source` element.

The `data_source!=''` and `!=` tests are node-set comparisons: they hold when some `data_source` child has text that differs.

### IMP-150: CheckRelatedItems checks plain related_id references, and makes floating ones follow the current version

[14.0.7] Each element `.//Item[@type!='RelationshipType']/related_id[not(Item)]` is handled in turn (an `Item` with no `type` attribute is not selected). Let `type` and `keyed_name` be the element's own attributes (`""` when absent) and `id` its text. When either is empty the element is skipped. Otherwise:

1. Write `checking for related items`, then the request `<Item type='{type}' action='get' levels='0'><id>{id}</id></Item>` (no `select`, so the whole item is read), then send it through the cache (IMP-102), writing `  was obtained from server` or `  was obtained from cache`.
2. When `IsVersionable(type)` is true (IMP-170), read the behavior of the relationship, named by the `type` attribute of the `related_id`'s parent `Item`: `GetRelationshipType(parentType, "behavior")` is `<Item type='RelationshipType' select='behavior' action='get'><name>{parentType}</name></Item>` (IMP-132), and the behavior is the text of `.//*[local-name(.)='Result']/Item/behavior`. When it contains `float` (a culture-sensitive substring test), replace the text of `related_id` with `GetCurrentIdOfVersion(id, type)` (IMP-151), which makes the reference point at the current generation. A response without a `behavior` element throws `NullReferenceException`.
3. When the get of step 1 fails with faultcode `0` (the related item does not exist yet), do the same lookup of `IsVersionable` and behavior, and when the behavior contains `float` add the attribute `__find_latest_generation_="yes"` to `related_id`. Either way record 10001 (IMP-103) with the `related_id` element, and go on.
4. A fault with another faultcode from any request of steps 1 to 3 is thrown.

The handler of step 3 is the one around steps 1 and 2 as well, so a faultcode `0` from `IsVersionable` (the related type is not on the server) or from the relationship lookup (`parentType` is not a RelationshipType name) in step 2 is taken for a missing related item; step 3 then repeats the lookup that failed, which is sent again (IMP-102) and now throws, ending the check (IMP-104).

### IMP-151: GetCurrentIdOfVersion returns the id of the current generation

[14.0.7] `GetCurrentIdOfVersion(id, type)`, which every caller shares (IMP-150, and the merge's `SetItemIdToLastGeneration`, `IMP-3xx`):

1. Send `<Item type='{type}' select='config_id, is_current' action='get'><id>{id}</id></Item>` with `applyAML`, not through the cache. A faultcode `0` is swallowed, leaving no response. Any other `CItemException` is thrown. Any other exception becomes `CItemException` (faultcode `-1`, inner exception attached, faultstring its stack trace, `Message` its message followed by `Unable to find a current version of the item (ID='{id}'; Type='{type}')`).
2. With a response: `current` is true when `Item/is_current` is present and its text equals `1` ignoring case; the working id becomes the text of `Item/config_id`, and a missing `config_id` throws `NullReferenceException`. Without a response the working id stays `id` and `current` is false.
3. When `current` is true the result is `id`.
4. Otherwise send `<Item type='{type}' select='id' action='get'><config_id>{working id}</config_id></Item>`. Any exception, a faultcode `0` included, becomes the `CItemException` of step 1 (`-1`, with the same message). The result is the text of the first `Item/id` of the response; none throws `NullReferenceException`.

When the item's generation is not the current one, the result is the id of the current generation of that config. An id that matches nothing, neither as an item id nor as a `config_id`, is an error, not the same id back.

### IMP-160: A RelationshipType's source_id and related_id must name existing ItemTypes

[14.0.7] Let `name` be the text of the document's first `.//Item[@type='RelationshipType']/name` (anywhere in the document, which may belong to another RelationshipType than the one being checked). Each element of `.//Item[@type='RelationshipType']/source_id[not(Item)] | .//Item[@type='RelationshipType']/related_id[not(Item)]`, in document order, with `type` and `keyed_name` its attributes, is skipped when either is empty. Otherwise: write `checking RelationshipType's source_id,related_id`, then `<Item levels='0' action='get' type='ItemType'><id>{text}</id></Item>`, send it through the cache (IMP-102) and write the outcome (`  was obtained from server` or `  was obtained from cache`).

Unlike the other checks, a missing item is an error, not an unresolved reference: any fault, faultcode `0` included, is thrown. A faultcode `0` first gets the detail `Bad {source_id or related_id} {keyed_name} for {name}` (IMP-180). When no RelationshipType in the document has a `name`, the detail line itself throws `NullReferenceException`, which replaces the fault. References that hold a nested `Item` are not selected; those are `CheckGetItems`'s (10002 and 10003).

### IMP-161: A Relationship View's grid must name an existing Grid

[14.0.7] Each element of `.//Item[@type='RelationshipType']/Relationships/Item[@type='Relationship View']/grid`, in document order, with `type` and `keyed_name` its attributes, is skipped when either is empty. Otherwise: write `checking Grids types`, then `<Item levels='0' action='get' type='Grid'><id>{inner text}</id></Item>`, send it through the cache (IMP-102) and write the outcome. Any fault is thrown, a faultcode `0` first getting the detail `Bad Grid {keyed_name} for {name}` (IMP-180), where `name` is the same document-wide RelationshipType name as in IMP-160, with the same `NullReferenceException` when there is none. A grid element that holds a nested `Item` is not excluded; the request then carries the concatenated text of its descendants.

## Versioning

### IMP-170: IsVersionable reads is_versionable of the ItemType once per type

[14.0.7] `IsVersionable(typeName)` calls `GetItemType(typeName, "is_versionable")` (IMP-132), which sends `<Item type='ItemType' select='is_versionable' action='get'><name>{typeName}</name></Item>`, with no logging. The response is cached under that string (IMP-102), so one request is made per distinct type name for the life of the helper; a type that is not found (faultcode `0`) is not cached and the request is repeated on every call, and the exception reaches the caller unchanged. The result is true when `Item/is_versionable` is present and its text equals `1`, ignoring case, and false for any other text. When the element is absent it throws `CItemException` (faultcode `-1`, faultstring and detail `Can't determine whether item versionable or not`).

The rule applies to every caller: the checks (IMP-150), the import orchestration (`IMP-4xx`), the merge (`IMP-3xx`) and the export.
