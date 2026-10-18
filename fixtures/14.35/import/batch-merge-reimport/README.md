# batch-merge-reimport

A batch re-imported with merge on. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, AML batch (tickets 05 and 75).

## Exercises

The merge lookups of the items are sent at the flush, one group per item, before the <AML>; the existing adds are edits.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | fresh import | `LIBSJS-SCRATCH-BATCHMRG` | amlBatch={"maxSize":3} | success (0) | 0 | 44 |
| 2 | re-import, merge on | `LIBSJS-SCRATCH-BATCHMRG` | merge=true, amlBatch={"maxSize":3} | success (0) | 0 | 36 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 28C1CC771C5A4E738A5A1D68CCEADA48 |
| 2 | PackageDefinition | DBF4D98E6DCB46C58656DC00BCE4DB3E |
| 3 | Variable | 3CBCC0088FA01EA7B81E9B3D5CAB4628 |
| 4 | Variable | 6874C19EE6BF0B29C932D2FF916ED06F |
| 5 | Variable | 6ACE2530B07680616DA32F61AFD138A3 |
| 6 | PackageGroup | CB1BB75E59414CF784B187AAF042D479 |
| 7 | PackageElement | 77B8595757464F608BC62475E1CA0791 |
| 8 | PackageElement | F5DCD99EB02742FD93C36F17DAAF2940 |
| 9 | PackageElement | 1A1537573E2F460C81F6A474380F621D |
| 10 | Variable | F6CC6DAA6A0BBBC7725E163B9211B705 |
| 11 | Variable | 978AB4A3FBAAE7A93BE6382C14ED2C34 |
| 12 | Variable | 5454BE79B5C93700A44AE8BF94AD0024 |
| 13 | PackageElement | B93DFFC468924410B6DE93D6DF86255F |
| 14 | PackageElement | 585BA58CDA694C118EDD5462DB50226A |
| 15 | PackageElement | CA9C848247854DFA9B31A1F9726DF814 |
| 16 | Variable | 1B939EE928FA82E8FEF5985AFEB2D007 |
| 17 | PackageElement | A0B7F8D285904CD88EBB90F8924694CE |

### Step 2: created 0

None.

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | A0B7F8D285904CD88EBB90F8924694CE |
| 2 | Variable | 1B939EE928FA82E8FEF5985AFEB2D007 |
| 3 | PackageElement | CA9C848247854DFA9B31A1F9726DF814 |
| 4 | PackageElement | 585BA58CDA694C118EDD5462DB50226A |
| 5 | PackageElement | B93DFFC468924410B6DE93D6DF86255F |
| 6 | Variable | 5454BE79B5C93700A44AE8BF94AD0024 |
| 7 | Variable | 978AB4A3FBAAE7A93BE6382C14ED2C34 |
| 8 | Variable | F6CC6DAA6A0BBBC7725E163B9211B705 |
| 9 | PackageElement | 1A1537573E2F460C81F6A474380F621D |
| 10 | PackageElement | F5DCD99EB02742FD93C36F17DAAF2940 |
| 11 | PackageElement | 77B8595757464F608BC62475E1CA0791 |
| 12 | PackageGroup | CB1BB75E59414CF784B187AAF042D479 |
| 13 | Variable | 6ACE2530B07680616DA32F61AFD138A3 |
| 14 | Variable | 6874C19EE6BF0B29C932D2FF916ED06F |
| 15 | Variable | 3CBCC0088FA01EA7B81E9B3D5CAB4628 |
| 16 | PackageDefinition | DBF4D98E6DCB46C58656DC00BCE4DB3E |
| 17 | DatabaseUpgrade | 28C1CC771C5A4E738A5A1D68CCEADA48 |

## Spec rules

IMP-512. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only batch-merge-reimport --force`.
