# p2-cui-default-referenced-items

Package whose dependencies are not on dev (cui_default), referenced items on. Engine 14.35, export, recorded on dev (read-only). Catalogue: P2, ReferencedItems (ticket 05).

## Exercises

The same item as p2-cui-default-missing-dependencies with bExportReferencedItems on: the FindReferencedElements faultcode-0 path. PackageReferencedElement has no rows on dev, so no referenced item is exported; the S2-backed case is ticket 67.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.cui_default | Method | 2BBAC312DCCB481CB0B16E651A73EE1E | CadToPdfMenuInitHandler |

Engine options: `exportReferencedItems` = `true`.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only p2-cui-default-referenced-items --force`.
