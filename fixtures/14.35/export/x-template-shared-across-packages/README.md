# x-template-shared-across-packages

Lists of two packages: one template per type for the whole call. Engine 14.35, export, recorded on dev (read-only). Catalogue: 14.35 request tree (ticket 57).

## Exercises

The dictionary of EXP-060 belongs to the ExportSolutions call, not to the package: the Lists of the second package send no template lookups, and the level they pass is ignored.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.core | List | EAB29654E2CD4D30B376957788198B40 | Categories |
| 2 | com.aras.innovator.core | List | 51D8F6076D2E41AAA7D72D6F1B2184D1 | Configurable Grid Events |
| 3 | com.aras.innovator.cmf | List | 01B506E02528434DB36D562A3FAB826D | cmf_DocumentPropertyDataType |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 23 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --engine 14.35 --only x-template-shared-across-packages --force`.
