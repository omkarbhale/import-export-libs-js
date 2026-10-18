# lang-unset-installed

A package with en, de and fr labels, Languages unset, all installed. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, Languages unset (tickets 05 and 75).

## Exercises

Every label is sent, and the server stores the de and fr translations.

## Dev state

Dev had these `Language` items while the case ran: `en`, `de`, `fr`. The result depends on it.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-LANGALL` | defaults | success (0) | 0 | 25 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 267ACFF2B11C4E469A52FC7E04D2E3E2 |
| 2 | PackageDefinition | 2D98ED16E4A94BD597AD1A071A4247BB |
| 3 | List | 7103931AD28428EECA699D64F330D9E2 |
| 4 | PackageGroup | 9BD9EAF404A54B60AEB5215E01129B9D |
| 5 | PackageElement | 438F5381985B46B8870FAA929FFE622C |

### Deleted by the cleanup: 5

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 438F5381985B46B8870FAA929FFE622C |
| 2 | PackageGroup | 9BD9EAF404A54B60AEB5215E01129B9D |
| 3 | List | 7103931AD28428EECA699D64F330D9E2 |
| 4 | PackageDefinition | 2D98ED16E4A94BD597AD1A071A4247BB |
| 5 | DatabaseUpgrade | 267ACFF2B11C4E469A52FC7E04D2E3E2 |

## Spec rules

IMP-635. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only lang-unset-installed --force`.
