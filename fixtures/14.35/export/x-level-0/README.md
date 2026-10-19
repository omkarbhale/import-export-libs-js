# x-level-0

CommandBarSection: sLevel 0. Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 request tree (ticket 57).

## Exercises

A level of 0 gives the bare item with no tree: none of the relationship-type lookups of EXP-061 is sent, and the main fetch asks for the item alone. Compare e53-level-1 to e53-level-3.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.i18n | CommandBarSection | 0212985C3E90930D618120D9625E4BB8 | Language_TOC_Content |

Engine options: `level` = `"0"`.

## Result

The export completes: host exit 0, 17 calls.

## Spec rules

EXP-021, EXP-022, EXP-060, EXP-061.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only x-level-0 --force`.
