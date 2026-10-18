# s9-batch-fatal-reltype

A RelationshipType whose source ItemType does not exist. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9 (tickets 05 and 75).

## Exercises

CheckRelationshipType treats a missing source_id as fatal (it is not queued for delayed resolution): the items before it are imported, the package fails.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHREL` | defaults | engine failure (1) | 1 | 32 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 6C93BA2036FE4C89AFF2061C88FE8EB0 |
| 2 | PackageDefinition | 95EACD0CEA934C1993E4E1EB5B930167 |
| 3 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 4 | PackageGroup | 07BC8DF23BD446E9A78EAE73582B0F7D |
| 5 | PackageElement | E58A1CB0B7F44B84810B65F92E972BF0 |
| 6 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 7 | PackageElement | 4FCF631C451D45DA8CB2164EE7076877 |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 4FCF631C451D45DA8CB2164EE7076877 |
| 2 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 3 | PackageElement | E58A1CB0B7F44B84810B65F92E972BF0 |
| 4 | PackageGroup | 07BC8DF23BD446E9A78EAE73582B0F7D |
| 5 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 6 | PackageDefinition | 95EACD0CEA934C1993E4E1EB5B930167 |
| 7 | DatabaseUpgrade | 6C93BA2036FE4C89AFF2061C88FE8EB0 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s9-batch-fatal-reltype --force`.
