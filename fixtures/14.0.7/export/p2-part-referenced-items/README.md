# p2-part-referenced-items

Package with dependencies, referenced items on (Part). Engine 14.0.7, export, recorded on dev (read-only). Catalogue: ReferencedItems (ticket 05).

## Exercises

bExportReferencedItems on for a package that depends on others. Compare with e02-part-itemtype, which has it off.

## Not covered here

Referenced elements (P5) need scratch package S2; ticket 67.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.solution.PLM | ItemType | 4F1AC04A2B484F3ABA4E20DB63808A88 | Part |

Engine options: `exportReferencedItems` = `true`.

## Result

The export completes: host exit 0, 97 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --only p2-part-referenced-items --force`.
