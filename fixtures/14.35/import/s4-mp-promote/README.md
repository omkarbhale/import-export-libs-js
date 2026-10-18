# s4-mp-promote

An mp_PromoteItem action on an mp_MacPolicy. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S4, R12 (tickets 05 and 75).

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
| 1 | DatabaseUpgrade | C9DF1F69CB314CB488E7530D96C21D0D |
| 2 | PackageDefinition | 2E3D790ADC644B1F8855EB8E32F0BFF8 |

### Deleted by the cleanup: 2

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageDefinition | 2E3D790ADC644B1F8855EB8E32F0BFF8 |
| 2 | DatabaseUpgrade | C9DF1F69CB314CB488E7530D96C21D0D |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s4-mp-promote --force`.
