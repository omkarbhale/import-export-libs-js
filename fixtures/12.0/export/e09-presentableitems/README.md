# e09-presentableitems

ItemType: polymorphic with a Morphae that is a package element (PresentableItems). Engine 12.0, export, recorded on dev (read-only). Catalogue: E09 (ticket 05).

## Exercises

Polymorphic, with Morphae 43C805F1681149FEABD670482A4A3470 that is itself a package element in tgv.configuration. Morphae wrapping.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.cui | ItemType | 58AECE23031E496FB04FFDEA6EDEF8A0 | PresentableItems |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 43 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 12.0 --only e09-presentableitems --force`.
