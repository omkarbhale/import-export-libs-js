# s2-ref-only

A package imported without the package it depends on. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S2 (ticket 05).

## Exercises

The dependency is neither imported nor on the server: the ordering warning, and every referenced element of it reported as not added.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import REF only | `LIBSJS-SCRATCH-REF` | defaults | success (0) | 0 | 31 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 7ADE7B8F04E14F45A2A2701FCF32BFBB |
| 2 | PackageDefinition | F7F07F2B881D454D9D8DE21A820B2536 |
| 3 | PackageDependsOn | 280A8CAC539D41959FDF35B26CBF425F |
| 4 | PackageReferencedElement | 6BA29E72627E433BAD2F9C6F5A6AA3A8 |
| 5 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 6 | PackageGroup | 7F72AB05FA75444BA86444CE8D59226E |
| 7 | PackageElement | CDCF10C825CE47E7BB21201258AE181F |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | CDCF10C825CE47E7BB21201258AE181F |
| 2 | PackageGroup | 7F72AB05FA75444BA86444CE8D59226E |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | 6BA29E72627E433BAD2F9C6F5A6AA3A8 |
| 5 | PackageDependsOn | 280A8CAC539D41959FDF35B26CBF425F |
| 6 | PackageDefinition | F7F07F2B881D454D9D8DE21A820B2536 |
| 7 | DatabaseUpgrade | 7ADE7B8F04E14F45A2A2701FCF32BFBB |

## Spec rules

None yet. The spec or build ticket that pins this case adds its rule ids here (mapcheck F11).

## Files

Each `step-<n>/` folder:

| File | What |
|---|---|
| `run.json` | the oracle's run record: toolset identity, parameters, host info, and the cleanup report (created, deleted, kept) |
| `transcript.jsonl` | every call the engine made, in order. A response of 64 KB or more is in `../../_blobs/<sha256>.xml`, named by `responseBlob`; `oracle/src/transcript.ts` reads it back |
| `messages.jsonl` | the engine's messages, by channel |
| `engine.log` | the engine's own log |
| `host.log` | the host's console output |
| `input/` | the package folder the engine read: `imports.mf` and the item files |

The return code is `run.json` `host.result` (`ImportSolutions returned N`); `hostExit` is the host process's own exit code.

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s2-ref-only --force`.
