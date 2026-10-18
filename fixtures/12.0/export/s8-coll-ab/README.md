# s8-coll-ab

Two packages whose names end in the same segment, A.Coll inserted first. Engine 12.0, export, recorded on dev against scratch state that the run seeded and deleted again (ticket 48). Catalogue: S8, P4 (ticket 05).

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

The export completes: host exit 0, 15 calls.

## Seed

The case exports items that did not exist on dev. The run (seed group `s8-coll`, recipe in `oracle/src/export-scratch-cases.ts`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by `oracle/src/seed-packages.ts` and `oracle/src/import-packages.ts`, so the seed can be rebuilt byte for byte.

### Seed step 1: import both (`LIBSJS-SCRATCH-A.Coll`, `LIBSJS-SCRATCH-B.Coll`; default options)

Created 10, in the order the engine made them:

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 891DD05969B944179536981B494B95C2 |
| 2 | PackageDefinition | 25925F92CF8240AC9C0BDE13E95799CB |
| 3 | Variable | B884DA4086B47D93861052CA33041D07 |
| 4 | PackageGroup | DB0A47C05AD948519D815CCF8461BD98 |
| 5 | PackageElement | 65B1759A286747A09510AF5ACC9D0EEA |
| 6 | DatabaseUpgrade | 116D581F92154D75803CA8F0C93D2B07 |
| 7 | PackageDefinition | 51C8C007180B4D21B37D16D6C778A3A9 |
| 8 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 9 | PackageGroup | 0023938E424A42A4BAE388C10AD90B72 |
| 10 | PackageElement | DB80E7D249884AA0B40B03F51758C81C |

### Deleted by the cleanup: 10

Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | DB80E7D249884AA0B40B03F51758C81C |
| 2 | PackageGroup | 0023938E424A42A4BAE388C10AD90B72 |
| 3 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 4 | PackageDefinition | 51C8C007180B4D21B37D16D6C778A3A9 |
| 5 | DatabaseUpgrade | 116D581F92154D75803CA8F0C93D2B07 |
| 6 | PackageElement | 65B1759A286747A09510AF5ACC9D0EEA |
| 7 | PackageGroup | DB0A47C05AD948519D815CCF8461BD98 |
| 8 | Variable | B884DA4086B47D93861052CA33041D07 |
| 9 | PackageDefinition | 25925F92CF8240AC9C0BDE13E95799CB |
| 10 | DatabaseUpgrade | 891DD05969B944179536981B494B95C2 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --engine 12.0 --only s8-coll-ab --force` (it seeds, exports and cleans up again).
