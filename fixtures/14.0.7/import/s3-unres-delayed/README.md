# s3-unres-delayed

References that resolve once the package is imported. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S3 (ticket 05).

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
| 1 | DatabaseUpgrade | ADE1DB35FDBA4D248EB1D6D87745A307 |
| 2 | PackageDefinition | 3C0007CB7C33411D859AFD7337F120AB |
| 3 | Identity | 178F5CDDAEDCBB34BD09F06470745602 |
| 4 | PackageGroup | D9B686894DBA450D8AC781AB3FA79897 |
| 5 | PackageElement | 2F3A6CDC72444EEABE70262E748935A5 |
| 6 | Identity | 3493A7900BEC83EA6396B8AC4120A691 |
| 7 | PackageElement | 1D5BC4927B3A4E6EAECF23E07543C24E |
| 8 | ItemType | 6E7E6F3785C0EA0207C5648D1A072EA7 |
| 9 | PackageGroup | 568F5D3BD704428C82A533A3418F13B5 |
| 10 | PackageElement | 45F50CAA26AF4707A6ADFE42CB019D9F |
| 11 | ItemType | D4F96DA7FCAACB328A32D7EADA3D9480 |
| 12 | PackageElement | 4424032593784B1286F8E19ED0B4FD29 |

### Deleted by the cleanup: 12

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 4424032593784B1286F8E19ED0B4FD29 |
| 2 | PackageElement | 45F50CAA26AF4707A6ADFE42CB019D9F |
| 3 | PackageGroup | 568F5D3BD704428C82A533A3418F13B5 |
| 4 | ItemType | 6E7E6F3785C0EA0207C5648D1A072EA7 |
| 5 | PackageElement | 1D5BC4927B3A4E6EAECF23E07543C24E |
| 6 | PackageElement | 2F3A6CDC72444EEABE70262E748935A5 |
| 7 | PackageGroup | D9B686894DBA450D8AC781AB3FA79897 |
| 8 | Identity | 178F5CDDAEDCBB34BD09F06470745602 |
| 9 | PackageDefinition | 3C0007CB7C33411D859AFD7337F120AB |
| 10 | DatabaseUpgrade | ADE1DB35FDBA4D248EB1D6D87745A307 |
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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s3-unres-delayed --force`.
