# s9-batch-server-failure

The fourth of seven items fails on the server. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9 (tickets 05 and 75).

## Exercises

A uniqueness error from the server ends the package at that item.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHSRV` | defaults | engine failure (1) | 1 | 34 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 9

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 5DEFE62EE52D499B8E5756D280D048DE |
| 2 | PackageDefinition | 8A54C4E6AD2541F58B41826144ECD641 |
| 3 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 4 | PackageGroup | 7C7C7BE617E54EEBBA122912F2701F38 |
| 5 | PackageElement | 3E5B35247C0A4A6F9E81CB9470509FEB |
| 6 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 7 | PackageElement | 6B0A32FA17EC45B4B4739FAF0A3D0E53 |
| 8 | Variable | E85E5A09574812188E8060248C111FE0 |
| 9 | PackageElement | 2849331053084CD095A354D8EE641383 |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 2849331053084CD095A354D8EE641383 |
| 2 | Variable | E85E5A09574812188E8060248C111FE0 |
| 3 | PackageElement | 6B0A32FA17EC45B4B4739FAF0A3D0E53 |
| 4 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 5 | PackageElement | 3E5B35247C0A4A6F9E81CB9470509FEB |
| 6 | PackageGroup | 7C7C7BE617E54EEBBA122912F2701F38 |
| 7 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 8 | PackageDefinition | 8A54C4E6AD2541F58B41826144ECD641 |
| 9 | DatabaseUpgrade | 5DEFE62EE52D499B8E5756D280D048DE |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s9-batch-server-failure --force`.
