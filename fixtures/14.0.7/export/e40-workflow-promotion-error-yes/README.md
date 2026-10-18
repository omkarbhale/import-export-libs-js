# e40-workflow-promotion-error-yes

Workflow Promotion (absent on 12 SP9): server fault, ErrorQuestion answered yes. Engine 14.0.7, export, recorded on dev (read-only). Catalogue: E40, ErrorQuestion (ticket 05).

## Exercises

The same two-package run as e40-workflow-promotion-error-no, with the ErrorQuestion answered yes (continue), and a second, valid item in the failing package.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | Workflow Promotion | 00000000000000000000000000000001 | Nope Promotion |
| 2 | com.aras.innovator.core | Form | F288A3345225407EACBC936191097BCD | Activity Template |
| 3 | com.aras.innovator.history | Grid | 4B9FF34674E34677B877FC8F71B5CDBE | History_whereTemplateUsed |

Engine options: `errorQuestionAnswer` = `"yes"`.

## Result

The export completes: host exit 0, 62 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --only e40-workflow-promotion-error-yes --force`.
