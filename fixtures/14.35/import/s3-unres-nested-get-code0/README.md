# s3-unres-nested-get-code0

A nested get that finds nothing, under an unlisted parent. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S3 (tickets 05 and 75).

## Exercises

CheckGetItems records code 0 (logged only, nothing is rewritten); the item is imported as it is, and the server then rejects the nested get, which fails the package.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-UNRES0` | defaults | engine failure (1) | 1 | 20 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 2

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | F4B290ED98AE46778CA92DB5A5894B34 |
| 2 | PackageDefinition | FDFD2B84BCCA4D6F9E0C161D64A7601C |

### Deleted by the cleanup: 2

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | FDFD2B84BCCA4D6F9E0C161D64A7601C |
| 2 | DatabaseUpgrade | F4B290ED98AE46778CA92DB5A5894B34 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s3-unres-nested-get-code0 --force`.
