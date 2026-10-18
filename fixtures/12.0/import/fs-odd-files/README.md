# fs-odd-files

Files the loader treats specially. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: file system (ticket 05).

## Exercises

LoadPackageDom: a `.xmlbak` file is read (the `*.xml` pattern matches it), a file with no AML/Item is logged as skipped, a UTF-16 file with a BOM is read, a `.txt` file and a file one directory too deep are ignored.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-FS` | defaults | success (0) | 0 | 31 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 9

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | FA0D44EE1D3144E8B96DC59B14339E7E |
| 2 | PackageDefinition | 5C5B4DEE316D487B9A5303A6B883CF10 |
| 3 | Variable | 44402126489F68289C53980576DE1D39 |
| 4 | PackageGroup | A35A99BE68EA4A81932A92CC5E36CD07 |
| 5 | PackageElement | 6FDDCCCA4ADE4C45AD8AFE54FFC290AA |
| 6 | Variable | DC08FF9FF82BB32E36FCD3B99C380DC8 |
| 7 | PackageElement | 78088DC54DA048CE9132BD38019D0F18 |
| 8 | Variable | EE37B579701D1BE8841859BE8ACECBA5 |
| 9 | PackageElement | 009957C30ABB4045A0B8A1E393E676D4 |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 009957C30ABB4045A0B8A1E393E676D4 |
| 2 | Variable | EE37B579701D1BE8841859BE8ACECBA5 |
| 3 | PackageElement | 78088DC54DA048CE9132BD38019D0F18 |
| 4 | Variable | DC08FF9FF82BB32E36FCD3B99C380DC8 |
| 5 | PackageElement | 6FDDCCCA4ADE4C45AD8AFE54FFC290AA |
| 6 | PackageGroup | A35A99BE68EA4A81932A92CC5E36CD07 |
| 7 | Variable | 44402126489F68289C53980576DE1D39 |
| 8 | PackageDefinition | 5C5B4DEE316D487B9A5303A6B883CF10 |
| 9 | DatabaseUpgrade | FA0D44EE1D3144E8B96DC59B14339E7E |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only fs-odd-files --force`.
