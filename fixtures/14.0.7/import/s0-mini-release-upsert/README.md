# s0-mini-release-upsert

The same release run twice, then a new release. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, DatabaseUpgrade upsert (ticket 05).

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
| 1 | DatabaseUpgrade | 3156D9ECFA324E998806C8D8DE692D67 |
| 2 | PackageDefinition | 0B2F9153256B40F3BEF5595E311B1FAC |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | C1D874B8BAF94842A37DFC57BF1017A3 |
| 5 | PackageElement | 49EA75B082FD45539C66C3E46C371EBA |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | E2D820789F5C435F872CA61DA0333DEA |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 72B879ABCEFE4DB5895C7B0E36D42656 |
| 10 | PackageElement | EA4A610540C0478FAA1665297C74C916 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 47A725D53BD140D09FF4AF91483F9B90 |
| 13 | PackageElement | EE59A33C365845D8ABC964DEE78B34BC |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 3F05428D23B64972BC0E111C3CCB0BD8 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | A27D574877004D24A1873E4BA4387283 |

### Step 2: created 0

None.

### Step 3: created 1

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 5C448C5248A4476B9F0275FED13F0495 |

### Deleted by the cleanup: 18

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 5C448C5248A4476B9F0275FED13F0495 |
| 2 | PackageElement | A27D574877004D24A1873E4BA4387283 |
| 3 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 4 | PackageElement | 3F05428D23B64972BC0E111C3CCB0BD8 |
| 5 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 6 | PackageElement | EE59A33C365845D8ABC964DEE78B34BC |
| 7 | PackageGroup | 47A725D53BD140D09FF4AF91483F9B90 |
| 8 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 9 | PackageElement | EA4A610540C0478FAA1665297C74C916 |
| 10 | PackageGroup | 72B879ABCEFE4DB5895C7B0E36D42656 |
| 11 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 12 | PackageElement | E2D820789F5C435F872CA61DA0333DEA |
| 13 | List | E182B4D73FB907759D5E1BA11441412D |
| 14 | PackageElement | 49EA75B082FD45539C66C3E46C371EBA |
| 15 | PackageGroup | C1D874B8BAF94842A37DFC57BF1017A3 |
| 16 | List | C6018EE6DD2187000216C39E55D07AAE |
| 17 | PackageDefinition | 0B2F9153256B40F3BEF5595E311B1FAC |
| 18 | DatabaseUpgrade | 3156D9ECFA324E998806C8D8DE692D67 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s0-mini-release-upsert --force`.
