# s0-mini-defaults

Six small items, every option at the engine default. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, release/description unset (ticket 05).

## Exercises

Package registration (PackageDefinition, one PackageGroup per type label, one PackageElement per item named by its file), the DatabaseUpgrade row (in progress, then success) with a null Release and Description, the per-type definition checks and their cache, and the plain add path with merge off.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | defaults | success (0) | 0 | 54 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 1A8E3838F7A946AF95101523ACB2A6E0 |
| 2 | PackageDefinition | AD2170FC24FA43DBA103BE81A331F5F7 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 1B4770DE9F19419F9ABC4F7AEA0D612E |
| 5 | PackageElement | 46BCBC5D5C0647508CD37D2A4204AC54 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 6101521AF17E41D6A1886E09D09BC027 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | B73E7F45C09245249460ED5869EB2586 |
| 10 | PackageElement | 496FDAA50A9840E28113A0C72665ABA5 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | B979BBB816104B2FA6D61E729A750372 |
| 13 | PackageElement | BA14A85BE3E44684BAE69F8C83398981 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | DFB77A6AF6DB4900834FB475F70E27B2 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | CDEF6611230D4A0BA91A414092237854 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | CDEF6611230D4A0BA91A414092237854 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | DFB77A6AF6DB4900834FB475F70E27B2 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | BA14A85BE3E44684BAE69F8C83398981 |
| 6 | PackageGroup | B979BBB816104B2FA6D61E729A750372 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 496FDAA50A9840E28113A0C72665ABA5 |
| 9 | PackageGroup | B73E7F45C09245249460ED5869EB2586 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 6101521AF17E41D6A1886E09D09BC027 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | 46BCBC5D5C0647508CD37D2A4204AC54 |
| 14 | PackageGroup | 1B4770DE9F19419F9ABC4F7AEA0D612E |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | AD2170FC24FA43DBA103BE81A331F5F7 |
| 17 | DatabaseUpgrade | 1A8E3838F7A946AF95101523ACB2A6E0 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s0-mini-defaults --force`.
