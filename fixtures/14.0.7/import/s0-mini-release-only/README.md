# s0-mini-release-only

Release set, Description left null. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, release only (ticket 05).

## Exercises

A null Description is concatenated as an empty string into the DatabaseUpgrade AML.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | release="LIBSJS-SCRATCH-R1" | success (0) | 0 | 55 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 712734155B944943B9FD1A1F0EEC0681 |
| 2 | PackageDefinition | 890E88B7E5284341B16BCD6C35FE584B |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | B25DD82F21F1404382AB535F8A2BEFDC |
| 5 | PackageElement | E917F32D16C140B58639C7E90B785BDE |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | A1209BE34D554E658764D909371BB131 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | C09A8BBA4ED646F69D2776B497C7283A |
| 10 | PackageElement | 141E328A12FA4FDD91E189287E4559B4 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 6131E003C5FE468DAF4FEC428FF35CDD |
| 13 | PackageElement | E32EBD1209FD48F2B4D172FF74927A8D |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | A00D83411D664DB4B44AC6C236BF2D9B |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 152323FF61D14EC0A2168CBCC74878F3 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 152323FF61D14EC0A2168CBCC74878F3 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | A00D83411D664DB4B44AC6C236BF2D9B |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | E32EBD1209FD48F2B4D172FF74927A8D |
| 6 | PackageGroup | 6131E003C5FE468DAF4FEC428FF35CDD |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 141E328A12FA4FDD91E189287E4559B4 |
| 9 | PackageGroup | C09A8BBA4ED646F69D2776B497C7283A |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | A1209BE34D554E658764D909371BB131 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | E917F32D16C140B58639C7E90B785BDE |
| 14 | PackageGroup | B25DD82F21F1404382AB535F8A2BEFDC |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 890E88B7E5284341B16BCD6C35FE584B |
| 17 | DatabaseUpgrade | 712734155B944943B9FD1A1F0EEC0681 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s0-mini-release-only --force`.
