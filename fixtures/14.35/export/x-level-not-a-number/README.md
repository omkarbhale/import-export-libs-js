# x-level-not-a-number

Two CommandBarSections with a level that is not a number. Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 request tree (ticket 57).

## Exercises

The default row of EXP-021 parses the level: 'abc' makes the factory of the type's template throw a FormatException, the Lazy keeps it, and the second item of the type gets the same exception without a request (EXP-062). The exception is not a CItemException, so it ends the run through the aggregate handler of EXP-556 as a warning. No file is written.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.i18n | CommandBarSection | 0212985C3E90930D618120D9625E4BB8 | Language_TOC_Content |
| 2 | com.aras.innovator.i18n | CommandBarSection | 35C6304FF739C77F618120D9625E4BB8 | Locale_TOC_Content |

Engine options: `level` = `"abc"`.

## Result

The export completes: host exit 0, 10 calls.

## Spec rules

EXP-021, EXP-022, EXP-060, EXP-061, EXP-054, EXP-062, EXP-556.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only x-level-not-a-number --force`.
