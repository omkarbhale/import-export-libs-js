# e17-method-middle-generation

Method: exported by a middle generation (onChange Action). Engine 12.0, export, recorded on dev (read-only). Catalogue: E17 (ticket 05).

## Exercises

A versionable Method exported by a middle generation (gen 2 of 3). The config is EC0D87C174814CB7BA574593456113F7 and the current id is 319C9E8D8526410594970EAFB3138485.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | Method | 9C4E2E1AB17F48699B9BC8F8789D173C | onChange Action |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 16 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 12.0 --only e17-method-middle-generation --force`.
