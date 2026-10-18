# e47-dr-relationshipfamily

dr_RelationshipFamily: User Identities (empty implementation_query). Engine 14.0.7, export, recorded on dev (read-only). Catalogue: E47 (ticket 05).

## Exercises

Levels 2; IncludeDrRelationshipAsValue embeds dr_Relationship D54BFC482F8C4FC89E2C44C35479D789. Its implementation_query is empty, so this pins what R10's XDocument.Parse does with empty text. It has no dr_FamilyEventHandler; event_data (R6) needs scratch state.

## Not covered here

event_data CDATA and a non-empty implementation_query need scratch package S6; ticket 67.

## Input

The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.

| # | Package | Type | Id | Keyed name |
|---|---|---|---|---|
| 1 | com.aras.innovator.derivedrelationships_default | dr_RelationshipFamily | CB35C14E66EC407F984CD37BF8CF38A0 | DerivedRelationshipFamily |

Engine options: none; every one keeps the engine's default.

## Result

The export completes: host exit 0, 24 calls.

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

Re-record: `ARAS_PASSWORD=… npm run oracle:export-cases -- --only e47-dr-relationshipfamily --force`.
