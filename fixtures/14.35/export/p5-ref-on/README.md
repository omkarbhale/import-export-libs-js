# p5-ref-on

The same package with referenced items on. Engine 14.35, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 57). Catalogue: P5, S2, referenced items on (ticket 05).

## Exercises

FindReferencedElements for a package with referenced elements: the extra requests for the dependency's elements, the stock List, and the id that exists nowhere (its fault), and the extra items in the output.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-REF | Variable | 6A880A1FAC02A374F97FFF2376246C91 | LIBSJS-SCRATCH-REF-Var_1 |

Engine options: `exportReferencedItems` = `true`.

## Result

The export completes: host exit 0, 25 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s2-ref`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: import both (`LIBSJS-SCRATCH-REF`, `LIBSJS-SCRATCH-REFDEP`; default options)

Created 13, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 910331955CC34114907C6B59F1DA1398 |
| 2 | PackageDefinition | CC0407649E5E48CAABBAE952448DE285 |
| 3 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 4 | PackageGroup | D09AA49EE25549499BDE6E19A20C95EF |
| 5 | PackageElement | C828E489458A4B8CA56609EEE12817C4 |
| 6 | DatabaseUpgrade | E4FB33E0793B49FBA5B1DDEDA1CC9DC7 |
| 7 | PackageDefinition | C8CAD2B404024F13ACE400F0A9E0D497 |
| 8 | PackageDependsOn | 918789F4B2E74E6198934EB44B50A140 |
| 9 | PackageReferencedElement | 73ED1212792C453F8A2C8C7A970446CE |
| 10 | PackageReferencedElement | AD72D2FA451D417B9BB22732B4B4797E |
| 11 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 12 | PackageGroup | 10459267BF4646BFB9E3743C1EB8F6FD |
| 13 | PackageElement | 60DD923FFEA74B86BA6B96518F9CCB7F |

### Deleted by the cleanup: 13

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 60DD923FFEA74B86BA6B96518F9CCB7F |
| 2 | PackageGroup | 10459267BF4646BFB9E3743C1EB8F6FD |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | AD72D2FA451D417B9BB22732B4B4797E |
| 5 | PackageReferencedElement | 73ED1212792C453F8A2C8C7A970446CE |
| 6 | PackageDependsOn | 918789F4B2E74E6198934EB44B50A140 |
| 7 | PackageDefinition | C8CAD2B404024F13ACE400F0A9E0D497 |
| 8 | DatabaseUpgrade | E4FB33E0793B49FBA5B1DDEDA1CC9DC7 |
| 9 | PackageElement | C828E489458A4B8CA56609EEE12817C4 |
| 10 | PackageGroup | D09AA49EE25549499BDE6E19A20C95EF |
| 11 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 12 | PackageDefinition | CC0407649E5E48CAABBAE952448DE285 |
| 13 | DatabaseUpgrade | 910331955CC34114907C6B59F1DA1398 |

## Spec rules

None yet. The spec or build ticket that pins this case adds its rule ids here (mapcheck F11).

## Files

| File | What |
|---|---|
| `case.json` | this case's input and result, machine-readable |
| `run.json` | the oracle's run record: toolset identity, parameters, host info |
| `transcript.jsonl` | every call the engine made, in order. A response of 64 KB or more is in `../_blobs/<sha256>.xml`, named by `responseBlob`; `oracle/src/transcript.ts` reads it back |
| `messages.jsonl` | the engine's messages, by channel |
| `engine.log` | the engine's own log |
| `host.log` | the host's console output |
| `output/` | the export folder, byte for byte |

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --engine 14.35 --only p5-ref-on --force` (it seeds, exports and cleans up again).
