# e10-activity-assignment

RelationshipType: dependency level 0 (Activity Assignment). Engine 14.35, export, recorded on dev (read-only). Catalogue: E10 (ticket 05).

## Exercises

dependencyLevel 0: the source Activity is not a relationship. ProcessRelationshipType; getDepencyLevel stops at once.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | RelationshipType | C92F589A534241B09EBD4FE0ECD903E2 | Activity Assignment |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 60 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only e10-activity-assignment --force`.
