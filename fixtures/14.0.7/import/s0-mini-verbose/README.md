# s0-mini-verbose

Verbose console output. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, Verbose (ticket 05).

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
| 1 | DatabaseUpgrade | 66E1E2D7653949F39759D13BA3A419C5 |
| 2 | PackageDefinition | 6F6CF8336B2F4E3F9C1427CEA3D9ADBB |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 2394A492A40845499AC8F2EAB9200B2B |
| 5 | PackageElement | 4D8A9E428C7B4F69980784D51DC257E8 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 77D2DEBB8E7A43518D122612F556E0B3 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 1E5A1400BDEB42B3AF2E625A66ED73F9 |
| 10 | PackageElement | C0F7B146149D457BB97B02321EF57EF6 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 3A2C469CEC4544F7B168DB946965D350 |
| 13 | PackageElement | C61B2A1F854D4249926E05FD7BD9D709 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | FEFE453A6EA84B01833C7BD0A0480B67 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | E090EF02D5B04C8C9B4F1C97DC3CA9DD |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | E090EF02D5B04C8C9B4F1C97DC3CA9DD |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | FEFE453A6EA84B01833C7BD0A0480B67 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | C61B2A1F854D4249926E05FD7BD9D709 |
| 6 | PackageGroup | 3A2C469CEC4544F7B168DB946965D350 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | C0F7B146149D457BB97B02321EF57EF6 |
| 9 | PackageGroup | 1E5A1400BDEB42B3AF2E625A66ED73F9 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 77D2DEBB8E7A43518D122612F556E0B3 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | 4D8A9E428C7B4F69980784D51DC257E8 |
| 14 | PackageGroup | 2394A492A40845499AC8F2EAB9200B2B |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 6F6CF8336B2F4E3F9C1427CEA3D9ADBB |
| 17 | DatabaseUpgrade | 66E1E2D7653949F39759D13BA3A419C5 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s0-mini-verbose --force`.
