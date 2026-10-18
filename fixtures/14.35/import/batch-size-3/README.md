# batch-size-3

Seven items in batches of three. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, AML batch (tickets 05 and 75).

## Exercises

Items without Relationships are queued and sent in one <AML> when the queue holds three: seven items go out as three requests of 3, 3 and 1 items (the last by the forced flush after the final item), each followed by the registration of its items.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHOK` | amlBatch={"maxSize":3} | success (0) | 0 | 44 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 64873F14F83D45F9A2334BB3DCF949CB |
| 2 | PackageDefinition | 527F8FA20692459ABCA3E1C43C42CF36 |
| 3 | Variable | EC9C96329D100ED9B0BB4B7590302693 |
| 4 | Variable | C2A69A431F0840A38D2E9FC5A7C01ACC |
| 5 | Variable | A7C806DF304D74743EAB427379553808 |
| 6 | PackageGroup | 20BBA3B0281A4A91B52290D643D82FB2 |
| 7 | PackageElement | 2288310B90AD44D3B5CD4E22CC5CA18F |
| 8 | PackageElement | F5350E581B8E438B996AE7A0ABA0D4AC |
| 9 | PackageElement | 483669A8C5214124ACEBC5100D5E010A |
| 10 | Variable | 8888207582506FBFB67F6AB6A472A05B |
| 11 | Variable | 6D9FA121673E93157E5D86A494DA9D05 |
| 12 | Variable | 9B930A30C15A0D0A576D9AF813500285 |
| 13 | PackageElement | A94361CCA476470C8A8F8D515AFBCA67 |
| 14 | PackageElement | E6EE62943490437A83283FE11A9D347C |
| 15 | PackageElement | 6EE4736B12F146B5B5447D53BAF1AFAC |
| 16 | Variable | D6CA50C7258E75AC49C2FE5C51CAAF65 |
| 17 | PackageElement | BC68FAA57AF542FAAF93D0E3E98A2183 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | BC68FAA57AF542FAAF93D0E3E98A2183 |
| 2 | Variable | D6CA50C7258E75AC49C2FE5C51CAAF65 |
| 3 | PackageElement | 6EE4736B12F146B5B5447D53BAF1AFAC |
| 4 | PackageElement | E6EE62943490437A83283FE11A9D347C |
| 5 | PackageElement | A94361CCA476470C8A8F8D515AFBCA67 |
| 6 | Variable | 9B930A30C15A0D0A576D9AF813500285 |
| 7 | Variable | 6D9FA121673E93157E5D86A494DA9D05 |
| 8 | Variable | 8888207582506FBFB67F6AB6A472A05B |
| 9 | PackageElement | 483669A8C5214124ACEBC5100D5E010A |
| 10 | PackageElement | F5350E581B8E438B996AE7A0ABA0D4AC |
| 11 | PackageElement | 2288310B90AD44D3B5CD4E22CC5CA18F |
| 12 | PackageGroup | 20BBA3B0281A4A91B52290D643D82FB2 |
| 13 | Variable | A7C806DF304D74743EAB427379553808 |
| 14 | Variable | C2A69A431F0840A38D2E9FC5A7C01ACC |
| 15 | Variable | EC9C96329D100ED9B0BB4B7590302693 |
| 16 | PackageDefinition | 527F8FA20692459ABCA3E1C43C42CF36 |
| 17 | DatabaseUpgrade | 64873F14F83D45F9A2334BB3DCF949CB |

## Spec rules

IMP-511, IMP-513. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only batch-size-3 --force`.
