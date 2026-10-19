# Language-resource export (14.35)

Engine 14.35 has two export modes that 14.0.7 and 12.0 lack. They export the translations of ml_string properties (a `label` in many languages) instead of, or together with, the item's other content. This document specifies the two modes: how the language list is resolved against the server, the requests that ask for translated values, and the steps that reshape the answer into an item file. The rules are `LP-100` to `LP-199`. Language-pack import is `LP-001` to `LP-099` (`language-pack.md`); the import side of the language list (the package scan, `import --languages`) is the import area's.

| Mode (`ImportExport` value) | Reference-host option | Item file holds |
|---|---|---|
| `ExportLanguageResourcesOnly` | `export-only-translations` | only the language elements of each item, plus the ancestors and `source_id` that locate them |
| `ExportMetadataWithLanguageResources` | `export-with-translations` | the whole item as a plain export writes it, with the translations of the selected languages next to the default one |

Sources:

- the 14.35 decompile of `Libs.dll` (`.decomp/14.35/`, never committed): `ImportExportManager` (constructor, `ThrowIfNoSelectedLanguagesInDatabase`), `CExportItems` (`Export`, `GetRelationshipsRequestByLevel`, `GetRelationshipRequestByExistingDocument`, `GetMultilangualPropertyNamesForItemType`, `GetAdditionalSelectString`, `ProcessRelationshipType` and the four language steps), `CItemHelper.GetLanguagesFromInnovator`, and Aras's `ConsoleUpgrade.exe` 14.35 (the only 14.35 host with the two options; decompiled locally, never committed);
- `oracle/language-export-probe/` (offline, no server, no password): the real 14.35 `Libs.dll` and IOM 15 driven through reflection and against a scripted connection, recorded in `fixtures/export-language/probe-14.35.txt`. Its sections are `C` (the constructor), `R` (the requests of `Export`), `MK`, `RM`, `ORD` and `ADD` (the four language steps on in-memory documents), `E` (one item through the whole of `Export` and the real `export.xsl`) and `X` (a whole `ExportSolutions` run). Rule text cites a case by its label (`C12`, `R04`). The scripted connection answers what a script says, so the probe shows what the engine does with an answer, not what the server answers;
- read-only requests to the dev instance (profile `dev`, 12 SP9), recorded in `fixtures/export-language/server-reactions.json` (LP-127).

**What the probes do not reach, and what ticket 57 recorded.** The dev instance has one language, `en`, so the read-only requests of the first evidence show nothing of how the real server writes a translated value. The rules about the answer's shape rested on the engine's own steps, which look for exactly that, and on how the language-pack preprocessor writes the same elements (LP-024), and they said *inferred*. Wayfinder ticket 57 then recorded runs of the engine on dev with the languages `en`, `de` and `fr` added for the recording and deleted again (`fixtures/14.35/export/lang-*`, `l3-*`, `l1-*`; each case's README lists the scratch state it seeded): the real server answers a select that names `title_de` with `<title xml:lang="en">…</title>` for the default language and `<i18n:title xml:lang="de">…</i18n:title>` for the other, declares `xmlns:i18n` once on the envelope, and leaves out a language that was not selected. Those runs are replayed through `ExportSolutions` byte for byte (`src/export/run-replay-1435.test.ts`). The *inferred* marks below stay where the recordings do not settle the point (the code of the empty-answer fault, for one).

**Engines.** `[12.0]` and `[14.0.7]` have neither mode. Their `ImportExport` enum ends at `LPImport` and their `SolutionUpgradeContext` has no `Languages` (EXP-501), so nothing in this document exists there. `LP-100` says so for the older builds; every other rule has a `[14.35]` variant only.

## Conventions used by every rule here

- **Mode** is the context's `Action`. "A language mode" is either of the two values; "Only" and "Metadata" name them in the rules below. The engine tests the value by equality in each place, never as a group, which is why some steps apply to one mode and not the other.
- **A language** is a code such as `de`. `en` is the default language: the server returns its values as the property's own value.
- **ml names of a type** is the result of LP-120: the names of the type's ml_string properties, in server order.
- **Suffixed names** are LP-121's `label_de`, `label_fr`.
- **XML text** is written as IMP-010 and EXP-423 describe; the examples drop the indentation the file writer adds.
- **Requests** are shown as IOM puts them on the wire (`isNew="1" isTemp="1"` first, EXP-061), with the attribute order the engine produces.
- **Interpolated values** are reproduced exactly (`AGENTS.md` rule 7): none of the requests here interpolates text, they are built through the DOM.

## The modes and their host

### LP-100: The two export modes exist only in 14.35

[12.0] No such modes. `ImportExport` has `Import` and `Export` only.

[14.0.7] No such modes. `ImportExport` ends at `LPImport`.

[14.35] `ImportExport` has `ExportLanguageResourcesOnly` and `ExportMetadataWithLanguageResources`. Both are export actions: the host runs the same `ExportSolutions` for them as for `Export` (EXP-500), with the same `SUExportContext` and the same table of packages to items. What they change is done inside the engine, in four places:

1. the constructor resolves the language list (LP-110 to LP-115);
2. the main fetch of every type asks for translated values (LP-120 to LP-126);
3. four steps of `CExportItems.Export` reshape the answer (LP-140 to LP-145);
4. the log header shows the action's name in its `Action:` line (EXP-506).

Nothing else in `ExportSolutions` looks at the action: the package loop, the parallel item loop (EXP-551), the first-failure stop (EXP-555), the manifest (EXP-511) and the file layout (EXP-414 to EXP-419) are those of a plain export. The enum values are the integers 3 (Only) and 4 (Metadata); the value 5 is `ImportDPPatch` (the DB patch area).

### LP-101: What the reference host does with the language options

[14.35] `ConsoleUpgrade.exe` selects a mode by a bare argument: `export-only-translations` for Only and `export-with-translations` for Metadata, compared in upper case with the invariant culture. They replace `import` and `lpimport` in the same position; the last of them wins, and with none the action is `Export`. The languages come from `langs=<list>`:

- the list is the text after `=` split on `,` with empty entries dropped, then `Distinct()` (ordinal, case-sensitive, first occurrence kept). The quotes around a value are removed first (`RemoveQuotes`). Nothing is trimmed, so `langs=en, de` has the entry ` de`;
- with no `langs`, the context's `Languages` is the empty array, not null;
- for either language mode an empty list ends the run before it starts: the host prints `\nParam error : 'langs' list can't be empty` (the quotes are part of the text) and returns 1;
- for any action, a non-empty list whose first entry is not `*` must contain `en`, compared with `OrdinalIgnoreCase`; otherwise the host prints `'en' language is required for 'langs' list` and returns 1. A list starting with `*` is never checked, so `langs=*,de` passes;
- `dir`, `log`, `level`, `timeout` and the other export options mean what they mean for `export`. `release` is not required, and `collect-errors` is refused for these modes (`should be used for 'import' or 'lpimport' only`).

The host passes the list to the engine unchanged, as the context's `Languages`. It then builds the manager, which resolves the list (LP-110). This rule is the contract for the CLI; the engine does not look at the host's checks, so a library caller can reach every state that the host forbids (a null list, a list without `en`, an empty list).

## The language list

### LP-110: The constructor rewrites the context's list in place

[14.35] `ImportExportManager(context, messagesFactory, itemHelper)` does the language work after the checks and the manifest handling of EXP-502, in this order:

1. `languageMode` is true when `context.Action` is `ExportLanguageResourcesOnly` or `ExportMetadataWithLanguageResources`.
2. When `context.Languages` is not null, has exactly one entry and that entry is the text `*` (ordinal), and `languageMode` is true, the list becomes the codes of the server's languages (LP-111). For an import with the same list the used languages of the packages are taken instead (import area). For every other action nothing happens: `*` stays.
3. When `languageMode` is true, the list becomes the entries other than `en` (LP-112). A null list throws here (LP-113).
4. The context and the message factory are kept.
5. The installed-language check runs on the list (LP-114).

The list is assigned to the **same context object** the caller passed in (the property `Languages` is set), not to a copy, so a caller that reads the context afterwards sees the resolved list, and a constructor that throws leaves the list as it stood when it threw (probes `C09` to `C17`: `["EN","de"]` stays `["EN","de"]` after the check failed; `["en","DE"]` becomes `["DE"]`). The same list object is read by every worker of the run and never changed after the constructor.

With the actions `Export` and `LPImport` and a non-null list, only step 5 happens (`C19`, `C20`, `C22`). An import adds its own steps (the package scan before step 2, the used-languages expansion in step 2), which the import area specifies.

### LP-111: `*` is replaced by the codes the server has

[14.35] In a language mode, a list that is exactly `["*"]` is replaced by the codes of `GetLanguagesFromInnovator()` (LP-115), in the server's answer order, lower-cased, `en` included (it is removed by LP-112 right after). Probes: a server with `en`, `de`, `fr` gives `["de","fr"]` (`C03`, `C04`); a server with only `en` gives `[]` (`C05`); an answer in upper case or mixed case (`DE`, `EN`, `Fr`) gives `["de","fr"]` (`C06`); an answer that is a fault, of any code, or has no Language items gives `[]` and the constructor succeeds (`C07`, `C08`).

Only the exact one-entry list is expanded. `["*","de"]` and `["*","*"]` are left as they are; the check then reports `*` as not installed (`C16`, `C17`). A `*` in any other position is an ordinary code.

A list of `*` with an action other than the two modes is never expanded by this step; with `Export` it reaches the check, which rejects `*` (`C21`).

### LP-112: `en` is removed by exact comparison, and nothing else is normalised

[14.35] In a language mode the list becomes the entries that are not equal to `en`, by an ordinal, case-sensitive comparison. `["en","de"]` becomes `["de"]` and `["en"]` becomes `[]` (`C01`, `C18`). `EN` is not removed (`C13`), a code with a space is kept with the space (`C28`, ` de`), and so is the empty string (`C29`). Duplicates are kept in their order (`["en","xx","de","yy","xx"]` becomes `["xx","de","yy","xx"]`, `C14`). The order of the remaining entries is the caller's. Nothing is lower-cased, trimmed or de-duplicated by the engine; the host's `Distinct()` (LP-101) is the only de-duplication.

An empty list stays empty (`C11`), and an empty list sends no request at all.

### LP-113: A null list in a language mode throws ArgumentNullException

[14.35] In a language mode a null `Languages` fails in step 3 of LP-110 with `System.ArgumentNullException`, message `Value cannot be null.` followed by CRLF and `Parameter name: source` (`C09`; LINQ's `Where`). It is not a `CItemException` and no request has been sent. With `Export` a null list is accepted and does nothing (`C10`). The reference host never passes null (LP-101).

### LP-114: The check that every selected language is installed

[14.35] `ThrowIfNoSelectedLanguagesInDatabase(list)` runs at the end of every manager constructor, for every action. It does nothing when the list is null or empty. Otherwise it calls `GetLanguagesFromInnovator()` (LP-115) and takes the set difference of the list and the codes: the entries of the list that are not among the server's codes, each once, in the order of the list, compared as ordinal strings. When any remain it throws `CItemException(0, "", text, null)`, with the text

```text
Some of the selected languages are not installed for current Aras Innovator: {missing}.<CR><LF>Please, install missing languages or remove them from import package before proceeding.
```

where `{missing}` is the missing codes joined by `,` (no space), and the line break is the CRLF of `Environment.NewLine` on Windows, which the port emits on every platform. The sentence says "import package" in the export modes too. Probes: one missing (`C15`), several (`C14`: `xx,yy`, the second `xx` dropped), order kept (`C27`: `b,a,c`), `Export` with `fr` (`C20`), `LPImport` with `fr` (`C22`), the server answering a fault or nothing for the Language get (`C25`, `C26`: every selected language is missing).

Because the engine's `en` removal and this comparison are exact (LP-112) while the server's codes are lower-cased (LP-115), an upper-case selection is never found (LP-180). The list is checked as the constructor left it, so in a language mode `en` is already gone and never needs to be installed; with `Export` an `en` in the list is checked like any other code (`C19`).

The check sends one Language request when the list is not empty and every entry is installed, in addition to the one of LP-111 when the list was `*`: `["*"]` costs two requests (`C03`), an explicit list one (`C01`), and an empty list none (`C18`). When an entry is missing it sends **two** (LP-187): the set difference is lazy and is enumerated once by `Any()` and once more by `string.Join`, and each enumeration asks the server again. So `["en", "DE"]` costs two requests and fails (`C12`; `C14`, `C25`, `C26`, `C28` likewise, and the recorded `l1-only-not-installed` made 8 calls: 6 for the login and 2 for the check). The names in the message are those of the second answer.

The exception leaves the constructor as thrown. The host reports it as the error of the run; no package is touched.

### LP-115: The server's languages come from one Language get

[14.35] `GetLanguagesFromInnovator()` is an iterator method. Each time it is enumerated it sends

```text
<Item isNew="1" isTemp="1" type="Language" action="get" select="code,name" />
```

through `Item.apply()`. When the answer is not an error and has at least one item, it yields, for each item in answer order, a `LanguageInfo` with `Code` = the `code` property lower-cased with `ToLowerInvariant()` and `Name` = the `name` property. An answer that is a fault of any code, or empty, yields nothing. `name` is not read by the language modes.

It is lazy: nothing is sent until the first element is requested, and every enumeration sends a new request (so LP-111 and LP-114 each send their own). The request is LP-014's with `select="code,name"` where the language pack asks for `code,suffix`. The count is IOM's, as LP-014 describes it: the number of items of a successful answer, 0 for the "no items" fault and for any other fault alike, which is why a failed get is taken as "no languages" here as there.

Two limits. The engine reads `code`, not the `suffix` of a Language item. A server whose Language has a suffix that differs from its code gets `label_<code>` in the select (LP-121), which the server does not know (LP-127 shows an unknown select name is dropped without a fault). That is the engine's behaviour and is reproduced. And a Language item with no `code` yields a null code, whose lower-casing throws (LP-181).

## The requests

### LP-120: The ml_string lookup finds a type's translatable properties

[14.35] `GetMultilangualPropertyNamesForItemType(typeName, languages)` first asks the server for the type's ml_string properties:

```text
<Item isNew="1" isTemp="1" type="ItemType" action="get" select="id"><name>{T}</name><Relationships><Item isNew="1" isTemp="1" type="Property" action="get" select="name"><data_type>ml_string</data_type></Item></Relationships></Item>
```

It is sent with `Item.apply()` and is never cached: it is not in `_requestedItems` (EXP-030) and the per-type template cache (EXP-060) only keeps the finished tree, so the same type is asked again every time the tree walk needs its names (LP-126). The answer is read as follows:

- when `Relationships/Item` has at least one item, the names are the `name` property of each, in answer order (`R01`: `label,description`);
- when it has none and the answer is an error whose code is 0 (the server's "No items of type ItemType found", which is what a type without ml_string properties gets: the lookup is a join, LP-127; the code 0 is IOM's convention for an empty answer, *inferred* for the real server), the list is empty and nothing more is asked (`R12`);
- when it has none and the answer is anything else, an error of another code or a success with no Relationships, the engine reads `name` from an empty set of items, which throws (LP-182).

The result is the names followed by the suffixed names (LP-121). `languages` is read only to build the suffixed names, so a null `languages` throws a `NullReferenceException` only for a type that has ml names (`R10`, `R11`, `R35`; a type without any is fine, `R34`).

### LP-121: Each name gets one suffixed name per language other than `en`

[14.35] For each ml name `n`, in order, and for each language `L` in the list, in order, with `L` not equal to `en` (ordinal, so `EN` is kept): the suffixed name `n_L`. The list returned is all the names, then all the suffixed names, grouped by name: for `label,description` and languages `de,fr` it is `label,description,label_de,label_fr,description_de,description_fr` (`R01`). An `en` in the list adds nothing (`R09`: `de,EN` gives `label_de,label_EN`). With no languages the list is the names alone (`R08`).

The suffix is the code as the list has it. It is not the `suffix` of the Language item (LP-115).

### LP-122: The select of a tree node in ExportLanguageResourcesOnly

[14.35] `GetRelationshipsRequestByLevel(T, level, current, action, languages)` is EXP-061's walk. In `ExportLanguageResourcesOnly` it adds selects. Let `names(X)` be the list of LP-120 for type `X`, and let the *extra* of a type be `,name,is_versionable` for `ItemType` and nothing for any other. In the order of EXP-061 the walk for `T` does:

1. the related-type lookup of EXP-061 step 2 (and, when it names a type `D`, `D`'s whole subtree first);
2. the node's select, from `names(T)` (this sends the LP-120 request for `T`): when the list is not empty, `{names joined by ,},config_id,relationship_id,related_id{extra of T}`; when it is empty, `id,config_id,relationship_id,related_id`;
3. the relationship lookup of EXP-061 step 3, and for each row `R` in answer order, a request item for `R` whose select is, from `names(R)` (this sends LP-120 for `R`):
   - `R` is `Property`: when the list is not empty, `{names},*[is_not_null()]`; when it is empty, **no select attribute at all**;
   - any other `R`: when the list is not empty, `{names},related_id{extra of R}`; when it is empty, `id,config_id,relationship_id,related_id`;
4. when `current` is still below the depth, the row is replaced by the subtree of `R` (EXP-061), whose own root select is rule 2 applied to `R` (so `{names},config_id,relationship_id,related_id`, not step 3's `{names},related_id`); otherwise the row is the request item of step 3.

So the root of every subtree, the first node included, carries step 2's select, and a row that is not expanded carries step 3's. Probes `R01` (depth 1: `TA` has `label,description,label_de,label_fr,description_de,description_fr,config_id,relationship_id,related_id`, its relationship `R1` has `title,title_de,title_fr,related_id`, `R2` has `id,config_id,relationship_id,related_id`) and `R02` (depth 2: `R1` becomes a subtree whose root select ends `config_id,relationship_id,related_id`, with its related type `TB` below it); `R18` to `R20` for `Property` and `ItemType` rows (`label,help_tooltip,label_de,label_fr,help_tooltip_de,help_tooltip_fr,*[is_not_null()]` and `label,label_de,label_fr,related_id,name,is_versionable`); `R23` for the `List`/`Value` row.

A depth of 0 (`Item Report`, or a level of 0 or below) returns the bare item before any of this, so the main fetch has no select attribute (`R05`).

### LP-123: The select of a tree node in ExportMetadataWithLanguageResources

[14.35] The same walk, with these selects:

1. the node: when `names(T)` is not empty, `{names},*[is_not_null()]`; when empty, `*[is_not_null()]`;
2. each row `R` (a `Property` row too): when `names(R)` is not empty, `{names},*[is_not_null()]`; when empty, **no select attribute**;
3. a row that is replaced by a subtree has that subtree's rule 1.

So a relationship at the depth limit without ml names has no select and the server's defaults apply, while the same relationship one level higher has `*[is_not_null()]` (`R03`, `R04`, `R19`, `R24`: `names,*[is_not_null()]`).

### LP-124: Which requests get a tree, a select or the default select

[14.35] The rows of EXP-021 are unchanged: the same types get the same depth, `Item Report` the bare item with `related_expand="0"`. The language modes add to them as follows.

- **The default row** (every type not named in EXP-021's table) takes the tree of LP-122/LP-123 at the requested level, then EXP-023's default select is added when the action is **not** `ExportLanguageResourcesOnly`. In Only the main fetch carries no `xp-*` and no `*[is_not_null()]` beyond LP-122's. In Metadata it is joined to the node's select: `label,label_de,*[is_not_null()],xp-*($value, @explicit, @permission_id), *[is_not_null()]` (`R03`; the select thus lists `*[is_not_null()]` twice). With level 0 in Metadata the node has no select, so EXP-065's comma appears: `,xp-*($value, @explicit, @permission_id), *[is_not_null()]` (`R06`); in Only level 0 has no select at all (`R05`).
- **The named rows** (`List`, `Permission`, `Grid`, `Form`, `Life Cycle Map`, … ) take the tree and its selects but not the default select, as in a plain export (`R23`, `R24`).
- **`Item Report`** is the bare item, with no select, in both modes (`R21`, `R22`).
- With the action `Export` the language list is ignored by the requests (`R07`).

A level that is blank is 1 and a level that does not parse fails the template as in EXP-022 and EXP-062.

### LP-125: The bodies built from a document get a select per node

[14.35] The `ItemType`, `cmf_ContentType` and `cmf_TabularView` requests start from a body document (EXP-024, EXP-025), and `ProcessRelationshipType` builds the same ItemType body for the related ItemType of a relationship type (EXP-049). `GetRelationshipRequestByExistingDocument(item, action, languages)` visits **every** `Item` element of the document in document order, nested ones and `related_id` ones included, and sets its `select` from the element's `type` attribute, sending an LP-120 request for each visit:

- Only, `type="Property"`: when `names(Property)` is not empty, `{names},*[is_not_null()]`; otherwise the element keeps the select it had;
- Only, any other type: when `names` is not empty, `{names},config_id,relationship_id,related_id{extra}`; otherwise `id,config_id,relationship_id,related_id`, replacing whatever select the element had;
- Metadata, any type: when `names` is not empty, `{names},*[is_not_null()]`; otherwise the element is left as it was.

The root of the ItemType body, `ItemType` itself, takes the form for "any other type" with the extra `,name,is_versionable`. The body of `ItemType` has 31 elements, so the walk sends 31 lookups before the `is_versionable` lookup and the main fetch (`R25`, `R26`). With ml names `label,label_plural` for `ItemType` and `label,help_tooltip,default_value` for `Property`, languages `de,fr`, the Only main fetch is

```text
<Item isNew="1" isTemp="1" type="ItemType" action="get" select="label,label_plural,label_de,label_fr,label_plural_de,label_plural_fr,config_id,relationship_id,related_id,name,is_versionable"><Relationships><Item type="DiscussionTemplate" action="get" select="id,config_id,relationship_id,related_id">…</Item>…<Item type="Property" action="get" select="label,help_tooltip,default_value,label_de,label_fr,help_tooltip_de,help_tooltip_fr,default_value_de,default_value_fr,*[is_not_null()]"><Relationships><Item type="Grid Event" action="get" select="id,config_id,relationship_id,related_id" /></Relationships></Item>…</Relationships><id>…</id></Item>
```

(the full text is in `R25`). The `cmf_ContentType` and `cmf_TabularView` bodies go through the same function (`R28`). In Metadata the root select is `label,label_plural,label_de,label_fr,label_plural_de,label_plural_fr,*[is_not_null()]`, every element without ml names keeps the select it had (none, in the plain body, except where EXP-024 sets one), and `Property` has `…,*[is_not_null()]` (`R26`). With `Export` the body is the plain one (`R27`).

`ProcessRelationshipType` (EXP-049) calls the same function with the language mode on the ItemType body it builds for `relationship_id`, so a `RelationshipType` item in a language export asks for the translated values of that nested ItemType too. The related ItemType is requested after the RelationshipType's own main fetch.

### LP-126: The requests are many, repeated and in a fixed order

[14.35] The per-type template is built once per type per call (EXP-060), but the LP-120 lookups are not cached, so a type's names are asked once for every visit of the walk:

- a relationship type is asked at step 3 of LP-122 for its row, and again at its own subtree root when the walk recurses into it (`R02`: the lookup for `R1` is request 4, as a row of `TA`, and request 10, as the root of its subtree);
- a row that is replaced by a subtree (LP-122 step 4) has had its select built and thrown away: only the lookup it caused remains;
- the order is the order of the statements: related-type lookup (with the related type's subtree), `names(T)`, the RelationshipType lookup, then per row `names(R)` followed by the row's subtree (`R02`, requests 1 to 15, then `is_versionable`, then the main fetch).

A depth-3 tree of the small fictional schema sends 18 lookups before the main fetch (`R31`). On a real schema the count grows with the number of relationship types at each level; this cost is the engine's and is reproduced exactly, since the requests are observable by a server. The lookups of a type run inside its `Lazy` factory (EXP-060), so they are sent once per call by whichever worker reaches the type first.

### LP-127: What the dev server answers to these shapes

[14.35] `server-reactions.json` records read-only requests to the dev instance (12 SP9) on 2026-10-19. They settle what the lookups see; they do not show a translated value, because dev has one language.

- **Languages.** The `Language` get (`select="code,name"`) answers one item: `en`, `English`.
- **The ml lookup.** A type with no ml_string property answers no items (`List`, `Form`: count 0; IOM reports an empty answer as the fault with code 0, *inferred*), so the lookup is a join over the Property rows. A type with some answers the type with only those rows: `Property` has `default_value`, `help_tooltip`, `label`; `ItemType` has `help_url`, `label`, `label_plural`; `Value` has `label`. 63 of the ItemTypes have at least one. The order is the server's (the three examples are in name order).
- **An unknown select name is dropped.** `select="label,label_de,name,*[is_not_null()]"` on `Property` and `select="label,label_de,name,is_versionable"` on `ItemType` are accepted: the answer lacks the `label_de` field and there is no fault. So a `_<code>` name for a language the database does not have, or for a code that is not a suffix, costs nothing and returns nothing.
- **Not shown by these requests, and recorded since.** Whether the answer to a get that selects `label_de` carries the German value as `<i18n:label xml:lang="de">` and writes `xml:lang="en"` on the default value: ticket 57's recordings show both (`lang-only-de-instances`: `<summary xml:lang="en">…</summary><i18n:summary xml:lang="de">…</i18n:summary>`, with the prefix declared on the envelope). Which language suffix the server uses for a code that is not its suffix is still not recorded.

## The steps after the transform

### LP-140: Where the four steps sit in Export

[14.35] For one item `Export` runs the steps of EXP-400 and the rewrites of EXP-100 to EXP-199 as for a plain export, with the language steps placed as follows (the steps of EXP-400 are numbered 1 to 7 there):

1. `RemoveSeparatelyExportedRelationships` (EXP-170) before the pre-XSL rewrites, in every mode;
2. `MarkPropertiesWithTranslationsIfNeeded` (LP-141), after the pre-XSL rewrites and before `ApplyXsl`;
3. `ApplyXsl(doc, "export.xsl")` (EXP-401);
4. **Only:** `RemoveNotLocalizedProperties` (LP-142). When it returns nothing (no item has a language element) `Export` **returns at once**: no further step runs, no folder is created and no file is written, and no exception is raised;
5. EXP-400 steps 2 to 5 (default permission, `filter_xml`, poly-lists, unknown packages), then `RemoveNamespaceNodes` (EXP-410) and `RemoveEmptyRelationships`;
6. `OrderPropertiesWithTranslations` (LP-143), then `AddI18NNamespaceToAllRootItems` (LP-144), both in either language mode;
7. the folder and the file (EXP-417 to EXP-428).

With the actions `Export`, `Import` and `LPImport` the four steps return at once. The probes call each step alone (`MK`, `RM`, `ORD`, `ADD`) and in the whole sequence (`E01` to `E10`).

### LP-141: Properties with a non-default translation are flagged

[14.35] `MarkPropertiesWithTranslationsIfNeeded(doc, action)` returns at once unless the action is `ExportLanguageResourcesOnly` (`MK10`, `MK11`: Metadata and Export leave the document alone). Otherwise, for every element `//Item[@type='Property']` of the document (the type compared exactly, `property` is not matched, `MK18`; at any depth, so also the Properties inside an ItemType's `Relationships`, `MK07`), it looks at the direct children that have an `xml:lang` attribute. If one of them satisfies **both** of these, the Property gets the attribute `export_has_translations="1"`:

- the attribute's value, upper-cased with the invariant culture, is not `EN` (so `en`, `EN` and `En` do not count, `MK04`; `de`, `de-DE` and the empty value do, `MK01`, `MK17`, `MK05`);
- the child's `InnerText` is not empty (`<label xml:lang="de"></label>` and `<label xml:lang="fr" />` do not count, `MK03`; a space does, `MK13`; a child that holds only an empty element does not, `MK15`; one that holds text in a nested element does, `MK14`).

The attribute is appended after the attributes the element has (`MK01`). If the element already has an `export_has_translations`, the new attribute replaces it, whatever its value: `"0"` becomes `"1"` (`MK08`). If the flag is not set, an existing value stays (`MK09`). Only direct children are looked at (`MK12`: a language element one level down does not flag), and `xml:lang` on the Property itself is not a child (`MK16`).

The flag has one use: export.xsl treats a flagged Property as a modified system property (EXP-381).

### LP-142: RemoveNotLocalizedProperties keeps only the language elements and what locates them

[14.35] The step runs on the output of the XSL, an `AML` document. It reloads the document through LINQ to XML (`XDocument.Parse(OuterXml)`, which drops whitespace-only text) and does the following; the reload at the end puts the result back into the same `XmlDocument` (`xmlDoc.LoadXml`).

An *Item with a language element* is an element named `Item` (no namespace), at any depth, with at least one **direct** child element that has a non-empty `xml:lang` attribute (the `en` ones count; the attribute on the Item itself does not, `RM08`; an empty value does not, `RM07`). For each such Item the **kept set** is: the Item and all its ancestors, and its direct children that have a non-empty `xml:lang` or are named exactly `source_id` (a child in a namespace is named `{uri}local` and never matches `source_id`, but one with `xml:lang` is kept whatever its name, `RM23`).

Every element of the document that is not in the union of the kept sets is removed. That has these consequences, all probed:

- an Item with no language element, and everything inside it, is removed unless it is the ancestor of one that has (`RM03`: the `Value` without a label disappears; `RM11`; `RM24`: an unrelated Item beside the kept one, inside a wrapper, is removed and the wrapper stays);
- non-language children of a kept Item are removed: `name`, `description`, `related_id`, `Relationships` (`RM01`, `RM04`; `RM10`: the `Relationships` of a kept Item goes when nothing below it is kept; `RM09`: a `related_id` is kept when it is the ancestor of a kept Item);
- `source_id` stays only in an Item with a language element (`RM04`, and `RM05`: with none, nothing is kept);
- **elements inside a kept element are removed, their text stays** (`RM06`: `<label xml:lang="de"><b>x</b>t<c/></label>` becomes `<label xml:lang="de">t</label>`), because only descendants that are elements are tested;
- text, CDATA and comments are never removed: `<![CDATA[…]]>` stays (`RM13`), a comment stays (`RM12`), and so do the attributes of every kept element, including namespace declarations (`RM14`);
- text with markup characters, tabs, line breaks and non-ASCII characters survives the reload (`RM12`, `RM15`, `RM21`), and the file writer then serialises it as EXP-424 says.

When no Item has a language element, every element is removed, the serialisation is the empty string and the step **returns null** without touching the document (`RM02`, `RM05`, `RM07`, `RM08`, `RM20`). `Export` then ends (LP-140 step 4). Otherwise it returns the same document object (`RM01`).

The step does not look at the action itself. `Export` calls it only for Only; Metadata keeps everything.

### LP-143: i18n elements are moved behind their default-language sibling

[14.35] `OrderPropertiesWithTranslations(doc, action)` returns at once unless the action is one of the two language modes (`ORD14`). Otherwise it takes the list `L` of every node of the document `//node()[@xml:lang]` in document order. For each node `i` of `L` that has a non-empty namespace **prefix**, it looks for the first node `j` of `L`, in list order, with the same local name, the same parent object and an **empty prefix**. When it finds one, it inserts a clone of `i` immediately after `j` and removes `i`. When it finds none, `i` stays.

Consequences (probes `ORD01` to `ORD20`):

- an `i18n:label` that follows or precedes its `label xml:lang="en"` ends directly after it (`ORD01`, `ORD03`); one with no unprefixed `label` that has an `xml:lang` stays (`ORD05`, `ORD09`, `ORD10`); the name is compared case-sensitively (`ORD15`) and any prefix counts (`foo:label` too, `ORD11`);
- elements in between are passed over: `en, name, de` becomes `en, de, name` (`ORD06`); a comment or text between is not touched (`ORD17`);
- the match is by parent: a language element one level down does not attract one above it (`ORD16`), and each Item is handled apart (`ORD12`);
- with two unprefixed siblings of the name the first wins (`ORD08`);
- **several i18n siblings come out in reverse order** (LP-183): each is inserted directly after the same `j`, so the last one handled sits nearest to it. `en, de, fr` becomes `en, fr, de` (`ORD02`); `de, fr, en` becomes `en, fr, de` (`ORD04`); four languages `de, fr, it, en` become `en, it, fr, de` (`ORD18`).

### LP-144: Every top-level Item gets xmlns:i18n, last in its attributes

[14.35] `AddI18NNamespaceToAllRootItems(doc, action)` returns at once unless the action is a language mode (`ADD06`). For every node `//AML/Item` (an `Item` that is a child of an `AML` element at any depth; `ADD08` shows an `AML` below another root also counts, `ADD07` and `ADD09` show that an Item that is not a direct child of an `AML` does not) it creates the attribute `xmlns:i18n` with the value `http://www.aras.com/I18N` and appends it to the element's attributes. An existing `xmlns:i18n`, whatever its value, is replaced by the new attribute and so moves to the end (`ADD02` to `ADD04`: `id="1" xmlns:i18n="…" action="add"` becomes `id="1" action="add" xmlns:i18n="…"`; `urn:other` becomes the Aras URL).

Since EXP-410 already keeps `xmlns:i18n` on the root Items, this step changes only its position, and adds it to the Items that the transform created without one (the `edit` and `delete` Items it writes of its own, `E08`, `E09`). Nested Items are not touched (`ADD05`).

### LP-145: What the rest of the pipeline does with a language export

[14.35] The steps of LP-141 to LP-144 sit among the unchanged ones, so these follow from the other areas; the probes `E01` to `E10` show them together.

- **Only** (`E01`): `export.xsl` runs on the whole answer (so the `is_null` drop, EXP-390, and the system-property edits, EXP-381, apply), then LP-142 removes everything but the language elements. An item that is `List` with `label` in three languages is written as its `label` (`en`) and the `i18n:label` of the others, reversed (LP-143), with nothing else, and its `Relationships` hold only the relationship items that have language elements. The rest of EXP-400 runs on what is left. A fetched item that has no language element at all writes no file (`E04`). An item with only an `en` value is written with that value (`E05`): the default language counts as a language element.
- **Metadata** (`E02`, compare `E03`): the item is written as a plain export would write it, with the i18n elements moved behind their default-language sibling (LP-143), so the same `List` differs from `E03` only in the order of its language elements (`E03` keeps the server's order `de, fr`; `E02` has `fr, de`).
- **A system Property that carries a translation** (`E08`): in Only a stock system Property of an ItemType that has language elements is written in the ItemType `edit` item, as `<Item type="Property" action="edit" where="source_id='' and name='behavior'">` holding its language elements. In the probe the `behavior` row's `label` also deviates from the stock row, so the row is selected by its content as well; the flag alone selects it in EXP-381's `AXF2`. The `edit` Item has `xmlns:i18n` (LP-144). The `View` and `Form` `delete` Items that a plain ItemType export adds (EXP-330) are gone in Only (`E08`) and present in Metadata with their `xmlns:i18n` (`E09`, compare `E10`).

An item file in either mode starts with the UTF-8 BOM and has the layout of EXP-423 to EXP-427.

## The run

### LP-150: ExportSolutions in a language mode

[14.35] A run in a language mode is a plain export run (EXP-500 to EXP-520, EXP-550 to EXP-558) with the constructor of LP-110, the requests of LP-120 to LP-126 and the steps of LP-140 to LP-145. The log's header block is the one of EXP-506, with `Action: ExportLanguageResourcesOnly` or `Action: ExportMetadataWithLanguageResources` (`X01`, `X02`). Probes: `X01` and `X02` (one package, three items, one of them with nothing to keep), `X03` (`*` expanded to `de,fr`), `X04` (a language that is not installed: the constructor throws, nothing else runs), `X05` (`["en"]` becomes `[]`, so the requests would carry no suffixed names), `X06` (the ml lookup of `List` fails: LP-182), `X07` (two packages).

The first failure still stops the whole export (EXP-555). A failure of the ml lookup is one (LP-182): `X06` logs the error (once per item that fails before the stop, a number that varies between runs, EXP-555) and writes no item file. The recorded runs of 14.35 also show the `is_versionable` lookup of the items' type sent once by each worker that starts together (`lang-only-de-instances`: 3 requests for 3 items; `lang-only-en-de-instances`: 1), a race of the parallel loop like those of EXP-573; the port runs the items one after the other and asks once.

### LP-151: An item that writes no file is logged as exported

[14.35] In Only, an item whose answer has no language element makes `Export` return normally (LP-140 step 4). The caller cannot tell it from a written item: the success line `Item id :{id}  keyed_name : {name}   type : {type} successfully exported` is logged and the status message `Item i of n: {type} - {name}` sent (EXP-515, `X01`: `A02` is logged and has no file, `A01` and `A03` have). No type folder is made for it. Registered in `bugs.md`.

## Reproduced bugs

### LP-180: The installed-language check is case-sensitive, the server's codes are lower-cased

[14.35] `GetLanguagesFromInnovator` lower-cases the codes it yields (LP-115) and `Except` compares ordinally, and nothing lower-cases the selection. So a selected `DE`, `De` or `Zh-CN` is reported as not installed even when the server has `de` (`C12`: `["en","DE"]` throws with `DE`; `C13`: `EN` is neither removed (LP-112) nor found). A selection with a space, `en, de`, has the entry ` de` which is not found either (`C28`). The host's own `en` check ignores case (LP-101), so `langs=EN,de` passes the host and fails here (LP-185). Registered in `bugs.md`.

### LP-181: A Language item without a code throws an unwrapped NullReferenceException

[14.35] Lower-casing the `code` of a Language item that has none (IOM returns null) throws `System.NullReferenceException` (`C23`, `C24`). It is thrown while the list is being enumerated, from the constructor of the manager (for `*` in LP-111, otherwise in LP-114), and is neither a `CItemException` nor wrapped. Registered in `bugs.md`.

### LP-182: A failed ml lookup throws "Not a single item" and is remembered for the run

[14.35] When the LP-120 lookup answers anything that is neither "a Property row exists" nor "no items" (a fault with another code, a transport failure turned into a fault, or an ItemType answer without `Relationships`), the engine tries to read the `name` of an empty set and IOM throws `System.Exception` with the message `Not a single item` (`R14`, `R15`, `R17`). The exception is not an `XmlException`, a `NullReferenceException` or an `XPathException`, so `Export` does not wrap it (EXP-054). It comes from the template factory, which runs under `Lazy` with the default thread-safety mode, so every later item of the same type in the call gets the same exception without sending a request (`R33`: the first item sends two requests, the second none). The type's tree is therefore lost for the rest of the run. In `X06`, with three items, the error is logged and no file is written. Registered in `bugs.md`.

### LP-183: The i18n elements of one property come out in reverse order

[14.35] LP-143 inserts each prefixed sibling directly after the same default-language element, so they end in reverse order of the server's answer (`E01`: `de, fr` in the answer, `fr, de` in the file). Both modes do it. Registered in `bugs.md`; the order is what a downstream import reads, and the port reproduces it.

### LP-184: The ml lookups are repeated for every visit

[14.35] LP-126: the same type's ml names are asked again at every visit of the walk and for every element of a body, including the ones whose select the engine then replaces. The port sends the same requests in the same order. Registered in `bugs.md`.

### LP-185: The host and the engine disagree about `EN`

[14.35] The host accepts `langs=EN,de` (its `en` test ignores case), the engine does not remove `EN` and the check rejects it (LP-112, LP-180). Registered in `bugs.md`.

### LP-186: A kept language element loses its child elements but keeps their text

[14.35] LP-142: `<label xml:lang="de"><b>x</b>t</label>` is written as `<label xml:lang="de">t</label>`. Registered in `bugs.md`.

### LP-187: A failed installed-language check asks the server twice

[14.35] LP-114: the check evaluates `languages.Except(second)` lazily, where `second` is the enumeration of `GetLanguagesFromInnovator()`. `Any()` evaluates it once, and `string.Join(",", …)` evaluates it again to build the message, so a check that fails sends the Language request twice (`C12`, `C14`, `C25`; the recorded run `l1-meta-not-installed` made 8 calls) and one that passes sends it once. The port sends the same requests and builds the message from the second answer. Registered in `bugs.md`.
