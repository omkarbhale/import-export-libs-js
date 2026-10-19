# e44-xpropertydefinition

xPropertyDefinition: xp-es_batch_size (default-type branch). Engine 14.35, export, recorded on dev (read-only). Catalogue: E44 (ticket 05).

## Exercises

The default-type branch (sLevel plus the xp select). The xp-* values on items (ProcessXProperties, the set= attribute) cannot be exercised on dev; ticket 67 records them.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.es | xPropertyDefinition | 46C0E4FFB0A94E379DFAE0C69B32F3A0 | xp-es_batch_size |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 20 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only e44-xpropertydefinition --force`.
