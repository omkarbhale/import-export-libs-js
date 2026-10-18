# s0-mini-fast-vault

Fast and Vault both set. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, bFast, bVault (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | 9D222AAC89AF400696B0BA640918935F |
| 2 | PackageDefinition | 8060C7D09D854EA0B8E7A62E384FAB1B |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 1CC84BFFA1934DF38B10178BAAA12EFE |
| 5 | PackageElement | F1174E14400841B9B0E631ACFB54BF89 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 4F603FE1CCC34438BD9214C3B36A41C1 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 98DFFBAFB696471B909EC4077C588CF8 |
| 10 | PackageElement | C519E08B704742A2AAA01E2F21AA03E5 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | FA2A144EA3EC4E34920D2066F62E34AF |
| 13 | PackageElement | 18846C7A4B8442DEA4294FF7EE41A341 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 395AB36FB88A4EDEB318E4F01CD16449 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 7A73A1A0A92A47C7B8EF880176C75480 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 7A73A1A0A92A47C7B8EF880176C75480 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | 395AB36FB88A4EDEB318E4F01CD16449 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 18846C7A4B8442DEA4294FF7EE41A341 |
| 6 | PackageGroup | FA2A144EA3EC4E34920D2066F62E34AF |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | C519E08B704742A2AAA01E2F21AA03E5 |
| 9 | PackageGroup | 98DFFBAFB696471B909EC4077C588CF8 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 4F603FE1CCC34438BD9214C3B36A41C1 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | F1174E14400841B9B0E631ACFB54BF89 |
| 14 | PackageGroup | 1CC84BFFA1934DF38B10178BAAA12EFE |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 8060C7D09D854EA0B8E7A62E384FAB1B |
| 17 | DatabaseUpgrade | 9D222AAC89AF400696B0BA640918935F |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s0-mini-fast-vault --force`.
