# e07-form-itemtype

Form: ItemType (Form Event that is a package element elsewhere). Engine 14.0.7, export, recorded on dev (read-only). Catalogue: E07 (ticket 05).

## Exercises

The Form's Form Event EF8E8BAFF7804E26AB1750B76344B481 is a package element of ssvc, the 14.35 RemoveSeparatelyExportedRelationships case; this records what 14.0.7 does with it.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | Form | 47B8630E2B4C40C1B23C6EE9962F7681 | ItemType |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 55 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --only e07-form-itemtype --force`.
