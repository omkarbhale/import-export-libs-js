# lang-select-de

Languages = de over a package with en, de and fr labels. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, Languages one code (tickets 05 and 75).

## Exercises

The skip set is en and fr (a selection only removes): each item is sent with its de labels only.

## Dev state

Dev had these `Language` items while the case ran: `en`, `de`, `fr`. The result depends on it.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-LANGDE` | languages=["de"] | success (0) | 0 | 26 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 6D223E699E074DA4A72692EE52D036D0 |
| 2 | PackageDefinition | 1E2478A6BC9541CA82F3ACDC633EB1FD |
| 3 | List | DFD3660B9570E6FA78309B0D17E1589D |
| 4 | PackageGroup | 6CCA61BBC0824331B7DD3E1F2F39C167 |
| 5 | PackageElement | 6F8518D4076B4E8A923E5969B40BC2C8 |

### Deleted by the cleanup: 5

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 6F8518D4076B4E8A923E5969B40BC2C8 |
| 2 | PackageGroup | 6CCA61BBC0824331B7DD3E1F2F39C167 |
| 3 | List | DFD3660B9570E6FA78309B0D17E1589D |
| 4 | PackageDefinition | 1E2478A6BC9541CA82F3ACDC633EB1FD |
| 5 | DatabaseUpgrade | 6D223E699E074DA4A72692EE52D036D0 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only lang-select-de --force`.
