# lang-batch-select

Languages = de in AML batch mode. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, Languages one code, AML batch (tickets 05 and 75).

## Exercises

The skipped labels are deleted before an item is queued, so the one <AML> holds de labels only.

## Dev state

Dev had these `Language` items while the case ran: `en`, `de`, `fr`. The result depends on it.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-LANGBATCH` | languages=["de"], amlBatch={"maxSize":2} | success (0) | 0 | 27 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | C5643B2823754291823432B55CB1A102 |
| 2 | PackageDefinition | 9C701FD2D3984C17A231F548FA2AADDA |
| 3 | List | E63EE0981BA0755AC7448D6F89920D71 |
| 4 | PackageGroup | 314AF3A87B554FA7AB105336236DA0E3 |
| 5 | PackageElement | E238A9480BCC4099AC4BCFA71DE72052 |

### Deleted by the cleanup: 5

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | E238A9480BCC4099AC4BCFA71DE72052 |
| 2 | PackageGroup | 314AF3A87B554FA7AB105336236DA0E3 |
| 3 | List | E63EE0981BA0755AC7448D6F89920D71 |
| 4 | PackageDefinition | 9C701FD2D3984C17A231F548FA2AADDA |
| 5 | DatabaseUpgrade | C5643B2823754291823432B55CB1A102 |

## Spec rules

IMP-632. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only lang-batch-select --force`.
