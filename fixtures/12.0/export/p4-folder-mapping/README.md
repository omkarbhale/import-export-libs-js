# p4-folder-mapping

Standard and non-standard package folder mapping. Engine 12.0, export, recorded on dev (read-only). Catalogue: P4 (ticket 05).

## Exercises

CreateOutputDir rules: com.aras.innovator.core (com\aras\innovator\core), com.aras.defaults.filerepresentations, com.aras.innovator.solution.PLM (PLM\Import) and com.steepgraph.pagex (pagex\Import). No last-segment collision exists on dev; the wipe-collision case needs scratch S8 (ticket 67).

## Not covered here

The last-segment folder collision needs scratch package S8; ticket 67.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | Form | F288A3345225407EACBC936191097BCD | Activity Template |
| 2 | com.aras.defaults.filerepresentations | fr_RepresentationType | 16039DDADB33459A9F6B344B9DD8C735 | CATIA Assembly SCS Representation |
| 3 | com.aras.innovator.solution.PLM | Variable | 968471EC23804034A3B7B2B5C78601E7 | CAD Angular Units |
| 4 | com.steepgraph.pagex | CommandBarButton | 0DD3CB20F7224E3FB3D5CA87E100A04A | com.steepgraph.pagex.builder.button |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 62 calls.

## Spec rules

None yet. The spec or build ticket that pins this case adds its rule ids here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 12.0 --only p4-folder-mapping --force`.
