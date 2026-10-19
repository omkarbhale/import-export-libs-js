# x-cancel-after-5-run1

Cancel() pressed after the fifth status message, eighteen Lists (run 1 of 3). Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 cancel (ticket 57).

## Exercises

EXP-557: every worker looks at the flag when its iteration starts; those that see it write 'Export was canceled by user' and 'end of execution', and stop the loop. Items already running write their files with no success line (EXP-570). The cancel pair can appear more than once. The package loop ends and the run finishes normally.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | List | EAB29654E2CD4D30B376957788198B40 | Categories |
| 2 | com.aras.innovator.core | List | 51D8F6076D2E41AAA7D72D6F1B2184D1 | Configurable Grid Events |
| 3 | com.aras.innovator.core | List | 858DCAAD7FF94EDC969A1C3CFA57FA93 | Data Types |
| 4 | com.aras.innovator.core | List | 972269F295174215AEB67FB24262468D | DBUpgadeStatus |
| 5 | com.aras.innovator.core | List | F90729D18482477CBB61311F108A3379 | DBUpgradeType |
| 6 | com.aras.innovator.core | List | 6056059D6CCB4E65A6465E1C36D2055D | Field Length Unit |
| 7 | com.aras.innovator.core | List | AEE9D6567EDB45A4A50A669F5B385BD5 | Field Positioning |
| 8 | com.aras.innovator.core | List | DA63CDCCBB654870B291EBA9A5FFBBA9 | Field Types |
| 9 | com.aras.innovator.core | List | 4E7C6E40D16145D399C9E7D468E5E28E | Form Events |
| 10 | com.aras.innovator.core | List | 61C1853DD1A44AAF85A519A6FACF8203 | Form View Types |
| 11 | com.aras.innovator.core | List | 61E86B1378F64F67B729F9EA0FAB9BED | Grid Events |
| 12 | com.aras.innovator.core | List | B65DA95B86694210BBD6490C894C0DA0 | ItemType Implementation |
| 13 | com.aras.innovator.core | List | 9369CAC90D9942D5B9260EC502593BBE | Method Types |
| 14 | com.aras.innovator.core | List | 242AA7A17BC14718AA7302912CDE8910 | RelationshipType Hide In |
| 15 | com.aras.innovator.core | List | 5AD0FB60496647E2862A4323BBAD2F6C | Report Types |
| 16 | com.aras.innovator.core | List | 0F4DD6406FFB4CAFBB244FA7A4D06D0F | Server Events Version |
| 17 | com.aras.innovator.core | List | B6DD3DDC3BD9494185913C6CB274E141 | Server Events |
| 18 | com.aras.innovator.core | List | 80A7E494F7294BCF9AF46A4D980862E4 | SQL Item Execution Flags |

Engine options: `cancelAfterStatus` = `5`.

## Result

The export completes: host exit 0, 33 calls.

## Spec rules

EXP-518, EXP-557, EXP-570, EXP-572, EXP-558.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only x-cancel-after-5-run1 --force`.
