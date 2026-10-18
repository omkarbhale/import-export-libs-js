# s8-coll-duplicate

The same item in two packages. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S8 (ticket 05).

## Exercises

PackageElement is looked up globally by element id: the second package finds the first one's element in another group and fails with the duplicate-element error (-2).

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-A.Coll`, `LIBSJS-SCRATCH-B.Coll` | defaults | engine failure (1) | 1 | 35 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 8

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | CF75971720D344D6B49A6CF370429954 |
| 2 | PackageDefinition | 9A7C539C0E744D4882E24B31A256D62D |
| 3 | Variable | 416141614D62782894BB63F6E612448D |
| 4 | PackageGroup | 36D73466F4B64EE59BAEA36EC4B4A66B |
| 5 | PackageElement | EC1C7B57833440DEA74408C491207D4C |
| 6 | DatabaseUpgrade | E91E317B96254CE7AD19F5B5CA4A1133 |
| 7 | PackageDefinition | CFD961291B984943844290340201B163 |
| 8 | PackageGroup | ECC526D8D5DD4A4F931D01F699AD7C93 |

### Deleted by the cleanup: 8

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageGroup | ECC526D8D5DD4A4F931D01F699AD7C93 |
| 2 | PackageDefinition | CFD961291B984943844290340201B163 |
| 3 | DatabaseUpgrade | E91E317B96254CE7AD19F5B5CA4A1133 |
| 4 | PackageElement | EC1C7B57833440DEA74408C491207D4C |
| 5 | PackageGroup | 36D73466F4B64EE59BAEA36EC4B4A66B |
| 6 | Variable | 416141614D62782894BB63F6E612448D |
| 7 | PackageDefinition | 9A7C539C0E744D4882E24B31A256D62D |
| 8 | DatabaseUpgrade | CF75971720D344D6B49A6CF370429954 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s8-coll-duplicate --force`.
