# s9-batch-bad-relation

The fourth of seven items fails the engine's own check. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9 (tickets 05 and 75).

## Exercises

On 14.0.7 the first failure stops the package: three items are imported and registered, the failing one raises 'Bad Relation type', the last three are never read. (14.35's batch and collected-errors modes differ; ticket 57 records them.)

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCH` | defaults | engine failure (1) | 1 | 34 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 9

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 354E20F097E1407C833C9B273F96B461 |
| 2 | PackageDefinition | ECA872E1D94C42D5A9D2AE7F293A31CF |
| 3 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 4 | PackageGroup | B143D62E18F04E32BF692F36DB94A830 |
| 5 | PackageElement | FA0B114228AB4ABF90D70E01C50D7695 |
| 6 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 7 | PackageElement | E055B7A7BF0D47FD93E036F93A0516E6 |
| 8 | Variable | E85E5A09574812188E8060248C111FE0 |
| 9 | PackageElement | 16752D65B11B4267BDFC3B2EDC8F2D7D |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 16752D65B11B4267BDFC3B2EDC8F2D7D |
| 2 | Variable | E85E5A09574812188E8060248C111FE0 |
| 3 | PackageElement | E055B7A7BF0D47FD93E036F93A0516E6 |
| 4 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 5 | PackageElement | FA0B114228AB4ABF90D70E01C50D7695 |
| 6 | PackageGroup | B143D62E18F04E32BF692F36DB94A830 |
| 7 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 8 | PackageDefinition | ECA872E1D94C42D5A9D2AE7F293A31CF |
| 9 | DatabaseUpgrade | 354E20F097E1407C833C9B273F96B461 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s9-batch-bad-relation --force`.
