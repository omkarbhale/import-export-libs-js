# s2-ref-both

A package and the package it depends on, imported together. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S2 (ticket 05).

## Exercises

Package ordering (the dependency is imported first although the manifest lists it second), PackageDependsOn, and the three kinds of referenced element: one in the dependency, a stock List, and an id that exists nowhere (the 'not added' warning).

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-REF`, `LIBSJS-SCRATCH-REFDEP` | defaults | success (0) | 0 | 50 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 13

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | D28F8F8EE2644DEFB80D7A112B908D7B |
| 2 | PackageDefinition | E0D27B6F71634F81B5A5FC2AFF448134 |
| 3 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 4 | PackageGroup | 136181277529471DAFCABFFFA8933809 |
| 5 | PackageElement | E9797894B513486BABFD42E412BB3598 |
| 6 | DatabaseUpgrade | 95C28846C84C49268E48A0FCE7CBDA32 |
| 7 | PackageDefinition | 7909BB931B2B435484A27DFA84155B58 |
| 8 | PackageDependsOn | 508D021F687646C1B8FF06A30DCADB03 |
| 9 | PackageReferencedElement | 8D8082D49A1B4BE48258FC3DDC982FF6 |
| 10 | PackageReferencedElement | 519F6482C9B441ECBB2EB518F71DB68E |
| 11 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 12 | PackageGroup | 2A50924A62234423BCCAC15F06CBD7E3 |
| 13 | PackageElement | 14EDFD87CC18413599EE080ED1F45E7E |

### Deleted by the cleanup: 13

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 14EDFD87CC18413599EE080ED1F45E7E |
| 2 | PackageGroup | 2A50924A62234423BCCAC15F06CBD7E3 |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | 519F6482C9B441ECBB2EB518F71DB68E |
| 5 | PackageReferencedElement | 8D8082D49A1B4BE48258FC3DDC982FF6 |
| 6 | PackageDependsOn | 508D021F687646C1B8FF06A30DCADB03 |
| 7 | PackageDefinition | 7909BB931B2B435484A27DFA84155B58 |
| 8 | DatabaseUpgrade | 95C28846C84C49268E48A0FCE7CBDA32 |
| 9 | PackageElement | E9797894B513486BABFD42E412BB3598 |
| 10 | PackageGroup | 136181277529471DAFCABFFFA8933809 |
| 11 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 12 | PackageDefinition | E0D27B6F71634F81B5A5FC2AFF448134 |
| 13 | DatabaseUpgrade | D28F8F8EE2644DEFB80D7A112B908D7B |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s2-ref-both --force`.
