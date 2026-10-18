# batch-collect-fallback

A refused batch with collection on. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, AML batch, collected errors (tickets 05 and 75).

## Exercises

The fallback's failure at the fourth item is collected and the package ends with the items after it dropped (IMP-517, IMP-551).

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHSRV` | amlBatch={"maxSize":10}, collectErrors={"maxCount":5} | 1 errors collected (1) | 1 | 38 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 9

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 9667D3D06A9443B49B54975C92FFFA48 |
| 2 | PackageDefinition | 1E3A478CAC2545338917795633DA6089 |
| 3 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 4 | PackageGroup | 303783BBA3974198A6B75F99ADD78BA6 |
| 5 | PackageElement | BA656AA812124C5D9363D5EB85215E5D |
| 6 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 7 | PackageElement | 50F64DF46C7F45BD84934360F67E81B6 |
| 8 | Variable | E85E5A09574812188E8060248C111FE0 |
| 9 | PackageElement | 7F363F46336C4BDF90010EC0DF5A73E6 |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 7F363F46336C4BDF90010EC0DF5A73E6 |
| 2 | Variable | E85E5A09574812188E8060248C111FE0 |
| 3 | PackageElement | 50F64DF46C7F45BD84934360F67E81B6 |
| 4 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 5 | PackageElement | BA656AA812124C5D9363D5EB85215E5D |
| 6 | PackageGroup | 303783BBA3974198A6B75F99ADD78BA6 |
| 7 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 8 | PackageDefinition | 1E3A478CAC2545338917795633DA6089 |
| 9 | DatabaseUpgrade | 9667D3D06A9443B49B54975C92FFFA48 |

## Spec rules

IMP-517, IMP-551. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only batch-collect-fallback --force`.
