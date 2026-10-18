# batch-cancel

Cancel pressed with items waiting in the batch queue. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, 14.35, AML batch (tickets 05 and 75).

## Exercises

The cancel test returns from the loop without flushing: the queued items are never sent (IMP-524) and the run returns 1.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import, cancelled | `LIBSJS-SCRATCH-MINI` | cancelAfterStatus=4, amlBatch={"maxSize":10} | engine failure (1) | 1 | 29 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | D63E8EDE66F14DD59CC7A32334F8B56A |
| 2 | PackageDefinition | A6D9C8F6CB5745858FF56FA60A0C3C33 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 3D01151AF45F4AC29943718E9BD21A9C |
| 5 | PackageElement | 8C2BABFCBD1344CBAF858EA28DF0AC52 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | FD425A3905C44CEFBC5298EACF57E2DA |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | FD425A3905C44CEFBC5298EACF57E2DA |
| 2 | List | E182B4D73FB907759D5E1BA11441412D |
| 3 | PackageElement | 8C2BABFCBD1344CBAF858EA28DF0AC52 |
| 4 | PackageGroup | 3D01151AF45F4AC29943718E9BD21A9C |
| 5 | List | C6018EE6DD2187000216C39E55D07AAE |
| 6 | PackageDefinition | A6D9C8F6CB5745858FF56FA60A0C3C33 |
| 7 | DatabaseUpgrade | D63E8EDE66F14DD59CC7A32334F8B56A |

## Spec rules

IMP-524. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only batch-cancel --force`.
