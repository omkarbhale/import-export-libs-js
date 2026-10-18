# e06-scopecachedependency-removesilently

ItemType: reference to an unknown package, RemoveSilently (ScopeCacheDependency). Engine 14.35, export, recorded on dev (read-only). Catalogue: E06 (ticket 05).

## Exercises

The same item as e06-scopecachedependency-donotremove: the references to the unknown package are removed with no warning.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.configurator | ItemType | A22EC0C6A1B940FB94654AB060F21459 | ScopeCacheDependency |

Engine options: `refToUnknownPacks` = `"RemoveSilently"`.

## Result

The export completes: host exit 0, 72 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only e06-scopecachedependency-removesilently --force`.
