# p1-order-admin-core-cui

Three packages, inserted admin, core, cui. Engine 14.0.7, export, recorded on dev (read-only). Catalogue: P1 (ticket 05).

## Exercises

The manifest's package order follows Hashtable enumeration, not insertion order. dependson is written with no referenced elements (dev has none).

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.admin | Item Report | 128C30A645F04E5380F8B4709A3BD1A1 | 128C30A645F04E5380F8B4709A3BD1A1 |
| 2 | com.aras.innovator.core | Form | F288A3345225407EACBC936191097BCD | Activity Template |
| 3 | com.aras.innovator.cui | ItemType | 58AECE23031E496FB04FFDEA6EDEF8A0 | PresentableItems |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 88 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --only p1-order-admin-core-cui --force`.
