# e18-form-system-fields

Form: Fields on six system properties (Part). Engine 14.35, export, recorded on dev (read-only). Catalogue: E18 (ticket 05).

## Exercises

Levels 3. Fields on the system properties state, owned_by_id, managed_by_id, major_rev, classification and effective_date: ProcessForm, the propertytype_id drop and the Field action=edit fix items with the comment.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.solution.PLM | Form | CAF99D0A8E6E44E9A681C38015FACE91 | Part |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only e18-form-system-fields --force`.
