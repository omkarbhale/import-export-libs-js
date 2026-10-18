# s2-ref-dep-present

A package imported after its dependency was imported earlier. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S2 (ticket 05).

## Exercises

The dependency is on the server (a PackageDefinition) but not in this run: the database branch of the ordering, and the referenced scratch item now found.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import REFDEP | `LIBSJS-SCRATCH-REFDEP` | defaults | success (0) | 0 | 25 |
| 2 | import REF | `LIBSJS-SCRATCH-REF` | defaults | success (0) | 0 | 33 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 0745B68C17694B5DA121F73C602EF8E1 |
| 2 | PackageDefinition | 5E4BE6CB28C84498B77237BBC7B23FBB |
| 3 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 4 | PackageGroup | EA4948A7AE8C4805A7E700BBA8F6C2E5 |
| 5 | PackageElement | 806CAA63B1354DD5A395C979A1B7BA75 |

### Step 2: created 8

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | C7CED79CC4F74724B9FF3111024AAA86 |
| 2 | PackageDefinition | F306FE7BCAA9419BAB60D6519B85728D |
| 3 | PackageDependsOn | BCD2BA59E85341A1A147463CAAD38E74 |
| 4 | PackageReferencedElement | 0B9A8EB28D8A46CC8865CDC612BBA761 |
| 5 | PackageReferencedElement | 3A8AFDCCD99242CC854A9363BA49B661 |
| 6 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 7 | PackageGroup | 2FEB92C14A514D93889BA0B6F9BFD8AE |
| 8 | PackageElement | 071991CB354644D6A5F6772D833736EF |

### Deleted by the cleanup: 13

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 071991CB354644D6A5F6772D833736EF |
| 2 | PackageGroup | 2FEB92C14A514D93889BA0B6F9BFD8AE |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | 3A8AFDCCD99242CC854A9363BA49B661 |
| 5 | PackageReferencedElement | 0B9A8EB28D8A46CC8865CDC612BBA761 |
| 6 | PackageDependsOn | BCD2BA59E85341A1A147463CAAD38E74 |
| 7 | PackageDefinition | F306FE7BCAA9419BAB60D6519B85728D |
| 8 | DatabaseUpgrade | C7CED79CC4F74724B9FF3111024AAA86 |
| 9 | PackageElement | 806CAA63B1354DD5A395C979A1B7BA75 |
| 10 | PackageGroup | EA4948A7AE8C4805A7E700BBA8F6C2E5 |
| 11 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 12 | PackageDefinition | 5E4BE6CB28C84498B77237BBC7B23FBB |
| 13 | DatabaseUpgrade | 0745B68C17694B5DA121F73C602EF8E1 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s2-ref-dep-present --force`.
