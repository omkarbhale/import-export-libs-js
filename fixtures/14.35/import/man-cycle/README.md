# man-cycle

Two packages that depend on each other. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: manifest (tickets 05 and 75).

## Exercises

GetPackageNamesInImportOrder: a dependency cycle through the starting package gives the circular-dependency warning, and both packages are still imported.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-CYC1`, `LIBSJS-SCRATCH-CYC2` | defaults | success (0) | 0 | 42 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 12

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | E8290D8AED304F3CA0A4267DABC5C106 |
| 2 | PackageDefinition | 28EFEAAB677F479EA98F041FC19BDA59 |
| 3 | PackageDependsOn | 04DFB87EE20A447083A08970B1A8DE46 |
| 4 | Variable | 54B3935B1919800C6EA7B49DDBBABC3E |
| 5 | PackageGroup | 18F6096FD64E4A339924F47EF01DA152 |
| 6 | PackageElement | 0B569C43658A408DABEC9E668497C9CB |
| 7 | DatabaseUpgrade | D5ABA94DB42D4E5CB1C047E64B11CB4D |
| 8 | PackageDefinition | ECB25A6CBD21406A9C33A0317815D314 |
| 9 | PackageDependsOn | E5B9D0D048F84C318B3E0E4BC92826CA |
| 10 | Variable | D72B4CA103EA4FFB0DD7E8F4EC95995C |
| 11 | PackageGroup | D66AC664AC7249279431D1286C9B501B |
| 12 | PackageElement | 0039887299E14A25B3CC049A0C9F0F36 |

### Deleted by the cleanup: 12

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 0039887299E14A25B3CC049A0C9F0F36 |
| 2 | PackageGroup | D66AC664AC7249279431D1286C9B501B |
| 3 | Variable | D72B4CA103EA4FFB0DD7E8F4EC95995C |
| 4 | PackageDependsOn | E5B9D0D048F84C318B3E0E4BC92826CA |
| 5 | PackageDefinition | ECB25A6CBD21406A9C33A0317815D314 |
| 6 | DatabaseUpgrade | D5ABA94DB42D4E5CB1C047E64B11CB4D |
| 7 | PackageElement | 0B569C43658A408DABEC9E668497C9CB |
| 8 | PackageGroup | 18F6096FD64E4A339924F47EF01DA152 |
| 9 | Variable | 54B3935B1919800C6EA7B49DDBBABC3E |
| 10 | PackageDependsOn | 04DFB87EE20A447083A08970B1A8DE46 |
| 11 | PackageDefinition | 28EFEAAB677F479EA98F041FC19BDA59 |
| 12 | DatabaseUpgrade | E8290D8AED304F3CA0A4267DABC5C106 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only man-cycle --force`.
