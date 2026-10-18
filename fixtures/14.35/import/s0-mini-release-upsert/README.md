# s0-mini-release-upsert

The same release run twice, then a new release. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, DatabaseUpgrade upsert (tickets 05 and 75).

## Exercises

WriteReleaseData's upsert per (release, name, type 1): the second run finds the row, checks its lock and edits it; a third run with another release adds a row and edits the is_latest flag of the others. Merge is on, so the re-imports are edits.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | release R1, description D1 | `LIBSJS-SCRATCH-MINI` | merge=true, release="LIBSJS-SCRATCH-R1", description="first" | success (0) | 0 | 58 |
| 2 | release R1, description D2 | `LIBSJS-SCRATCH-MINI` | merge=true, release="LIBSJS-SCRATCH-R1", description="second" | success (0) | 0 | 49 |
| 3 | release R2 | `LIBSJS-SCRATCH-MINI` | merge=true, release="LIBSJS-SCRATCH-R2", description="third" | success (0) | 0 | 48 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 41E427AB7EE8497DB350B80E9CF847BA |
| 2 | PackageDefinition | EAFBCD27F39649678FBA42425283C097 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 621CDCF27E8F42A7AC566FEF4C89B7DD |
| 5 | PackageElement | 4710DC7D83C140EA94834CBE8B6B5D32 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | FFDACAA3E6924B57A67F5131AA42A9CA |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 9B12253F11454B04BE9BEA050CFC765D |
| 10 | PackageElement | D0FAC1615F0148088A0D9B4601A3D8EB |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | D622C6877B5A4CB78EF7B39C34CDAB8A |
| 13 | PackageElement | 3A8837E47DB743FA8B9986DB81484FE7 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 7446C65627A0430EA0ECBC1D7743C64E |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 335EE81A43AF48E5B6EE60BAC458AA48 |

### Step 2: created 0

None.

### Step 3: created 1

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 594C3ECD75B547DEA27BC451A57F42C7 |

### Deleted by the cleanup: 18

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 594C3ECD75B547DEA27BC451A57F42C7 |
| 2 | PackageElement | 335EE81A43AF48E5B6EE60BAC458AA48 |
| 3 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 4 | PackageElement | 7446C65627A0430EA0ECBC1D7743C64E |
| 5 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 6 | PackageElement | 3A8837E47DB743FA8B9986DB81484FE7 |
| 7 | PackageGroup | D622C6877B5A4CB78EF7B39C34CDAB8A |
| 8 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 9 | PackageElement | D0FAC1615F0148088A0D9B4601A3D8EB |
| 10 | PackageGroup | 9B12253F11454B04BE9BEA050CFC765D |
| 11 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 12 | PackageElement | FFDACAA3E6924B57A67F5131AA42A9CA |
| 13 | List | E182B4D73FB907759D5E1BA11441412D |
| 14 | PackageElement | 4710DC7D83C140EA94834CBE8B6B5D32 |
| 15 | PackageGroup | 621CDCF27E8F42A7AC566FEF4C89B7DD |
| 16 | List | C6018EE6DD2187000216C39E55D07AAE |
| 17 | PackageDefinition | EAFBCD27F39649678FBA42425283C097 |
| 18 | DatabaseUpgrade | 41E427AB7EE8497DB350B80E9CF847BA |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s0-mini-release-upsert --force`.
