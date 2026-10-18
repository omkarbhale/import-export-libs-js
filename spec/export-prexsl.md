# Export rewrites before the XSL

This document specifies steps 5 to 12 of `CExportItems.Export`: everything the engine does to an item's server response between the fetch (the per-type request, `spec/export-requests.md`) and `export.xsl` (`spec/export-transform.md`). The rules are `EXP-100` to `EXP-199`.

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`) and of `IOM.dll` 14.0.7.35492, for the IOM `Item` and `Innovator` methods these steps call (decompiled locally, never committed);
- probes run on .NET Framework 4.8 (CLR 4.0.30319, Windows PowerShell 5.1) for every .NET behaviour that decides bytes: `XmlDocument` attribute and `InnerText` handling, `XmlWriter` indentation, `WebUtility.HtmlDecode`/`HtmlEncode` and `XDocument.ToString`;
- read-only queries on the dev server (Aras 12.0 SP9) for the item types involved, and the recorded wire request in `fixtures/wire/14.0.7-reference-host/capture.jsonl` for the float-property query (EXP-116).

Rules that say "not probed live" come from the IOM source alone: they need server state that dev does not have until the scratch fixtures (wayfinder ticket 67) are recorded.

## Conventions used by every rule here

- **The response document** is the DOM `CItemHelper.applyAML` returns (`Item.dom` of the `ApplyItem` response): a SOAP envelope (`Envelope/Body/Result/Item`). IOM creates it with `PreserveWhitespace` on, so whitespace the server sent stays. The steps below edit this one document in place, in the order of EXP-100. A **fetch** is `CItemHelper.applyAML`: it throws on any fault, including faultcode `0` ("no items", WIRE-006).
- **The Result item** is the first `Item` element, in document order, whose parent is a `Result` element (`.//*[local-name(.)='Result']/Item`). The ItemType and xClassificationTree steps and `ProcessPropertiesOfTypeItem` locate it with the equivalent `//Result/Item` or an explicit `Envelope/Body/Result/Item` path; with a well-formed response they find the same node.
- **Requests the engine builds from DOM nodes** are serialised by the DOM, not by string concatenation: attributes are written in the order they were created, in double quotes, an element with no content as `<X />`, and text is escaped (`&`, `<`, `>`). IOM then re-serialises the root again (WIRE-004), which changes nothing further. Requests the engine builds by string concatenation put values in unescaped (AGENTS.md rule 7), and IOM's `loadAML` then parses that string: a value that breaks the XML raises `XmlException` before anything is sent.
- **`InnerText` assignment** replaces every child of an element with one text node and keeps its attributes. Assigning an empty string leaves one empty text node, so the element is later written `<x></x>` and not `<x />` (probed; the transform part, wayfinder ticket 13, relies on the same distinction).
- **`SelectNodes` results are snapshots.** Every loop below visits the nodes that matched when the query ran, even when the loop removes nodes (probed: by index, `foreach`, and a child-axis list). A node the loop has detached from the document is still visited if it matched (EXP-115).
- **Metadata lookups** (`GetItemType`, `GetRelationshipType`, `IsVersionable`) fetch an ItemType or RelationshipType definition through the request cache of `spec/export-requests.md`: keyed by the exact AML text, filled only by a successful response, never invalidated, so a faultcode-`0` lookup is repeated each time it is needed. They throw on a fault. This document names each lookup and the AML text it builds, and leaves the cache itself to that document.

## EXP-100: The rewrite steps and their order

[14.0.7] After the fetch, `Export` runs these steps on the response document, in this order. Each step is skipped unless its condition holds. Any request a step makes is a fetch (above) unless the rule says otherwise.

| Step | Runs when | Rule |
|---|---|---|
| 5 | item type is `ItemType`: Client Event removal, then the `cmf_ContentType` lookup | EXP-103, EXP-104 |
| 5 | item type is `xClassificationTree` | EXP-105 |
| 6 | always: `xp-*` properties | EXP-106 |
| 7 | the item type is versionable (`IsVersionable`, `spec/export-requests.md`) | EXP-107 |
| 8 | item type is `RelationshipType` | EXP-108, EXP-109 |
| 8 | item type is `Sequence` | EXP-110 |
| 8 | item type is `Form` | EXP-111, EXP-112 |
| 9 | always: independent related items | EXP-113 to EXP-115 |
| 10 | when the response has an `Envelope/Body/Result/Item` element | EXP-116 |
| 11 | item type is `dr_RelationshipFamily` | EXP-117 |
| 11 | item type is `ac_PolicyAccessItemAttribute` | EXP-118 |
| 12 | item type is `dac_DomainDefinition` | EXP-119 |

The item type tested is the type name of the item being exported (`ExportItem.typeName`), compared exactly (ordinal, case-sensitive). Steps 8 are mutually exclusive. Steps 13 onward (the XSL and the post-processing) are other documents.

## EXP-101: Which exceptions the steps raise, and which are wrapped

[14.0.7] Inside the `try` of `Export`, an `XmlException`, a `NullReferenceException` or an `XPathException` is converted to a `CItemException` with faultcode `-1`, `faultstring` the .NET stack trace, and `faultdetail` and message the original message followed by ` Can't export item.` (a leading space). Every other exception passes through unchanged: a `CItemException` from a fetch (faultcode from the server, or `-1` and `-99` from the helpers named below), a plain `System.Exception`, an `ArgumentException`, an `InvalidCastException`. The first stage that catches them is the export of one item (`spec/export-run.md`).

A null dereference is how these steps report a missing element. Wherever a rule says "dereferences" a result that can be absent, the engine fails with the `NullReferenceException` message `Object reference not set to an instance of an object.`, which this rule wraps. The port reproduces the wrapped message and faultcode; the stack trace text is .NET's and is not reproduced (the log rules say how it is shown).

## ItemType and xClassificationTree

### EXP-103: ItemType: the Client Event named cmf_OnShowContainer is removed

[14.0.7] For an item of type `ItemType`, step 5 first removes at most one relationship from the response document: the first element, in document order anywhere in the document, matching `//Relationships/Item[@type='Client Event' and related_id[@keyed_name='cmf_OnShowContainer']]`. The `Relationships` container stays even when it becomes empty (the empty-relationship cleanup is a later step). This removal is made on the real document, so it reaches the file.

For `xClassificationTree` see EXP-105. For every other type step 5 does nothing.

### EXP-104: ItemType: the cmf lookup that edits a copy

[14.0.7] After EXP-103, for an `ItemType`, the engine builds an IOM item from a copy of the response document (`Innovator.getItemInDom`: the document's outer XML is serialised and loaded into a new document, so no node is shared) and looks up the content types linked to the ItemType:

1. If the copy has no `Item` element, or the item is an error or an empty result, step 5 ends.
2. The item's id is the `id` attribute of the first `Item` in the copy (the Result item), or, when that attribute is empty, the trimmed text of its `id` child when that child has no `condition` or condition `eq`.
3. One `ApplyAML` request (an `Innovator.applyAML` call, not a fetch: it does not throw on a fault) is sent. Its text is this one line, with tab characters where `<TAB>` stands and no line breaks, `{id}` the id from step 2, unescaped:

   ```text
   <AML><TAB><Item type="cmf_ContentType" action="get" select="id"><TAB><TAB><linked_item_type>{id}</linked_item_type><TAB><TAB><Relationships><TAB><TAB><TAB><Item type="cmf_ElementType" select="generated_type" ><TAB><TAB><TAB><TAB><Relationships><TAB><TAB><TAB><TAB><TAB><Item type="cmf_PropertyType" select="generated_type" /><TAB><TAB><TAB><TAB></Relationships><TAB><TAB><TAB></Item><TAB><TAB></Relationships><TAB></Item></AML>
   ```

   The request is sent once per ItemType export that reaches this step, uncached.
4. If the response is a fault (typically faultcode `0`, no linked content type) or its XML is the text `<Empty />`, step 5 ends.
5. Otherwise, for each `cmf_ElementType` item under the content type, and for each `cmf_PropertyType` item under each element type, the engine removes from the **copy** the relationship `Relationships/Item[relationship_id='{g}']` of the copied Result item, where `{g}` is that item's `generated_type` property (its text, or the id of an `Item` child; an absent property gives an empty string; the value is placed in the XPath unescaped).

Because the removals act on the copy, which is discarded, they never reach the file; only the Client Event removal of EXP-103 does. The observable effects of this rule are the one extra request and the failures below. This is a reproduced bug (registered in `bugs.md`).

Failures, taken from the IOM source (not probed live):

- The content-type response must be a single item. When more than one `cmf_ContentType` is linked to the ItemType, `getRelationships` throws `System.Exception` with the message `Not a single item`, which is not wrapped (EXP-101).
- Each removal needs exactly one matching relationship in the copy. With none, or with several, `removeRelationship` throws `System.ArgumentException`, message `The argument passed to the method is not a single item`, which is not wrapped.
- A `{g}` containing an apostrophe breaks the XPath and raises `XPathException`, which is wrapped.

### EXP-105: xClassificationTree: system xClass_xProperty_Flatten relationships are removed

[14.0.7] For an item of type `xClassificationTree`, step 5 edits the real document. Taking the Result item found by `//Result/Item`, for each direct relationship item `Relationships/Item[@type='xClass']` of it, in document order, it removes every direct relationship item `Relationships/Item[@type='xClass_xProperty_Flatten']` of that `xClass` item. Nothing deeper is touched, and the `Relationships` containers stay even when they become empty.

If the document has no `Result/Item`, IOM throws `System.Exception` (`Not a single item`), which is not wrapped.

## Extended properties and ids

### EXP-106: xp-* properties get a set attribute

[14.0.7] Step 6 visits, for every `Item` element in the document at any depth, each child element whose name starts with `xp-` (the property elements of extended properties; `//Item/node()[starts-with(name(), 'xp-')]`, evaluated once, in document order). For each:

1. `set` starts as `permission_id`.
2. If its `explicit` attribute is exactly `1`, `|explicit` is appended. Otherwise the `explicit` attribute is removed, whatever its value (`0`, anything else, or absent).
3. If its `is_null` attribute is **not** exactly `0`, `|value` is appended. That includes the attribute being absent (an empty string is not `0`) or `1`. Otherwise the `is_null` attribute is removed.
4. If it has no `permission_id` attribute, one is added with the empty value, after the existing attributes.
5. A new attribute `set` with the value from steps 1 to 3 is inserted as the **first** attribute. An existing `set` attribute is replaced by it and not kept (probed: `set` first, then the other attributes in their original order).

The possible `set` values are therefore `permission_id`, `permission_id|explicit`, `permission_id|value` and `permission_id|explicit|value`. The branch that sets the attribute on an element with no attributes cannot run, because step 4 guarantees an attribute.

### EXP-107: Ids of versionable items are replaced by config ids

[14.0.7] Step 7, for a versionable item type, on the real document:

1. It takes the first `config_id` element matching `.//*[local-name(.)='Result']/Item/config_id` and its text. When there is none, the step dereferences nothing valid and fails (EXP-101).
2. It sets the `id` attribute of the first `Result/Item` to that text. An existing `id` attribute is replaced in place; a missing one is added after the others.
3. For every `source_id` element at `Relationships/Item/source_id` under that Result item (direct relationship items only), it replaces the content with that text (`InnerText`, so any child element is dropped and the attributes stay).
4. It removes the `id` attribute from every direct relationship item `Relationships/Item` of the Result item. Their children and deeper items keep theirs.

## Relationship types, sequences and forms

### EXP-108: RelationshipType: the relationship ItemType is embedded

[14.0.7] Step 8 for `RelationshipType`:

1. It takes the first `relationship_id` element at `.//*[local-name(.)='Result']/Item/relationship_id` (a missing one fails, EXP-101), its text as the id, and sets its content to the empty string. Its attributes (`keyed_name`, `type`) stay.
2. It fetches the ItemType with that id. The request is built from DOM nodes (see Conventions): an `Item` with attributes `type="ItemType"`, `action="get"`, `id="{id}"` in that order, and as its only child the `Relationships` body that the ItemType export request carries (`spec/export-requests.md`, the ItemType body: the resource loaded without preserving whitespace, so it has no whitespace text nodes). The fetch throws on any fault; that exception is not caught here.
3. If the response has a first `Result/Item`, a deep copy of it is appended into the emptied `relationship_id`. Without one the rest of the step is skipped.
4. It then takes the first `Result/Item/source_id` of the document, which is the RelationshipType's own `source_id` and not the embedded item's, and, if it exists, adds an attribute `dependencyLevel` to the first `Result/Item`, the result of EXP-109 called with that text and `0`, written as an invariant integer. The attribute is added after the existing ones (an existing one would be replaced in place).

The embedded copy is subject to every later step, including the rewrites of EXP-113 and EXP-116, which see it as part of the document.

### EXP-109: The dependency level counts the chain of RelationshipTypes above an ItemType

[14.0.7] `getDepencyLevel(typeId, level)` fetches one RelationshipType whose `relationship_id` is `typeId`:

```text
<Item type="RelationshipType" select="source_id,relationship_id" page="1" pagesize="1" action="get"><relationship_id>{typeId}</relationship_id></Item>
```

(built from DOM nodes, so `{typeId}` is escaped, and the attributes are in this order). If the fetch throws a `CItemException` of any faultcode, the result is `level`. Otherwise, if the first `Result/Item/source_id` of the response exists, the result is `getDepencyLevel(that text, level + 1)`; if not, `level`. The server picks the RelationshipType when several have the same `relationship_id` (`pagesize` is 1).

Example on dev: `Grid Event` is a RelationshipType from `Property` to the ItemType `Grid Event`. Called with the id of `Property`, the lookup finds the RelationshipType `Property` (source `ItemType`), recurses with the `ItemType` id and level 1, and finds none, so the level is `1`. A RelationshipType whose source is no other RelationshipType's relationship ItemType gets `0`.

The engine recurses without a bound, so data in which the chain is a cycle never ends and .NET overflows its stack. The port keeps the result for every finite chain and, past the one fixed recursion limit it uses for all such cases (the build ticket sets the number), fails with a visible error instead. This is the "unbounded recursion" deviation of `roadmap/round-5.md`; no real data reaches it.

### EXP-110: Sequence: current_value is removed

[14.0.7] Step 8 for `Sequence`: it takes the first `Item` of type `Sequence` anywhere in the document (`//Item[@type='Sequence']`). If it has a `current_value` child, that element is removed (only the first such child; its neighbouring whitespace stays). Without a matching item, or without the child, nothing changes.

### EXP-111: Form: Field propertytype_id is replaced by the Property item

[14.0.7] Step 8 for `Form` visits every `propertytype_id` element that is a child of an `Item` of type `Field`, anywhere in the document (`//Item[@type='Field']/propertytype_id`), in document order. For each:

1. `name` is the text of the Field's `name` child, or the empty string.
2. A `Property` is fetched (not cached: one request per field). The request is built from DOM nodes, with the element's text as the id: `<Item type="Property" action="get" id="{text}" select="name,source_id" page="1" pagesize="1" />`.
3. If the fetch succeeds and has a first `Result/Item`, the `propertytype_id` content is replaced by a deep copy of that Property item (its attributes `keyed_name` and `type` stay).
4. A fetch failure follows EXP-112.

### EXP-112: Form: the catch handles the wrong fault (bug)

[14.0.7] Around the Property fetch of EXP-111, the catch of `CItemException` is inverted. When the fault has faultcode `0` (the Property is not found), it sets `faultdetail` to `Unable to get property {t} for field {name}` and rethrows, so a missing Property aborts the export of the form. `{name}` is the Field name of EXP-111 and `{t}` is the `type` attribute of the `propertytype_id` element, taken only when that element has a `keyed_name` attribute, and the empty string otherwise (the engine tests `keyed_name` and reads `type`: when `keyed_name` is present and `type` is absent, reading it throws a `NullReferenceException` inside the catch, which replaces the `CItemException` and is wrapped by EXP-101).

For every other faultcode (a permission error, a server fault, IOM's `999` transport fault) the exception is swallowed: nothing is embedded, and the form continues with the `propertytype_id` left as the plain id. This is a reproduced bug (registered in `bugs.md`).

## Related items and float properties

### EXP-113: Related items of independent ItemTypes are collapsed to their id

[14.0.7] Step 9 collapses the full related items of relationships. It selects, on the whole document, the `Item` elements matching:

```text
.//Relationships/Item[@type!='ITPresentationConfiguration']/related_id[@type!='Identity' and @type!='Method' and @type!='SSVCPresentationConfiguration' and @type!='cmf_TabularViewHeaderRow']/Item[@id!='']
```

All `Relationships` elements at any depth count. In XPath, `@a!='x'` is false when the attribute is absent, so a relationship item without a `type` attribute, a `related_id` without a `type` attribute, or an item without an `id` attribute never matches. For each selected item, in document order (EXP-115 says what the snapshot means):

1. It looks up the related ItemType, named by the `type` attribute of the `related_id` element: `GetItemType(name, "is_dependent, is_versionable")`, whose AML text is `<Item type='ItemType' select='is_dependent, is_versionable' action='get'><name>{name}</name></Item>`. The text of `Result/Item/is_dependent` must be exactly `1` for the ItemType to count as dependent; a missing `is_dependent` element fails (EXP-101). A dependent related item is left in place.
2. Otherwise it looks up the RelationshipType named by the `type` attribute of the relationship item (the `Item` that holds `related_id`): `GetRelationshipType(name, "behavior")`, AML `<Item type='RelationshipType' select='behavior' action='get'><name>{name}</name></Item>`, and reads the text of `Result/Item/behavior`.
3. The replacement text is the related item's `id` attribute, unless the behavior text contains `float` (a culture-sensitive `IndexOf`, which for these ASCII values is a plain substring test), in which case it is the related item's config id, EXP-114.
4. The related `Item` is removed from its `related_id` and the `related_id` content is set to the replacement text (`InnerText`). The `related_id` keeps its attributes.

A lookup that finds nothing (faultcode `0`) throws the `CItemException` with `faultdetail` `Unable to get definition of {type attribute text}: {name}`; that is raised by the lookup helper, whose own rule is in `spec/export-requests.md`.

### EXP-114: The config id of a related item

[14.0.7] `GetRelatedItemConfigId(relatedIdElement)`, called by EXP-113 before the related item is removed (and by the reference-removal step, `spec/export-unknown-refs.md`):

1. If `relatedIdElement` has a child `Item` (`./Item`):
   - if that item has `action="get"`, its id is `GetCurrentIdByUniqueKey(item, false)`;
   - otherwise its id is its `id` attribute when that attribute, trimmed, is not empty (the value is used as is, untrimmed), else `GetCurrentIdByUniqueKey(item, true)`;
   - then, with `t` the item's `type` attribute (a missing one fails, EXP-101): if `t` is versionable (`IsVersionable(t)`), the id becomes the text of the item's `config_id` child when it has one, else `GetConfigId(id, t)`.
2. If it has no child `Item`, the id is the element's text.
3. A null or empty id throws `CItemException` with faultcode `-1`, and `Unable to find ID of the related item` as both faultstring and faultdetail.

From the export path the `action="get"` and empty-`id` branches are not reached for the items of EXP-113, which have a non-empty `id` attribute and, in server responses, no `action`; they are specified because the import checks reach `GetCurrentIdByUniqueKey` (`spec/import-checks.md`).

`GetConfigId(id, type)` sends, uncached and through `Item.apply` (not `CItemHelper.applyAML`), `<Item type='{type}' select='config_id' action='get'><id>{id}</id></Item>` (unescaped values, single quotes, in this attribute order). A fault of any code throws `CItemException` with faultcode `-99` and `Failed to get config_id for item (type={type}; id={id})` as faultstring and faultdetail. Otherwise it returns the text of `config_id` (or the id of an `Item` child, or null when absent).

`GetCurrentIdByUniqueKey(item, exceptionIfPropMissing)`:

1. The item's `type` attribute is read (a missing attribute fails, EXP-101). A null, empty or blank type throws `CItemException`, faultcode `-1`, `Item node doesn't have type attribute`.
2. The unique properties of that type are fetched with `GetUniqueProperties(type)`, which sends, through `Item.apply` and cached by its text in the request cache, `<Item type='ItemType' action='get' select='id'><name>{type}</name><Relationships><Item type='Property' action='get' select='name'><is_keyed>1</is_keyed><is_required>1</is_required><name condition='ne'>generation</name></Item></Relationships></Item>`. A fault throws `CItemException` whose faultcode is the server's faultcode as an integer (or `-1` when it is not a number) and whose faultstring and faultdetail are `Failed to get unique properties for the ItemType '{type}. Error: {fault string}'`. The properties are the `Item` elements of `//*[local-name(.)='Result']/Item/Relationships/Item`.
3. A `CItemException` with faultcode `0` from step 2, or an empty property list, makes the result null. Any other `CItemException` propagates.
4. It builds `<Item type='{type}' action='get' select='id'>`, and for each unique property, in order: the property's `name` child is required (absent throws `CItemException` `-1`, `Error when trying to build unique key for type {type}: required Property doesn't have a name`); the property name is used as an XPath relative to the item (`item.SelectSingleNode(name)`: unescaped, so a name that is not a valid XPath raises an `XPathException`) and when it finds an element, `<{name}>{its text}</{name}>` is appended, unescaped. When it finds nothing: with `exceptionIfPropMissing` it throws `CItemException` `-1`, `Property {name} that is part of the unique key for type {type} is not part of the response`; without it the property is skipped. It closes with `</Item>`.
5. That text is applied through `Item.apply`. A fault gives null. Otherwise the result is the value of `@id` of the first `Result/Item`. When every property was skipped, the request has no criteria and returns the first item of the type.

### EXP-115: Nodes already detached are still processed (bug)

[14.0.7] EXP-113 selects its items before it changes any of them, and removes each non-dependent related item from the document while it loops. A related item nested inside another selected item is still in the snapshot after its ancestor has been removed. It is processed anyway: its metadata lookups are fetched (and may fail), and its `related_id` is rewritten in the detached subtree, which nobody reads. So the requests of EXP-113 are made for every selected item, including those inside collapsed ones, in document order (probed: a parent `P` containing a nested `Q` followed by two siblings visits `P`, `Q`, then the siblings). A dependent related item stays attached, so its nested items are processed on the document.

This is a reproduced bug (registered in `bugs.md`): the extra lookups are cached, so they cost one request per new type name, but a lookup that fails (for example a RelationshipType the server does not have) aborts the export of the item although the node it concerns is no longer part of the output.

### EXP-116: Float item properties holding an id are converted to config ids

[14.0.7] Step 10 applies when the response document has an element `Envelope/Body/Result/Item` (the SOAP namespace or none on the three names; the Result item). `ProcessPropertiesOfTypeItem(item)` does, for that item and then recursively for every `Item` that is a child of a child element of it, in document order (`*/Item`, so `Relationships/Item` and `related_id/Item`, and any property that holds an item):

1. It fetches the float item properties of the item's type (a missing `type` attribute fails, EXP-101). The AML text is below, with `{type}` the type name, unescaped; the same text is the cache key. (The 14.0.7 wire capture holds this request, with a faultcode-`0` response, in `fixtures/wire/14.0.7-reference-host/`.)

   ```text
   <Item type='ItemType' action='get' levels='1' select='id'><name>{type}</name><Relationships><Item type='Property' select='name, data_type, data_source' action='get'><data_type>item</data_type><item_behavior>float</item_behavior><name condition='not like'>config_id</name><name condition='not like'>created_by_id</name><name condition='not like'>source_id</name><name condition='not like'>related_id</name><name condition='not like'>locked_by_id</name><name condition='not like'>modified_by_id</name><name condition='not like'>created_by_id</name><name condition='not like'>permission_id</name><name condition='not like'>managed_by_id</name><name condition='not like'>owned_by_id</name><name condition='not like'>history_id</name><name condition='not like'>id</name><name condition='not like'>current_state</name><name condition='not like'>team_id</name></Item></Relationships></Item>
   ```

   (`created_by_id` is listed twice.) A faultcode `0` fault ends the item's own processing without error, and is not cached, so each item of a type with no float properties repeats the request. Any other exception (a fault, or a non-`CItemException`) is wrapped in a `CItemException` with faultcode `-1`, the original message followed by `Failed to process properties of type 'Item' for ItemType '{type}'` (no space), and the original as its inner exception.
2. The properties are the `Item` elements of `//Result/Item/Relationships/Item` of the response (a path without namespace handling, which matches the unprefixed `Result`).
3. For each property definition, in order: it is skipped when it has no `data_source` child, when that child's `is_null` attribute, trimmed, is `1`, when it has no `name` attribute (the data source ItemType's name, which this ticket does not pin on the server; see below), or when that name is not a versionable type (`IsVersionable(name)`). Otherwise `p` is the text of the definition's `name` child and `v` the item's child element selected by the XPath `p` (unescaped; a non-XPath name raises `XPathException`, wrapped). If there is a `v` and its trimmed text is exactly 32 characters of `0-9` and uppercase `A-F`, its content is replaced by `GetConfigId(its text, data source name)` (EXP-114; the text is passed untrimmed). A lower-case id is not converted.
4. It then recurses into the item's `*/Item` children.

Not pinned by this ticket: whether the dev server's `data_source` element carries a `name` attribute. The engine skips every property that lacks it, so the fixtures that cover float properties (wayfinder ticket 24) decide whether this step ever converts a value.

### EXP-117: dr_RelationshipFamily: the dr_Relationship items are embedded

[14.0.7] Step 11 for `dr_RelationshipFamily`, on the real document: for each `dr_relationship_id` element at `.//*[local-name(.)='Result']/Item/Relationships/Item/dr_relationship_id` (direct relationship items of the Result item), in document order:

1. Its text is the id, and its content is set to the empty string (its attributes stay).
2. A `dr_Relationship` is fetched: `<Item type="dr_Relationship" action="get" id="{id}" />` (DOM-built). A fault throws and aborts the item.
3. If the response has a first `Result/Item`, then, searching the whole response document (`//implementation_query` from that item, which is absolute): when an `implementation_query` element exists anywhere in the response, its text is parsed as XML and replaced by its re-serialisation (EXP-121). A text that is not well-formed XML, or is empty, raises `XmlException`, which is wrapped.
4. A deep copy of the response's Result item is appended into the emptied `dr_relationship_id`.

On dev, `dr_RelationshipFamily` has one item (`User Identities`) whose single `dr_FamilyElement` relationship has `dr_relationship_id` `D54BFC48…`, with `keyed_name` `User Identities-User Identity`.

### EXP-118: ac_PolicyAccessItemAttribute runs the dr_RelationshipFamily routine (bug)

[14.0.7] Step 11 for `ac_PolicyAccessItemAttribute` runs exactly the routine of EXP-117, with the same element names, requests and failures: the code is a second `if` that repeats the `dr_RelationshipFamily` call. The routine looks for `dr_relationship_id` in the direct relationships of the Result item. Its effect on an `ac_PolicyAccessItemAttribute` is therefore whatever its `ac_PolicyAccessAttrDefinition` relationship items hold in that property: the dev schema defines `dr_relationship_id` on `ac_PolicyAccessAttrDefinition`, so the routine does fire there (the earlier reading, that it was a no-op, is wrong). Not probed live: dev holds no `ac_PolicyAccessItemAttribute` item until the scratch fixtures exist.

This is registered in `bugs.md` as the reproduced copy-paste: the second call is the first one's code, and a routine written for the `ac_` shape would not embed `dr_Relationship` items or re-indent an `implementation_query`.

## Conditions in DAC items

### EXP-119: dac_DomainDefinition: condition_xml is re-indented

[14.0.7] Step 12 for `dac_DomainDefinition` rewrites, for each `condition_xml` element that is a child of an `Item` of type `dac_SubdomainPermission` at any depth (`//Item[@type='dac_SubdomainPermission']/condition_xml`, in document order), its content as follows:

1. Its inner XML (the content as XML text, with `&`, `<` and `>` escaped as entities) is HTML-decoded (EXP-120), and the result is parsed back as the element's inner XML. Escaped markup (`&lt;and&gt;`) therefore becomes real child elements. A result that is not well-formed raises `XmlException`, wrapped by EXP-101: unbalanced tags, a bare `&` left after decoding (so plain text containing `&amp;` fails), or an entity name XML does not know.
2. The element's children are written through an `XmlWriter` with these settings: indentation on, indent string one space, newline string CR LF, newline handling `Replace`, no XML declaration, conformance level `Auto` (a fragment, with several roots or text, is allowed). Element-only content is indented one space per level, `<a/>` is written `<a />`, text and mixed content are not indented, comments are kept, a CDATA section is written as `<![CDATA[…]]>`, and an XML declaration in the content is dropped. A CR or LF in text is written as CR LF. No newline follows the last node.
3. The written string is HTML-encoded (EXP-120) and set as the element's inner XML. The encoded string parses as one text node (the encoding turns `<` into `&lt;`), so the element ends up holding the indented XML **as text**, with CR LF inside it. An empty element stays empty (no text node).

Probed examples (`\r\n` is CR LF):

- `&lt;and&gt;&lt;eq&gt;&lt;property name="a"/&gt;&lt;/eq&gt;&lt;/and&gt;` becomes the text `<and>\r\n <eq>\r\n  <property name="a" />\r\n </eq>\r\n</and>`.
- Content that already holds CDATA, `<![CDATA[<and><eq a="1"/></and>]]>`, comes out as the text `<![CDATA[<and><eq a="1"/></and>]]>`.
- `&lt;a/&gt;&lt;b/&gt;` becomes `<a />\r\n<b />`; `&lt;?xml version="1.0"?&gt;&lt;a/&gt;` becomes `<a />`.

### EXP-120: HtmlDecode and HtmlEncode follow .NET Framework's WebUtility

[14.0.7] `WebUtility.HtmlDecode` and `HtmlEncode` of .NET Framework 4.8 are used here and by later steps. The port reproduces them exactly (probed):

- **HtmlDecode** replaces named entities from a table of 253 names (the HTML 4.01 set plus `apos`; names are case-sensitive: `&Eacute;` decodes and `&AMP;` does not), numeric references `&#NNN;` and `&#xHHH;`, and leaves everything else as it is. An entity needs its closing semicolon (`&amp` and `&lt` are not decoded). `&#0;` and numbers above U+FFFF (`&#128512;`) are left as written. `&#xD800;` decodes to the lone surrogate. Unknown names (`&foo;`) are left as written. Decoding runs once: `&amp;amp;` gives `&amp;`.
- **HtmlEncode** writes `<` `>` `&` `"` as `&lt;` `&gt;` `&amp;` `&quot;`, the apostrophe as `&#39;`, characters U+00A0 to U+00FF as decimal references (`&#233;`, `&#160;`), and leaves every other character, including line breaks, tabs, the euro sign and surrogate pairs, as written.

### EXP-121: XDocument.ToString re-serialises XML text

[14.0.7] EXP-117 replaces an `implementation_query` text by `XDocument.Parse(text).ToString()`. The parse keeps no whitespace-only text nodes (so existing indentation is discarded); the output is indented by two spaces per level, with CR LF between lines, no XML declaration and no trailing newline, and empty elements as `<x />` (probed on Windows). Text-only and mixed content stays on its own line, comments and CDATA sections are kept, and a document type declaration is written as `<!DOCTYPE a []>`. A DOM line feed inside an attribute value is written as a space. Text that is empty, blank, has several roots or is not XML at all raises `XmlException` (`Root element is missing.`, `There are multiple root elements.`, `Data at the root level is invalid.`), wrapped by EXP-101.
