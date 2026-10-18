# s0-mini-release-only

Release set, Description left null. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, release only (ticket 05).

## Exercises

A null Description is concatenated as an empty string into the DatabaseUpgrade AML.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | release="LIBSJS-SCRATCH-R1" | success (0) | 0 | 54 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 0D3C51CFD46947A8B0B02BB987C6E4CC |
| 2 | PackageDefinition | 0671BC5EA867490BB3713B3833FF3759 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | B8D937C53300490CB8C724196284A622 |
| 5 | PackageElement | F664B4F27B9F42DDAF9B7410A20A2239 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | D446AE5741124B74B9EB1530BA63D8CC |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | B43FAAF57AA5471490310F873A162FDF |
| 10 | PackageElement | 2BA31B4C9840443C871EB4FBF3DB8A8F |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 67374DD507444DE8AA4F7B28359DED94 |
| 13 | PackageElement | 8FF8E170401A4D87A4F382991744A89B |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | F1895B34013B4F6A9348AA6A46A0D23E |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | B829C882A029449996F1D8AF84FB5299 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | B829C882A029449996F1D8AF84FB5299 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | F1895B34013B4F6A9348AA6A46A0D23E |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 8FF8E170401A4D87A4F382991744A89B |
| 6 | PackageGroup | 67374DD507444DE8AA4F7B28359DED94 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 2BA31B4C9840443C871EB4FBF3DB8A8F |
| 9 | PackageGroup | B43FAAF57AA5471490310F873A162FDF |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | D446AE5741124B74B9EB1530BA63D8CC |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | F664B4F27B9F42DDAF9B7410A20A2239 |
| 14 | PackageGroup | B8D937C53300490CB8C724196284A622 |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 0671BC5EA867490BB3713B3833FF3759 |
| 17 | DatabaseUpgrade | 0D3C51CFD46947A8B0B02BB987C6E4CC |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s0-mini-release-only --force`.
