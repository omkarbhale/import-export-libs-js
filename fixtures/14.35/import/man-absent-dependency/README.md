# man-absent-dependency

A dependency on a package that exists nowhere. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: manifest, P2 (tickets 05 and 75).

## Exercises

The ordering warning for a dependency that is neither imported nor on the server; the package is imported anyway.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-ABSENTDEP` | defaults | success (0) | 0 | 26 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 6

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 5FFF1E1CBEF14EE0A41F79CD6F2751B1 |
| 2 | PackageDefinition | 990B34D02E814F75908B8C82235D593D |
| 3 | PackageDependsOn | 6D56AFFAA803440394C184FE35639E3B |
| 4 | Variable | 7A8237B13A212728BB97D815613C98E6 |
| 5 | PackageGroup | 4242B607909C43B098A3BA57E183C254 |
| 6 | PackageElement | A904083B06364F00A4DD7123CD782F29 |

### Deleted by the cleanup: 6

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | A904083B06364F00A4DD7123CD782F29 |
| 2 | PackageGroup | 4242B607909C43B098A3BA57E183C254 |
| 3 | Variable | 7A8237B13A212728BB97D815613C98E6 |
| 4 | PackageDependsOn | 6D56AFFAA803440394C184FE35639E3B |
| 5 | PackageDefinition | 990B34D02E814F75908B8C82235D593D |
| 6 | DatabaseUpgrade | 5FFF1E1CBEF14EE0A41F79CD6F2751B1 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only man-absent-dependency --force`.
