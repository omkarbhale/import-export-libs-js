# batch-check-fails

The fourth item fails the engine's own check in batch mode. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, AML batch (tickets 05 and 75).

## Exercises

A failed check flushes the queue (the three waiting items go out in one <AML> and are registered), restores the item and checks it again; the second failure ends the package (IMP-518), and an empty <AML></AML> is sent too (IMP-515).

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHCHK` | amlBatch={"maxSize":3} | engine failure (1) | 1 | 34 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 9

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 8C98CEB260B94766BA8355FBD8736FE1 |
| 2 | PackageDefinition | 1D99A369053D414F8B2B2C95D03887AA |
| 3 | Variable | 25E946F9C36B86F6130E2728ED0BC0C3 |
| 4 | Variable | 7516B30075F875318D294298AA8F564C |
| 5 | Variable | 8F1A31E32A66525D1B457156967AC9BB |
| 6 | PackageGroup | C11764A65C46461BB6FA758FB7DCA246 |
| 7 | PackageElement | BB4ECF715A5948F4B319FD59DBD3B42A |
| 8 | PackageElement | 40AB7656148345E7A184DAE891521781 |
| 9 | PackageElement | 2A7391811572491A99E315A9A5D668B4 |

### Deleted by the cleanup: 9

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 2A7391811572491A99E315A9A5D668B4 |
| 2 | PackageElement | 40AB7656148345E7A184DAE891521781 |
| 3 | PackageElement | BB4ECF715A5948F4B319FD59DBD3B42A |
| 4 | PackageGroup | C11764A65C46461BB6FA758FB7DCA246 |
| 5 | Variable | 8F1A31E32A66525D1B457156967AC9BB |
| 6 | Variable | 7516B30075F875318D294298AA8F564C |
| 7 | Variable | 25E946F9C36B86F6130E2728ED0BC0C3 |
| 8 | PackageDefinition | 1D99A369053D414F8B2B2C95D03887AA |
| 9 | DatabaseUpgrade | 8C98CEB260B94766BA8355FBD8736FE1 |

## Spec rules

IMP-518. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only batch-check-fails --force`.
