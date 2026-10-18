# batch-fatal-reltype

A RelationshipType whose source ItemType does not exist, in batch mode. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, AML batch (tickets 05 and 75).

## Exercises

The fatal check of IMP-160 in batch mode: the queued items are sent by the forced flush of IMP-518, then the package fails.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHREL` | amlBatch={"maxSize":3} | engine failure (1) | 1 | 32 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | FF73648C66254A66B1E130606C35D297 |
| 2 | PackageDefinition | F9AF4C9C2B6A41CFB720732E56A8917E |
| 3 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 4 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 5 | PackageGroup | 61D839F8EF954E98B78CA78DA5DBEF3E |
| 6 | PackageElement | 9928CC2FF15648EAA9DCDEDDB82CE8C9 |
| 7 | PackageElement | 6F4A54C1B5BC4A48B3B926497A7D4F7F |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 6F4A54C1B5BC4A48B3B926497A7D4F7F |
| 2 | PackageElement | 9928CC2FF15648EAA9DCDEDDB82CE8C9 |
| 3 | PackageGroup | 61D839F8EF954E98B78CA78DA5DBEF3E |
| 4 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 5 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 6 | PackageDefinition | F9AF4C9C2B6A41CFB720732E56A8917E |
| 7 | DatabaseUpgrade | FF73648C66254A66B1E130606C35D297 |

## Spec rules

IMP-518. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only batch-fatal-reltype --force`.
