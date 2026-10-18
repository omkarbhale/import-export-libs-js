# s0-mini-release-only

Release set, Description left null. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, release only (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | 54ACDE193F42474781868CA1E3C0661C |
| 2 | PackageDefinition | 9912B57A7BA34297A6C32E2FB67853F5 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 9FD7F27A559147DBBA8F5420F30FFDC0 |
| 5 | PackageElement | 1B56F27106E140E3AD6370914DBE9C4B |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 319C4E92F8184E2C90996605E9B579DE |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 9655783557F2423E8B3952B77B8F153E |
| 10 | PackageElement | AC4F49EAB9474BA4857668BECB5975BA |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | A05791F734DC4CFAA52AABA2AB0CC1AF |
| 13 | PackageElement | 0B2F76BC40D84B36B22F27C565FC2DB3 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 9178DAFA431B45CABB44A73FF293BF88 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | BFC96AB5E7524E868589B8ECA43EC34F |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | BFC96AB5E7524E868589B8ECA43EC34F |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | 9178DAFA431B45CABB44A73FF293BF88 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 0B2F76BC40D84B36B22F27C565FC2DB3 |
| 6 | PackageGroup | A05791F734DC4CFAA52AABA2AB0CC1AF |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | AC4F49EAB9474BA4857668BECB5975BA |
| 9 | PackageGroup | 9655783557F2423E8B3952B77B8F153E |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 319C4E92F8184E2C90996605E9B579DE |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | 1B56F27106E140E3AD6370914DBE9C4B |
| 14 | PackageGroup | 9FD7F27A559147DBBA8F5420F30FFDC0 |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 9912B57A7BA34297A6C32E2FB67853F5 |
| 17 | DatabaseUpgrade | 54ACDE193F42474781868CA1E3C0661C |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s0-mini-release-only --force`.
