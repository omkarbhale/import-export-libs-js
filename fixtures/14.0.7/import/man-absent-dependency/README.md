# man-absent-dependency

A dependency on a package that exists nowhere. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: manifest, P2 (ticket 05).

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
| 1 | DatabaseUpgrade | 1AAF81A5677F4D8684E9F58C10B55883 |
| 2 | PackageDefinition | 033A6AE70F654ADABA7DE79A83DAB3B9 |
| 3 | PackageDependsOn | 2F79BAA2EE81417791E17EC0F43BA3BE |
| 4 | Variable | 7A8237B13A212728BB97D815613C98E6 |
| 5 | PackageGroup | A41BD6B1BF154FE682A029C7994FB445 |
| 6 | PackageElement | F6F4FC2775F34673A2F6E190B4E4A926 |

### Deleted by the cleanup: 6

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | F6F4FC2775F34673A2F6E190B4E4A926 |
| 2 | PackageGroup | A41BD6B1BF154FE682A029C7994FB445 |
| 3 | Variable | 7A8237B13A212728BB97D815613C98E6 |
| 4 | PackageDependsOn | 2F79BAA2EE81417791E17EC0F43BA3BE |
| 5 | PackageDefinition | 033A6AE70F654ADABA7DE79A83DAB3B9 |
| 6 | DatabaseUpgrade | 1AAF81A5677F4D8684E9F58C10B55883 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only man-absent-dependency --force`.
