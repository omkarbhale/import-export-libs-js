# s2-ref-dep-present

A package imported after its dependency was imported earlier. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S2 (ticket 05).

## Exercises

The dependency is on the server (a PackageDefinition) but not in this run: the database branch of the ordering, and the referenced scratch item now found.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import REFDEP | `LIBSJS-SCRATCH-REFDEP` | defaults | success (0) | 0 | 24 |
| 2 | import REF | `LIBSJS-SCRATCH-REF` | defaults | success (0) | 0 | 32 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | B061D81C00B94EAEAB5C559BB8E3F8DF |
| 2 | PackageDefinition | 64B593927C1347F396E8765CABA77C7A |
| 3 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 4 | PackageGroup | DEEC16F1E6B447C2B65948478CDA5A51 |
| 5 | PackageElement | D5C7D2937A774655B0525D68B07B77F6 |

### Step 2: created 8

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 0FF9246DE6A94B0B9CF0958F05854C07 |
| 2 | PackageDefinition | 6A0F8CB5AC294E5C8F31805259B71151 |
| 3 | PackageDependsOn | 29B07356A7CC455887EC4D446FACA78F |
| 4 | PackageReferencedElement | 67CEF78115C04EF59FBDEB84CD379783 |
| 5 | PackageReferencedElement | E814647D1BC94F30B73C89E19940FECD |
| 6 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 7 | PackageGroup | 371B01E0F8704A308AC5F8A5784DE612 |
| 8 | PackageElement | 46AA86F874BC4ACEB8592C392EDCF685 |

### Deleted by the cleanup: 13

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 46AA86F874BC4ACEB8592C392EDCF685 |
| 2 | PackageGroup | 371B01E0F8704A308AC5F8A5784DE612 |
| 3 | Variable | 6A880A1FAC02A374F97FFF2376246C91 |
| 4 | PackageReferencedElement | E814647D1BC94F30B73C89E19940FECD |
| 5 | PackageReferencedElement | 67CEF78115C04EF59FBDEB84CD379783 |
| 6 | PackageDependsOn | 29B07356A7CC455887EC4D446FACA78F |
| 7 | PackageDefinition | 6A0F8CB5AC294E5C8F31805259B71151 |
| 8 | DatabaseUpgrade | 0FF9246DE6A94B0B9CF0958F05854C07 |
| 9 | PackageElement | D5C7D2937A774655B0525D68B07B77F6 |
| 10 | PackageGroup | DEEC16F1E6B447C2B65948478CDA5A51 |
| 11 | List | ADFEE419D8DB444BF5EDED7C490E4BA2 |
| 12 | PackageDefinition | 64B593927C1347F396E8765CABA77C7A |
| 13 | DatabaseUpgrade | B061D81C00B94EAEAB5C559BB8E3F8DF |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s2-ref-dep-present --force`.
