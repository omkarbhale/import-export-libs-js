# x-par-two-packages-run3

Eight Lists and five Variables in two packages (run 3 of 3). Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 parallel (ticket 57).

## Exercises

Packages are still exported one after another (EXP-551), each with its own parallel loop, so the package headers and 'start of execution' lines stay in order while the lines between them are a set.

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
| 9 | com.aras.innovator.solution.PLM | Variable | 968471EC23804034A3B7B2B5C78601E7 | CAD Angular Units |
| 10 | com.aras.innovator.solution.PLM | Variable | A41D0BAAF61B4427BAE59D3879DB5FF6 | CAD Length Units |
| 11 | com.aras.innovator.solution.PLM | Variable | ED8C1F0C5721435A9CA1D8FADB30A168 | CAD Transformation Matrix Format |
| 12 | com.aras.innovator.solution.PLM | Variable | 049573909D3D49FD81E0C2AEA1CDD62C | PE_Impact_Matrix_expand |
| 13 | com.aras.innovator.solution.PLM | Variable | 679408C1EFE845AFA526D3897B42DBFF | Product Engineering |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 37 calls.

## Spec rules

EXP-551, EXP-552, EXP-553, EXP-554, EXP-558, EXP-508.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only x-par-two-packages-run3 --force`.
