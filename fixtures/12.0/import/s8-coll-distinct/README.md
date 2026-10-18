# s8-coll-distinct

Two packages whose names end in the same segment. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S8 (ticket 05).

## Exercises

Two packages with different items import side by side; each has its own PackageDefinition and element. Ticket 67 exports them to pin the shared last-segment folder.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-A.Coll`, `LIBSJS-SCRATCH-B.Coll` | defaults | success (0) | 0 | 37 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 10

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 0BC75B04B33243A8BABD3EBCB13AE05D |
| 2 | PackageDefinition | 77170A8F4E2E4C14B6627BB5D4AF2EE7 |
| 3 | Variable | B884DA4086B47D93861052CA33041D07 |
| 4 | PackageGroup | 7CBC7F3DE4E446A48E9F35BB3646A29B |
| 5 | PackageElement | AA1F8EC86D534B8E9CBE71D9F80B7A98 |
| 6 | DatabaseUpgrade | 54DEB47D47D043DDA8D276D88504AC2D |
| 7 | PackageDefinition | 76C3264A76C24BD882B86BA3C1362FAC |
| 8 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 9 | PackageGroup | 95EFBF55A48E475DA48DB0B92A184DA1 |
| 10 | PackageElement | 31D2C8AC89C34ECDA5A831D10D189BEB |

### Deleted by the cleanup: 10

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 31D2C8AC89C34ECDA5A831D10D189BEB |
| 2 | PackageGroup | 95EFBF55A48E475DA48DB0B92A184DA1 |
| 3 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 4 | PackageDefinition | 76C3264A76C24BD882B86BA3C1362FAC |
| 5 | DatabaseUpgrade | 54DEB47D47D043DDA8D276D88504AC2D |
| 6 | PackageElement | AA1F8EC86D534B8E9CBE71D9F80B7A98 |
| 7 | PackageGroup | 7CBC7F3DE4E446A48E9F35BB3646A29B |
| 8 | Variable | B884DA4086B47D93861052CA33041D07 |
| 9 | PackageDefinition | 77170A8F4E2E4C14B6627BB5D4AF2EE7 |
| 10 | DatabaseUpgrade | 0BC75B04B33243A8BABD3EBCB13AE05D |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s8-coll-distinct --force`.
