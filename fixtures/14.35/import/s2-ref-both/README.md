# s2-ref-both

A package and the package it depends on, imported together. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S2 (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | 5318C672012949F8B997537CECD51E86 |
| 2 | PackageDefinition | 3A17481AA0E941F48CBB3F4105280D1B |
| 3 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 4 | PackageGroup | 789285EF978D4793B88B6D6A72349D87 |
| 5 | PackageElement | 20C178648D1D4212A6A5CF39CA1511DE |
| 6 | DatabaseUpgrade | 9F31F4D096FE4B5680C6B5CB01DB904F |
| 7 | PackageDefinition | 53B357CC250044208D1DC32986DBCF6E |
| 8 | PackageDependsOn | 994A3D8B9EDE404BAF6ABDC780CD09C2 |
| 9 | PackageReferencedElement | DD548EBE60D94907A98FF691C20A86DD |
| 10 | PackageReferencedElement | 8347D97DCF2242949BB6B01B561C64B3 |
| 11 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 12 | PackageGroup | D6C1E3B25A3249AA88D731427E37A765 |
| 13 | PackageElement | 24A57BD5A2184D2E9BE04F36D74FE051 |

### Deleted by the cleanup: 13

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 24A57BD5A2184D2E9BE04F36D74FE051 |
| 2 | PackageGroup | D6C1E3B25A3249AA88D731427E37A765 |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | 8347D97DCF2242949BB6B01B561C64B3 |
| 5 | PackageReferencedElement | DD548EBE60D94907A98FF691C20A86DD |
| 6 | PackageDependsOn | 994A3D8B9EDE404BAF6ABDC780CD09C2 |
| 7 | PackageDefinition | 53B357CC250044208D1DC32986DBCF6E |
| 8 | DatabaseUpgrade | 9F31F4D096FE4B5680C6B5CB01DB904F |
| 9 | PackageElement | 20C178648D1D4212A6A5CF39CA1511DE |
| 10 | PackageGroup | 789285EF978D4793B88B6D6A72349D87 |
| 11 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 12 | PackageDefinition | 3A17481AA0E941F48CBB3F4105280D1B |
| 13 | DatabaseUpgrade | 5318C672012949F8B997537CECD51E86 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s2-ref-both --force`.
