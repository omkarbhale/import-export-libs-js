# s9-batch-server-failure

The fourth of seven items fails on the server. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9 (ticket 05).

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
| 1 | DatabaseUpgrade | EB58E9AF550549FD90E8A3877EDE9ACF |
| 2 | PackageDefinition | 4ADC36A80CEF49CEA70B1C3B88D833EE |
| 3 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 4 | PackageGroup | B6701BE51250442EBADFEF9CB6BEE8EA |
| 5 | PackageElement | E1DE5E7AAD3548F3A14F5D0496152EF6 |
| 6 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 7 | PackageElement | 032A492698124C4AB0C785DF6B95C564 |
| 8 | Variable | E85E5A09574812188E8060248C111FE0 |
| 9 | PackageElement | F15AEE4504AE40DAA69EFBC5C2FB8DA7 |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | F15AEE4504AE40DAA69EFBC5C2FB8DA7 |
| 2 | Variable | E85E5A09574812188E8060248C111FE0 |
| 3 | PackageElement | 032A492698124C4AB0C785DF6B95C564 |
| 4 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 5 | PackageElement | E1DE5E7AAD3548F3A14F5D0496152EF6 |
| 6 | PackageGroup | B6701BE51250442EBADFEF9CB6BEE8EA |
| 7 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 8 | PackageDefinition | 4ADC36A80CEF49CEA70B1C3B88D833EE |
| 9 | DatabaseUpgrade | EB58E9AF550549FD90E8A3877EDE9ACF |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s9-batch-server-failure --force`.
