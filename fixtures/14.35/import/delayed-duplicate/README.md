# delayed-duplicate

The same delayed entry from two files. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, delayed (tickets 05 and 75).

## Exercises

AddDelayedAmlItem drops an entry equal to a queued one: an Identity with a Member to an Identity that a later file adds is in two files, and with merge on the second is an edit, so the check queues the same entry twice and 14.35 keeps one (14.0.7 ran both).

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-DELAYDUP` | merge=true | success (0) | 0 | 35 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 0D9BD486A8C543119E2E3B5EA2808A6E |
| 2 | PackageDefinition | 184C5F8D843A4B22BD13E7DBA2D52D06 |
| 3 | Identity | C66E97DEE5FF291814F9DC8C29F0C1D5 |
| 4 | PackageGroup | FF62E19EF6894904A470C4A021B3E918 |
| 5 | PackageElement | 529550F3198A4CDE94FF7A3A1E8EDE8D |
| 6 | Identity | AB5102AE39151A20E06BE8F50EDFCF1E |
| 7 | PackageElement | 5B1AF5E420834D8AAE3FEEAB4C564D27 |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 5B1AF5E420834D8AAE3FEEAB4C564D27 |
| 2 | PackageElement | 529550F3198A4CDE94FF7A3A1E8EDE8D |
| 3 | PackageGroup | FF62E19EF6894904A470C4A021B3E918 |
| 4 | Identity | C66E97DEE5FF291814F9DC8C29F0C1D5 |
| 5 | PackageDefinition | 184C5F8D843A4B22BD13E7DBA2D52D06 |
| 6 | DatabaseUpgrade | 0D9BD486A8C543119E2E3B5EA2808A6E |
| 7 | Identity | AB5102AE39151A20E06BE8F50EDFCF1E |

## Spec rules

IMP-251. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only delayed-duplicate --force`.
