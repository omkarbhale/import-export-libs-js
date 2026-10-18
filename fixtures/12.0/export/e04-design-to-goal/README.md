# e04-design-to-goal

ItemType: no View (Design To Goal). Engine 12.0, export, recorded on dev (read-only). Catalogue: E04 (ticket 05).

## Exercises

An ItemType with no View, so the View and Form delete fix items. The element name's case differs from the ItemType name 'Design to Goal'.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.solution.PLM | ItemType | 8E3CFB68CF2B42A39ABBE2A8B31D006B | Design To Goal |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 27 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 12.0 --only e04-design-to-goal --force`.
