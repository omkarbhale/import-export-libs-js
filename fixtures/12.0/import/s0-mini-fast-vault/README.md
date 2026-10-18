# s0-mini-fast-vault

Fast and Vault both set. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, bFast, bVault (ticket 05).

## Exercises

Neither option changes what the engine does (bFast always reads as false; bVault is never read), apart from the parameters it logs.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | fast=true, vault=true | success (0) | 0 | 54 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 51B142EF020F44CFB64675FB9EC90B7F |
| 2 | PackageDefinition | B473056E25A047DA8AAFD22746EE5A3C |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 342C877B893B4B74B26BE45488490D3C |
| 5 | PackageElement | 29B0D72C97004CB296FE640AEB8FF42A |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 3CD61E645007490DAF8E734DAAE71DD2 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 8814C12AB5654348A2C832B6746BE9C2 |
| 10 | PackageElement | 92FEA11CEB0E43CF93720DCCC0539CD2 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 033732720D0240DBB8235EC93FFDD126 |
| 13 | PackageElement | 17CF7EAF04974FE5A480D7E22E6DB28D |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | DD45F77DBE7A42EB81CDCA59835C3E23 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 11639BA2CD1D4EEBB58B270D86EE1FF5 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 11639BA2CD1D4EEBB58B270D86EE1FF5 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | DD45F77DBE7A42EB81CDCA59835C3E23 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 17CF7EAF04974FE5A480D7E22E6DB28D |
| 6 | PackageGroup | 033732720D0240DBB8235EC93FFDD126 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 92FEA11CEB0E43CF93720DCCC0539CD2 |
| 9 | PackageGroup | 8814C12AB5654348A2C832B6746BE9C2 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 3CD61E645007490DAF8E734DAAE71DD2 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | 29B0D72C97004CB296FE640AEB8FF42A |
| 14 | PackageGroup | 342C877B893B4B74B26BE45488490D3C |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | B473056E25A047DA8AAFD22746EE5A3C |
| 17 | DatabaseUpgrade | 51B142EF020F44CFB64675FB9EC90B7F |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s0-mini-fast-vault --force`.
