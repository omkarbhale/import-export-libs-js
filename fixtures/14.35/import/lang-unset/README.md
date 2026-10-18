# lang-unset

A package with en and de labels, Languages unset. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, Languages unset (tickets 05 and 75).

## Exercises

Languages is null: the constructor still scans the package (no Language request), nothing is deleted, and every label is sent.

## Dev state

Dev had these `Language` items while the case ran: `en`. The result depends on it.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-LANGUNSET` | defaults | success (0) | 0 | 25 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 2122E8FC89F841E581631BA29CDC95D1 |
| 2 | PackageDefinition | 8608B07EF0C849D7B184104231534B5D |
| 3 | List | FD35793BFEF02D5761DCA1A821AF12CA |
| 4 | PackageGroup | 69F505D577F8439C876C6CDCAD977BB4 |
| 5 | PackageElement | EF21B2F65BC34B8FAEBF9CFF103A90BB |

### Deleted by the cleanup: 5

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | EF21B2F65BC34B8FAEBF9CFF103A90BB |
| 2 | PackageGroup | 69F505D577F8439C876C6CDCAD977BB4 |
| 3 | List | FD35793BFEF02D5761DCA1A821AF12CA |
| 4 | PackageDefinition | 8608B07EF0C849D7B184104231534B5D |
| 5 | DatabaseUpgrade | 2122E8FC89F841E581631BA29CDC95D1 |

## Spec rules

IMP-610, IMP-635. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only lang-unset --force`.
