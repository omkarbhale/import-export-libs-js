# s0-mini-release-upsert

The same release run twice, then a new release. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, DatabaseUpgrade upsert (ticket 05).

## Exercises

WriteReleaseData's upsert per (release, name, type 1): the second run finds the row, checks its lock and edits it; a third run with another release adds a row and edits the is_latest flag of the others. Merge is on, so the re-imports are edits.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | release R1, description D1 | `LIBSJS-SCRATCH-MINI` | merge=true, release="LIBSJS-SCRATCH-R1", description="first" | success (0) | 0 | 57 |
| 2 | release R1, description D2 | `LIBSJS-SCRATCH-MINI` | merge=true, release="LIBSJS-SCRATCH-R1", description="second" | success (0) | 0 | 48 |
| 3 | release R2 | `LIBSJS-SCRATCH-MINI` | merge=true, release="LIBSJS-SCRATCH-R2", description="third" | success (0) | 0 | 47 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | B963ED65D3E248CD8492B84CDCF1DA4B |
| 2 | PackageDefinition | 398587F5D6D84A9884A9502A1F7FDB72 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 09BB2C5BBEA84BFD9CC690539591EF23 |
| 5 | PackageElement | 08844F13C68E482E91D4667493DF6B56 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | E15EC6FCE5F64A45BD79327DE890DF4E |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 9E790935832745B8BA747CC93A3F641E |
| 10 | PackageElement | CCF0FF7D5B254CF1AC4C4C8438765461 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 74B0D56E60F145CAA7844B7727F62BD6 |
| 13 | PackageElement | E804436383A2421C971F5605D9BF49E1 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 62ADB82979304CE6B666AC61EA92AF80 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 9BFA2BAA1F2841D5BCA7281D5D717371 |

### Step 2: created 0

None.

### Step 3: created 1

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 4ADD68E92A3446E8B27F2B1C0FBA4CE9 |

### Deleted by the cleanup: 18

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 4ADD68E92A3446E8B27F2B1C0FBA4CE9 |
| 2 | PackageElement | 9BFA2BAA1F2841D5BCA7281D5D717371 |
| 3 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 4 | PackageElement | 62ADB82979304CE6B666AC61EA92AF80 |
| 5 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 6 | PackageElement | E804436383A2421C971F5605D9BF49E1 |
| 7 | PackageGroup | 74B0D56E60F145CAA7844B7727F62BD6 |
| 8 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 9 | PackageElement | CCF0FF7D5B254CF1AC4C4C8438765461 |
| 10 | PackageGroup | 9E790935832745B8BA747CC93A3F641E |
| 11 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 12 | PackageElement | E15EC6FCE5F64A45BD79327DE890DF4E |
| 13 | List | E182B4D73FB907759D5E1BA11441412D |
| 14 | PackageElement | 08844F13C68E482E91D4667493DF6B56 |
| 15 | PackageGroup | 09BB2C5BBEA84BFD9CC690539591EF23 |
| 16 | List | C6018EE6DD2187000216C39E55D07AAE |
| 17 | PackageDefinition | 398587F5D6D84A9884A9502A1F7FDB72 |
| 18 | DatabaseUpgrade | B963ED65D3E248CD8492B84CDCF1DA4B |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s0-mini-release-upsert --force`.
