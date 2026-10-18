# s8-coll-duplicate

The same item in two packages. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S8 (ticket 05).

## Exercises

PackageElement is looked up globally by element id: the second package finds the first one's element in another group and fails with the duplicate-element error (-2).

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-A.Coll`, `LIBSJS-SCRATCH-B.Coll` | defaults | engine failure (1) | 1 | 36 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 8

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | A46AE79C9E95491C9FCC179D14938884 |
| 2 | PackageDefinition | 35E2BB7DE7854D5EA19FDD70D5A614F9 |
| 3 | Variable | 416141614D62782894BB63F6E612448D |
| 4 | PackageGroup | E318288C0AD24B358BC41202DEDCD10B |
| 5 | PackageElement | 3CF464213076479A9107EFB8FDDB44B9 |
| 6 | DatabaseUpgrade | 0FBAFC329F4F4A6CA5D0D82F5021FE37 |
| 7 | PackageDefinition | 95B834349F6444118013E4687027EF11 |
| 8 | PackageGroup | E07A97D802F245B4933052A4434CD4B7 |

### Deleted by the cleanup: 8

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageGroup | E07A97D802F245B4933052A4434CD4B7 |
| 2 | PackageDefinition | 95B834349F6444118013E4687027EF11 |
| 3 | DatabaseUpgrade | 0FBAFC329F4F4A6CA5D0D82F5021FE37 |
| 4 | PackageElement | 3CF464213076479A9107EFB8FDDB44B9 |
| 5 | PackageGroup | E318288C0AD24B358BC41202DEDCD10B |
| 6 | Variable | 416141614D62782894BB63F6E612448D |
| 7 | PackageDefinition | 35E2BB7DE7854D5EA19FDD70D5A614F9 |
| 8 | DatabaseUpgrade | A46AE79C9E95491C9FCC179D14938884 |

## Spec rules

None yet. The spec or build ticket that pins this case adds its rule ids here (mapcheck F11).

## Files

Each `step-<n>/` folder:

| File | What |
|---|---|
| `run.json` | the oracle's run record: toolset identity, parameters, host info, and the cleanup report (created, deleted, kept) |
| `transcript.jsonl` | every call the engine made, in order. A response of 64 KB or more is in `../../_blobs/<sha256>.xml`, named by `responseBlob`; `oracle/src/transcript.ts` reads it back |
| `messages.jsonl` | the engine's messages, by channel |
| `engine.log` | the engine's own log |
| `host.log` | the host's console output |
| `input/` | the package folder the engine read: `imports.mf` and the item files |

The return code is `run.json` `host.result` (`ImportSolutions returned N`); `hostExit` is the host process's own exit code.

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s8-coll-duplicate --force`.
