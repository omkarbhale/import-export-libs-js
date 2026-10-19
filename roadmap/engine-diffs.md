# The three engines on the same dev items

Wayfinder ticket 64. The same catalogue items were exported with the three oracle engines (12.0.0.13341, 14.0.7.35492, 14.35.0.43890) on the dev instance, and the output folders, the messages, the engine log and the requests were diffed, pair by pair: 12.0 against 14.0.7, and 14.0.7 against 14.35. `export.xsl` was also run by the three engines on the same 578 documents, because dev cannot show some of the differences the code reading predicts.

Per the round 5 correction, **this cannot prove two engines the same.** A case that comes out byte for byte equal shows that these items do not reach a difference, nothing more. What it can do is confirm and pin the differences the code reading predicts, and look for one the reading missed. Both are below.

## What was compared

| Input | What | Where |
|---|---|---|
| 89 export cases | Every case that all three engines recorded: 75 of ticket 05's catalogue and option matrix (read-only gets on dev) and 14 scratch-seeded ones (ticket 67: `s2`, `s6`, `s7`, `s8`; the seed is built from code, imported, exported and deleted again). | `fixtures/{12.0,14.0.7,14.35}/export/` |
| 75 of them again, live | The catalogue was exported once more by the three engines in turn, case after case, so that every engine saw the same dev state, on 2026-10-19. Read-only; nothing was created. | outside the repo; the result is in "The live run" |
| 578 `export.xsl` inputs | The sets `export` (16), `export-items` (138) and `export-fix` (424) of `oracle/xsl-cases/`, run by each engine's own `CItemHelper.ApplyXsl` with no server. 12.0 and 14.35 ran `export-items` and `export-fix` for this ticket. | `fixtures/{12.0,14.0.7,14.35}/xsl/` |

The comparison is `npm run oracle:engine-diff` (`oracle/src/engine-diff.ts`). It pins its result in `fixtures/engine-diffs/`, and `oracle/src/engine-diff.test.ts` fails on any change to it, and on any difference in an output folder that is not listed below with its rules. Two scratch-seeded cases (`s6-cmf-itemtype` on both pairs) differ only in the id of an `Item Action` that the server generates when the seed is imported; the comparison counts them as equal in content.

## At a glance

| | 12.0 against 14.0.7 | 14.0.7 against 14.35 |
|---|---|---|
| Cases | 89 | 89 |
| Output folder byte-identical (`imports.mf` and every item file) | 84 | 81 |
| Equal but for server-generated ids | 1 | 1 |
| Item files differ | 4 | 7 |
| Host exit differs | 0 | 0 |
| Calls to the server | 2796 against 3281 | 3281 against 3346 |
| `export.xsl` inputs that differ (of 578) | 13 | 90 |

`imports.mf` is the same on all three engines in all 89 cases, including every multi-package ordering case (`p1-*`) and the two collision cases (`s8-*`).

## 12.0 against 14.0.7

| Predicted difference | Rule | Dev result | Pinned by |
|---|---|---|---|
| `implementation_query` and `event_data` are written as escaped text (12.0) or CDATA (14.0.7) | EXP-360 | **Confirmed.** `s6-dr-family`: both elements, and the family's `filter_xml`, which 14.0.7 also wraps (EXP-405). | the case; XSL: 6 inputs (`c01_08_implementation_query`, `c01_11_event_data`, `c42`, `c45`, `c46`, `a15`) |
| User `pwd_is_set_on` is exported (12.0) or dropped (14.0.7) | EXP-315 | **Not visible on dev.** The dev User ItemType has no such Property: it is in no response of `e33-user`, on any engine. | XSL: 2 inputs (`d16_user_pwd`, `d18_user_pwd_empty`) |
| The three system Properties of Change Controlled Relationship are an `edit` with `where` (12.0) or an `add` with `id` (14.0.7) | EXP-324 | **Confirmed.** `e08-change-controlled-relationship`: three Properties. | the case; XSL: 5 inputs |
| `ac_PolicyAccessItemAttribute` is fetched at `levels="1"` with a select (12.0) or at `levels="2"` (14.0.7), and 14.0.7 embeds the `dr_Relationship` | EXP-021, EXP-118 | **Confirmed.** `s6-ac-attribute`: 12.0 keeps `dr_relationship_id` as a reference (13 calls), 14.0.7 embeds the whole item (19 calls; 1 line against 38). | the case |
| A second `filter_xml` in a MAC condition is left as markup (12.0) or wrapped in CDATA (14.0.7) | EXP-405 | **Confirmed.** `s6-mac-two-filters`. | the case |
| The `dr_Relationship`'s `implementation_query` is re-indented through `XDocument.ToString` (14.0.7 only) | EXP-121 | **Not visible on dev.** The text the server computes is already indented the way `XDocument.ToString` writes it, so the unescaped 12.0 text equals the 14.0.7 text apart from the CDATA split of EXP-405. The server computes the query when the family is activated, so a seed cannot set a different one. | offline probes of EXP-121 |
| Float item properties are converted on `Relationships/Item` only, and the walk ends at a null lookup (12.0), or on every nested Item (14.0.7) | EXP-116 | **Visible in the requests, not in the bytes.** In 43 of 89 cases 14.0.7 sends more `ItemType` Property lookups (462 against 809 in the 89 cases, and 47 more `is_versionable` gets), and the files are identical. No dev item has a nested, non-relationship float item property that points to a re-generated item, so there is nothing to convert differently. | the request counts in `export.json` |
| Login and version probe | WIRE-015, WIRE-020 | **Confirmed.** 12.0 sends `GetCurrentUserID` (89 times) and two probe requests; 14.0.7 none and four (178 more `Variable` gets). | `export.json` |
| Log and messages | EXP-505, EXP-506, EXP-516, EXP-520, WIRE-051 | **Confirmed.** 14.0.7 writes the 15-line header block and 12.0 does not; the error item's log line has one space before `type` in 12.0 and four in 14.0.7; the `faultstring` of the two `e40` cases is the response's outer XML (12.0) or `Server error` with the pretty-printed request and response (14.0.7). | `export.json` (`log`, `messages`) |

## 14.0.7 against 14.35

| Predicted difference | Rule | Dev result | Pinned by |
|---|---|---|---|
| Relationships that are package elements of any package are removed | EXP-170 | **Confirmed in 7 cases**: a Form Event in `e07-form-itemtype`, the `PresentableItems` Morphae in `e09-presentableitems` and the four `p1-order-*` cases, and an 80-line `ES_Settings` block in `e34-preference`. In every one 14.35 only takes lines away. | the cases |
| Every element marked `is_null="1"` (other than `xp-*`) is dropped | EXP-380 | **Not visible on dev.** No response that feeds an export carries one: the only marked elements in the 89 recordings are 94 `data_source` elements in the `ItemType` lookups that the 14.35 template sends (EXP-061), which are never written, and the `xp-*` values, which are kept. So the drop changes no byte of the 89 output folders. | XSL: 90 inputs, all explained by the drop |
| The explicit relationship tree (EXP-061), `isNew`/`isTemp`, and the leading comma of the select (EXP-065) change what the server returns | EXP-060 to EXP-065 | **Not seen.** 78 request shapes differ (the per-type lookups, and every main fetch without `levels`), and the dev server answered them all with the same items: outside EXP-170, the 89 output folders are byte-identical. This is EXP-063's finding at the scale of whole exports, with the deepest levels of `Grid` and the life cycle map still unmatched, as EXP-063 says. | `export.json` (`requests`) |
| The template dictionary is shared by the packages of a run | EXP-060 | **Confirmed.** 14.35 sends fewer `ItemType` Property, `use_src_access`, `is_dependent` and `behavior` lookups for the same items (809 → 414, 468 → 348, 80 → 70, 79 → 69), and sends 600 template gets of its own (300 `ItemType`, 300 `RelationshipType`). | `export.json` |
| A failed item stops the whole export; the answer to the error question is ignored; an item still running keeps writing | EXP-555, EXP-570, EXP-571 | **Confirmed.** `e40-workflow-promotion-error-yes`: in 14.35 the `Activity Template` Form is written to disk while its "successfully exported" log line is lost. | the cases |
| The item counter races | EXP-552, EXP-573 | **Confirmed in 4 cases** with two items in a package (`e40-workflow-promotion-error-yes`, `e55-lists-no-package-pair`, `p5-ref-on`, `p5-ref-both-on`): the second status reads `Item 1 of 2`, as the first does, because two workers took the same number. | the cases (`messages.jsonl`) |
| The log header names 14.35.0.43890; `CItemException` text is pretty-printed | EXP-506, WIRE-051 | **Confirmed.** | `export.json` |

## `export.xsl` on the same documents

The two stylesheets differ in the places the reading names and in no others, on these inputs:

| Pair and set | Inputs | Differ | Why |
|---|---|---|---|
| 12.0 against 14.0.7, `export` | 16 | 0 | |
| 12.0 against 14.0.7, `export-items` | 138 | 0 | |
| 12.0 against 14.0.7, `export-fix` | 424 | 13 | EXP-360 (6), EXP-324 (5), EXP-315 (2) |
| 14.0.7 against 14.35, `export` | 16 | 1 | EXP-380 (`report-is-null-method`) |
| 14.0.7 against 14.35, `export-items` | 138 | 6 | EXP-380 |
| 14.0.7 against 14.35, `export-fix` | 424 | 83 | EXP-380: the inputs that carry a null-marked element, mostly the modified system Properties (`m_*`) |

A set's `recorded-11` input, a recorded response of a live export, is only in 14.0.7's `export` set. The test assigns each differing input to one rule from its content, and fails when a difference belongs to none.

## Differences the reading missed

None that lacks a rule. Everything the diff turned up is in `spec/`: the `GetCurrentUserID` call (WIRE-015), the four-request probe (WIRE-020), the end-of-run text and the one-space log line of 12.0 (EXP-516, EXP-520), the abort semantics and the lost log line of 14.35 (EXP-555, EXP-570), and the status-number race (EXP-552, EXP-573). No new rule variant is needed, and no new fixture case: each difference above is already pinned by a case, by the XSL sets, or by the request counts.

What the diff does add is a map of which differences dev cannot show on an export at all:

- **User `pwd_is_set_on` (EXP-315)** and the **`is_null` drop (EXP-380)** are pinned only by `export.xsl` on synthetic documents. No dev export reaches them.
- **Float item properties on nested items (EXP-116)** differ in the requests only.
- **The re-indent of a `dr_Relationship`'s query (EXP-121)** differs on no dev data.

Live parity (tickets 44 and 76) compares the port with the oracle on the same items, so it will not reach these either; the offline probes and the XSL recordings are where they stay pinned.

## The live run

All three engines exported the 75 catalogue cases on dev on 2026-10-19, one case after the other (225 recordings, read-only, no scratch item touched). The comparison of those recordings gives the same answer as the committed fixtures:

| | 12.0 against 14.0.7 | 14.0.7 against 14.35 |
|---|---|---|
| Output folders byte-identical | 74 of 75 | 68 of 75 |
| Cases that differ | `e08-change-controlled-relationship` (EXP-324) | `e07-form-itemtype`, `e09-presentableitems`, `e34-preference`, `p1-order-*` (four): EXP-170 |
| Calls | 2542 against 3001 | 3001 against 3040 |

Each engine's new output is also **byte-identical to its own committed fixture in all 75 cases** (`imports.mf` and every item file), so dev has not changed since the fixtures were recorded, between 2026-10-18 and today. What did change from run to run is what EXP-558 says is nondeterministic for 14.35: the item counter raced in 2 cases this time (`e40-workflow-promotion-error-yes`, `e55-lists-no-package-pair`) and in 4 in the committed recordings. One recording (`e21-workflow-map-system-owner` on 14.0.7) lost its host to a WSL error before the engine ran and was recorded again; `oracle:engine-diff --live` now repeats such a recording by itself.

## Limits

- **Equal is not the same.** 84 and 81 byte-identical folders say nothing about items that dev does not hold or that these cases do not name.
- **Dev has the `en` Language only**, so the 14.35 language-resource modes (LP-100 and on) are outside this diff; their cases are ticket 57's `l1-*` and `lang-*`.
- **The scratch-seeded cases** are compared from their committed fixtures, which the three recorders seeded on different days from the same code. The live run did not seed again.
- **14.35 is parallel.** Its log order, its message order and which in-flight item writes are not deterministic (EXP-558); each case was recorded once for this comparison, and the log and messages are compared as multisets. The cases that need three recordings (`x-par-*`, `x-cancel-*`) exist only for 14.35 and are not part of it.
- **Not compared:** `host.log`, `run.json`, the time stamps, and the order of requests within a case.

## Re-run

```sh
npm run oracle:engine-diff                                  # the committed fixtures, no server
npm run oracle:engine-diff -- --write                       # re-pin fixtures/engine-diffs/ after a re-record
ARAS_PASSWORD=… npm run oracle:engine-diff -- --live <dir>  # export the catalogue again on dev, read-only, then compare
```
