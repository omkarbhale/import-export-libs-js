# s0-mini-verbose

Verbose console output. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, Verbose (tickets 05 and 75).

## Exercises

The engine's Verbose flag only changes its console lines (the host log); the requests are the same as in s0-mini-defaults.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | verbose=true | success (0) | 0 | 55 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 9B50F5D42D174DD79927996FF647FF39 |
| 2 | PackageDefinition | 9356FE5DDD4E4F36823B677329EA9241 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | E3A31B3E6FF747369123814E803C81C5 |
| 5 | PackageElement | 056CD9DD758B42CC844793434E8AD52A |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 268F1A419D5C4672B9772743F9579CA3 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 2861D2996A9F4013A0CAE3BA98ADB70C |
| 10 | PackageElement | 0CD91CF6D20C4048A2BFC5E5319A43D5 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | D302FA53737047A28F4048B9FF7E6002 |
| 13 | PackageElement | 9AC4AD8087734E408F1E176F45DF08A7 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 2AAB878AABAA4A4A8F2BC98EF5A23E74 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 4A87A0C894BE448287F3536A223255D6 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 4A87A0C894BE448287F3536A223255D6 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | 2AAB878AABAA4A4A8F2BC98EF5A23E74 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 9AC4AD8087734E408F1E176F45DF08A7 |
| 6 | PackageGroup | D302FA53737047A28F4048B9FF7E6002 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 0CD91CF6D20C4048A2BFC5E5319A43D5 |
| 9 | PackageGroup | 2861D2996A9F4013A0CAE3BA98ADB70C |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 268F1A419D5C4672B9772743F9579CA3 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | 056CD9DD758B42CC844793434E8AD52A |
| 14 | PackageGroup | E3A31B3E6FF747369123814E803C81C5 |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 9356FE5DDD4E4F36823B677329EA9241 |
| 17 | DatabaseUpgrade | 9B50F5D42D174DD79927996FF647FF39 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s0-mini-verbose --force`.
