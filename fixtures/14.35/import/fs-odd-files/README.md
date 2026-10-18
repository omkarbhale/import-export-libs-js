# fs-odd-files

Files the loader treats specially. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: file system (tickets 05 and 75).

## Exercises

LoadPackageDom: a `.xmlbak` file is read (the `*.xml` pattern matches it), a file with no AML/Item is logged as skipped, a UTF-16 file with a BOM is read, a `.txt` file and a file one directory too deep are ignored.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-FS` | defaults | success (0) | 0 | 32 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 9

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 49712B34E1254EA696D94722BA05445C |
| 2 | PackageDefinition | 58629B6905FD40F38FBA5C88576A6A48 |
| 3 | Variable | 44402126489F68289C53980576DE1D39 |
| 4 | PackageGroup | 7B0F91032F944D3D9664F913037DD047 |
| 5 | PackageElement | 71096C3A3BF84D2FA02CDFEDA3BA7BD6 |
| 6 | Variable | DC08FF9FF82BB32E36FCD3B99C380DC8 |
| 7 | PackageElement | 8146721FBE8B4464BA3438FD9136E1BF |
| 8 | Variable | EE37B579701D1BE8841859BE8ACECBA5 |
| 9 | PackageElement | 772F29B8007946A6B84F807378327379 |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 772F29B8007946A6B84F807378327379 |
| 2 | Variable | EE37B579701D1BE8841859BE8ACECBA5 |
| 3 | PackageElement | 8146721FBE8B4464BA3438FD9136E1BF |
| 4 | Variable | DC08FF9FF82BB32E36FCD3B99C380DC8 |
| 5 | PackageElement | 71096C3A3BF84D2FA02CDFEDA3BA7BD6 |
| 6 | PackageGroup | 7B0F91032F944D3D9664F913037DD047 |
| 7 | Variable | 44402126489F68289C53980576DE1D39 |
| 8 | PackageDefinition | 58629B6905FD40F38FBA5C88576A6A48 |
| 9 | DatabaseUpgrade | 49712B34E1254EA696D94722BA05445C |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only fs-odd-files --force`.
