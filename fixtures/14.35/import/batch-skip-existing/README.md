# batch-skip-existing

A batch re-imported with merge off. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, AML batch (tickets 05 and 75).

## Exercises

Existing items are skipped, and in batch mode a skipped item is not registered in the package definition (IMP-522).

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | fresh import | `LIBSJS-SCRATCH-BATCHSKP` | defaults | success (0) | 0 | 48 |
| 2 | re-import, batch | `LIBSJS-SCRATCH-BATCHSKP` | amlBatch={"maxSize":3} | success (0) | 0 | 24 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 871A5E3E2C4744BC821DEE85B18059CE |
| 2 | PackageDefinition | 3561F94D2E0843F3967A0E11E785B321 |
| 3 | Variable | B497BAA0F18D424E345EA7A4B961D2DA |
| 4 | PackageGroup | ECF2448C08DD4DAF8ABAC64E9A24B8C0 |
| 5 | PackageElement | 5693A84BB6F54573B277556D68D2864A |
| 6 | Variable | 8832564D54AF13B9D24AF0F483D7A764 |
| 7 | PackageElement | 8425C8561F54433EA0ED40ECCE413E87 |
| 8 | Variable | AF46DB98131A88E9CD0899123123E8A1 |
| 9 | PackageElement | 07F6435D1532441783B2EFBCBEFFA4DC |
| 10 | Variable | F95A5A6F3D6C939FB6E075743488BB05 |
| 11 | PackageElement | DB67EB3E672344CEA70BCDB9D6F302DE |
| 12 | Variable | 20D8072619A339B87A781476BF02C7A0 |
| 13 | PackageElement | 73BA3E812B9D45D0ABD92AD367D354BF |
| 14 | Variable | 756138F0BF60A8BC6DDD86C3754D1A5E |
| 15 | PackageElement | D3FAE3A771E8441E8EC3D6073DFE5E45 |
| 16 | Variable | AF7B410495BB376497AABBE7B41E58AE |
| 17 | PackageElement | FFCBDF3AD6D34A8A8FE011D2B498D0B5 |

### Step 2: created 0

None.

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | FFCBDF3AD6D34A8A8FE011D2B498D0B5 |
| 2 | Variable | AF7B410495BB376497AABBE7B41E58AE |
| 3 | PackageElement | D3FAE3A771E8441E8EC3D6073DFE5E45 |
| 4 | Variable | 756138F0BF60A8BC6DDD86C3754D1A5E |
| 5 | PackageElement | 73BA3E812B9D45D0ABD92AD367D354BF |
| 6 | Variable | 20D8072619A339B87A781476BF02C7A0 |
| 7 | PackageElement | DB67EB3E672344CEA70BCDB9D6F302DE |
| 8 | Variable | F95A5A6F3D6C939FB6E075743488BB05 |
| 9 | PackageElement | 07F6435D1532441783B2EFBCBEFFA4DC |
| 10 | Variable | AF46DB98131A88E9CD0899123123E8A1 |
| 11 | PackageElement | 8425C8561F54433EA0ED40ECCE413E87 |
| 12 | Variable | 8832564D54AF13B9D24AF0F483D7A764 |
| 13 | PackageElement | 5693A84BB6F54573B277556D68D2864A |
| 14 | PackageGroup | ECF2448C08DD4DAF8ABAC64E9A24B8C0 |
| 15 | Variable | B497BAA0F18D424E345EA7A4B961D2DA |
| 16 | PackageDefinition | 3561F94D2E0843F3967A0E11E785B321 |
| 17 | DatabaseUpgrade | 871A5E3E2C4744BC821DEE85B18059CE |

## Spec rules

IMP-522. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only batch-skip-existing --force`.
