# r15-utf16-no-bom

A UTF-16LE item file with no byte-order mark. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: R15 (ticket 05).

## Exercises

XmlDocument.Load recognises UTF-16 without a mark when the file starts with '<', so the item is imported; 14.0.7 fails the load.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-FSUTF16NOBOM` | defaults | success (0) | 0 | 23 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 91F1489A3DAA4A4CA5A2C253AE48C2A4 |
| 2 | PackageDefinition | 0977F1DFB92049AD96C6E66177D54A5A |
| 3 | Variable | DF49D631DA2FC3854888CFC00FD37AD6 |
| 4 | PackageGroup | 36E2804F339247B7984943F5E88BD41F |
| 5 | PackageElement | B95D9A3B9F7C484B8C2E1EC42B3C780D |

### Deleted by the cleanup: 5

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | B95D9A3B9F7C484B8C2E1EC42B3C780D |
| 2 | PackageGroup | 36E2804F339247B7984943F5E88BD41F |
| 3 | Variable | DF49D631DA2FC3854888CFC00FD37AD6 |
| 4 | PackageDefinition | 0977F1DFB92049AD96C6E66177D54A5A |
| 5 | DatabaseUpgrade | 91F1489A3DAA4A4CA5A2C253AE48C2A4 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only r15-utf16-no-bom --force`.
