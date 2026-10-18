# s2-ref-both

A package and the package it depends on, imported together. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S2 (ticket 05).

## Exercises

Package ordering (the dependency is imported first although the manifest lists it second), PackageDependsOn, and the three kinds of referenced element: one in the dependency, a stock List, and an id that exists nowhere (the 'not added' warning).

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-REF`, `LIBSJS-SCRATCH-REFDEP` | defaults | success (0) | 0 | 51 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 13

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 44A783EEAC794AAE9ED3A4AFF3DC04E2 |
| 2 | PackageDefinition | 0E360742AEE6469FB14B5F29AC5EF33C |
| 3 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 4 | PackageGroup | 8E5C9242C48C49A2BD8B8829D59F525E |
| 5 | PackageElement | F26EE4FB573C46FFA489AC70B94BF4D4 |
| 6 | DatabaseUpgrade | 9F4B67A36EBB4E6CA1864E3E964CF76D |
| 7 | PackageDefinition | 19D5CF2A7D744B49B43394F5E047A731 |
| 8 | PackageDependsOn | 50C4DECB1FC043BE80CFC8D5B7CF1240 |
| 9 | PackageReferencedElement | CE217799CE9F4B349C4F076B90EBBD99 |
| 10 | PackageReferencedElement | 8FA2D8917C3748D4A21272F7BB4AC903 |
| 11 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 12 | PackageGroup | 10C07F6C91194790966E3B959D0A3EA9 |
| 13 | PackageElement | 985D02C48B244D8BB6F1A08F6825B144 |

### Deleted by the cleanup: 13

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 985D02C48B244D8BB6F1A08F6825B144 |
| 2 | PackageGroup | 10C07F6C91194790966E3B959D0A3EA9 |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | 8FA2D8917C3748D4A21272F7BB4AC903 |
| 5 | PackageReferencedElement | CE217799CE9F4B349C4F076B90EBBD99 |
| 6 | PackageDependsOn | 50C4DECB1FC043BE80CFC8D5B7CF1240 |
| 7 | PackageDefinition | 19D5CF2A7D744B49B43394F5E047A731 |
| 8 | DatabaseUpgrade | 9F4B67A36EBB4E6CA1864E3E964CF76D |
| 9 | PackageElement | F26EE4FB573C46FFA489AC70B94BF4D4 |
| 10 | PackageGroup | 8E5C9242C48C49A2BD8B8829D59F525E |
| 11 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 12 | PackageDefinition | 0E360742AEE6469FB14B5F29AC5EF33C |
| 13 | DatabaseUpgrade | 44A783EEAC794AAE9ED3A4AFF3DC04E2 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s2-ref-both --force`.
