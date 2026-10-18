# s0-mini-cancel

Cancel pressed after the fourth status message. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, cancel (tickets 05 and 75).

## Exercises

ImportExportManager.Cancel() during a package. 14.35 checks the flag before each item and ends the package with an OperationCanceledException, so the package row is written with status 2 (failed) and the run returns 1, where 14.0.7 recorded the package as a success and returned 0. The host presses Cancel from inside the status message, which is where the GUI's button would act.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import, cancelled | `LIBSJS-SCRATCH-MINI` | cancelAfterStatus=4 | engine failure (1) | 1 | 29 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 08AF1FFC27B944FBA9641A829EE82110 |
| 2 | PackageDefinition | CB8E00372DCF4569BB79401D7B7F0F22 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 033873886C384F8F8A68312AABF1B5F3 |
| 5 | PackageElement | 7A271444BBA84A50BB7BD2D4A691CFF1 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 05CD7269CCD44F069BFF5E1AACF08C13 |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 05CD7269CCD44F069BFF5E1AACF08C13 |
| 2 | List | E182B4D73FB907759D5E1BA11441412D |
| 3 | PackageElement | 7A271444BBA84A50BB7BD2D4A691CFF1 |
| 4 | PackageGroup | 033873886C384F8F8A68312AABF1B5F3 |
| 5 | List | C6018EE6DD2187000216C39E55D07AAE |
| 6 | PackageDefinition | CB8E00372DCF4569BB79401D7B7F0F22 |
| 7 | DatabaseUpgrade | 08AF1FFC27B944FBA9641A829EE82110 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s0-mini-cancel --force`.
