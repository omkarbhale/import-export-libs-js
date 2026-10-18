# e39-usermessage

UserMessage: levels 1 (effs_ItemTypeWithOtherName). Engine 14.0.7, export, recorded on dev (read-only). Catalogue: E39 (ticket 05).

## Exercises

Levels 1.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.effectivityservices | UserMessage | 04BBDF47D751496490568B771E204F4B | effs_ItemTypeWithOtherName |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 16 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --only e39-usermessage --force`.
