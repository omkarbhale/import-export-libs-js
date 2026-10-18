# s0-mini-merge

The same package with merge on, when nothing exists yet. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, merge on (ticket 05).

## Exercises

Merge mode on a fresh server: the one-get-per-type idlist lookup that finds nothing, so every add stays an add.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | merge=true | success (0) | 0 | 58 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 7FA4CD4B8C3846D7916D14CED6CF6D18 |
| 2 | PackageDefinition | 81CB4ACDCAB2431CA84FD223CDADD1D5 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | C053372C4F2D4735BFC9BAC08E1E9644 |
| 5 | PackageElement | D0DFF46BE98546EB85A078D016AF2732 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | AB3CB4649C45472AAEE3EB026912D2F1 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 3B30632EEDDB4986AFA57B47E45FD350 |
| 10 | PackageElement | 82159CE9BD9445E08E6885831002F2D3 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 2304EC52CEF944329826E620DC09CDA9 |
| 13 | PackageElement | 3C4C10B5AF494A439118793CF104B2B3 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | A943E2141C564ADAB39DFF52F6CED0CF |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 08CBF551CC594A0E8363E58C03456160 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 08CBF551CC594A0E8363E58C03456160 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | A943E2141C564ADAB39DFF52F6CED0CF |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 3C4C10B5AF494A439118793CF104B2B3 |
| 6 | PackageGroup | 2304EC52CEF944329826E620DC09CDA9 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 82159CE9BD9445E08E6885831002F2D3 |
| 9 | PackageGroup | 3B30632EEDDB4986AFA57B47E45FD350 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | AB3CB4649C45472AAEE3EB026912D2F1 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | D0DFF46BE98546EB85A078D016AF2732 |
| 14 | PackageGroup | C053372C4F2D4735BFC9BAC08E1E9644 |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 81CB4ACDCAB2431CA84FD223CDADD1D5 |
| 17 | DatabaseUpgrade | 7FA4CD4B8C3846D7916D14CED6CF6D18 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s0-mini-merge --force`.
