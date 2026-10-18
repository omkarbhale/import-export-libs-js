# lang-star-installed

Languages = * over a package with en, de and fr labels. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, Languages * (tickets 05 and 75).

## Exercises

`*` expands to de, en, fr (sorted by the host's culture); all are installed, so nothing is deleted.

## Dev state

Dev had these `Language` items while the case ran: `en`, `de`, `fr`. The result depends on it.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-LANGSTAR` | languages=["*"] | success (0) | 0 | 26 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | F9B7888C854842F78BAA4357E30E5BB5 |
| 2 | PackageDefinition | 1E05B9FCB91C4A069DA82714B1157604 |
| 3 | List | 33D9F92F7939295BDE244F33931B420B |
| 4 | PackageGroup | 46C7EE43F83244B4A744C2D47BC264AE |
| 5 | PackageElement | D8F2733C53CC4214AA100201629FF4F8 |

### Deleted by the cleanup: 5

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | D8F2733C53CC4214AA100201629FF4F8 |
| 2 | PackageGroup | 46C7EE43F83244B4A744C2D47BC264AE |
| 3 | List | 33D9F92F7939295BDE244F33931B420B |
| 4 | PackageDefinition | 1E05B9FCB91C4A069DA82714B1157604 |
| 5 | DatabaseUpgrade | F9B7888C854842F78BAA4357E30E5BB5 |

## Spec rules

IMP-615, IMP-620, IMP-621, IMP-635. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only lang-star-installed --force`.
