# s8-coll-distinct

Two packages whose names end in the same segment. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S8 (tickets 05 and 75).

## Exercises

Two packages with different items import side by side; each has its own PackageDefinition and element. Ticket 67 exports them to pin the shared last-segment folder.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-A.Coll`, `LIBSJS-SCRATCH-B.Coll` | defaults | success (0) | 0 | 38 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 10

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 423D44506C344CC98DBA1041A966FB84 |
| 2 | PackageDefinition | 17E3546DC1A345479104260137F46C3F |
| 3 | Variable | B884DA4086B47D93861052CA33041D07 |
| 4 | PackageGroup | 519E563DA55D423B94DD7AC37A54A334 |
| 5 | PackageElement | 1E03A37EDD8943FE9039E68C27715301 |
| 6 | DatabaseUpgrade | E953F01C8A454EEAB1528CCF9B08A47D |
| 7 | PackageDefinition | F3B8471521024B089573745730CCB5CC |
| 8 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 9 | PackageGroup | D653314288764719AB1C3AED541F3B82 |
| 10 | PackageElement | A5ADB972B03F4C8B91C8DC9AFACBE465 |

### Deleted by the cleanup: 10

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | A5ADB972B03F4C8B91C8DC9AFACBE465 |
| 2 | PackageGroup | D653314288764719AB1C3AED541F3B82 |
| 3 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 4 | PackageDefinition | F3B8471521024B089573745730CCB5CC |
| 5 | DatabaseUpgrade | E953F01C8A454EEAB1528CCF9B08A47D |
| 6 | PackageElement | 1E03A37EDD8943FE9039E68C27715301 |
| 7 | PackageGroup | 519E563DA55D423B94DD7AC37A54A334 |
| 8 | Variable | B884DA4086B47D93861052CA33041D07 |
| 9 | PackageDefinition | 17E3546DC1A345479104260137F46C3F |
| 10 | DatabaseUpgrade | 423D44506C344CC98DBA1041A966FB84 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s8-coll-distinct --force`.
