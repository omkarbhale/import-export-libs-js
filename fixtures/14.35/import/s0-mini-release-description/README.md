# s0-mini-release-description

Release and Description both set. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, release/description both set (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | 2875E907D4BB4CE5962B673645E8139A |
| 2 | PackageDefinition | 169DD49C29F8477D95479A93FB173052 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 6FBB7668B4464E16954A8BF88B5233BD |
| 5 | PackageElement | EE2B5FAB4A7C436CAFE8DB2ED44E1410 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | C754A0027DBD455F8F1428C5498DAD90 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | DA7869651C8146398DC8C9908929F244 |
| 10 | PackageElement | 377010A25EBB40B181E53EC1E45E5A96 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 9883383EA5C74361A115756CD9BA1A1B |
| 13 | PackageElement | 7B4AEE6097744353A4C63DF11F1FCC2D |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | C17478803A044FF6872EB293542D5383 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 78B1FDD4DEB74BA28F1D5DAC9C314064 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 78B1FDD4DEB74BA28F1D5DAC9C314064 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | C17478803A044FF6872EB293542D5383 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 7B4AEE6097744353A4C63DF11F1FCC2D |
| 6 | PackageGroup | 9883383EA5C74361A115756CD9BA1A1B |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 377010A25EBB40B181E53EC1E45E5A96 |
| 9 | PackageGroup | DA7869651C8146398DC8C9908929F244 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | C754A0027DBD455F8F1428C5498DAD90 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | EE2B5FAB4A7C436CAFE8DB2ED44E1410 |
| 14 | PackageGroup | 6FBB7668B4464E16954A8BF88B5233BD |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 169DD49C29F8477D95479A93FB173052 |
| 17 | DatabaseUpgrade | 2875E907D4BB4CE5962B673645E8139A |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s0-mini-release-description --force`.
