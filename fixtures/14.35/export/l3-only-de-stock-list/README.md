# l3-only-de-stock-list

ExportLanguageResourcesOnly, `de`, a stock List. Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 language modes (ticket 57).

## Exercises

LP-120 to LP-125, LP-142: a List and its Value relationships asked for `label_de`. Stock values have no translation, so the answer holds empty i18n elements and the reshaping keeps only what locates the item.

## Not covered here

Recorded while dev had the Languages `en`, `de` and `fr` (added for the recording and deleted again afterwards). Stock items carry no `de` or `fr` values, so every translated slot of the answer is empty.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.cmf | List | 01B506E02528434DB36D562A3FAB826D | cmf_DocumentPropertyDataType |

Engine options: `engineAction` = `"ExportLanguageResourcesOnly"`, `languages` = `["de"]`.

## Result

The export completes: host exit 0, 21 calls.

## Spec rules

LP-100, LP-120, LP-121, LP-124, LP-125, LP-141, LP-142, LP-150.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only l3-only-de-stock-list --force`.
