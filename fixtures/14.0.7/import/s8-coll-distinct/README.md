# s8-coll-distinct

Two packages whose names end in the same segment. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S8 (ticket 05).

## Exercises

Two packages with different items import side by side; each has its own PackageDefinition and element. Ticket 67 exports them to pin the shared last-segment folder.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-A.Coll`, `LIBSJS-SCRATCH-B.Coll` | defaults | success (0) | 0 | 38 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 10

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | EDA99BBF68B94E80BE30E4817F7621C7 |
| 2 | PackageDefinition | 9DCCD3AD886B4140BDE9B440A8671BF5 |
| 3 | Variable | B884DA4086B47D93861052CA33041D07 |
| 4 | PackageGroup | 0706361C03554902992A404178A3C02D |
| 5 | PackageElement | 37E2D5BD51764A57AF3AF534CB2901D0 |
| 6 | DatabaseUpgrade | 1CCDCE90EF334BB6995741140A4D06FC |
| 7 | PackageDefinition | 7453DD6425ED49EBB9697FD22E4C9D9C |
| 8 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 9 | PackageGroup | 9393F2302725416FB29C76258065A588 |
| 10 | PackageElement | 26906454ECBE4E3790A76CC077D21382 |

### Deleted by the cleanup: 10

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 26906454ECBE4E3790A76CC077D21382 |
| 2 | PackageGroup | 9393F2302725416FB29C76258065A588 |
| 3 | Variable | EB4A3D180B43F8CE6B393C6484D3F650 |
| 4 | PackageDefinition | 7453DD6425ED49EBB9697FD22E4C9D9C |
| 5 | DatabaseUpgrade | 1CCDCE90EF334BB6995741140A4D06FC |
| 6 | PackageElement | 37E2D5BD51764A57AF3AF534CB2901D0 |
| 7 | PackageGroup | 0706361C03554902992A404178A3C02D |
| 8 | Variable | B884DA4086B47D93861052CA33041D07 |
| 9 | PackageDefinition | 9DCCD3AD886B4140BDE9B440A8671BF5 |
| 10 | DatabaseUpgrade | EDA99BBF68B94E80BE30E4817F7621C7 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s8-coll-distinct --force`.
