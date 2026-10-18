# lang-select-en

Languages = en over a package with en and de labels. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, Languages one code (tickets 05 and 75).

## Exercises

The skip set is de: the constructor checks that en is installed (one Language get), and each item is sent without its de labels.

## Dev state

Dev had these `Language` items while the case ran: `en`. The result depends on it.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-LANGEN` | languages=["en"] | success (0) | 0 | 26 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 4A767728B61247599ECA8869A7B34A67 |
| 2 | PackageDefinition | 2E2E938A8ECE451D825F80942E6BD936 |
| 3 | List | BEFE09BC85FE6275E0379C31519BC445 |
| 4 | PackageGroup | 597A0A637B9E4D5DA24E6F0CB3EC340E |
| 5 | PackageElement | EB24E2D801EB4E7FAC3DDCC446E9BA95 |

### Deleted by the cleanup: 5

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | EB24E2D801EB4E7FAC3DDCC446E9BA95 |
| 2 | PackageGroup | 597A0A637B9E4D5DA24E6F0CB3EC340E |
| 3 | List | BEFE09BC85FE6275E0379C31519BC445 |
| 4 | PackageDefinition | 2E2E938A8ECE451D825F80942E6BD936 |
| 5 | DatabaseUpgrade | 4A767728B61247599ECA8869A7B34A67 |

## Spec rules

IMP-621, IMP-630, IMP-631. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only lang-select-en --force`.
