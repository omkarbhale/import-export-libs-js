# l1-only-star

ExportLanguageResourcesOnly with `*` on a server that has `en` only. Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 language modes (ticket 57).

## Exercises

LP-111, LP-112: `*` becomes the server's codes, `en` is removed, so the list is empty and the engine sends no translated-value request; the reshaping steps of LP-140 to LP-145 still run on the plain answer.

## Not covered here

Recorded while dev had the Language `en` only. With a second Language the `*` expands to its code and the same item is exported with translations: see the `lang-*` cases (seeded and cleaned up by `oracle:export-scratch-cases`).

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.cmf | List | 01B506E02528434DB36D562A3FAB826D | cmf_DocumentPropertyDataType |

Engine options: `engineAction` = `"ExportLanguageResourcesOnly"`, `languages` = `["*"]`.

## Result

The export completes: host exit 0, 21 calls.

## Spec rules

LP-100, LP-110, LP-111, LP-112, LP-115, LP-124, LP-140, LP-150.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only l1-only-star --force`.
