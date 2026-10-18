# man-absent-dependency

A dependency on a package that exists nowhere. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: manifest, P2 (ticket 05).

## Exercises

The ordering warning for a dependency that is neither imported nor on the server; the package is imported anyway.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-ABSENTDEP` | defaults | success (0) | 0 | 25 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 6

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 96CC2F35E9E642C5B7435D363EB9AD9B |
| 2 | PackageDefinition | 6C957D043F3446209E3F496A882B32A0 |
| 3 | PackageDependsOn | 1B68813792B44269B2C3544C3F5211D6 |
| 4 | Variable | 7A8237B13A212728BB97D815613C98E6 |
| 5 | PackageGroup | BC63C15D9CF64AA4A9F5F2ED8EFE8790 |
| 6 | PackageElement | 6516FC0AC8CF4AD5B8E1C175425E31DF |

### Deleted by the cleanup: 6

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 6516FC0AC8CF4AD5B8E1C175425E31DF |
| 2 | PackageGroup | BC63C15D9CF64AA4A9F5F2ED8EFE8790 |
| 3 | Variable | 7A8237B13A212728BB97D815613C98E6 |
| 4 | PackageDependsOn | 1B68813792B44269B2C3544C3F5211D6 |
| 5 | PackageDefinition | 6C957D043F3446209E3F496A882B32A0 |
| 6 | DatabaseUpgrade | 96CC2F35E9E642C5B7435D363EB9AD9B |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only man-absent-dependency --force`.
