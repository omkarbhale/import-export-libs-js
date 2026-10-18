# s0-mini-cancel

Cancel pressed after the fourth status message. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, cancel (ticket 05).

## Exercises

ImportExportManager.Cancel() during a package: the loop checks the flag before each item, writes the cancelled message and returns normally, so the package is recorded as success and the run returns 0. The host presses Cancel from inside the status message, which is where the GUI's button would act.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import, cancelled | `LIBSJS-SCRATCH-MINI` | cancelAfterStatus=4 | success (0) | 0 | 28 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 87F2AC4E7BBD49BE9F74AA15347C0652 |
| 2 | PackageDefinition | 7DF5571272B441619A7A8DDC8B960EE4 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 710A534299B345F5A348E63C54BFD437 |
| 5 | PackageElement | DD24EDC6971646A1B9391AC06C547CDC |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 2EB9F4D9737C495AA8C06016D8DDCDB7 |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 2EB9F4D9737C495AA8C06016D8DDCDB7 |
| 2 | List | E182B4D73FB907759D5E1BA11441412D |
| 3 | PackageElement | DD24EDC6971646A1B9391AC06C547CDC |
| 4 | PackageGroup | 710A534299B345F5A348E63C54BFD437 |
| 5 | List | C6018EE6DD2187000216C39E55D07AAE |
| 6 | PackageDefinition | 7DF5571272B441619A7A8DDC8B960EE4 |
| 7 | DatabaseUpgrade | 87F2AC4E7BBD49BE9F74AA15347C0652 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s0-mini-cancel --force`.
