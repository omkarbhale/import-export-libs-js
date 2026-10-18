# x-abort-after-healthy-package

The same two packages inserted the other way round: the healthy package comes first. Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 abort (ticket 57).

## Exercises

The packages of x-abort-skips-later-package with `core` inserted first. The Hashtable then enumerates `history` first, so its item is exported and logged, and the failure in `core` ends the run after it. The manifest holds both packages.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | List | 00000000000000000000000000000001 | Nope One |
| 2 | com.aras.innovator.core | List | EAB29654E2CD4D30B376957788198B40 | Categories |
| 3 | com.aras.innovator.history | Grid | 4B9FF34674E34677B877FC8F71B5CDBE | History_whereTemplateUsed |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 38 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only x-abort-after-healthy-package --force`.
