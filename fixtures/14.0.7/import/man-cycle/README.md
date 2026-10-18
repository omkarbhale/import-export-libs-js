# man-cycle

Two packages that depend on each other. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: manifest (ticket 05).

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
| 1 | DatabaseUpgrade | D20BC748D1FD407CA290D4561A6BD506 |
| 2 | PackageDefinition | F62E23E58EBA4EB395B0B5CEA41CD9BE |
| 3 | PackageDependsOn | 26B2D5939183481780CC496A8DC43AB6 |
| 4 | Variable | 54B3935B1919800C6EA7B49DDBBABC3E |
| 5 | PackageGroup | 520D8F11366742BF884F198120F824E7 |
| 6 | PackageElement | 20071B79BB9F46BBA9CFCCD10EA7AB0A |
| 7 | DatabaseUpgrade | 537E8BE2CA0C4F3D9B5B57BA791EF906 |
| 8 | PackageDefinition | ECCB5B2A49F34EDCBE1DBEC953468910 |
| 9 | PackageDependsOn | C8DE251ABCE74C27A93B37CE787D69FE |
| 10 | Variable | D72B4CA103EA4FFB0DD7E8F4EC95995C |
| 11 | PackageGroup | 0A108089D8B3491C870913EFD9374919 |
| 12 | PackageElement | 118C780B57F5400B88D5332694CDC05E |

### Deleted by the cleanup: 12

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 118C780B57F5400B88D5332694CDC05E |
| 2 | PackageGroup | 0A108089D8B3491C870913EFD9374919 |
| 3 | Variable | D72B4CA103EA4FFB0DD7E8F4EC95995C |
| 4 | PackageDependsOn | C8DE251ABCE74C27A93B37CE787D69FE |
| 5 | PackageDefinition | ECCB5B2A49F34EDCBE1DBEC953468910 |
| 6 | DatabaseUpgrade | 537E8BE2CA0C4F3D9B5B57BA791EF906 |
| 7 | PackageElement | 20071B79BB9F46BBA9CFCCD10EA7AB0A |
| 8 | PackageGroup | 520D8F11366742BF884F198120F824E7 |
| 9 | Variable | 54B3935B1919800C6EA7B49DDBBABC3E |
| 10 | PackageDependsOn | 26B2D5939183481780CC496A8DC43AB6 |
| 11 | PackageDefinition | F62E23E58EBA4EB395B0B5CEA41CD9BE |
| 12 | DatabaseUpgrade | D20BC748D1FD407CA290D4561A6BD506 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only man-cycle --force`.
