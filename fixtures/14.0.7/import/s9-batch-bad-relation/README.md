# s9-batch-bad-relation

The fourth of seven items fails the engine's own check. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9 (ticket 05).

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
| 1 | DatabaseUpgrade | EB5B5F09E099402FA10368D0C0EC2CFA |
| 2 | PackageDefinition | 50F1EF41E0A64612940F5CC98D601AAA |
| 3 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 4 | PackageGroup | 78A26417F04947DD8C6E813DFA740D2D |
| 5 | PackageElement | F024EFC3A9C8461E860BB64589FA4194 |
| 6 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 7 | PackageElement | CA025B1E245A4A5D8EB4D972EE62A6E1 |
| 8 | Variable | E85E5A09574812188E8060248C111FE0 |
| 9 | PackageElement | 4C8E8FE4A3964054BC38B87A79FB3FF7 |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 4C8E8FE4A3964054BC38B87A79FB3FF7 |
| 2 | Variable | E85E5A09574812188E8060248C111FE0 |
| 3 | PackageElement | CA025B1E245A4A5D8EB4D972EE62A6E1 |
| 4 | Variable | 3172ED4C9B7DC0304F67A4238F7739FA |
| 5 | PackageElement | F024EFC3A9C8461E860BB64589FA4194 |
| 6 | PackageGroup | 78A26417F04947DD8C6E813DFA740D2D |
| 7 | Variable | 58760E04551E59833BC3B0DD0A8C48DC |
| 8 | PackageDefinition | 50F1EF41E0A64612940F5CC98D601AAA |
| 9 | DatabaseUpgrade | EB5B5F09E099402FA10368D0C0EC2CFA |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s9-batch-bad-relation --force`.
