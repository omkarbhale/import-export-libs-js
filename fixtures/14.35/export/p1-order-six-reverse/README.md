# p1-order-six-reverse

Six packages, inserted conversion, es, history, cui, core, admin. Engine 14.35, export, recorded on dev (read-only). Catalogue: P1 (ticket 05).

## Exercises

The six packages of p1-order-six-forward in the reverse insertion order.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.conversion | Identity | 694C8B27E5D940DAA8BD336E45EC3A63 | Conversion Manager |
| 2 | com.aras.innovator.es | Variable | 18C614579E6D45468B90F5E9103AA153 | ES_SolrUrl |
| 3 | com.aras.innovator.history | Grid | 4B9FF34674E34677B877FC8F71B5CDBE | History_whereTemplateUsed |
| 4 | com.aras.innovator.cui | ItemType | 58AECE23031E496FB04FFDEA6EDEF8A0 | PresentableItems |
| 5 | com.aras.innovator.core | Form | F288A3345225407EACBC936191097BCD | Activity Template |
| 6 | com.aras.innovator.admin | Item Report | 128C30A645F04E5380F8B4709A3BD1A1 | 128C30A645F04E5380F8B4709A3BD1A1 |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 122 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only p1-order-six-reverse --force`.
