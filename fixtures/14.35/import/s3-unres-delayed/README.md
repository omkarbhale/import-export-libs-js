# s3-unres-delayed

References that resolve once the package is imported. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S3 (tickets 05 and 75).

## Exercises

Delayed resolution: a Property whose data_source ItemType is imported by a later file (code 10000) and a Member whose related Identity is imported later (code 10001). The nodes are rewritten before the import and queued; the queue runs at the end of the package.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-UNRES` | defaults | success (0) | 0 | 47 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 12

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 1EDF5C2CB4E9443EBAF900AF09F16158 |
| 2 | PackageDefinition | B3DB59BEA62142E1B6D1F5EA71A874DB |
| 3 | Identity | 178F5CDDAEDCBB34BD09F06470745602 |
| 4 | PackageGroup | 7305C9BBEF9441A3AD8D72AB3353FCCF |
| 5 | PackageElement | 67F535CCB63640008D5AAAB7C3AAF304 |
| 6 | Identity | 3493A7900BEC83EA6396B8AC4120A691 |
| 7 | PackageElement | 1E07701538AC4DB0AF3A8C92DB7AEBC0 |
| 8 | ItemType | 6E7E6F3785C0EA0207C5648D1A072EA7 |
| 9 | PackageGroup | DBD1AD3C19504FEA919658AE17CF4352 |
| 10 | PackageElement | 5E3079DCAC5D4230A960EDA99131DFC4 |
| 11 | ItemType | D4F96DA7FCAACB328A32D7EADA3D9480 |
| 12 | PackageElement | 72369F1E49084A89B7292E175A02CBF0 |

### Deleted by the cleanup: 12

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 72369F1E49084A89B7292E175A02CBF0 |
| 2 | PackageElement | 5E3079DCAC5D4230A960EDA99131DFC4 |
| 3 | PackageGroup | DBD1AD3C19504FEA919658AE17CF4352 |
| 4 | ItemType | 6E7E6F3785C0EA0207C5648D1A072EA7 |
| 5 | PackageElement | 1E07701538AC4DB0AF3A8C92DB7AEBC0 |
| 6 | PackageElement | 67F535CCB63640008D5AAAB7C3AAF304 |
| 7 | PackageGroup | 7305C9BBEF9441A3AD8D72AB3353FCCF |
| 8 | Identity | 178F5CDDAEDCBB34BD09F06470745602 |
| 9 | PackageDefinition | B3DB59BEA62142E1B6D1F5EA71A874DB |
| 10 | DatabaseUpgrade | 1EDF5C2CB4E9443EBAF900AF09F16158 |
| 11 | ItemType | D4F96DA7FCAACB328A32D7EADA3D9480 |
| 12 | Identity | 3493A7900BEC83EA6396B8AC4120A691 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s3-unres-delayed --force`.
