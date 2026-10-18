# s4-mp-promote

An mp_PromoteItem action on an mp_MacPolicy. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S4, R12 (ticket 05).

## Exercises

build.xsl selects mp_* items with any action in 14.x, so the engine sends it; the policy does not exist, so the server's answer ends the package. 12.0 drops mp_PromoteItem (R12): nothing is sent and the package succeeds.

## Not covered here

No mp_MacPolicy is created: the item names an id that exists nowhere.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-DELPROMOTE` | defaults | engine failure (1) | 1 | 18 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 2

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 32169DF4C5AF41DBB0CDA2CE7330575F |
| 2 | PackageDefinition | 3B0A5930385F4ECCBEEF5883F68191F9 |

### Deleted by the cleanup: 2

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | 3B0A5930385F4ECCBEEF5883F68191F9 |
| 2 | DatabaseUpgrade | 32169DF4C5AF41DBB0CDA2CE7330575F |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s4-mp-promote --force`.
