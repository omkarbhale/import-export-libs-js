# s8-coll-duplicate

The same item in two packages. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S8 (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | 7E8AE9133270443EB96091E9F8359BFF |
| 2 | PackageDefinition | 4AFDD40CD5104533A9FECB480D620C98 |
| 3 | Variable | 416141614D62782894BB63F6E612448D |
| 4 | PackageGroup | B53C71BB2325401DABD3A8CDE5567937 |
| 5 | PackageElement | 6C227E17FFEF43A892C5AC083A037A23 |
| 6 | DatabaseUpgrade | E371454159F1413AB200CC0E43A91C69 |
| 7 | PackageDefinition | 2FB0813A28644C2CACAE90399C46249A |
| 8 | PackageGroup | 72839CB3ECFC4D20B1246AF607B3407A |

### Deleted by the cleanup: 8

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageGroup | 72839CB3ECFC4D20B1246AF607B3407A |
| 2 | PackageDefinition | 2FB0813A28644C2CACAE90399C46249A |
| 3 | DatabaseUpgrade | E371454159F1413AB200CC0E43A91C69 |
| 4 | PackageElement | 6C227E17FFEF43A892C5AC083A037A23 |
| 5 | PackageGroup | B53C71BB2325401DABD3A8CDE5567937 |
| 6 | Variable | 416141614D62782894BB63F6E612448D |
| 7 | PackageDefinition | 4AFDD40CD5104533A9FECB480D620C98 |
| 8 | DatabaseUpgrade | 7E8AE9133270443EB96091E9F8359BFF |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s8-coll-duplicate --force`.
