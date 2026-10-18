# s9-batch-fatal-reltype

A RelationshipType whose source ItemType does not exist. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9 (ticket 05).

## Exercises

CheckRelationshipType treats a missing source_id as fatal (it is not queued for delayed resolution): the items before it are imported, the package fails.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHREL` | defaults | engine failure (1) | 1 | 31 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 6DC5F9AC508F4408B0976186C91AD403 |
| 2 | PackageDefinition | AD33DAE83E1C4AC7B619FD318E59AC68 |
| 3 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 4 | PackageGroup | F3482523C1F84402BC14A09D1A5F4262 |
| 5 | PackageElement | 81D0E77694EF46F7919855091C094838 |
| 6 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 7 | PackageElement | 70E895454DF64579B85B69A0EB045169 |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 70E895454DF64579B85B69A0EB045169 |
| 2 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 3 | PackageElement | 81D0E77694EF46F7919855091C094838 |
| 4 | PackageGroup | F3482523C1F84402BC14A09D1A5F4262 |
| 5 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 6 | PackageDefinition | AD33DAE83E1C4AC7B619FD318E59AC68 |
| 7 | DatabaseUpgrade | 6DC5F9AC508F4408B0976186C91AD403 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s9-batch-fatal-reltype --force`.
