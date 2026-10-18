# p5-ref-on

The same package with referenced items on. Engine 12.0, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 48). Catalogue: P5, S2, referenced items on (ticket 05).

## Exercises

FindReferencedElements for a package with referenced elements: the extra requests for the dependency's elements, the stock List, and the id that exists nowhere (its fault), and the extra items in the output.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-REF | Variable | 6A880A1FAC02A374F97FFF2376246C91 | LIBSJS-SCRATCH-REF-Var_1 |

Engine options: `exportReferencedItems` = `true`.

## Result

The export completes: host exit 0, 20 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s2-ref`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: import both (`LIBSJS-SCRATCH-REF`, `LIBSJS-SCRATCH-REFDEP`; default options)

Created 13, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | AE21394A7597482DB76C9EF9465B2D9D |
| 2 | PackageDefinition | 50DC3ED835A148E0861519AE7861D23F |
| 3 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 4 | PackageGroup | 25F7573E05E2420F8947511580F258FA |
| 5 | PackageElement | BDB03253BBAA40F5A4F2949DB44F8FB5 |
| 6 | DatabaseUpgrade | E449B7287CDE4A8990C3FD5DDA4CEE29 |
| 7 | PackageDefinition | EAF6535738A149F1A2D2A49990A62134 |
| 8 | PackageDependsOn | 8D8BE1C325E445B796045AA8BA766545 |
| 9 | PackageReferencedElement | 0B6E1B56C9D7494E93C313B8BAF6185F |
| 10 | PackageReferencedElement | F9B8343D77B54CAFB9FE9E5B947998C6 |
| 11 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 12 | PackageGroup | C8E1FF6977284F14B39D37C2580329B7 |
| 13 | PackageElement | 15E2558493BC4A6595132AA0C5C44D77 |

### Deleted by the cleanup: 13

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 15E2558493BC4A6595132AA0C5C44D77 |
| 2 | PackageGroup | C8E1FF6977284F14B39D37C2580329B7 |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | F9B8343D77B54CAFB9FE9E5B947998C6 |
| 5 | PackageReferencedElement | 0B6E1B56C9D7494E93C313B8BAF6185F |
| 6 | PackageDependsOn | 8D8BE1C325E445B796045AA8BA766545 |
| 7 | PackageDefinition | EAF6535738A149F1A2D2A49990A62134 |
| 8 | DatabaseUpgrade | E449B7287CDE4A8990C3FD5DDA4CEE29 |
| 9 | PackageElement | BDB03253BBAA40F5A4F2949DB44F8FB5 |
| 10 | PackageGroup | 25F7573E05E2420F8947511580F258FA |
| 11 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 12 | PackageDefinition | 50DC3ED835A148E0861519AE7861D23F |
| 13 | DatabaseUpgrade | AE21394A7597482DB76C9EF9465B2D9D |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --engine 12.0 --only p5-ref-on --force` (it seeds, exports and cleans up again).
