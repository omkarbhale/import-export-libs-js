# s2-ref-dep-present

A package imported after its dependency was imported earlier. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S2 (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | 4A33E94EEB6B42678C7A42AE81002A69 |
| 2 | PackageDefinition | 2680283B836F43CF8F3528560AE1C2ED |
| 3 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 4 | PackageGroup | 16569CF59178413EB36AB561558A93F9 |
| 5 | PackageElement | 5D0E2AAAA71F48398733071EE5FABEA9 |

### Step 2: created 8

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 704A66B28C1945A4A3105A2973D0300F |
| 2 | PackageDefinition | A5ACCD86B7E84AB497E4D7045287157F |
| 3 | PackageDependsOn | 7E64EE61395F4FB8B6E683EAAACDE3B5 |
| 4 | PackageReferencedElement | 8BAB654EE12245589CF50DDD20948FF2 |
| 5 | PackageReferencedElement | A6FD6B92C8224D9E965DC8EFDAF42954 |
| 6 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 7 | PackageGroup | C2294873B086471FADC1B4C24A09E22E |
| 8 | PackageElement | 26686CC9FB61405485F43C57FFE03D8C |

### Deleted by the cleanup: 13

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 26686CC9FB61405485F43C57FFE03D8C |
| 2 | PackageGroup | C2294873B086471FADC1B4C24A09E22E |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | A6FD6B92C8224D9E965DC8EFDAF42954 |
| 5 | PackageReferencedElement | 8BAB654EE12245589CF50DDD20948FF2 |
| 6 | PackageDependsOn | 7E64EE61395F4FB8B6E683EAAACDE3B5 |
| 7 | PackageDefinition | A5ACCD86B7E84AB497E4D7045287157F |
| 8 | DatabaseUpgrade | 704A66B28C1945A4A3105A2973D0300F |
| 9 | PackageElement | 5D0E2AAAA71F48398733071EE5FABEA9 |
| 10 | PackageGroup | 16569CF59178413EB36AB561558A93F9 |
| 11 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 12 | PackageDefinition | 2680283B836F43CF8F3528560AE1C2ED |
| 13 | DatabaseUpgrade | 4A33E94EEB6B42678C7A42AE81002A69 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s2-ref-dep-present --force`.
