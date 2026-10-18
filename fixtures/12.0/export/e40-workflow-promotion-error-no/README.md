# e40-workflow-promotion-error-no

Workflow Promotion (absent on 12 SP9): server fault, ErrorQuestion answered no. Engine 12.0, export, recorded on dev (read-only). Catalogue: E40, ErrorQuestion (ticket 05).

## Exercises

12 SP9 has no Workflow Promotion ItemType, so a dummy id pins the levels-1 request shape and the failure path: the type lookup finds no ItemType, the engine reports 'Error of exporting Item' and asks the ErrorQuestion, answered no (abort the package). A second package is in the run. The success branch stays covered by the spec and a unit test.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | Workflow Promotion | 00000000000000000000000000000001 | Nope Promotion |
| 2 | com.aras.innovator.history | Grid | 4B9FF34674E34677B877FC8F71B5CDBE | History_whereTemplateUsed |

Engine options: `errorQuestionAnswer` = `"no"`.

## Result

The export completes: host exit 0, 23 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 12.0 --only e40-workflow-promotion-error-no --force`.
