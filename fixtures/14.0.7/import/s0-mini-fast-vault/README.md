# s0-mini-fast-vault

Fast and Vault both set. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, bFast, bVault (ticket 05).

## Exercises

Neither option changes what the engine does (bFast always reads as false; bVault is never read), apart from the parameters it logs.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | fast=true, vault=true | success (0) | 0 | 55 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 585672FD922641C190862E0244857A3C |
| 2 | PackageDefinition | 7567B40DE6844394B94D18466125D7E7 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 575236A585C346B9AE38AF89D83E0B17 |
| 5 | PackageElement | A9A5A56E1F4045079FEADCCDDD85E3BD |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 026A40758B6B4CCFB559E05A98194D33 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 9886AF0879744536BEAA52B852482E20 |
| 10 | PackageElement | E5E1954FB1264423B64502272341024F |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 470FB4BBA7674FE0B267088B6A88A175 |
| 13 | PackageElement | 9D689746828843699A4F6D8A69277CF0 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 3D6CC7BFFCE34FCBB480D499070B5F8F |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 85288686F83C4079942E2EE792BDBFD4 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 85288686F83C4079942E2EE792BDBFD4 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | 3D6CC7BFFCE34FCBB480D499070B5F8F |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 9D689746828843699A4F6D8A69277CF0 |
| 6 | PackageGroup | 470FB4BBA7674FE0B267088B6A88A175 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | E5E1954FB1264423B64502272341024F |
| 9 | PackageGroup | 9886AF0879744536BEAA52B852482E20 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 026A40758B6B4CCFB559E05A98194D33 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | A9A5A56E1F4045079FEADCCDDD85E3BD |
| 14 | PackageGroup | 575236A585C346B9AE38AF89D83E0B17 |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 7567B40DE6844394B94D18466125D7E7 |
| 17 | DatabaseUpgrade | 585672FD922641C190862E0244857A3C |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s0-mini-fast-vault --force`.
