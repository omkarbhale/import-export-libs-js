# man-cycle

Two packages that depend on each other. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: manifest (ticket 05).

## Exercises

GetPackageNamesInImportOrder: a dependency cycle through the starting package gives the circular-dependency warning, and both packages are still imported.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-CYC1`, `LIBSJS-SCRATCH-CYC2` | defaults | success (0) | 0 | 41 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 12

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | FA3AAE8EE80D4B3AB0D8283784D20659 |
| 2 | PackageDefinition | F8A4579570414E8FA732C3EE4981E72D |
| 3 | PackageDependsOn | 718868C98DBB41C88113F515B5DDB16C |
| 4 | Variable | 54B3935B1919800C6EA7B49DDBBABC3E |
| 5 | PackageGroup | D2B5DE745DE74701B4214801C8F68CBB |
| 6 | PackageElement | 380EE9331A8540559EF818E95F20C0C1 |
| 7 | DatabaseUpgrade | 8211D1F9E51243ADA34AF37679D9DB6A |
| 8 | PackageDefinition | B88042557B1A4AFA8365D924B8E19290 |
| 9 | PackageDependsOn | 96111C7D5EBD4230A97CB7B0FB6513B5 |
| 10 | Variable | D72B4CA103EA4FFB0DD7E8F4EC95995C |
| 11 | PackageGroup | 32D7F399A4D241FDB5717D59C01547F0 |
| 12 | PackageElement | 321E2FFFEAE0414EA7705D0D765D6A09 |

### Deleted by the cleanup: 12

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 321E2FFFEAE0414EA7705D0D765D6A09 |
| 2 | PackageGroup | 32D7F399A4D241FDB5717D59C01547F0 |
| 3 | Variable | D72B4CA103EA4FFB0DD7E8F4EC95995C |
| 4 | PackageDependsOn | 96111C7D5EBD4230A97CB7B0FB6513B5 |
| 5 | PackageDefinition | B88042557B1A4AFA8365D924B8E19290 |
| 6 | DatabaseUpgrade | 8211D1F9E51243ADA34AF37679D9DB6A |
| 7 | PackageElement | 380EE9331A8540559EF818E95F20C0C1 |
| 8 | PackageGroup | D2B5DE745DE74701B4214801C8F68CBB |
| 9 | Variable | 54B3935B1919800C6EA7B49DDBBABC3E |
| 10 | PackageDependsOn | 718868C98DBB41C88113F515B5DDB16C |
| 11 | PackageDefinition | F8A4579570414E8FA732C3EE4981E72D |
| 12 | DatabaseUpgrade | FA3AAE8EE80D4B3AB0D8283784D20659 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only man-cycle --force`.
