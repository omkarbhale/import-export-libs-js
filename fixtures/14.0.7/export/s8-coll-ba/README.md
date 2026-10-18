# s8-coll-ba

The same two packages, B.Coll inserted first. Engine 14.0.7, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 67). Catalogue: S8, P4 (ticket 05).

## Exercises

The same collision with the insertion order reversed: the manifest and the surviving folder show whether the enumeration order follows the insertion.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-B.Coll | Variable | EB4A3D180B43F8CE6B393C6484D3F650 | LIBSJS-SCRATCH-Coll_B |
| 2 | LIBSJS-SCRATCH-A.Coll | Variable | B884DA4086B47D93861052CA33041D07 | LIBSJS-SCRATCH-Coll_A |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 16 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s8-coll`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: import both (`LIBSJS-SCRATCH-A.Coll`, `LIBSJS-SCRATCH-B.Coll`; default options)

Created 10, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 8A5638C19B9F4BF49DF94A33F1F86FD1 |
| 2 | PackageDefinition | 46D91E2818504E178D1AEA2D4B955BEA |
| 3 | Variable | B884DA4086B47D93861052CA33041D07 |
| 4 | PackageGroup | 6698A936B1BE4E119C75C57200DCC783 |
| 5 | PackageElement | 96C5DD68D85840F88D85711E0DA67601 |
| 6 | DatabaseUpgrade | 09E0E0D20A5742AE923DD4F6126E4521 |
| 7 | PackageDefinition | D9D4A1436064401BA46E07E6EF9C23C0 |
| 8 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 9 | PackageGroup | 601F86C08BD449CF93B70B354535D9F1 |
| 10 | PackageElement | AD4054A39FF040909CA854E03008FE15 |

### Deleted by the cleanup: 10

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | AD4054A39FF040909CA854E03008FE15 |
| 2 | PackageGroup | 601F86C08BD449CF93B70B354535D9F1 |
| 3 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 4 | PackageDefinition | D9D4A1436064401BA46E07E6EF9C23C0 |
| 5 | DatabaseUpgrade | 09E0E0D20A5742AE923DD4F6126E4521 |
| 6 | PackageElement | 96C5DD68D85840F88D85711E0DA67601 |
| 7 | PackageGroup | 6698A936B1BE4E119C75C57200DCC783 |
| 8 | Variable | B884DA4086B47D93861052CA33041D07 |
| 9 | PackageDefinition | 46D91E2818504E178D1AEA2D4B955BEA |
| 10 | DatabaseUpgrade | 8A5638C19B9F4BF49DF94A33F1F86FD1 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --only s8-coll-ba --force` (it seeds, exports and cleans up again).
