# batch-server-failure

A batch the server refuses at the fourth item. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, AML batch (tickets 05 and 75).

## Exercises

The <AML> of seven items fails on the server (the fourth repeats the first's name) and the server applies none of it (the first three items are then added without complaint, one by one); the fourth fails alone and ends the package, and the items after it are neither checked nor sent (IMP-517).

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHSRV` | amlBatch={"maxSize":10} | engine failure (1) | 1 | 38 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 9

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 844BA758ADD6485D948630A881998685 |
| 2 | PackageDefinition | 85FB2D4E2A10485D9948085A49068FE1 |
| 3 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 4 | PackageGroup | 6C5D06F4743A4E70B32AA24DB62FC423 |
| 5 | PackageElement | D880ECAC47E24B1E9E743FB2633C439F |
| 6 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 7 | PackageElement | 3F8800A593CD4A4799EC31D148E3F1F8 |
| 8 | Variable | E85E5A09574812188E8060248C111FE0 |
| 9 | PackageElement | 4367FB3CB1C642A08F798E1ADE21612F |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 4367FB3CB1C642A08F798E1ADE21612F |
| 2 | Variable | E85E5A09574812188E8060248C111FE0 |
| 3 | PackageElement | 3F8800A593CD4A4799EC31D148E3F1F8 |
| 4 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 5 | PackageElement | D880ECAC47E24B1E9E743FB2633C439F |
| 6 | PackageGroup | 6C5D06F4743A4E70B32AA24DB62FC423 |
| 7 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 8 | PackageDefinition | 85FB2D4E2A10485D9948085A49068FE1 |
| 9 | DatabaseUpgrade | 844BA758ADD6485D948630A881998685 |

## Spec rules

IMP-516, IMP-517, IMP-523. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only batch-server-failure --force`.
