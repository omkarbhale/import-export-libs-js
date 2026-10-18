# e52-float-item-property

CommandBarButton: float item property to a re-generated Method (sg_powerplay_relationshipgrid). Engine 14.35, export, recorded on dev (read-only). Catalogue: E52 (ticket 05).

## Exercises

A float item property with a visible effect: on_click_handler points to Method sg_powerplay_relgrid_click, whose generation is above 1. GetCustomFloatPropertiesOfTypeItem and GetConfigId rewrite it to the config_id.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.steepgraph.powerplay | CommandBarButton | 4B51486994E740E383BA33D46250AAFA | sg_powerplay_relationshipgrid |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only e52-float-item-property --force`.
