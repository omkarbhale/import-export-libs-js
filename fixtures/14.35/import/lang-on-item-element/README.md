# lang-on-item-element

A skipped language on the Item element itself. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, bug (tickets 05 and 75).

## Exercises

The selection also matches the root Item when it carries xml:lang of a skipped language, and removing it leaves an empty document (IMP-634).

## Dev state

Dev had these `Language` items while the case ran: `en`. The result depends on it.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-LANGSELF` | languages=["en"] | engine failure (1) | 1 | 19 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 2

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 6158DCAD229A465DBA19EA513DD4DEF5 |
| 2 | PackageDefinition | 1B2DC4B6A15E48C181D583AA05222804 |

### Deleted by the cleanup: 2

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | 1B2DC4B6A15E48C181D583AA05222804 |
| 2 | DatabaseUpgrade | 6158DCAD229A465DBA19EA513DD4DEF5 |

## Spec rules

IMP-634. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only lang-on-item-element --force`.
