# l1-only-star-and-code

ExportLanguageResourcesOnly with `*` and `de`. Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 language modes (ticket 57).

## Exercises

LP-111: only the exact one-entry list `*` is expanded. In `*`, `de` the star is an ordinary code, which the installed-language check reports as missing.

## Not covered here

Recorded while dev had the Language `en` only. With a second Language the `*` expands to its code and the same item is exported with translations: see the `lang-*` cases (seeded and cleaned up by `oracle:export-scratch-cases`).

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.cmf | List | 01B506E02528434DB36D562A3FAB826D | cmf_DocumentPropertyDataType |

Engine options: `engineAction` = `"ExportLanguageResourcesOnly"`, `languages` = `["*","de"]`.

## Result

The run ends in an engine error, which the case pins: host exit 2, 8 calls.

```
Aras.Tools.SolutionUpgrade.CItemException: Some of the selected languages are not installed for current Aras Innovator: *,de.
```

## Spec rules

LP-100, LP-111, LP-114.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only l1-only-star-and-code --force`.
