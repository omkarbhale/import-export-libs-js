# s2-ref-only

A package imported without the package it depends on. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S2 (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | BA3F0069220A4AD090CD953262A1B24C |
| 2 | PackageDefinition | 7750A68623DE403695C843113776BB33 |
| 3 | PackageDependsOn | 8D1716DE685546BFB0C86351E2DC0CDC |
| 4 | PackageReferencedElement | 6A047882E73C4931880371D19370F24B |
| 5 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 6 | PackageGroup | D29458EAD85E46FEB7FD56A93E81D3DE |
| 7 | PackageElement | 7C9C30E9CC6C4D18BB0F75794A61A5B7 |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 7C9C30E9CC6C4D18BB0F75794A61A5B7 |
| 2 | PackageGroup | D29458EAD85E46FEB7FD56A93E81D3DE |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | 6A047882E73C4931880371D19370F24B |
| 5 | PackageDependsOn | 8D1716DE685546BFB0C86351E2DC0CDC |
| 6 | PackageDefinition | 7750A68623DE403695C843113776BB33 |
| 7 | DatabaseUpgrade | BA3F0069220A4AD090CD953262A1B24C |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s2-ref-only --force`.
