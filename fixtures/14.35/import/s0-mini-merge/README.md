# s0-mini-merge

The same package with merge on, when nothing exists yet. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, merge on (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | 0E86E509ACD146AFBC416DFE5EC1449D |
| 2 | PackageDefinition | 2AEE9EFBF5954ACAAAB2EC8F293AF473 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 7A4BA87493124486B863F389034B3D1B |
| 5 | PackageElement | A5A0D29D5C4041E099D44469B1EEB7D0 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | BEF98E825F89446391C881989B459CF5 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 06E9ED110E0F4327A632388F0B00A338 |
| 10 | PackageElement | F39460D207EB4A9D823A0C502D78165B |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 32DB6EF5F8D240719B17EBCD9B027865 |
| 13 | PackageElement | F7EA4ED4E255471998F3ED42FDE2BEB3 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 2E80F089A12943CBBB29A3D65B3C99D2 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 54FD9E11424B4DA98D4FE9DEEED0847A |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 54FD9E11424B4DA98D4FE9DEEED0847A |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | 2E80F089A12943CBBB29A3D65B3C99D2 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | F7EA4ED4E255471998F3ED42FDE2BEB3 |
| 6 | PackageGroup | 32DB6EF5F8D240719B17EBCD9B027865 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | F39460D207EB4A9D823A0C502D78165B |
| 9 | PackageGroup | 06E9ED110E0F4327A632388F0B00A338 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | BEF98E825F89446391C881989B459CF5 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | A5A0D29D5C4041E099D44469B1EEB7D0 |
| 14 | PackageGroup | 7A4BA87493124486B863F389034B3D1B |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 2AEE9EFBF5954ACAAAB2EC8F293AF473 |
| 17 | DatabaseUpgrade | 0E86E509ACD146AFBC416DFE5EC1449D |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s0-mini-merge --force`.
