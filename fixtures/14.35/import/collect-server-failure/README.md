# collect-server-failure

One item the server refuses, errors collected up to 5. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, collected errors (tickets 05 and 75).

## Exercises

The failure of the fourth item is collected (an error message, the log block), the loop goes on and the last three items are imported; the failed add is registered in the package definition (IMP-544); the package ends failed and the run returns the count, 1.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-COLLSRV` | collectErrors={"maxCount":5} | 1 errors collected (1) | 1 | 48 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 16

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 9828B394E42A43E7ADA7FAFB6B3055F2 |
| 2 | PackageDefinition | 4758FB88B91B4D399D35FD8E3A479584 |
| 3 | Variable | 869121B98673CF8382BB252B0F44B0D9 |
| 4 | PackageGroup | 87D2A7F43E804C8B8226E45200FF765B |
| 5 | PackageElement | 747A609F04444DB3A3182FF1B58D8ABB |
| 6 | Variable | 18C5C0CB315799C40E1184280CD8BEC3 |
| 7 | PackageElement | 2B19D0CC4CA74B6ABABF55407243ABDD |
| 8 | Variable | C329C9235B5763279D3C75E23EBF6028 |
| 9 | PackageElement | 1DA1CB72187144F2803AE50E22799BEC |
| 10 | PackageElement | 5FEB13A622B147DBA3EE3044A1CCA27C |
| 11 | Variable | AD33EF5E743449F63FDC6B7DB05C6B23 |
| 12 | PackageElement | AF6A8F97835F4D608EBB008F3D093C15 |
| 13 | Variable | 479809B62ACCB26658B591F3A25A9EB8 |
| 14 | PackageElement | 319DED3E4F364839ABFAF16224A7FB8A |
| 15 | Variable | F7E293E47DE805A94819FB94A97F51E6 |
| 16 | PackageElement | 8F9F217B6FD340DB805C1DB8787AE6A5 |

### Deleted by the cleanup: 16

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 8F9F217B6FD340DB805C1DB8787AE6A5 |
| 2 | Variable | F7E293E47DE805A94819FB94A97F51E6 |
| 3 | PackageElement | 319DED3E4F364839ABFAF16224A7FB8A |
| 4 | Variable | 479809B62ACCB26658B591F3A25A9EB8 |
| 5 | PackageElement | AF6A8F97835F4D608EBB008F3D093C15 |
| 6 | Variable | AD33EF5E743449F63FDC6B7DB05C6B23 |
| 7 | PackageElement | 5FEB13A622B147DBA3EE3044A1CCA27C |
| 8 | PackageElement | 1DA1CB72187144F2803AE50E22799BEC |
| 9 | Variable | C329C9235B5763279D3C75E23EBF6028 |
| 10 | PackageElement | 2B19D0CC4CA74B6ABABF55407243ABDD |
| 11 | Variable | 18C5C0CB315799C40E1184280CD8BEC3 |
| 12 | PackageElement | 747A609F04444DB3A3182FF1B58D8ABB |
| 13 | PackageGroup | 87D2A7F43E804C8B8226E45200FF765B |
| 14 | Variable | 869121B98673CF8382BB252B0F44B0D9 |
| 15 | PackageDefinition | 4758FB88B91B4D399D35FD8E3A479584 |
| 16 | DatabaseUpgrade | 9828B394E42A43E7ADA7FAFB6B3055F2 |

## Spec rules

IMP-541, IMP-542, IMP-544, IMP-545, IMP-546. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only collect-server-failure --force`.
