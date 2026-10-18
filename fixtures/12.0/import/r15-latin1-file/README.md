# r15-latin1-file

An item file in Latin-1 with no XML declaration. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: R15 (ticket 05).

## Exercises

XmlDocument.Load decodes the file itself: the invalid UTF-8 byte is an XmlException ('Invalid character in the given encoding'), where 14.0.7 would read U+FFFD and import the item.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-FSLATIN1` | defaults | engine failure (1) | 1 | 12 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 1

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 2B4B44C787A447A98A9EBBD93EC103FA |

### Deleted by the cleanup: 1

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 2B4B44C787A447A98A9EBBD93EC103FA |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only r15-latin1-file --force`.
