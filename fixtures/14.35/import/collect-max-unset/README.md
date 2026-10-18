# collect-max-unset

Collected errors with the maximum left at 0. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, collected errors (tickets 05 and 75).

## Exercises

A maximum of 0 trips on the first error: the AggregateException ends the package at once, before the failed item is registered, and the last items are never read.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-COLLZERO` | collectErrors={"maxCount":0} | 1 errors collected (1) | 1 | 34 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 9

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 8BAE686C00324F0389EC4E70607DD501 |
| 2 | PackageDefinition | 5E2BADA6C49B4B72A7CE84047C0F62C3 |
| 3 | Variable | AA0AE90968DA7BE0EF754632C9F5305E |
| 4 | PackageGroup | CF2C9E9597A447A8A3B1A7F2A0FEF655 |
| 5 | PackageElement | 72AA10A94ECC447885BAE344E2A19282 |
| 6 | Variable | C94FB62F61F8BA0310D9E85E38B649F0 |
| 7 | PackageElement | AB2A131A77C748A989FC0EA1AFC57369 |
| 8 | Variable | B9124BC2F70EF4204FA40C46BED68EDF |
| 9 | PackageElement | C95589D26C014286A0752CA88FFF7C46 |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | C95589D26C014286A0752CA88FFF7C46 |
| 2 | Variable | B9124BC2F70EF4204FA40C46BED68EDF |
| 3 | PackageElement | AB2A131A77C748A989FC0EA1AFC57369 |
| 4 | Variable | C94FB62F61F8BA0310D9E85E38B649F0 |
| 5 | PackageElement | 72AA10A94ECC447885BAE344E2A19282 |
| 6 | PackageGroup | CF2C9E9597A447A8A3B1A7F2A0FEF655 |
| 7 | Variable | AA0AE90968DA7BE0EF754632C9F5305E |
| 8 | PackageDefinition | 5E2BADA6C49B4B72A7CE84047C0F62C3 |
| 9 | DatabaseUpgrade | 8BAE686C00324F0389EC4E70607DD501 |

## Spec rules

IMP-541, IMP-544. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only collect-max-unset --force`.
