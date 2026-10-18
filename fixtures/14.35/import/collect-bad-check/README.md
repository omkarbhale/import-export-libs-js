# collect-bad-check

An item whose reference check fails. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, collected errors (tickets 05 and 75).

## Exercises

The failed check is collected and the item is sent anyway (IMP-543); the server then refuses the item's Relationships, a second collected error, so the run returns 2.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHCHK` | collectErrors={"maxCount":5} | 2 errors collected (2) | 2 | 49 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 16

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 0D92C8C3B8FD45059B492ED5AC4FFA08 |
| 2 | PackageDefinition | 64E799CDEA684A6C956B8F515EE3CFF2 |
| 3 | Variable | 25E946F9C36B86F6130E2728ED0BC0C3 |
| 4 | PackageGroup | A38AB13B90E74E86878AE83CB28BF5E4 |
| 5 | PackageElement | 63B135D1058649E4BEAD41425B9FFB0B |
| 6 | Variable | 7516B30075F875318D294298AA8F564C |
| 7 | PackageElement | B1A0730C10084718ACAF74C273A1F8D2 |
| 8 | Variable | 8F1A31E32A66525D1B457156967AC9BB |
| 9 | PackageElement | 50145C4B67AE4C74BCA9D602BADF123A |
| 10 | PackageElement | 9FBC35E05ADF4A0B97F6EA7CBF84BBCB |
| 11 | Variable | 7D4D3C9C74D44266B00E0627216390DF |
| 12 | PackageElement | 83898B820B554C57BFB66EB49D56897B |
| 13 | Variable | E9E4F4F3CEFD3C5826F6FF612F2BFAF1 |
| 14 | PackageElement | B3A0F3D6B0A24E03A51E3E7B2C8B31EE |
| 15 | Variable | 28DB1C3DCF951DEF31AB93853D63EE8C |
| 16 | PackageElement | 2176A483B0424389B81AAFB8959FC340 |

### Deleted by the cleanup: 16

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 2176A483B0424389B81AAFB8959FC340 |
| 2 | Variable | 28DB1C3DCF951DEF31AB93853D63EE8C |
| 3 | PackageElement | B3A0F3D6B0A24E03A51E3E7B2C8B31EE |
| 4 | Variable | E9E4F4F3CEFD3C5826F6FF612F2BFAF1 |
| 5 | PackageElement | 83898B820B554C57BFB66EB49D56897B |
| 6 | Variable | 7D4D3C9C74D44266B00E0627216390DF |
| 7 | PackageElement | 9FBC35E05ADF4A0B97F6EA7CBF84BBCB |
| 8 | PackageElement | 50145C4B67AE4C74BCA9D602BADF123A |
| 9 | Variable | 8F1A31E32A66525D1B457156967AC9BB |
| 10 | PackageElement | B1A0730C10084718ACAF74C273A1F8D2 |
| 11 | Variable | 7516B30075F875318D294298AA8F564C |
| 12 | PackageElement | 63B135D1058649E4BEAD41425B9FFB0B |
| 13 | PackageGroup | A38AB13B90E74E86878AE83CB28BF5E4 |
| 14 | Variable | 25E946F9C36B86F6130E2728ED0BC0C3 |
| 15 | PackageDefinition | 64E799CDEA684A6C956B8F515EE3CFF2 |
| 16 | DatabaseUpgrade | 0D92C8C3B8FD45059B492ED5AC4FFA08 |

## Spec rules

IMP-542, IMP-543. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only collect-bad-check --force`.
