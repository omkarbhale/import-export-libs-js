# Export fetch requests

This document specifies what `CExportItems.Export` asks the server for, and how each lookup it triggers behaves: the main fetch of an item, the per-type levels and select table, the four request-body resources, the `_requestedItems` cache, and the literal text and fault handling of every lookup in the export path (`evidence/libs-export-spec.md` §2, rows 2 to 17). What the engine does with the answers is specified elsewhere: the rewrites before the XSL in `export-prexsl.md`, the XSL and the post-processing after it in `export-transform.md` and `export-write.md`, the orchestration around `Export` in `export-run.md`.

Sources:

- the 14.0.7 decompile of `Libs.dll` (`.decomp/14.0.7/`, regenerated locally, never committed);
- the request probe `fixtures/export-requests/14.0.7-probe/requests.json` (quoted below as "the probe"). It was produced by `oracle/request-probe/` with the vendored 14.0.7 `Libs.dll` and `IOM.dll`: the real `CExportItems` and `CItemHelper` run against a stub connection that records the document IOM is handed and answers from a script. No server is involved, so the probe pins what the engine sends and how it reacts to scripted answers, not what Aras answers;
- the proxy capture `fixtures/wire/14.0.7-reference-host/capture.jsonl` (WIRE-002), exchanges 14 to 20, which show the same requests for a one-item export of a `List` against dev.

The `[12.0]` variants come from the 12.0 decompile (`.decomp/12.0/`) compared method by method with 14.0.7's, from the embedded request bodies (byte-identical in both builds), and from the 12.0 capture `fixtures/wire/12.0-reference-host/capture.jsonl` and live exports of the vendored 12.0 engine against dev (a rule says so where it quotes one). A rule without a `[12.0]` difference says `Same as 14.0.7.`: the code behind it is the same in both builds.

## Notation

Each request has two texts:

- **Engine text** is the string the engine hands to `applyAML` (or `loadAML`). It is what `CItemException` quotes in its message (WIRE-051) and what the engine's log would show. Lookups written as string literals mostly have single-quoted attributes and `/>` without a space.
- **Wire text** is what IOM sends: the engine text parsed into a DOM and written out again (WIRE-004), so attributes are double-quoted and an empty element is `<X />`. The probe and the oracle transcripts record the wire text.

Requests the engine builds through the DOM (EXP-003) have the same text in both forms. Where a rule gives a request, it gives the engine text, with `{…}` for a value the engine interpolates. All requests are `ApplyItem`, except the one in EXP-048, which is `ApplyAML` (WIRE-004). Every request is a `get`; nothing on the export path writes (`evidence/libs-export-spec.md` §2).

"The helper" is the `CItemHelper` instance of the run. "Faultcode 0" is IOM's "no items" fault (WIRE-052). `applyAML` is WIRE-006: it throws a `CItemException` for any fault, faultcode 0 included, whose faultstring and message are WIRE-051's `Server error … Request: {engine text} … Responce: {response}`.

## One item

### EXP-001: An item's requests, in order

[14.0.7] `CItemHelper.PackageItem(item, package, level, excludedRefs)` creates a `CExportItems` over the helper and calls `Export`. Everything is sequential. For one item, `Export` sends these requests, in this order, each only when its condition holds:

| # | Request | Sent when | Cached |
|---|---|---|---|
| 1 | is_versionable lookup of the item's type (EXP-010) | always | yes |
| 2 | current-id lookups (EXP-011) | the type is versionable | no |
| 3 | main fetch (EXP-020) | always | no |
| 4 | auto-generated relationship query (EXP-048) | the type is `ItemType` and the main fetch's result holds an item | no |
| 5 | the relationship's ItemType fetch (EXP-049), then the dependency-level chain (EXP-043) | the type is `RelationshipType`, in that order | no |
| 6 | one Property fetch per Field (EXP-050) | the type is `Form` | no |
| 7 | the independent-related-item lookups: ItemType and RelationshipType metadata (EXP-040), and for a float relationship the unique-key, key and config id lookups (EXP-041, EXP-042; EXP-010 again for the related type) | per matching related item, in document order | partly |
| 8 | the float-property lookup (EXP-044), then the config id lookup (EXP-042) for each qualifying value | once per `Item` element of the result, the root first, then each child element's `Item` children, depth first | yes on success |
| 9 | one dr_Relationship fetch per `dr_relationship_id` (EXP-051) | the type is `dr_RelationshipFamily` or `ac_PolicyAccessItemAttribute` | no |
| 10 | the default-permission lookup (EXP-045) | once per `Item` of the transformed result that has a `permission_id`, by its type | yes on success |
| 11 | the poly-type lookup (EXP-046) | once per run, on the first item that reaches it | latched |
| 12 | the unknown-package lookups | only when the references to unknown packages are not left alone: `export-unknown-refs.md` | per that area |

The probe's `N.*` scenarios and the capture (exchanges 14 to 20: is_versionable of `List`, main fetch, float properties of `List` and `Value`, default permission of `List` and `Value`, poly-types) show this order. What steps 4 to 10 do with the answers, and their faults, are in `export-prexsl.md`; this document gives the request each step sends. When a step throws, the later steps' requests are not sent, and the exception is handled as EXP-054 says.

Steps 1 to 3 and the step-8 float lookup are all that a plain item such as a `List` needs. A host reaches `Export` through `ImportExportManager` (`export-run.md`). The 12.0 variants (`[12.0]`) are given with each rule; 14.35's come with its tickets.

[12.0] Same requests and order, with three differences. Step 3 for `ac_PolicyAccessItemAttribute` is the default-row request (EXP-021). Step 8 is shorter (EXP-116): the lookup runs for the root and then for each `Relationships/Item` child, depth first, and it stops for an item, and so for the whole subtree, when the lookup of its type is a faultcode `0`. Step 9 is sent for `dr_RelationshipFamily` only (EXP-051). The capture (`fixtures/wire/12.0-reference-host/`, exchanges 9 to 31) shows the order for a one-item export of a `List`: it has the float lookup of `List` and none of `Value`, which the 14.0.7 capture has.

### EXP-002: What an item is, and its file name

[14.0.7] The item to export is an `ExportItem` of three strings: `keyedName`, `idName` and `typeName`. `ToString()` is the keyed name. Where the three come from is the orchestration's business (`export-run.md`): for a package element they come from the package definition; for an element referenced by a dependency (EXP-053) the keyed name is the element's `element_description`, empty when that is blank, and the id and type are its `element_id` and `element_type`. A null item is refused with `ArgumentNullException("item")` before anything else; a host never passes one.

The file name is chosen first, before any request. It is the keyed name when it is non-empty and contains none of the characters of .NET's `Path.GetInvalidFileNameChars()` on Windows, otherwise the **requested id** (`idName`, as given, before the current-version resolution of EXP-011), and the extension `.xml` follows. The characters are exactly: `"`, `<`, `>`, `|`, U+0000 to U+001F, `:`, `*`, `?`, `\` and `/` (41 characters, probed on the oracle machine). The port applies this Windows set on every platform. The keyed name is not trimmed, and a whitespace-only name is a valid name here. The type name, which is also the folder name, is not checked. The folder, the directory handling and the file-system effects on the name (case collisions, a trailing space) belong to `export-write.md`.

[12.0] Same as 14.0.7.

### EXP-003: Requests built through the DOM

[14.0.7] The main fetch (EXP-020), the ItemType fetch of EXP-049, the Property fetch of EXP-050, the dr_Relationship fetch of EXP-051, the dependency-level request of EXP-043, and the ItemType body fragments are built as DOM nodes, so their values are escaped and their shape is fixed:

- Attributes are created in the order the engine sets them and written in that order, always double-quoted.
- Attribute values escape `&` as `&amp;`, `<` as `&lt;`, `>` as `&gt;` and `"` as `&quot;`. A CR or LF in a value is written `&#xD;` or `&#xA;`, and a tab is written as itself. A non-ASCII character is written as itself.
- Text (the `<id>` and the like) escapes `&`, `<` and `>`, and leaves `"` and `'`. The probe: an id `idwith&amp;<x>"` is sent as `idwith&amp;amp;&lt;x&gt;"`, and a level `<&"` as `&lt;&amp;&quot;`.
- An element with no children is written `<X />`, with a space.
- There is no whitespace between elements, no declaration and no namespace.

A request written as a string literal (the lookups of EXP-010, EXP-011, EXP-040 to EXP-042, EXP-044 to EXP-048 and EXP-052, EXP-053) is parsed first, so its wire text is the mechanical re-serialisation of WIRE-004.

[12.0] Same as 14.0.7.

### EXP-004: Interpolated values are not escaped in string requests

[14.0.7] The lookups written as string literals interpolate names and ids into the text exactly as given, with no escaping (AGENTS.md rule 7). A value that makes the text not well-formed XML does not reach the wire: IOM refuses the document and `XmlException` surfaces from the lookup, with .NET's message and the position in the engine text. From inside `Export` that is wrapped by EXP-054. The probe, for the type name `Part & Co`, sends nothing and ends with `An error occurred while parsing EntityName. Line 1, position 72. Can't export item.`; for `Part<Co` the message is `The '<' character, hexadecimal value 0x3C, cannot be included in a name. Line 1, position 73. Can't export item.`. A value with a quote that is harmless in element text (`O'Brien`) is sent as it is, and in the DOM-built main fetch becomes an attribute value, where `"` is escaped (EXP-003) and `'` is not.

Some string requests interpolate into an attribute, `type='{type}'` in EXP-011, EXP-041 and EXP-042. A type name containing `'` ends the attribute early and fails the parse in the same way.

[12.0] Same as 14.0.7.

## Versionable types and current ids

### EXP-010: The is_versionable lookup

[14.0.7] `IsVersionable(typeName)` asks the server about the ItemType of that name:

```text
<Item type='ItemType' select='is_versionable' action='get'><name>{typeName}</name></Item>
```

It goes through the metadata lookup (EXP-031), so it is cached by its engine text (EXP-030). `Export` calls it at the start (EXP-001 step 1) and again before `ReplaceIdWithConfigId`; the second call is always a cache hit.

The answer is read from `Envelope/Body/Result/Item/is_versionable` (the first `Item`, matching the envelope by local name in the SOAP namespace or in none). If the element exists, the type is versionable exactly when its text equals `1`, compared ignoring case: `0`, an empty text, `true` and ` 1` give false (probe `E.isVersionableValues`). If the element is missing, `CItemException` with faultcode -1, faultstring and detail `Can't determine whether item versionable or not`. A fault is thrown as the metadata lookup says (EXP-031); a name no ItemType carries therefore gives faultcode 0 with a rewritten detail.

[12.0] Same as 14.0.7.

### EXP-011: The current id of a versionable item

[14.0.7] When the type is versionable, `GetCurrentIdOfVersion(id, type)` runs, with `id` the requested `idName`:

Step 1 sends:

```text
<Item type='{type}' select='config_id, is_current' action='get'><id>{id}</id></Item>
```

A `CItemException` with faultcode other than 0 is rethrown as it is. Faultcode 0 means "not found by that id" and leaves the answer empty. Any other exception (for example the `XmlException` of EXP-004) becomes a `CItemException` with faultcode -1, the original exception's stack text as faultstring (EXP-055), the original message followed directly (no separator) by `Unable to find a current version of the item (ID='{id}'; Type='{type}')` as faultdetail and message.

Step 2: when an answer exists, `is_current` of its `Item` is read: current exactly when the text equals `1` ignoring case, and not current when the element is missing. `config_id` of its `Item` becomes the config id; a missing `config_id` is a `NullReferenceException` (EXP-054).

Step 3: a current item's id is returned as `id`, with no further request. Otherwise the second request is sent, with the config id from step 2, or `{id}` itself when step 1 gave faultcode 0:

```text
<Item type='{type}' select='id' action='get'><config_id>{configId}</config_id></Item>
```

There is no `is_current` condition. Any exception from it, faultcode 0 included, becomes the faultcode -1 `CItemException` of step 1 with this request's own text in the message. The returned id is the text of `Result/Item/id` of the answer's first `Item`; a missing `id` is a `NullReferenceException`.

`Export` puts the returned id in the main fetch (EXP-020). When the type is not versionable the main fetch carries `idName` and no lookup is made. The probe (`F.getCurrentIdOfVersion`, `D.versionable`) shows each path: current (one request, id unchanged), not current (two requests, the new id), not found (a faultcode -1 exception carrying the second request), a server error on the first request (rethrown, faultcode 999), and a missing `config_id` (`NullReferenceException`).

[12.0] Same as 14.0.7.

## The main fetch

### EXP-020: The main fetch

[14.0.7] After EXP-010 and EXP-011, `Export` builds one `Item` element through the DOM (EXP-003) and sends it with `applyAML`:

```text
<Item type="{typeName}" action="get" [levels="…"] [related_expand="0"] [select="…"]><id>{id}</id>[body]</Item>
```

The attributes are `type`, then `action`, then the ones EXP-021 to EXP-023 name, in the order shown. The `<id>` child comes first and the type's relationship body (EXP-024, EXP-025), if it has one, follows it. The answer is the whole response document, envelope included (WIRE-006). A fault, faultcode 0 included, is thrown by `applyAML` and is not caught by `Export` (EXP-054 lists what it catches), so it ends this item's export with the `CItemException` of WIRE-051 (probe `O.mainFetchFault`).

[12.0] Same as 14.0.7.

### EXP-021: Levels and select by type

[14.0.7] The attributes depend on the item's type name, matched with ordinal, case-sensitive string equality (the engine's `switch`, EXP-026). `item report` and `ITEM REPORT` are not `Item Report` and take the default row.

| Type | `levels` | other |
|---|---|---|
| `Item Report` | `0` | `related_expand="0"` |
| `Action`, `Identity`, `List`, `Method`, `Permission`, `RelationshipType`, `Sequence`, `UserMessage`, `Workflow Promotion` | `1` | |
| `Grid`, `User`, `Preference` | `2` | |
| `qry_QueryDefinition`, `rb_TreeGridViewDefinition`, `xClassificationTree`, `dac_DomainDefinition`, `ac_PolicyAccessItemAttribute`, `dr_RelationshipFamily` | `2` | |
| `Form`, `Life Cycle Map`, `Workflow Map` | `3` | |
| `ItemType` | none | the ItemType body (EXP-024) |
| `cmf_ContentType` | none | the content-type body (EXP-025) |
| `cmf_TabularView` | none | the tabular-view body (EXP-025) |
| anything else | EXP-022 | `select` of EXP-023 |

The level an export was asked for (EXP-022) is ignored for every named type. The probe's `A.typeTable` has the request of each row.

[12.0] The same table, except that `ac_PolicyAccessItemAttribute` has no row. It takes the default row (EXP-022, EXP-023): `levels` is the requested level and the default `select` is sent. `qry_QueryDefinition`, `rb_TreeGridViewDefinition`, `xClassificationTree`, `dac_DomainDefinition` and `dr_RelationshipFamily` keep `levels="2"`.

### EXP-022: The requested level, for other types

[14.0.7] For a type with no row of its own, `levels` is the level the caller passed to `Export` (the export context's `sLevel`), except that a null, empty or whitespace-only level becomes `1`. A level of any other text is used verbatim, not trimmed and not validated: ` 3 ` is sent as `levels=" 3 "` and `abc` as `levels="abc"`, with the escaping of EXP-003 (probe `B.levels`). The level is never an integer to the engine.

[12.0] Same, and `ac_PolicyAccessItemAttribute` is one of the types it applies to (EXP-021).

### EXP-023: The default select, by server version

[14.0.7] A type with no row of its own also gets `select="xp-*($value, @explicit, @permission_id), *[is_not_null()]"` (the text is exact, with the spaces) when the server's major version is above 11, or is 11 with service pack 12 or later. Otherwise the attribute is omitted. The version is the helper's `InnovatorVersion` (WIRE-021). The probe: servers 14.0, 12.0 and 11 SP12 get it; 11 SP11, 11.0, 10.0 and 9.0 do not. The 14.0.7 login gate (WIRE-023) refuses servers below 12, so the library always sends it. When the helper has no version, because `Login` was not called, the default row throws a `NullReferenceException` (EXP-054).

[12.0] Same code. The window of the 12.0 gate (WIRE-023) includes servers 10 and 11, so the omission applies to them: the attribute is left out for a 10.x server and for 11 below service pack 12, and sent for 11 SP12 and later and for 12. Dev is 12.0 SP9, so it is sent.

### EXP-024: The ItemType body

[14.0.7] An `ItemType` fetch carries one `Relationships` element after the `<id>`, built from an embedded resource and serialised without whitespace (the resource's own line breaks and tabs are dropped when it is loaded, and an element with no children is written `<Item … />`). The server major version chooses the resource: below 11 the older body, otherwise the current one. The 14.0.7 gate refuses servers below 12 (WIRE-023), so the library always uses the current body; the older one is specified for completeness (probe `C.serverVersion`). When the helper has no version, the choice throws a `NullReferenceException` (EXP-054). The same body is added to the ItemType fetch of EXP-049.

Every entry is `<Item type="{T}" action="get" />`, with the attributes in that order, unless it has children. The current body is, in this order (children indented, `related_id:` meaning an element of that name that holds the `Item`):

- `DiscussionTemplate`
  - `FeedTemplate`
    - `FileSelectorTemplate`
  - `DiscussionTemplateView`, with `related_id:` `SSVCPresentationConfiguration`
- `ITPresentationConfiguration`, with a third attribute `related_expand="0"`
- `Property`
  - `Grid Event`
- `RelationshipType`
- `View`, with `related_id:` `Form`
  - `Body` (a child of the `Form`)
- `Server Event`
- `Item Action`
- `ItemType Life Cycle`
- `Allowed Workflow`
- `TOC Access`, with `related_id:` `Identity`
  - `Member` (a child of the `Identity`)
- `TOC View`
- `Client Event`
- `Can Add`, with `related_id:` `Identity`
  - `Member` (a child of the `Identity`)
- `Allowed Permission`, with `related_id:` `Permission`
  - `Access` (a child of the `Permission`)
- `Item Report`
- `Morphae`
- `ItemType_xPropertyDefinition`

That is 30 `Item` elements. The older body, for servers below 11, is the same list without the `DiscussionTemplate` subtree (five elements), `ITPresentationConfiguration` and `ItemType_xPropertyDefinition`: 23 elements. The serialised `Relationships` element of the current body is 1699 characters, sha256 `cce60f07f2f932fbf20b394e33a390b707f21c5aa1e4bb084cee768f9ba7db2b`, and the older one 1219 characters, sha256 `218c420c5c173eb0c39034e51b402b5ca2c62df8d45ca51216c2d071d13bc06c` (UTF-8, from the first `<Relationships>` to its closing tag, taken from the probe's requests).

[12.0] Same resources, byte for byte (the embedded request bodies are identical in both builds, so the element lists, lengths and digests above hold). The 12.0 gate lets servers 10 and 11 in, so the older body (below 11) is reachable here, where 14.0.7 never uses it; on a 12.0 SP9 server the current body is used.

### EXP-025: The cmf bodies

[14.0.7] `cmf_ContentType` and `cmf_TabularView` fetches carry a `Relationships` element after the `<id>`, built and serialised as in EXP-024, with every entry `<Item type="{T}" action="get" />` unless it has children. The content-type body, in order:

- `cmf_ContentTypeView`
- `cmf_ElementType`
  - `cmf_ElementAllowedPermission`
  - `cmf_ElementBinding`
    - `cmf_PropertyBinding`
  - `cmf_PropertyType`
    - `cmf_ComputedProperty`
    - `cmf_PropertyAllowedPermission`
- `cmf_ContentTypeExportRel`
- `cmf_DocumentLifeCycleState`

That is 10 elements, 643 characters, sha256 `b05314bca582d6a24033ae0ca3a765f7c6e8ba0284f99bbdd309ed572fd19b3d`. The tabular-view body, in order:

- `cmf_TabularViewColumn`
  - `cmf_AdditionalPropertyType`
- `cmf_TabularViewHeaderRows`, with `related_id:` `cmf_TabularViewHeaderRow`
  - `cmf_TabularViewColumnGroups` (a child of the `cmf_TabularViewHeaderRow`)
- `cmf_TabularViewTree`

That is 6 elements, 449 characters, sha256 `34e083dd28c64310a298effc615297faeff845f0be4415b225ac204bad6ab999`. The digests are taken as in EXP-024.

[12.0] Same as 14.0.7.

### EXP-026: The string switch and its hash

[14.0.7] The compiler turns the engine's `switch (item.typeName)` (EXP-021) into a hash dispatch: `<PrivateImplementationDetails>::ComputeStringHash(s)` returns 0 for a null string and otherwise the 32-bit FNV-1a hash over the string's UTF-16 code units, `h = 2166136261; for each unit c: h = (c XOR h) × 16777619 (mod 2^32)`. The dispatch compares the hash with constants and then confirms the match with string equality, so a hash collision never selects a wrong row. The behaviour is therefore exactly an ordinal, case-sensitive string match, and the port uses one. `DelayedResolutionManager` has a switch of its own and uses the same helper (`import-delayed.md`). A null `typeName` takes the default row.

[12.0] Same as 14.0.7.

## The lookup cache

### EXP-030: The `_requestedItems` cache

[14.0.7] Each `CItemHelper` has one `Dictionary<string, XmlDocument>`, created with the helper and never emptied. Its key is the lookup's exact engine text, compared ordinally and case-sensitively, so a different `select`, spacing or case is a different entry (`select='is_versionable'` and `select='is_dependent, is_versionable'` for one type are two). Only successful answers are stored: a fault is never cached, and the next identical lookup sends the request again. A hit returns the stored document itself, not a copy; the engine only reads cached documents, so the port may share them.

These lookups use it: the metadata lookups (EXP-010, EXP-040), EXP-041's keyed-properties request, EXP-044 and EXP-045. These do not: EXP-011, the key lookup of EXP-041, EXP-042, EXP-043, EXP-046 (which has its own latch), EXP-048 to EXP-053.

Two helpers never share a cache: a second `CItemHelper` on the same connection asks the server again (probe `E.cachePerHelper`). The cache is separate from the static tables the constructors reset (`m_pkgIDs`, `_mNonCorePackageNames`, `_relationshipTypeIDs`, `_mPolynames`, the last being EXP-046's).

[12.0] Same as 14.0.7.

### EXP-031: The metadata lookup

[14.0.7] `GetItemType(name, select, log)`, `GetRelationshipType(name, select, log)` and `GetMetaDataInfo` build

```text
<Item type='{ItemType|RelationshipType}'[ select='{select}'] action='get'>[criteria]<name>{name}</name></Item>
```

(`select` is omitted when empty; the extra criteria are used only on the import side). `GetTypeAmlInner` then returns the cached answer for that text (EXP-030) or sends it with `applyAML` and stores the answer. On the export path the log writer is null, so nothing is written. A `CItemException` with faultcode 0 gets a new `faultdetail`, `Unable to get definition of {x}: {name}`, where `{name}` is the lookup's `<name>` text (empty when it has none) and `{x}` is, by a defect, not the type (EXP-032). The exception is rethrown with its faultcode and faultstring unchanged. Any other exception is rethrown as it is. The probe (`E.isVersionableUnknownType`, `E.isVersionableServerError`) shows faultcode 0 rewritten twice, one request each time, and a faultcode 999 untouched.

[12.0] Same as 14.0.7.

### EXP-032: The "Unable to get definition" text names `System.Xml.XmlAttribute` (bug)

[14.0.7] The rewritten detail of EXP-031 is built from the `type` attribute node's `ToString()`, which is the .NET type name and not the attribute's value. A refused lookup reads `Unable to get definition of System.Xml.XmlAttribute: Nope` whatever the type. Registered in `bugs.md`.

[12.0] Same as 14.0.7.

### EXP-040: The ItemType and RelationshipType metadata for related items

[14.0.7] `processIndependentRelatedItems` (EXP-001 step 7) selects, in the answer, every `Item` with a non-empty `id` attribute that is the child of a `related_id` of a relationship `Item` (`.//Relationships/Item/related_id/Item`). The relationship `Item`'s type must not be `ITPresentationConfiguration` and the `related_id`'s `type` attribute must not be `Identity`, `Method`, `SSVCPresentationConfiguration` or `cmf_TabularViewHeaderRow`. For each it sends two lookups through the metadata lookup (EXP-031), cached by EXP-030:

```text
<Item type='ItemType' select='is_dependent, is_versionable' action='get'><name>{relatedItemType}</name></Item>
<Item type='RelationshipType' select='behavior' action='get'><name>{relationshipType}</name></Item>
```

where `{relatedItemType}` is the `type` attribute of the `related_id` element and `{relationshipType}` is the `type` attribute of the relationship `Item` that holds it. The second is sent only when `is_dependent` of the first is not `1`; a first answer without `is_dependent`, or a second without `behavior`, is a `NullReferenceException`. What follows is in `export-prexsl.md`.

[12.0] Same as 14.0.7.

### EXP-041: The unique-key lookups

[14.0.7] To find the current id of an item by its unique key, `GetCurrentIdByUniqueKey(item, exceptionIfPropMissing)` first reads the item's `type` attribute. A blank one (empty or only whitespace) is `CItemException` faultcode -1 with faultstring and detail `Item node doesn't have type attribute`; a missing attribute is a `NullReferenceException`. Then:

1. The keyed properties of the type, through `GetUniqueProperties` (cached, EXP-030), written directly with `loadAML` and `apply` rather than `applyAML`:
   ```text
   <Item type='ItemType' action='get' select='id'><name>{type}</name><Relationships><Item type='Property' action='get' select='name'><is_keyed>1</is_keyed><is_required>1</is_required><name condition='ne'>generation</name></Item></Relationships></Item>
   ```
   An error answer is `CItemException` with the faultcode parsed from the error (-1 when it does not parse), and faultstring and detail `Failed to get unique properties for the ItemType '{type}. Error: {error text}'` (the quote placement is the engine's). When that faultcode is 0, or the answer has no property rows, `GetCurrentIdByUniqueKey` returns null.
2. The key request is built by text: `<Item type='{type}' action='get' select='id'>`, then for each property row in answer order `<{name}>{value}</{name}>` with the value the text of the element of that name in the item (the name is used as an XPath relative to the item), then `</Item>`. A row with no `name` is `CItemException` -1 with `Error when trying to build unique key for type {type}: required Property doesn't have a name`. A property the item lacks is `CItemException` -1 with `Property {name} that is part of the unique key for type {type} is not part of the response` when `exceptionIfPropMissing` is true, and is left out of the request when false. Values are not escaped (EXP-004): a value with `&` throws `XmlException` from the lookup.
3. The key request is sent directly. Any error answer, faultcode 0 or not, gives null. Otherwise the result is the `id` attribute of the answer's first `Item`; an answer with none is a `NullReferenceException`.

Probe `Q.configIdAndUniqueKey` and `I.getCurrentIdByUniqueKey` (the second call of one type is a cache hit for step 1 and sends the key request again) show each branch.

[12.0] Same as 14.0.7.

### EXP-042: The config id lookup

[14.0.7] `GetConfigId(id, type)` sends, directly with `loadAML` and `apply`:

```text
<Item type='{type}' select='config_id' action='get'><id>{id}</id></Item>
```

An error answer of any faultcode is `CItemException` with faultcode -99 and faultstring and detail `Failed to get config_id for item (type={type}; id={id})`. Otherwise it returns the item's `config_id` property: null when the answer has none and the empty string when it is empty (probe `Q.configIdAndUniqueKey`). It is not cached.

[12.0] Same as 14.0.7.

### EXP-043: The dependency level of a relationship type

[14.0.7] `getDepencyLevel(typeId, level)` sends (built through the DOM, EXP-003):

```text
<Item type="RelationshipType" select="source_id,relationship_id" page="1" pagesize="1" action="get"><relationship_id>{typeId}</relationship_id></Item>
```

A `CItemException` of any faultcode ends the recursion and returns `level` as it stands. Otherwise, when the answer has `Result/Item/source_id`, it asks again with that id and `level + 1`; when it has none, it returns `level`. Called first with 0, the chain stops at the first fault or the first answer without `source_id`; there is no cycle guard, so a cycle in the server's data does not end. The level is an integer written in invariant culture. XML and XPath errors become `CItemException` -1 with the exception's message followed by the text keyed `UnableToGetDepencyLevelForRelationshipType`, which the engine looks up under a key written with a leading space and therefore always yields the empty string. The probe (`H.getDepencyLevel`, `H.getDepencyLevelError`) shows a three-request chain giving 2, and a fault giving the level passed in. Not cached.

[12.0] Same request, same recursion. The error text works in 12.0: an XML or XPath error becomes `CItemException` -1 with the exception's message followed by ` Unable to get depency level for RelationshipType.` (a leading space, the engine's spelling). In 14.0.7 that text is lost to a key written with a leading space.

### EXP-044: The custom float properties of a type

[14.0.7] `GetCustomFloatPropertiesOfTypeItem(type)` sends through `applyAML`:

```text
<Item type='ItemType' action='get' levels='1' select='id'><name>{type}</name><Relationships><Item type='Property' select='name, data_type, data_source' action='get'><data_type>item</data_type><item_behavior>float</item_behavior><name condition='not like'>config_id</name><name condition='not like'>created_by_id</name><name condition='not like'>source_id</name><name condition='not like'>related_id</name><name condition='not like'>locked_by_id</name><name condition='not like'>modified_by_id</name><name condition='not like'>created_by_id</name><name condition='not like'>permission_id</name><name condition='not like'>managed_by_id</name><name condition='not like'>owned_by_id</name><name condition='not like'>history_id</name><name condition='not like'>id</name><name condition='not like'>current_state</name><name condition='not like'>team_id</name></Item></Relationships></Item>
```

The fourteen `name` conditions are in that order, `created_by_id` twice. A successful answer is cached by EXP-030 and its rows are `//Result/Item/Relationships/Item`. A `CItemException` with faultcode 0 gives no rows, and is **not** cached, so every `Item` element of the same type asks again (probe `I.floatPropertiesFault0NotCached`: a `List` with three `Value` children sends four requests; `R.floatProperties`: with a success answer, two). Any other exception is `CItemException` -1 with the original message followed directly by `Failed to process properties of type 'Item' for ItemType '{type}'` (and the original stack text as faultstring, EXP-055), even when the original was a `CItemException`.

[12.0] Same request, caching and rows. The wrapped exception's text lacks the closing quote: the original message followed directly by `Failed to process properties of type 'Item' for ItemType '{type}` (the engine's literal ends after `{type}`).

### EXP-045: The default permission of a type

[14.0.7] `GetItemType(name)` sends through `applyAML`:

```text
<Item type='ItemType' action='get' select='id, is_relationship, use_src_access'><name>{name}</name><Relationships><Item type='Allowed Permission' action='get' select='related_id(id)'><is_default>1</is_default></Item></Relationships></Item>
```

A successful answer is cached by EXP-030 and returned. A `CItemException` of any faultcode returns null and caches nothing, so the next call asks again (probe `G.getItemTypeCache`: `Part` once, `Nope` and `Boom` twice each). Other exceptions propagate. The caller is the permission rewrite of `export-write.md`; the name is the `type` attribute of an `Item` that has a `permission_id`.

[12.0] Same as 14.0.7.

### EXP-046: The poly-type names

[14.0.7] `GetPolytypeNames()` returns the names of the polymorphic ItemTypes. The first call of a helper's life sends, through `applyAML`:

```text
<Item type='ItemType' action='get' select='name'><implementation_type>polymorphic</implementation_type></Item>
```

and keeps the text of every `Result/Item/name` in a list; faultcode 0 keeps an empty list. Later calls return that list with no request. The list is a static field that every `CItemHelper` constructor resets to unset, so each helper asks once. A fault other than 0 is EXP-047.

[12.0] Same as 14.0.7.

### EXP-047: A failed poly-type lookup is remembered as "no poly-types" (bug)

[14.0.7] The list of EXP-046 is created before the request is sent. When the request fails with a faultcode other than 0, the exception reaches the first caller, but the list stays and is empty, so every later call of that helper returns an empty list and sends nothing (probe `I.polytypeNamesLatch`: the second call neither throws nor asks; a new helper asks again). Items exported after the failed one therefore keep their `data_source` references to polymorphic types unrewritten, silently. A correct engine would not keep the empty list after a failure. Registered in `bugs.md`.

[12.0] Same as 14.0.7.

### EXP-048: The auto-generated relationship query

[14.0.7] For an `ItemType`, after the main fetch, and only when the answer holds an item that is not an error, the engine sends through `Innovator.applyAML` (so as `ApplyAML`, WIRE-004):

```text
<AML>{TAB}<Item type="cmf_ContentType" action="get" select="id">{TAB}{TAB}<linked_item_type>{itemTypeId}</linked_item_type>{TAB}{TAB}<Relationships>{TAB}{TAB}{TAB}<Item type="cmf_ElementType" select="generated_type" >{TAB}{TAB}{TAB}{TAB}<Relationships>{TAB}{TAB}{TAB}{TAB}{TAB}<Item type="cmf_PropertyType" select="generated_type" />{TAB}{TAB}{TAB}{TAB}</Relationships>{TAB}{TAB}{TAB}</Item>{TAB}{TAB}</Relationships>{TAB}</Item></AML>
```

`{TAB}` is a tab character; there are no line breaks, and the space before `>` after the `cmf_ElementType` select is in the engine text only (the wire text, WIRE-004, has none). `{itemTypeId}` is the id of the item the main fetch returned. An error answer ends the step without effect. What the answer is used for, and why almost none of it reaches the file, is in `export-prexsl.md`.

[12.0] Same as 14.0.7.

### EXP-049: The ItemType fetch for a relationship type

[14.0.7] For a `RelationshipType`, after its main fetch, the engine empties the `relationship_id` element, taking its text as `{relId}`, and sends through `applyAML`, built through the DOM (EXP-003) with the ItemType body of EXP-024 after it:

```text
<Item type="ItemType" action="get" id="{relId}">{ItemType body}</Item>
```

There is no `levels`, `select` or `<id>` child here: the id is an attribute. The dependency-level chain (EXP-043) follows when the answer holds an item and the main answer has a `source_id`. A fault is handled as `export-prexsl.md` says.

[12.0] Same as 14.0.7.

### EXP-050: The Property fetch for a Form's Field

[14.0.7] For a `Form`, for each `propertytype_id` of a `Field` in the main answer, in document order, the engine sends through `applyAML`, built through the DOM:

```text
<Item type="Property" action="get" id="{propertytype_id}" select="name,source_id" page="1" pagesize="1" />
```

The `id` is the element's text. How the answer and a fault are handled is in `export-prexsl.md`.

[12.0] Same as 14.0.7.

### EXP-051: The dr_Relationship fetch

[14.0.7] For `dr_RelationshipFamily` and for `ac_PolicyAccessItemAttribute`, the engine looks for `dr_relationship_id` elements under the relationship `Item`s of the answer. For each, in document order, it empties the element, takes its text as `{drId}` and sends through `applyAML`, built through the DOM:

```text
<Item type="dr_Relationship" action="get" id="{drId}" />
```

The step is the same for both types, a copy-paste in the engine; the probe (`N.drRelationshipFamily`, `N.acPolicyAccessItemAttribute`) shows the request for each when the answer holds a `dr_relationship_id`. Whether an `ac_PolicyAccessItemAttribute` answer ever does is server data, and is for `export-prexsl.md`.

[12.0] Only `dr_RelationshipFamily` does this. `ac_PolicyAccessItemAttribute` has no step 9 in 12.0, so its answer is never searched for `dr_relationship_id` and no `dr_Relationship` is fetched for it. The request, the element walk and the embedding for `dr_RelationshipFamily` are as in 14.0.7 (EXP-117 for what is done with the answer).

### EXP-052: The package definition lookup

[14.0.7] `PackageDefinitionManager(helper, name, doCreate)` runs `InitSolution` in its constructor, with the export's `doCreate` false:

```text
<Item type='PackageDefinition' select='id,name,generation' action='get'><name>{name}</name><is_current>1</is_current></Item>
```

The package definition's id is the text of the first `//Item[@type='PackageDefinition']/id` of the answer; none is a `NullReferenceException`. Faultcode 0 with `doCreate` false is rethrown like any other `CItemException`; with `doCreate` true the engine would add the package (the import side, `import-run.md`). Every `CItemException` that leaves has ` Fails to init solution to PackageDefinition: {name}` appended to its faultdetail (the leading space is part of the text): `No items of type PackageDefinition found. Fails to init solution to PackageDefinition: pkg`. A non-`CItemException` becomes `CItemException` -1 with the exception's message followed by the same text and its stack text as faultstring (EXP-055). The probe (`P.packageDefinitionManager`) shows each case. It is not cached. Where the constructor is called, and what a thrown `CItemException` does to the run, is in `export-run.md`.

[12.0] Same as 14.0.7.

### EXP-053: The referenced elements of a dependency

[14.0.7] `FindReferencedElements(package)` sends, with the package definition's id from EXP-052 as `{sourceId}`:

```text
<Item type='PackageDependsOn' levels='1' configPath='.|PackageReferencedElement' select='id|element_id,element_type,element_description' action='get'><name>{package}</name><source_id>{sourceId}</source_id></Item>
```

The `|` characters are literal. Every `//Item[@type='PackageReferencedElement']` of the answer becomes an `ExportItem` (EXP-002), in document order: `idName` is the text of `element_id`, `typeName` the text of `element_type`, and `keyedName` the text of `element_description` when it has a non-blank text, otherwise the empty string. A missing or blank (after trimming) `element_id` or `element_type` throws `CItemException` -1 with an empty faultstring and `Referenced element doesn't have '{element_id|element_type}' set`. Faultcode 0 from the request gives an empty list. A `CItemException` of any other faultcode, including that -1, is rethrown with ` Failed to find referenced elements for package '{name}'` appended to its faultdetail, where `{name}` is the package the manager was made for (not `{package}`). Any other exception becomes `CItemException` -1, with the faultstring its stack text (EXP-055) and the message `{message}; Failed to find referenced elements for package '{name}'`. Values are not escaped (EXP-004): `dep&one` fails as an `XmlException` and arrives as that last form. The probe shows the elements read (`refsOk`, whose second element has the blank description) and each fault. It is not cached.

[12.0] Same as 14.0.7.

## Faults of `Export`

### EXP-054: What `Export` catches

[14.0.7] The whole of `Export` after the null check (EXP-002), steps 1 to 19 of `evidence/libs-export-spec.md` §1, runs in one `try`. It catches exactly three exception types, and each becomes `CItemException` with faultcode -1, faultstring the exception's stack text (EXP-055), and faultdetail and message `{exception message} Can't export item.` (one space before `Can't`):

- `XmlException`, from a request that is not well-formed (EXP-004), from an answer that is not XML, or from a later step;
- `NullReferenceException`, whose message is `Object reference not set to an instance of an object.`;
- `XPathException`.

A `CItemException` that is already thrown passes through unchanged, as does every other exception type (an `IOException` of the file write, for example, ends the whole export instead of one item: `export-run.md`). So a `CItemException` from EXP-010 to EXP-053 reaches the orchestration as it is, and one `XmlException` or `NullReferenceException` from them reaches it as the wrapped form. The .NET message texts are reproduced for the cases the port can raise; the probe records those it has seen (EXP-004, `Q.configIdAndUniqueKey`, `F.getCurrentIdOfVersion`).

[12.0] Same as 14.0.7.

### EXP-055: Stack text is not reproduced (deviation)

[14.0.7] Where the engine puts an exception's stack text in `faultstring` (EXP-011, EXP-044, EXP-052, EXP-053 and EXP-054), the text is a list of .NET frames, including framework internals, which differs between .NET Framework builds and cannot be reproduced. The port writes the exception's type name, a colon, a space and its message instead, with no frames. A log or message that quotes such a `faultstring` therefore differs from the engine's on that one field; it is compared with that field masked. Registered in `bugs.md` as a deviation, with the others the grill listed.

[12.0] Same as 14.0.7.
