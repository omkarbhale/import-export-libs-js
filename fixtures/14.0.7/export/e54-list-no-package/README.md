# e54-list-no-package

List: item in no package, keyed name that is not a file name (True/False). Engine 14.0.7, export, recorded on dev (read-only). Catalogue: E54 (ticket 05).

## Exercises

The keyed name has '/', so the file is named by the id. The item is in no package; the engine accepts it under any existing package key (core here). The CLI's refusal is a ticket 43 unit test.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | List | F8CDB96400C445879DA9E6FCA53889A2 | True/False |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 17 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --only e54-list-no-package --force`.
