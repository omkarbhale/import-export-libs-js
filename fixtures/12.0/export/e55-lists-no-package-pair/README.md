# e55-lists-no-package-pair

Lists: two items in no package under one package (True/False, Yes/No). Engine 12.0, export, recorded on dev (read-only). Catalogue: E54, E55 (ticket 05).

## Exercises

The same pair of cases as e54-list-no-package, with a second item to show item ordering within one package.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | List | F8CDB96400C445879DA9E6FCA53889A2 | True/False |
| 2 | com.aras.innovator.core | List | 9FEC936F59F14FECAA3621F726FBAAF2 | Yes/No |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 12.0 --only e55-lists-no-package-pair --force`.
