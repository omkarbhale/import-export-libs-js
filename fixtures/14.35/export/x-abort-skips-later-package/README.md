# x-abort-skips-later-package

A failing item in a package that the manifest enumerates first, a healthy package after it. Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 abort (ticket 57).

## Exercises

EXP-555: the remaining packages are skipped, with no manifest entry, directory, definition lookup or message. The Hashtable of the host enumerates `core` before `history` here (EXP-508), although `history` was inserted first, so the failing package comes first and `history` is never exported. The pair with x-abort-after-healthy-package inserts them the other way round.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.history | Grid | 4B9FF34674E34677B877FC8F71B5CDBE | History_whereTemplateUsed |
| 2 | com.aras.innovator.core | List | 00000000000000000000000000000001 | Nope One |
| 3 | com.aras.innovator.core | List | EAB29654E2CD4D30B376957788198B40 | Categories |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 20 calls.

## Spec rules

EXP-516, EXP-555, EXP-570, EXP-571, EXP-572, EXP-558, EXP-508.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only x-abort-skips-later-package --force`.
