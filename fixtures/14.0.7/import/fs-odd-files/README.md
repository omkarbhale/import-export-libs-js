# fs-odd-files

Files the loader treats specially. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: file system (ticket 05).

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
| 1 | DatabaseUpgrade | F8B14F7697C64D72AE765BEA37451B49 |
| 2 | PackageDefinition | 6EC7785A8ECA47C6BBE7846255237370 |
| 3 | Variable | 44402126489F68289C53980576DE1D39 |
| 4 | PackageGroup | B6F9055031714644A6F4359FF4990192 |
| 5 | PackageElement | F9386ED58E4A477DA668059F4A989E7D |
| 6 | Variable | DC08FF9FF82BB32E36FCD3B99C380DC8 |
| 7 | PackageElement | 85C477847C7241A18104533D922AE6EF |
| 8 | Variable | EE37B579701D1BE8841859BE8ACECBA5 |
| 9 | PackageElement | 82FED4D2DA044E0B8C7F1F8394D5D763 |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 82FED4D2DA044E0B8C7F1F8394D5D763 |
| 2 | Variable | EE37B579701D1BE8841859BE8ACECBA5 |
| 3 | PackageElement | 85C477847C7241A18104533D922AE6EF |
| 4 | Variable | DC08FF9FF82BB32E36FCD3B99C380DC8 |
| 5 | PackageElement | F9386ED58E4A477DA668059F4A989E7D |
| 6 | PackageGroup | B6F9055031714644A6F4359FF4990192 |
| 7 | Variable | 44402126489F68289C53980576DE1D39 |
| 8 | PackageDefinition | 6EC7785A8ECA47C6BBE7846255237370 |
| 9 | DatabaseUpgrade | F8B14F7697C64D72AE765BEA37451B49 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only fs-odd-files --force`.
