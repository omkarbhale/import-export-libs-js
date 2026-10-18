# collect-cancel

Cancel with collection on and nothing collected. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, 14.35, collected errors (tickets 05 and 75).

## Exercises

The cancel becomes an aggregate that is reported as an error, but the count is 0, so the run returns 0 (IMP-547).

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import, cancelled | `LIBSJS-SCRATCH-MINI` | cancelAfterStatus=4, collectErrors={"maxCount":5} | success (0) | 0 | 29 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 42AF17ACF4A24B869EC0C445EC624991 |
| 2 | PackageDefinition | 1C4682583D48430493506FD76252BFCF |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 13AD3E9AF1A1476D9065E7E831D82A70 |
| 5 | PackageElement | 5FF67A191202483DB154AD2D4735CC65 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 1A43A32556464728AB17A36D9469209A |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 1A43A32556464728AB17A36D9469209A |
| 2 | List | E182B4D73FB907759D5E1BA11441412D |
| 3 | PackageElement | 5FF67A191202483DB154AD2D4735CC65 |
| 4 | PackageGroup | 13AD3E9AF1A1476D9065E7E831D82A70 |
| 5 | List | C6018EE6DD2187000216C39E55D07AAE |
| 6 | PackageDefinition | 1C4682583D48430493506FD76252BFCF |
| 7 | DatabaseUpgrade | 42AF17ACF4A24B869EC0C445EC624991 |

## Spec rules

IMP-545, IMP-547. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only collect-cancel --force`.
