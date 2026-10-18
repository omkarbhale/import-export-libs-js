# Import merge and versionable processing

`CImportItems.Import` is the last thing the engine does to a package item before it sends it. It validates the item document, in merge mode turns the `add` of every item that already exists into an `edit`, rewrites the relationships of a versionable item so that they address the current generation, and sends the result. This document specifies that step, the helper calls it makes, and the one decision the import loop takes when merge mode is off. The rules are `IMP-300` to `IMP-399`.

The step before it is the reference checks (`spec/import-checks.md`, `IMP-100` to `IMP-199`) and the delayed resolution (`spec/import-delayed.md`, `IMP-200` to `IMP-299`). The loop that calls it, the package registration and the log are import orchestration (wayfinder ticket 22, `IMP-4xx`).

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`): `CImportItems`, `CItemHelper` (`doImport`, `SetItemIdToLastGeneration`, `GetCurrentIdByUniqueKey`, `GetCurrentIdOfVersion`, `Unlock`, `ExistRelItemInCurVer`, `DoesItemAlreadyExist`, `ItemExistById`), `SUImportContext` and the call sites in `ImportExportManager.ImportProc` (decompiled locally, never committed);
- the merge probe `fixtures/import-merge/14.0.7-probe/results.json` (quoted below as "the probe"). It was produced by `oracle/merge-probe/` with the vendored 14.0.7 `Libs.dll` and `IOM.dll`: the real `CImportItems` run against a scriptable `ICItemHelper` that records every call, and the real `CItemHelper` run against a stub connection. No server is involved, so the probe pins what the engine sends and how it reacts to scripted answers, not what Aras answers. What the server does with the final item (for example an `edit` whose `where` matches nothing) needs the scratch import fixtures (wayfinder ticket 25).

## Conventions used by every rule here

- **The item document** is the DOM of one item of the package: the `XmlDocument` that `GetItemsFromPackageDom` made for it (`IMP-015`), whose root is the `Item` element, already carrying `doGetItem="0"` (`IMP-4xx`). `.//Item` and `//Item` are evaluated from the document node, so they include the root item and every `Item` at any depth, `related_id/Item` included.
- **"The helper"** is the run's `CItemHelper`. `applyAML` is `WIRE-006`: it throws a `CItemException` for any fault, faultcode `0` ("no items", `WIRE-052`) included. Request texts are the **engine text** that `applyAML` is handed, as in `spec/export-requests.md` ("Notation"): single-quoted attributes and `/>` without a space for the lookups the engine writes as literals. The probe records them as the engine made them (`calls`) and as IOM was handed them (`requests`).
- **Values are interpolated unescaped** (`AGENTS.md` rule 7). Every request below puts ids, types and texts of the item between quotes or tags exactly as the DOM returns them. A value that breaks the XML makes `applyAML` fail with `XmlException` before anything is sent (`EXP-004`), and one that breaks an XPath makes `XPathException`; `IMP-304` says where those end.
- **"Missing attribute"** means `Attributes["x"]` is null; `GetAttribute("x")` returns the empty string for it. The engine uses `GetAttribute` for `type`, `id`, `where` and `action`, so a missing attribute and an empty one are the same to it, except where a rule says it selects `@x` (an XPath, where a present empty attribute still exists).
- **The log and the messages.** `CImportItems` writes nothing to the log and sends no message. All its output is requests and the edits it makes to the item document.

## The step

### IMP-300: doImport runs Import on the item document, with merge mode as a flag

[14.0.7] `CItemHelper.doImport(itemInXml, mergeMode)` creates a new `CImportItems` over the helper and calls `Import(itemInXml, mergeMode)`. The object has no state of its own, so each call is independent. The only effects are the requests it makes through the helper and the edits it makes to `itemInXml`; it returns nothing.

`mergeMode` is `SUImportContext.bMerge`, a plain read/write flag that defaults to false. The import loop passes it unchanged to every `doImport` call, including the retry after a failed first attempt (`IMP-250`). The same flag selects the skip path of `IMP-350`.

`Import` does these things, in this order. Each is a rule below; a failure in one ends the call and the later ones do not happen:

1. validate the document (`IMP-301` to `IMP-304`);
2. in merge mode, bring versionable adds to the latest generation, find the items that exist, unlock them and turn their `add` into `edit` (`IMP-310` to `IMP-317`);
3. when the root's type is versionable, rewrite the root's relationships (`IMP-330` to `IMP-334`);
4. send the document (`IMP-340`).

Because the document is edited in place, a call that fails after step 2 or 3 leaves those edits in the document. The retry of `IMP-250` runs `Import` again on that edited document.

## Validation

### IMP-301: Every Item in the document must have a type attribute

[14.0.7] The first thing `Import` does is count `//Item[not(@type)]`. When there is one, it throws `CItemException` with faultcode `-1`, faultstring `Items must have 'type' set` and faultdetail (and `Message`) `Error - empty 'type'`. It is not wrapped (`IMP-304`). Nothing has been requested by then: not even the versionable lookup of the root.

The test is for a missing attribute. An item with `type=""` passes it. The root with an empty type then asks `IsVersionable("")` (probe `V.rootEmptyType` shows the call), which sends the metadata lookup with an empty name (`IMP-170`). No ItemType has that name, so the server's faultcode `0` is thrown and reaches the caller unchanged.

### IMP-302: Items to add or edit need an id or a where, and a versionable root exempts its own relationships

[14.0.7] After the type check, `Import` reads from the root: `type` (`GetAttribute`, so empty when missing), `IsVersionable(type)` (`IMP-170`, one lookup per distinct type name, so a type that is not on the server fails here with faultcode `0`), `id`, and `text`: the `id` when it is not empty, otherwise the `where`. `text` and `type` are only used by the message of `IMP-304`; both are set before anything that `IMP-304` wraps can run.

It then counts the items that have no way to be addressed. The XPath depends on the root's versionability, with `{id}` the root's `id` attribute (empty when missing or when the item is addressed by `where`) interpolated unescaped:

| Root type | Selection (counted from the document node) |
|---|---|
| versionable | `//Item[(@action='add' or action='edit') and not(@id) and not(@where) and not(source_id/text()='{id}')]` |
| not versionable | `//Item[(@action='add' or action='edit') and not(@id) and not(@where)]` |

A count above zero throws `CItemException` with faultcode `-1`, faultstring `Items must have 'id' or 'where' set` and faultdetail `Error - empty 'id' or 'where'`, not wrapped. The probe (`V.validation`) shows each branch:

- `not(@id)` and `not(@where)` test for absence: `id=""` is present, so `<Item type="Part" id="" action="add"/>` passes (and is sent, `plainAddEmptyId`).
- An item with no `action` attribute is never selected, nor is one with `action` `delete`, `get`, `merge` or anything but `add` (see `IMP-303` for `edit`).
- In a versionable root, an item is exempt when some text node child of its `source_id` equals the root's `id` attribute. The comparison is node-set against string, so a `source_id` with a matching text node among others is enough. This is what lets a relationship of the root be written without its own id (`versionableNestedAddSourceMatches`). A relationship whose `source_id` holds another id (`versionableNestedAddSourceOther`), holds an element instead of text (`...ElementChild`), is empty or is missing is not exempt. The exemption applies to every `Item` in the document, not only to relationships of the root.
- A root addressed by `where` and no `id` has `{id}` empty, so nothing is exempt: every relationship without its own `id` or `where` fails (`versionableRootWhere`, `versionableRootWhereEmptySource`), and so does a root with neither (`versionableRootAddNoIdNoWhere`).
- An `id` that holds a single quote breaks the XPath of the versionable row: `XPathException`, wrapped by `IMP-304` (`versionableApostropheId`). In the non-versionable row `{id}` is not used, and the same item goes through to the send (`nonVersionableApostropheId`).

### IMP-303: The edit test reads a child element named action, not the attribute (bug)

[14.0.7] The selection of `IMP-302` writes `action='edit'` where it means `@action='edit'`. That is a test on a child *element* named `action`, so an item with the attribute `action="edit"` and no `id` or `where` is not counted: the import goes on and sends it. Only an `add` is validated; an `edit` addressed by nothing is sent (probe `V.plainEditNoId`: `applyAML` is called with the item) and the server decides what it means. An item that happens to hold an `<action>edit</action>` child is counted whatever its attribute says (`plainEditNoIdWithActionChild`). A correct check would test the attribute. Registered in `bugs.md`.

### IMP-304: A failure of Import is wrapped as faultcode -1 when it is an NRE, an XmlException or an XPathException

[14.0.7] Everything after `IMP-301` runs inside one `try`. Its three handlers catch `NullReferenceException`, `XmlException` and `XPathException`, nothing else, and each throws `CItemException` with:

- faultcode `-1`;
- faultstring: the original exception's stack trace (not reproduced, as `EXP-055`);
- faultdetail and `Message`: `{original Message} Can't merge item {text} {type}`, with `{text}` and `{type}` as read by `IMP-302`;
- the original exception as the inner exception.

The wrapped exceptions come from: the XPath of `IMP-302` (a quote in the root `id`); any `applyAML` of the call, whose request text does not parse (`XmlException`, for example a type with a quote, or an id with `&`: probe `M.apostropheInType`, `M.ampersandInId`); the null references of `IMP-315`, `IMP-316`, `IMP-331` and `IMP-333`; and the null reference of `IMP-320` for a version lookup without a `config_id`.

Everything else leaves `Import` as it is. That includes the `CItemException`s thrown by `IMP-301`, `IMP-302` and the helper calls (`IsVersionable`, `Unlock`, `ExistRelItemInCurVer`, `SetItemIdToLastGeneration`, and the `applyAML` of every request, faultcode `0` included: probes `M.getFault999`, `M.unlockFails`, `F.finalApply`). The `.NET` wording of `{original Message}` for a parse error or an XPath error is the framework's; the port reproduces the shape `{message} Can't merge item {text} {type}` and the exception kind, not the framework's sentence.

## Merge mode

Everything in this section runs only when `mergeMode` is true. With it false, `Import` does not look at `add` items, makes no `get`, and calls `IsVersionable` only for the root (probe `M.notMerge`).

### IMP-310: Merge works on the add items of the whole document, found once

[14.0.7] The add list is `.//Item[@action='add']` from the document node: the root, if it is an add, and every nested add at any depth and in any position, `related_id/Item` included, in document order. It is taken once, before anything else is changed, and the list is a snapshot: the later edits to `id` and `action` do not change which items it holds, and an item the rules remove from the document (`IMP-315`) stays in it.

### IMP-311: A versionable add is first moved to the latest generation of its id

[14.0.7] Each item of the add list, in order, is asked `IsVersionable(type)` with its own `type` (`GetAttribute`; a missing type has been refused by `IMP-301`). The lookups are cached per type (`IMP-170`), so the requests are the distinct types in order of first appearance, after the root's. When the type is versionable the helper's `SetItemIdToLastGeneration(item)` runs on that item (`IMP-320`), and its effects (the new `id`, the new `source_id` texts) are in place before the item's `id` is read for `IMP-312`. A non-versionable item is not touched.

An add item with no `id` is not an error here when its type is not versionable (it stays an `add` and takes no part in the existence check, `IMP-312`). For a versionable type the call is made even with no `id` (probe `G.versionableNoIdSkipsDictionary`, whose stub helper accepts it), and the real helper refuses it (`IMP-320` step 1), so an add addressed only by `where` of a versionable type cannot be imported in merge mode.

### IMP-312: One idlist get per type asks which of the add items exist

[14.0.7] After step `IMP-311` each add item is read again for its `id`. When the `id` is not empty it goes into a map from `type` to a list of ids: the map is keyed by the exact type string (ordinal, case-sensitive: `Part` and `part` are two types, probe `M.typeIsCaseSensitive`), keeps its types in the order of their first item and each list keeps its ids in document order and with duplicates (`IMP-040`, probe `M.sameIdTwiceSameType`, `M.typeOrderFollowsFirstAdd`, `M.nestedAddsGroupedByType`).

For each type, in that order, one request is sent with `applyAML`:

```text
<Item type='{type}' action='get' idlist='{id1,id2,…}' select='id, locked_by_id' />
```

The ids are joined with `,` and no space. A faultcode `0` is the answer "none of them exists": the type is skipped and its items stay `add` (probe `M.absentStaysAdd`). Any other fault is thrown as it is (`M.getFault999`). Nothing is chunked, so a type with many adds is one long request.

Add items without an `id`, and every item whose action is not `add`, are not asked about: they are sent as they are (`M.addWithoutIdIgnored`, `M.editAndDeleteIgnored`).

### IMP-313: An item found by the get is unlocked first when it is locked

[14.0.7] For each id of the type's list, in order, the engine looks in the answer for `Envelope/Body/Result/Item[@id='{id}']`: `Envelope`, `Body` and `Result` are matched by local name, in the SOAP namespace or in no namespace, and `Item` is a direct child of `Result`. The `id` is compared as a string, case-sensitively (probe `M.idCaseSensitive`: an add with `id="a"` does not match an answer item `A`, and stays `add`). An answer with another envelope namespace, or with the `Item` inside another element, finds nothing (`M.responseOtherNamespace`, `M.responseItemInsideItems`). An id not found in the answer is skipped.

When it is found and the item has a `locked_by_id` child (a direct child) with non-empty text, `Unlock(id, type)` (`IMP-322`) is called before the item is changed. An empty `locked_by_id` is not locked (`M.lockedEmpty`). The answer is read once per type, so an id listed twice is unlocked twice (`M.lockedDuplicateId`). A failing unlock ends the call with that exception, with the document unchanged (`M.unlockFails`).

### IMP-314: Every add item with the found id becomes an edit

[14.0.7] Once an id is found (and unlocked, `IMP-313`), the engine walks the whole add list of `IMP-310` and, for each item whose `id` attribute equals the found id (an ordinal comparison), unless `IMP-315` removes it, sets its `action` attribute to `edit`. The attribute keeps its place among the item's attributes, and nothing else about the item changes: its `id`, its properties and its relationships stay, and a nested add whose own id was not found stays an `add` (`M.onlySomeExist`, `M.existsBecomesEdit`).

The match is by id only, not by type: an add of another type that carries the same id is switched too, even though the get for its own type found nothing (`M.sameIdOtherType`). Real ids are unique across the database, so this is only visible in hand-made packages.

### IMP-315: A system property of Change Controlled Relationship is removed instead of edited

[14.0.7] Before an add item with a found id is switched, `RemoveSystemPropertyForPolyType` looks at it:

1. `name` is the text of its `name` child (null when there is none);
2. `keyed` is the text of the attribute `keyed_name` of its `source_id` child (null when there is none).

When `keyed` equals `Change Controlled Relationship` and `name` is one of `related_id`, `sort_order` and `source_id` (ordinal, case-sensitive), the item is **removed from its parent** and its action is not changed. These are the properties Aras adds to every relationship ItemType that is change controlled, which exist in the target database already and cannot be edited. Otherwise the item is switched as `IMP-314` says. The test does not look at the item's type or position: any item with that shape is taken (`C.ccr.anyTypeWithTheShape`). `Related_Id` is not `related_id` (`C.ccr.Related_Id`); `name` missing or another keyed name switches it (`C.ccr.noName`, `C.ccr.otherKeyedName`, `C.ccr.noKeyedName`). An item that does not exist in the database (no found id) keeps its `add` and stays in the document (`C.ccr.notExisting`).

When the removed item is the root of the document, the document is left with no root. Its `OuterXml` is the empty string, and the send of `IMP-340` fails with `XmlException` (`Root element is missing.`; the real `applyAML("")` sends nothing: probe `X.lookups`, `applyAML.emptyString`), which `IMP-304` wraps (`C.ccr.rootProperty`).

### IMP-316: A removal that meets the same item twice throws a null reference (bug)

[14.0.7] The removal is run for each id of the type's list. When the list holds the same id twice (two items with that id, or one listed twice), the second pass takes the same item from the add list again. It has been detached from the document by the first, so its `ParentNode` is null and `RemoveChild` throws `NullReferenceException`, which `IMP-304` wraps as `Object reference not set to an instance of an object. Can't merge item {text} {type}` (probe `C.ccr.sameIdTwoNodes`). The other item with that id has been switched by then, and stays switched in the document. A correct engine would remove the item once. Registered in `bugs.md`.

### IMP-317: Merge never deletes, and leaves what the file does not mention

[14.0.7] Merge mode only turns `add` into `edit` (and removes the properties of `IMP-315`). It sends no `delete` and no `purge`, it does not look at `edit`, `delete`, `merge`, `get` or other actions, and relationships of an existing item that are not in the file are not touched in the database (the `edit` carries only what the file holds). The item sent is the document as the earlier rules left it.

## Helper lookups of the merge

### IMP-320: SetItemIdToLastGeneration moves a versionable add and its relationships to the current generation

[14.0.7] `SetItemIdToLastGeneration(item)`, with `id` and `type` read by `GetAttribute`:

1. An empty `id` or `type` is `CItemException` faultcode `-1`, faultstring `Item with action "add" must have 'id' and 'type' set`, faultdetail `Error - empty 'id' or 'type'` (probe `S.noId`, `S.noType`, `S.emptyId`).
2. `IsVersionable(type)` must be true, otherwise `CItemException` `-1`, faultstring `Item type is not versionable`, faultdetail `Error - item type is not versionable` (`S.notVersionable`). The merge calls it only for versionable types.
3. The new id is `GetCurrentIdOfVersion(id, type)` (`IMP-151`): `config_id, is_current` of the item, then, if it is not current, the item of that `config_id` (`S.alreadyCurrent`: one request; `S.oldGeneration`: two). Any `CItemException` from it, whatever its faultcode, is caught, and the new id is `GetCurrentIdByUniqueKey(item, true)` (`IMP-321`) instead (`S.currentIdLookupFaultOtherFallsToUniqueKey`). A typical add of an item that is new to the database therefore costs: the version lookup (faultcode `0` swallowed), the lookup by `config_id` (faultcode `0`, becoming a `CItemException`), the keyed-properties request (cached after the first) and the key request, which finds nothing (`S.notFoundAnywhereFallsToUniqueKey` shows these requests). A non-`CItemException` is not caught: a version lookup answer without `config_id` is a `NullReferenceException` (`S.currentIdNoConfigIsNotCaught`), wrapped by `IMP-304`.
4. When the new id is null or empty, or equals the item's id, nothing changes (`S.oldGenerationSameIdAsLatest`, `S.uniqueKeyNoPropertiesLeavesIdAlone`).
5. Otherwise the item's `id` attribute is set to the new id, and the text of every `source_id` in `Relationships/Item/source_id` (the direct `Relationships` children of the item, their direct `Item` children, their `source_id`) is replaced by the new id, whatever it held (`S.oldGeneration`: a relationship whose `source_id` was `OTHER` is also changed). Relationships nested deeper, and the `related_id` side, are left alone (`S.nestedInRelatedIdUntouched`, `S.oldGeneration`).

### IMP-321: The unique-key lookup is used with a missing key property being an error

[14.0.7] The merge, and `DoesItemAlreadyExist` (`IMP-351`), call `GetCurrentIdByUniqueKey(item, true)`, specified in `EXP-041`: the keyed and required properties of the type, other than `generation`, are read from the child elements of the **package item** and sent as a `get`; the first `Item` of the answer gives the id, any fault gives null. With `true`, a key property that the package item lacks is `CItemException` faultcode `-1` (`Property {name} that is part of the unique key for type {type} is not part of the response`: probe `S.uniqueKeyMissingPropertyThrows`), which leaves `SetItemIdToLastGeneration` and `Import` unwrapped. A type with no keyed required property, or whose property request fails with faultcode `0`, gives null, and the item keeps its id.

### IMP-322: Unlock sends one unlock and lets any fault through

[14.0.7] `Unlock(id, type)` sends `<Item type='{type}' id='{id}' action='unlock' doGetItem='0' />` with `applyAML` and returns nothing. Every fault is thrown, faultcode `0` included (probe `X.lookups`, `unlock.ok`, `unlock.fault`, `unlock.fault0`).

## Versionable processing

### IMP-330: ProcessVersionableItem rewrites the root's relationships when the root is versionable

[14.0.7] When the root's type was versionable (`IMP-302`, decided once, before the merge changed anything), `ProcessVersionableItem(root)` runs, after the merge and before the send. It looks at each `Item` that is a direct child of a direct `Relationships` child of the root (`Relationships/Item`), in document order. Relationships nested deeper, `Relationships` elsewhere than directly under the root (`relationshipsNotUnderRootIgnored`) and items inside `related_id` are not visited (`P.deeperRelationshipsIgnored`). For a non-versionable root the pass does not run and the relationships go out as they are (`P.nonVersionableRootUntouched`).

For each relationship item:

1. A relationship with no `source_id` child is skipped, whatever else it holds (`P.relationshipWithoutSourceId`, `P.mpMacNoSourceId`).
2. Its `type` attribute is read (`GetAttribute`) and the text of `source_id` (`InnerText`: the concatenated text of all its descendants).
3. A type equal to `mp_MacCondition` (ordinal, case-sensitive: `P.mpMacTypeCaseSensitive`) is handled by `IMP-331`; any other type with a `related_id` child by `IMP-332`. Any other relationship item is left alone (`P.relationshipWithoutRelatedId`).

The `where` the pass writes holds the interpolated texts unescaped. It is set with `SetAttribute`, so the document escapes it when it is written, and the texts reach the attribute as the DOM held them (`P.apostropheInRelated`).

### IMP-331: An mp_MacCondition relationship is matched by its source and ref ids

[14.0.7] For an `mp_MacCondition`, `ref_id` is the text of the relationship's `ref_id` child; a missing `ref_id` is a `NullReferenceException` (wrapped by `IMP-304`; probe `P.mpMacNoRefId`). The engine asks with `applyAML`:

```text
<Item type='mp_MacCondition' action='get' select='id'><source_id>{source_id}</source_id><ref_id>{ref_id}</ref_id></Item>
```

A `CItemException` with a faultcode other than `0` is thrown (`P.mpMacFault999`). A faultcode `0` means "no such relationship": the relationship's `action` attribute is set to `add` and nothing else changes (`P.mpMacMissing`: an existing `where` and the `id` stay). Otherwise the relationship's `where` is set to `source_id='{source_id}' and ref_id='{ref_id}'` and its `action` to `edit`; its `id` attribute is **not** removed (`P.mpMacFound`). The `related_id` of such a relationship is not looked at (`P.mpMacWithRelatedIdIgnored`).

### IMP-332: Any other relationship with a related_id is matched by its source and related ids

[14.0.7] Let `related` be the relationship's `related_id` child. Its text is `related_id`: the inner text of the element when it holds no `Item`; and when its first `Item` child exists, the value of the first attribute selected by `related_id/Item/@id` from the relationship (`IMP-333` for the case it is not there). Then:

1. The relationship's own `id` attribute is removed (if present).
2. `ExistRelItemInCurVer(type, source_id, related_id)` (`IMP-334`) decides. When false the relationship's `action` is set to `add` (an existing `where` stays: `P.plainRelationshipMissing`). When true its `where` is set to `source_id='{source_id}' and related_id='{related_id}'` and its `action` to `edit` (`P.plainRelationshipExists`, `P.relatedIdWithItemAndId`).

So the relationship is always re-addressed by its two ends, and its original id is dropped, which is what makes it follow the source to a new generation: the relationship of the old generation has a different id than the one in the file. In merge mode the idlist get of `IMP-312` has already run for the relationship's own id; its result is overwritten here (`P.mergeThenVersionable`).

### IMP-333: A related_id with an Item and no id throws a null reference (bug)

[14.0.7] When `related_id` holds an `Item`, the engine reads `related_id/Item/@id` as an attribute node and takes its `Value` without testing that it exists. An `Item` without `id` (for example one addressed by `where`) leaves the selection empty and raises `NullReferenceException`, which `IMP-304` wraps as `Object reference not set to an instance of an object. Can't merge item {text} {type}`; the relationships already handled keep their edits in the document, and the document is not sent (probe `P.relatedIdWithItemNoId`). The selection is made from the relationship, not from the first `Item`, so it takes the first `id` attribute among all the `Item`s under `related_id`: when the first one has no `id` and a later one has, that later id is used and there is no fault (probe `P.relatedIdTwoItemsSecondHasId`). A correct engine would fall back to the text, or to the `where`. Registered in `bugs.md`.

An `Item` under `related_id` without `id` and `where`, and with action `add`, is refused earlier by `IMP-302`. The null reference is therefore seen for an `Item` that has a `where`, or whose action is not `add` or `edit`, and for an `edit` (`IMP-303`).

### IMP-334: ExistRelItemInCurVer asks whether the relationship already exists between the two ends

[14.0.7] `ExistRelItemInCurVer(type, sourceId, relatedId)` sends, with `applyAML`:

```text
<Item type='{type}' action='get' select='id'><source_id>{sourceId}</source_id><related_id>{relatedId}</related_id></Item>
```

Any answer is true. A `CItemException` with faultcode `0` is false. Any other `CItemException` is thrown (probe `X.lookups`, `rel.found`, `rel.missing`, `rel.error999`). Values are not escaped: `&` in either id is an `XmlException` from the request (`rel.unescapedValues`), which `IMP-304` wraps. Nothing is cached.

## Sending

### IMP-340: The edited document is sent as it stands and its answer is ignored

[14.0.7] The last step of `Import` is `applyAML(itemInXml.OuterXml)`: the document, as the rules above left it, serialised as the DOM writes it. Its answer is not read. A fault is thrown as it is, faultcode `0` included, and is not wrapped (probe `F.finalApply`: `sendFaultCode0`, `sendFault999`). What the import loop does with that `CItemException` is `IMP-4xx`'s. For the `edit` with a `where` written by `IMP-331` and `IMP-332`, whether a `where` that matches nothing is a fault is the server's; the scratch import fixtures (wayfinder ticket 25) record it.

## The skip path when merge mode is off

### IMP-350: With merge off, an add of an item that already exists is skipped

[14.0.7] In the import loop (`ImportExportManager.ImportProc`), for each item document, after the item's progress is reported and before its checks, the engine evaluates `!bMerge && action == "add" && DoesItemAlreadyExist(item, null)`, where `action` is the root item's `action` attribute (`GetAttribute`, so an item without one never skips) and `item` is the root `Item` element. The conditions are evaluated in that order, so with merge on the helper is never called.

When it is true:

- the item is not sent: no `DoChecking` (`IMP-100`), no `doImport`, no delayed-resolution entries, no `SQL` deletion step (`IMP-4xx`);
- the log gets the line `Item successfully skipped {0}`, where `{0}` is the description the loop built for the item before the test, from the item's attributes as they were before `DoesItemAlreadyExist` could change the `id`: the concatenation of `  id : {id}  `, `  keyed_name : {tempKeyName}  ` and `  type : {type}  `, each replaced by a single space when its value is empty;
- the rest of the loop body still runs for the item (the package-definition registration, `IMP-4xx`), with the `id` the loop read before the test.

When it is false, the item goes on to the checks and to `doImport`. The test applies to every `add` item, whatever its type.

### IMP-351: DoesItemAlreadyExist asks by id for plain items and by version for versionable ones

[14.0.7] `DoesItemAlreadyExist(item, pair)` is called with `pair` null, the only call there is; the overload that takes an `IdTypePair` is not reachable and the port does not offer it (the probe `E.idTypePairIsUsed` shows that the pair replaces the item's own id and type and receives the final id). With the item's `id` and `type` attributes (`GetNamedItem`, so a missing one is empty):

1. An empty `id` or `type` is `CItemException` faultcode `-1`, faultstring `Item with action "add" must have 'id' and 'type' set`, faultdetail `Error - empty 'id' or 'type'`. The loop's own handlers do not catch it (what ends the package is `IMP-4xx`'s). Probe `E.noIdAttribute`, `E.noTypeAttribute`, `E.emptyIdAttribute`.
2. A type that is not versionable (`IMP-170`): the result is `ItemExistById(id, type)` (`IMP-352`). Nothing about the item changes (`E.plainExists`, `E.plainMissing`).
3. A versionable type: `GetCurrentIdOfVersion(id, type)` (`IMP-151`). When it returns, the item exists, the result is true and the id is the one returned (`E.versionableCurrent`: the same id, `E.versionableOldGeneration`: the current generation's). When it throws a `CItemException`, whatever the faultcode, `GetCurrentIdByUniqueKey(item, true)` (`IMP-321`) is used: a non-null answer is the id and the result is true, a null answer keeps the item's own id and the result is false (`E.versionableNotFoundUniqueKeyFinds`, `E.versionableNotFoundUniqueKeyNone`, `E.versionableLookupFault999FallsToUniqueKey`). A non-`CItemException` is not caught (`E.versionableNoConfigNotCaught`: a `NullReferenceException`).
4. When the id found differs from the item's id (which happens only with a true result), the item's `id` attribute is set to it and every `source_id` in `Relationships/Item/source_id` (the same selection as `IMP-320`) gets its text. A skipped versionable item therefore has the current generation's id in its document, while the loop's own copy of the id (`IMP-350`) is the old one.

The requests are those of `IMP-151`, `EXP-041` and `IMP-352`; the metadata lookup for `IsVersionable` comes first and is cached.

### IMP-352: ItemExistById treats any CItemException as "does not exist"

[14.0.7] `ItemExistById(id, type)` sends `<Item type='{type}' action='get' select='id'><id>{id}</id></Item>` with `applyAML`. A normal answer is true. A `CItemException` of **any** faultcode is false: a server error, a permission fault or a dropped connection are taken for "the item is not there", and the import then goes on to add it (probe `X.lookups`, `rel.error999`, whose first column is `ItemExistById`). Exceptions that are not `CItemException` (a request that does not parse) are thrown. Nothing is cached. The package-definition rules (`IMP-4xx`) use the same method for the elements of a package.
