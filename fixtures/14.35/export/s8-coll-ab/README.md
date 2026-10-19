# s8-coll-ab

Two packages whose names end in the same segment, A.Coll inserted first. Engine 14.35, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 57). Catalogue: S8, P4 (ticket 05).

## Exercises

CreateOutputDir with two packages that share the last dot-segment (Coll): both map to Coll\Import, so the folder the second one creates wipes the first one's. Which wins depends on the Hashtable's enumeration order.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | LIBSJS-SCRATCH-A.Coll | Variable | B884DA4086B47D93861052CA33041D07 | LIBSJS-SCRATCH-Coll_A |
| 2 | LIBSJS-SCRATCH-B.Coll | Variable | EB4A3D180B43F8CE6B393C6484D3F650 | LIBSJS-SCRATCH-Coll_B |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 17 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s8-coll`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: import both (`LIBSJS-SCRATCH-A.Coll`, `LIBSJS-SCRATCH-B.Coll`; default options)

Created 10, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 993DBB18D19A4F0FB0B5772039E66A4F |
| 2 | PackageDefinition | 9BEEEE7A9F974DAB9E0AFDA71B462DBA |
| 3 | Variable | B884DA4086B47D93861052CA33041D07 |
| 4 | PackageGroup | AD0DE0ED798A42E3AF1CD2ED07F45B1B |
| 5 | PackageElement | B0BCE89D9B1C4FC38B4FB49840DF5352 |
| 6 | DatabaseUpgrade | F9042B2CDD2343EFA30067698E06913D |
| 7 | PackageDefinition | A4C0916529E8446D8A8F8DD32F8C16AD |
| 8 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 9 | PackageGroup | 4AFEE68EB19A48DD9CF28F84B93AFA28 |
| 10 | PackageElement | D963B27B2F3B425CAB1F587C87AC58EB |

### Deleted by the cleanup: 10

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | D963B27B2F3B425CAB1F587C87AC58EB |
| 2 | PackageGroup | 4AFEE68EB19A48DD9CF28F84B93AFA28 |
| 3 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 4 | PackageDefinition | A4C0916529E8446D8A8F8DD32F8C16AD |
| 5 | DatabaseUpgrade | F9042B2CDD2343EFA30067698E06913D |
| 6 | PackageElement | B0BCE89D9B1C4FC38B4FB49840DF5352 |
| 7 | PackageGroup | AD0DE0ED798A42E3AF1CD2ED07F45B1B |
| 8 | Variable | B884DA4086B47D93861052CA33041D07 |
| 9 | PackageDefinition | 9BEEEE7A9F974DAB9E0AFDA71B462DBA |
| 10 | DatabaseUpgrade | 993DBB18D19A4F0FB0B5772039E66A4F |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --engine 14.35 --only s8-coll-ab --force` (it seeds, exports and cleans up again).
