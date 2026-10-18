# x-abort-middle-no

A failing List between healthy ones, ErrorQuestion answered no. Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 abort (ticket 57).

## Exercises

EXP-555: the failed item sends 'Error of exporting Item', the fault block and the abort question, then stops the whole export. Items already running finish and write their files, items not started never run, and the log holds none of their success lines (EXP-570). Compare e40-workflow-promotion-error-no, where 14.0.7 aborts the package only.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | List | EAB29654E2CD4D30B376957788198B40 | Categories |
| 2 | com.aras.innovator.core | List | 51D8F6076D2E41AAA7D72D6F1B2184D1 | Configurable Grid Events |
| 3 | com.aras.innovator.core | List | 858DCAAD7FF94EDC969A1C3CFA57FA93 | Data Types |
| 4 | com.aras.innovator.core | List | 972269F295174215AEB67FB24262468D | DBUpgadeStatus |
| 5 | com.aras.innovator.core | List | 00000000000000000000000000000002 | Nope Two |
| 6 | com.aras.innovator.core | List | F90729D18482477CBB61311F108A3379 | DBUpgradeType |
| 7 | com.aras.innovator.core | List | 6056059D6CCB4E65A6465E1C36D2055D | Field Length Unit |
| 8 | com.aras.innovator.core | List | AEE9D6567EDB45A4A50A669F5B385BD5 | Field Positioning |
| 9 | com.aras.innovator.core | List | DA63CDCCBB654870B291EBA9A5FFBBA9 | Field Types |

Engine options: `errorQuestionAnswer` = `"no"`.

## Result

The export completes: host exit 0, 26 calls.

## Spec rules

EXP-516, EXP-555, EXP-570, EXP-571, EXP-572, EXP-558.

## Files

| File | What |
|---|---|
| `case.json` | this case's input and result, machine-readable |
| `run.json` | the oracle's run record: toolset identity, parameters, host info |
| `transcript.jsonl` | every call the engine made, in order. A response of 64 KB or more is in `../_blobs/<sha256>.xml`, named by `responseBlob`; `oracle/src/transcript.ts` reads it back |
| `messages.jsonl` | the engine's messages, by channel |
| `engine.log` | the engine's own log |
| `host.log` | the host's console output |
| `output/` | the export folder, byte for byte |

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only x-abort-middle-no --force`.
