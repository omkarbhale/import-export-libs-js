# s0-mini-cancel

Cancel pressed after the fourth status message. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, cancel (ticket 05).

## Exercises

ImportExportManager.Cancel() during a package: the loop checks the flag before each item, writes the cancelled message and returns normally, so the package is recorded as success and the run returns 0. The host presses Cancel from inside the status message, which is where the GUI's button would act.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import, cancelled | `LIBSJS-SCRATCH-MINI` | cancelAfterStatus=4 | success (0) | 0 | 29 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | D79EBAA7475149C8B9485AC2EB2B371D |
| 2 | PackageDefinition | C4C18782926E4D3DB9D7843ECAB9EAB6 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | B91D7A8A138B4A94B4467EEBE4E71BCE |
| 5 | PackageElement | F811BCB108C7400788B3D021E5129285 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | E75A65E63F9C41FD94FE01C939CA844A |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | E75A65E63F9C41FD94FE01C939CA844A |
| 2 | List | E182B4D73FB907759D5E1BA11441412D |
| 3 | PackageElement | F811BCB108C7400788B3D021E5129285 |
| 4 | PackageGroup | B91D7A8A138B4A94B4467EEBE4E71BCE |
| 5 | List | C6018EE6DD2187000216C39E55D07AAE |
| 6 | PackageDefinition | C4C18782926E4D3DB9D7843ECAB9EAB6 |
| 7 | DatabaseUpgrade | D79EBAA7475149C8B9485AC2EB2B371D |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s0-mini-cancel --force`.
