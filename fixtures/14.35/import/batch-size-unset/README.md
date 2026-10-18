# batch-size-unset

AML batch mode with AmlBatchMaxSize left at 0. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S9, 14.35, AML batch (tickets 05 and 75).

## Exercises

A maximum of 0 flushes after every item: one <AML> request per item, and then, because the last item was already sent by its own flush, the forced flush after the package sends an empty <AML></AML> (IMP-515). Aras accepts it and answers an empty Result, the answer ticket 55 left open.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-BATCHZERO` | amlBatch={"maxSize":0} | success (0) | 0 | 49 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 8F7EAA99396F4CBE94AB5438A0757CB3 |
| 2 | PackageDefinition | C986A555EEFC480BBA9E33B194188345 |
| 3 | Variable | BC338FE1C8279B43005D1C1FD78D4339 |
| 4 | PackageGroup | 6BCFD065ACD443489CE7B97636227B2D |
| 5 | PackageElement | 15578CDDDBAB4081915E5D2F7972EE03 |
| 6 | Variable | CBAEF42461D7229C4613953564F8FF5D |
| 7 | PackageElement | A5C0DD5A05F94611A84C816767901A03 |
| 8 | Variable | 6B5D9B8872F614B8765179AB8C5F040C |
| 9 | PackageElement | 6BC3DEEC0BBB4B61AFE5D20C5B94883C |
| 10 | Variable | 7E4454896BAA84B50B939DE15878D1CD |
| 11 | PackageElement | B4D1E62699084240B6AB7B0F16784955 |
| 12 | Variable | A91B57844F07C4334FC37BD97AC1A4CD |
| 13 | PackageElement | E1DC6FDAD9B64302A6C9D867F7AF20F6 |
| 14 | Variable | BEC8821E6D8D7DF50F9B39AA58ECE107 |
| 15 | PackageElement | 36677D8F22C54AD6BEC8D6D92ECE7C9C |
| 16 | Variable | 808014C3FB4D5E556A1431E5813A8572 |
| 17 | PackageElement | 05E42060833A472D946FCE006941EF21 |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 05E42060833A472D946FCE006941EF21 |
| 2 | Variable | 808014C3FB4D5E556A1431E5813A8572 |
| 3 | PackageElement | 36677D8F22C54AD6BEC8D6D92ECE7C9C |
| 4 | Variable | BEC8821E6D8D7DF50F9B39AA58ECE107 |
| 5 | PackageElement | E1DC6FDAD9B64302A6C9D867F7AF20F6 |
| 6 | Variable | A91B57844F07C4334FC37BD97AC1A4CD |
| 7 | PackageElement | B4D1E62699084240B6AB7B0F16784955 |
| 8 | Variable | 7E4454896BAA84B50B939DE15878D1CD |
| 9 | PackageElement | 6BC3DEEC0BBB4B61AFE5D20C5B94883C |
| 10 | Variable | 6B5D9B8872F614B8765179AB8C5F040C |
| 11 | PackageElement | A5C0DD5A05F94611A84C816767901A03 |
| 12 | Variable | CBAEF42461D7229C4613953564F8FF5D |
| 13 | PackageElement | 15578CDDDBAB4081915E5D2F7972EE03 |
| 14 | PackageGroup | 6BCFD065ACD443489CE7B97636227B2D |
| 15 | Variable | BC338FE1C8279B43005D1C1FD78D4339 |
| 16 | PackageDefinition | C986A555EEFC480BBA9E33B194188345 |
| 17 | DatabaseUpgrade | 8F7EAA99396F4CBE94AB5438A0757CB3 |

## Spec rules

IMP-511, IMP-515. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only batch-size-unset --force`.
