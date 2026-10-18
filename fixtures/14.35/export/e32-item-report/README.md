# e32-item-report

Item Report: levels 0, related_expand 0, element name = id. Engine 14.35, export, recorded on dev (read-only). Catalogue: E32 (ticket 05).

## Exercises

Levels 0 and related_expand=0 (14.35 drops levels). The package element's name is the id, so the case passes the id as the keyed name.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.admin | Item Report | 128C30A645F04E5380F8B4709A3BD1A1 | 128C30A645F04E5380F8B4709A3BD1A1 |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 13 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only e32-item-report --force`.
