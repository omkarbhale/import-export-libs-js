# s4-del

Delete actions against items an earlier import created. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S4 (tickets 05 and 75).

## Exercises

The build.xsl drop bug: List, ItemType and Identity deletes are dropped silently (their types are listed, but only for adds and edits); Form delete (its own bucket), Field delete (any action) and Value delete (an unlisted type, last bucket) are kept. The plan the import prints is the engine's answer to which ones ran.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import BASE | `LIBSJS-SCRATCH-BASE` | merge=true | success (0) | 0 | 206 |
| 2 | import DEL | `LIBSJS-SCRATCH-DEL` | merge=true | success (0) | 0 | 21 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 0

None.

### Step 2: created 2

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | CACC85D19B5A4A01BD7932F540EC5B35 |
| 2 | PackageDefinition | 5997109D1FFE4B67A78D2575271329F4 |

### Deleted by the cleanup: 2

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | 5997109D1FFE4B67A78D2575271329F4 |
| 2 | DatabaseUpgrade | CACC85D19B5A4A01BD7932F540EC5B35 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s4-del --force`.
