# s0-mini-merge

The same package with merge on, when nothing exists yet. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, merge on (ticket 05).

## Exercises

Merge mode on a fresh server: the one-get-per-type idlist lookup that finds nothing, so every add stays an add.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | merge=true | success (0) | 0 | 57 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | F5B2D65F8FD74A7AA846A6E14980ABC4 |
| 2 | PackageDefinition | 546064F4153C4495BB84EDCCF8060090 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 4A7550F5BA684430AA72918D8B01F8E5 |
| 5 | PackageElement | 9F1DD0DC287449E9B7F55B3FFD8F3A43 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 863441A7501A4162960F412B181DC5BC |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | CA2E6FF5A4DF4E0ABFB8607D6EF8FF75 |
| 10 | PackageElement | 6449393B877448D09460DD9A00136774 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | E1B694A170604E5B82A5FD3B2D299524 |
| 13 | PackageElement | 2C70429A3A4B41908D718EC94432B681 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 3DC5BFFE25F54E72A815EF74E3B99CCC |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 372DF5187CDB4AD789D57913917755BC |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 372DF5187CDB4AD789D57913917755BC |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | 3DC5BFFE25F54E72A815EF74E3B99CCC |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 2C70429A3A4B41908D718EC94432B681 |
| 6 | PackageGroup | E1B694A170604E5B82A5FD3B2D299524 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 6449393B877448D09460DD9A00136774 |
| 9 | PackageGroup | CA2E6FF5A4DF4E0ABFB8607D6EF8FF75 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 863441A7501A4162960F412B181DC5BC |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | 9F1DD0DC287449E9B7F55B3FFD8F3A43 |
| 14 | PackageGroup | 4A7550F5BA684430AA72918D8B01F8E5 |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 546064F4153C4495BB84EDCCF8060090 |
| 17 | DatabaseUpgrade | F5B2D65F8FD74A7AA846A6E14980ABC4 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s0-mini-merge --force`.
