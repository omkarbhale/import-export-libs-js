# collect-two-errors-max2

Two failing items, maximum 2. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, collected errors (tickets 05 and 75).

## Exercises

The second error reaches the maximum (the test is >=) and ends the package; the items after the second failure are never read.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHTWO` | collectErrors={"maxCount":2} | 2 errors collected (2) | 2 | 38 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 10

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | CFF19B01DAC74F408A47EC7449797F76 |
| 2 | PackageDefinition | 60CA36A3515C476F891FC92C9F0FA544 |
| 3 | Variable | 0AE9C503D4AB17164394AC775290C24D |
| 4 | PackageGroup | 888E0BF53EB140FEA5A159FF471038B8 |
| 5 | PackageElement | BF359910FAFA40DABFB42C12C316F876 |
| 6 | Variable | DBF7285965597B3A17EA1EB53532C982 |
| 7 | PackageElement | 4A1CDBA6705C465A808B17A8F7F109D4 |
| 8 | PackageElement | A707C9986FFD41A6B02776EE0C3D1FED |
| 9 | Variable | 2EBC1C85DC9E9949D4E5CE2E2A6A7DD7 |
| 10 | PackageElement | 381249280D884FCAAC8D6E03480B36C6 |

### Deleted by the cleanup: 10

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 381249280D884FCAAC8D6E03480B36C6 |
| 2 | Variable | 2EBC1C85DC9E9949D4E5CE2E2A6A7DD7 |
| 3 | PackageElement | A707C9986FFD41A6B02776EE0C3D1FED |
| 4 | PackageElement | 4A1CDBA6705C465A808B17A8F7F109D4 |
| 5 | Variable | DBF7285965597B3A17EA1EB53532C982 |
| 6 | PackageElement | BF359910FAFA40DABFB42C12C316F876 |
| 7 | PackageGroup | 888E0BF53EB140FEA5A159FF471038B8 |
| 8 | Variable | 0AE9C503D4AB17164394AC775290C24D |
| 9 | PackageDefinition | 60CA36A3515C476F891FC92C9F0FA544 |
| 10 | DatabaseUpgrade | CFF19B01DAC74F408A47EC7449797F76 |

## Spec rules

IMP-541. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only collect-two-errors-max2 --force`.
