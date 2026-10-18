# s5-sql

A SQL item imported twice. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S5 (tickets 05 and 75).

## Exercises

DeleteSqlItems runs before the first SQL item of a package is imported: it sends a delete for every SQL item in the package DOM (a first import deletes an id the server does not have), so a re-import deletes and re-adds the view. The cleanup drops the view with the item.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | fresh import | `LIBSJS-SCRATCH-SQL` | defaults | success (0) | 0 | 25 |
| 2 | re-import | `LIBSJS-SCRATCH-SQL` | defaults | success (0) | 0 | 20 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | DE6433419AE54A2C9C70703B6714442A |
| 2 | PackageDefinition | 2CE2AB62A64849DB849DDA546EF66358 |
| 3 | SQL | D9E85E9C05E70116CB38C132B3F44A7A |
| 4 | PackageGroup | 6A6D02BAB399455889293B079CAE374A |
| 5 | PackageElement | B8BE4D5927A7415CBED2074A10327BF9 |

### Step 2: created 0

None.

### Deleted by the cleanup: 5

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | B8BE4D5927A7415CBED2074A10327BF9 |
| 2 | PackageGroup | 6A6D02BAB399455889293B079CAE374A |
| 3 | SQL | D9E85E9C05E70116CB38C132B3F44A7A |
| 4 | PackageDefinition | 2CE2AB62A64849DB849DDA546EF66358 |
| 5 | DatabaseUpgrade | DE6433419AE54A2C9C70703B6714442A |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s5-sql --force`.
