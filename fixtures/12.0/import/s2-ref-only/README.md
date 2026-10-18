# s2-ref-only

A package imported without the package it depends on. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S2 (ticket 05).

## Exercises

The dependency is neither imported nor on the server: the ordering warning, and every referenced element of it reported as not added.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import REF only | `LIBSJS-SCRATCH-REF` | defaults | success (0) | 0 | 30 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 4CED800B724B470BB7AB6A60B29EB1E3 |
| 2 | PackageDefinition | FC7333AB772445CBB2338F70E2835E96 |
| 3 | PackageDependsOn | C33B3A6EA5434FDCA7891BFE92B68786 |
| 4 | PackageReferencedElement | DD529AB9E5984565B2D0B46CEB1346CD |
| 5 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 6 | PackageGroup | 56D6655B9DBA4250AE4209C6E18DB9AC |
| 7 | PackageElement | F48613F1E3D9479BBB51D33734B68A7E |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | F48613F1E3D9479BBB51D33734B68A7E |
| 2 | PackageGroup | 56D6655B9DBA4250AE4209C6E18DB9AC |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | DD529AB9E5984565B2D0B46CEB1346CD |
| 5 | PackageDependsOn | C33B3A6EA5434FDCA7891BFE92B68786 |
| 6 | PackageDefinition | FC7333AB772445CBB2338F70E2835E96 |
| 7 | DatabaseUpgrade | 4CED800B724B470BB7AB6A60B29EB1E3 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s2-ref-only --force`.
