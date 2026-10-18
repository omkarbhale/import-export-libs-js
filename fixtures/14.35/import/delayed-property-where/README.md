# delayed-property-where

A Property with no id but a where, whose data_source resolves later. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: 14.35, delayed (tickets 05 and 75).

## Exercises

The delayed edit of a Property is addressed by the Property's own where when it has no id (14.0.7 wrote id=''). The where is scoped to the scratch ItemType and the property name, so the edit can touch nothing else.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-DELAYPROP` | defaults | success (0) | 0 | 31 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 7

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 80FD3AB2F0E445BAAF5925292B70ADE8 |
| 2 | PackageDefinition | 7A1476DC287640508ED67189649581E4 |
| 3 | ItemType | D4A440B82188A821125EA4F28E0C1771 |
| 4 | PackageGroup | 1F801544789441ECB0311E40F4235286 |
| 5 | PackageElement | 8FBDA3500A7A4B5E87B507D4FB03C4C5 |
| 6 | ItemType | 0C959D62FDAEF1BF0C482A671CAC248A |
| 7 | PackageElement | E5C52CEB030746E89F888461F01913C2 |

### Deleted by the cleanup: 7

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | E5C52CEB030746E89F888461F01913C2 |
| 2 | PackageElement | 8FBDA3500A7A4B5E87B507D4FB03C4C5 |
| 3 | PackageGroup | 1F801544789441ECB0311E40F4235286 |
| 4 | ItemType | D4A440B82188A821125EA4F28E0C1771 |
| 5 | PackageDefinition | 7A1476DC287640508ED67189649581E4 |
| 6 | DatabaseUpgrade | 80FD3AB2F0E445BAAF5925292B70ADE8 |
| 7 | ItemType | 0C959D62FDAEF1BF0C482A671CAC248A |

## Spec rules

IMP-220. A spec or build ticket that pins this case adds more here (mapcheck F11).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only delayed-property-where --force`.
