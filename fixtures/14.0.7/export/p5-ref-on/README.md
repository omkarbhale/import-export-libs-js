# p5-ref-on

The same package with referenced items on. Engine 14.0.7, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 67). Catalogue: P5, S2, referenced items on (ticket 05).

## Exercises

FindReferencedElements for a package with referenced elements: the extra requests for the dependency's elements, the stock List, and the id that exists nowhere (its fault), and the extra items in the output.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-REF | Variable | 6A880A1FAC02A374F97FFF2376246C91 | LIBSJS-SCRATCH-REF-Var_1 |

Engine options: `exportReferencedItems` = `true`.

## Result

The export completes: host exit 0, 23 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s2-ref`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: import both (`LIBSJS-SCRATCH-REF`, `LIBSJS-SCRATCH-REFDEP`; default options)

Created 13, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 25F7327888D4472398547C19BE4E6972 |
| 2 | PackageDefinition | 47A7228FA24349FA8E85CED596BEFE00 |
| 3 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 4 | PackageGroup | DF0F9A2F2F674CDDAA7FD9EB5B017AF6 |
| 5 | PackageElement | 26F929F366A44A84AAE3D98DDAD1C93A |
| 6 | DatabaseUpgrade | 1DDA12A46F9F4AD285B61116E4A1733D |
| 7 | PackageDefinition | 7C4599C680DD40E98EE666C483AD7AD3 |
| 8 | PackageDependsOn | 21A79BBC083F45BA8C24E792B72B5627 |
| 9 | PackageReferencedElement | 5E779124A8FA4BF0A14D2364BEAB2CDC |
| 10 | PackageReferencedElement | 1E7B053BFBA34BD39CE8C80BCA8E323D |
| 11 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 12 | PackageGroup | 2066D99F5B464A1E83090E5E233A95DB |
| 13 | PackageElement | 1D9C8E9DC3D1436DAFD8978E22125B46 |

### Deleted by the cleanup: 13

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 1D9C8E9DC3D1436DAFD8978E22125B46 |
| 2 | PackageGroup | 2066D99F5B464A1E83090E5E233A95DB |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | 1E7B053BFBA34BD39CE8C80BCA8E323D |
| 5 | PackageReferencedElement | 5E779124A8FA4BF0A14D2364BEAB2CDC |
| 6 | PackageDependsOn | 21A79BBC083F45BA8C24E792B72B5627 |
| 7 | PackageDefinition | 7C4599C680DD40E98EE666C483AD7AD3 |
| 8 | DatabaseUpgrade | 1DDA12A46F9F4AD285B61116E4A1733D |
| 9 | PackageElement | 26F929F366A44A84AAE3D98DDAD1C93A |
| 10 | PackageGroup | DF0F9A2F2F674CDDAA7FD9EB5B017AF6 |
| 11 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 12 | PackageDefinition | 47A7228FA24349FA8E85CED596BEFE00 |
| 13 | DatabaseUpgrade | 25F7327888D4472398547C19BE4E6972 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --only p5-ref-on --force` (it seeds, exports and cleans up again).
