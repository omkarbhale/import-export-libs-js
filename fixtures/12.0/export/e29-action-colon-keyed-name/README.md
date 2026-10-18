# e29-action-colon-keyed-name

Action: keyed name with a colon (PE: rollup all parts in DB). Engine 12.0, export, recorded on dev (read-only). Catalogue: E29 (ticket 05).

## Exercises

The keyed name contains ':', which is not allowed in a file name, so the file is named by the id. The package element's name is 'PE rollup all parts in DB'; this case passes the item's real keyed name.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.solution.PLM | Action | 3313FB477B9A4982A30EA157ED896247 | PE: rollup all parts in DB |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 15 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 12.0 --only e29-action-colon-keyed-name --force`.
