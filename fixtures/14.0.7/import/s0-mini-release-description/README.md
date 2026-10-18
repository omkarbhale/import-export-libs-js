# s0-mini-release-description

Release and Description both set. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, release/description both set (ticket 05).

## Exercises

The DatabaseUpgrade row carries target_release and description; the in-progress and success writes.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | release="LIBSJS-SCRATCH-R1", description="scratch import run" | success (0) | 0 | 55 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 68772A70882644C4AB8A6608BC48DE59 |
| 2 | PackageDefinition | E0DA846D93844FEDAB238C3602A02AC9 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 45C402E8D45A47B28D01E83714F5F008 |
| 5 | PackageElement | EE4187C944AA455DBCF28E51BE17BCA6 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 46C2C19425A04AAD88A73099B1916377 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | E047D8BC098746CF8AEAA7F4E415AFF7 |
| 10 | PackageElement | 865CEB86CC2A42AFB369155C3A42F334 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 2566F776ABBC48DC9598B670A454FC2A |
| 13 | PackageElement | BCD9C7EEA6BD4CBEBB60BFF62E74E6F7 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | E38B2A4FD0424F25A43DE7BB22BBE446 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | F4E764DB915D4FC6B0A725D439C3F6BA |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | F4E764DB915D4FC6B0A725D439C3F6BA |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | E38B2A4FD0424F25A43DE7BB22BBE446 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | BCD9C7EEA6BD4CBEBB60BFF62E74E6F7 |
| 6 | PackageGroup | 2566F776ABBC48DC9598B670A454FC2A |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 865CEB86CC2A42AFB369155C3A42F334 |
| 9 | PackageGroup | E047D8BC098746CF8AEAA7F4E415AFF7 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 46C2C19425A04AAD88A73099B1916377 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | EE4187C944AA455DBCF28E51BE17BCA6 |
| 14 | PackageGroup | 45C402E8D45A47B28D01E83714F5F008 |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | E0DA846D93844FEDAB238C3602A02AC9 |
| 17 | DatabaseUpgrade | 68772A70882644C4AB8A6608BC48DE59 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s0-mini-release-description --force`.
