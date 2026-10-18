# s0-mini-verbose

Verbose console output. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, Verbose (ticket 05).

## Exercises

The engine's Verbose flag only changes its console lines (the host log); the requests are the same as in s0-mini-defaults.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | verbose=true | success (0) | 0 | 54 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 631DED36778C48849F0D49CD11A77EC6 |
| 2 | PackageDefinition | FF0CE6EBF70A4655AF7B328E632BB1A1 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 50211B24B1CE428590F2080CF2D2DF39 |
| 5 | PackageElement | 6E13F11919854404A665C5167F225937 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 132FDE375365460E92BA3AF3E593124C |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 2E576F89595A4E0BB3FB21B101EFC8F6 |
| 10 | PackageElement | CEBE813AE58A4A32967F6462BBA6D4D2 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 0026D78CB7844A40907474C20059056C |
| 13 | PackageElement | 2CC71CE82E374D5CA70C1B9F0DC98A7C |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | CAB71D8EC5724980BA679B2199CD5967 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 9CE8F12BF0EA4B708D26FC1A5F27A869 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 9CE8F12BF0EA4B708D26FC1A5F27A869 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | CAB71D8EC5724980BA679B2199CD5967 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 2CC71CE82E374D5CA70C1B9F0DC98A7C |
| 6 | PackageGroup | 0026D78CB7844A40907474C20059056C |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | CEBE813AE58A4A32967F6462BBA6D4D2 |
| 9 | PackageGroup | 2E576F89595A4E0BB3FB21B101EFC8F6 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 132FDE375365460E92BA3AF3E593124C |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | 6E13F11919854404A665C5167F225937 |
| 14 | PackageGroup | 50211B24B1CE428590F2080CF2D2DF39 |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | FF0CE6EBF70A4655AF7B328E632BB1A1 |
| 17 | DatabaseUpgrade | 631DED36778C48849F0D49CD11A77EC6 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s0-mini-verbose --force`.
