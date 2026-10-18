# s9-batch-server-failure

The fourth of seven items fails on the server. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9 (ticket 05).

## Exercises

A uniqueness error from the server ends the package at that item.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHSRV` | defaults | engine failure (1) | 1 | 33 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 9

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | CFB472B330544E299D941724DB332593 |
| 2 | PackageDefinition | B2ABC106255C4C7D802DE30FB5C51F1E |
| 3 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 4 | PackageGroup | DDCDB48234CC47EDA030C11E782452C3 |
| 5 | PackageElement | F2F5426D10584ADEA731FC4FADE9277A |
| 6 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 7 | PackageElement | 66FC9B06062A4C12A680EDE27535FBC6 |
| 8 | Variable | E85E5A09574812188E8060248C111FE0 |
| 9 | PackageElement | 2398A1E7699A4768A1394E8136C9C163 |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 2398A1E7699A4768A1394E8136C9C163 |
| 2 | Variable | E85E5A09574812188E8060248C111FE0 |
| 3 | PackageElement | 66FC9B06062A4C12A680EDE27535FBC6 |
| 4 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 5 | PackageElement | F2F5426D10584ADEA731FC4FADE9277A |
| 6 | PackageGroup | DDCDB48234CC47EDA030C11E782452C3 |
| 7 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 8 | PackageDefinition | B2ABC106255C4C7D802DE30FB5C51F1E |
| 9 | DatabaseUpgrade | CFB472B330544E299D941724DB332593 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s9-batch-server-failure --force`.
