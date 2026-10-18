# s3-unres-delayed

References that resolve once the package is imported. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S3 (ticket 05).

## Exercises

Delayed resolution: a Property whose data_source ItemType is imported by a later file (code 10000) and a Member whose related Identity is imported later (code 10001). The nodes are rewritten before the import and queued; the queue runs at the end of the package.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-UNRES` | defaults | success (0) | 0 | 46 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 12

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | E50D810F8559446E815FBEFC9AB2AD46 |
| 2 | PackageDefinition | B5EA1921B87746B5AE1CABAA466A9841 |
| 3 | Identity | 178F5CDDAEDCBB34BD09F06470745602 |
| 4 | PackageGroup | 80198C1496C24C4DB24E4EA65CA37A1A |
| 5 | PackageElement | 5A4C83CD52714944A7C19C537F150CEE |
| 6 | Identity | 3493A7900BEC83EA6396B8AC4120A691 |
| 7 | PackageElement | 678C6377A5BA42F19B5F9CF4060DEAFD |
| 8 | ItemType | 6E7E6F3785C0EA0207C5648D1A072EA7 |
| 9 | PackageGroup | FBA194D804204D6EA04552AEE0353C3B |
| 10 | PackageElement | 0A4374223C584E7B86D47BE2D7853064 |
| 11 | ItemType | D4F96DA7FCAACB328A32D7EADA3D9480 |
| 12 | PackageElement | 675FC682A6D140F7866DB608965BEC54 |

### Deleted by the cleanup: 12

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 675FC682A6D140F7866DB608965BEC54 |
| 2 | PackageElement | 0A4374223C584E7B86D47BE2D7853064 |
| 3 | PackageGroup | FBA194D804204D6EA04552AEE0353C3B |
| 4 | ItemType | 6E7E6F3785C0EA0207C5648D1A072EA7 |
| 5 | PackageElement | 678C6377A5BA42F19B5F9CF4060DEAFD |
| 6 | PackageElement | 5A4C83CD52714944A7C19C537F150CEE |
| 7 | PackageGroup | 80198C1496C24C4DB24E4EA65CA37A1A |
| 8 | Identity | 178F5CDDAEDCBB34BD09F06470745602 |
| 9 | PackageDefinition | B5EA1921B87746B5AE1CABAA466A9841 |
| 10 | DatabaseUpgrade | E50D810F8559446E815FBEFC9AB2AD46 |
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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s3-unres-delayed --force`.
