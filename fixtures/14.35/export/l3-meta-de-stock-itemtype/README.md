# l3-meta-de-stock-itemtype

ExportMetadataWithLanguageResources, `de`, the stock ItemType Part. Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 language modes (ticket 57).

## Exercises

LP-123: the metadata mode on a large ItemType, with the whole item kept and the empty `de` slots beside it.

## Not covered here

Recorded while dev had the Languages `en`, `de` and `fr` (added for the recording and deleted again afterwards). Stock items carry no `de` or `fr` values, so every translated slot of the answer is empty.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.solution.PLM | ItemType | 4F1AC04A2B484F3ABA4E20DB63808A88 | Part |

Engine options: `engineAction` = `"ExportMetadataWithLanguageResources"`, `languages` = `["de"]`.

## Result

The export completes: host exit 0, 102 calls.

## Spec rules

LP-100, LP-123, LP-124, LP-125, LP-141, LP-143, LP-144.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only l3-meta-de-stock-itemtype --force`.
