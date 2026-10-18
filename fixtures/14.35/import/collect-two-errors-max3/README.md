# collect-two-errors-max3

Two failing items, maximum 3. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, collected errors (tickets 05 and 75).

## Exercises

Both errors are collected and the rest of the package is imported; the run returns 2.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHTWO` | collectErrors={"maxCount":3} | 2 errors collected (2) | 2 | 48 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 15

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 80B493B413AC4B6BA94DA020AD79CBBB |
| 2 | PackageDefinition | 902A5F0854C34745B43773A8780239E5 |
| 3 | Variable | 0AE9C503D4AB17164394AC775290C24D |
| 4 | PackageGroup | D35ADD9BE0AB413F87C9808D6337F5F7 |
| 5 | PackageElement | 223A663761CB4DB3B10BE65AACA7A3C9 |
| 6 | Variable | DBF7285965597B3A17EA1EB53532C982 |
| 7 | PackageElement | 605EB57C3618476B9C67AF9A37340044 |
| 8 | PackageElement | C47C0FBF34F647A1B9CD6FC5684042DC |
| 9 | Variable | 2EBC1C85DC9E9949D4E5CE2E2A6A7DD7 |
| 10 | PackageElement | 67CDFA4AFA4748B18629F1833E923296 |
| 11 | PackageElement | E5BCD11FF7DA4FBF835E0B9F6275E872 |
| 12 | Variable | 7D0D726B1BA2E2C2A22C3C46E68BD2A6 |
| 13 | PackageElement | 4AE54AC1E85043A4BEE6475F5B860806 |
| 14 | Variable | 2A9D18BD013A6E2D322557D868D05EDE |
| 15 | PackageElement | 9915F2573B3F40EAAEC1F117D60B8540 |

### Deleted by the cleanup: 15

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 9915F2573B3F40EAAEC1F117D60B8540 |
| 2 | Variable | 2A9D18BD013A6E2D322557D868D05EDE |
| 3 | PackageElement | 4AE54AC1E85043A4BEE6475F5B860806 |
| 4 | Variable | 7D0D726B1BA2E2C2A22C3C46E68BD2A6 |
| 5 | PackageElement | E5BCD11FF7DA4FBF835E0B9F6275E872 |
| 6 | PackageElement | 67CDFA4AFA4748B18629F1833E923296 |
| 7 | Variable | 2EBC1C85DC9E9949D4E5CE2E2A6A7DD7 |
| 8 | PackageElement | C47C0FBF34F647A1B9CD6FC5684042DC |
| 9 | PackageElement | 605EB57C3618476B9C67AF9A37340044 |
| 10 | Variable | DBF7285965597B3A17EA1EB53532C982 |
| 11 | PackageElement | 223A663761CB4DB3B10BE65AACA7A3C9 |
| 12 | PackageGroup | D35ADD9BE0AB413F87C9808D6337F5F7 |
| 13 | Variable | 0AE9C503D4AB17164394AC775290C24D |
| 14 | PackageDefinition | 902A5F0854C34745B43773A8780239E5 |
| 15 | DatabaseUpgrade | 80B493B413AC4B6BA94DA020AD79CBBB |

## Spec rules

IMP-541, IMP-546. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only collect-two-errors-max3 --force`.
