# r11-ac-attribute-actions

Delete and purge of an ac_PolicyAccessItemAttribute. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: R11 (ticket 05).

## Exercises

build.xsl for ac_PolicyAccessItemAttribute: 12.0 lists it in neither the edit list nor the unlisted-types list, so every action of it goes to the last bucket, after the Variable add. 14.0.7 would drop the delete and the purge. The ids exist nowhere.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-ACACT` | defaults | success (0) | 0 | 27 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 5

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | B279961B81364E1AA33DDC4054541144 |
| 2 | PackageDefinition | 6EF2CECDEE1B428C91D2043007596E53 |
| 3 | Variable | 4811409318570F0FC3A8096F18B1E8BD |
| 4 | PackageGroup | 00E6B49C63DB44CD82B719C1473FEFC2 |
| 5 | PackageElement | F80401FC4E524183AA0033C05F3DB8D1 |

### Deleted by the cleanup: 5

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | F80401FC4E524183AA0033C05F3DB8D1 |
| 2 | PackageGroup | 00E6B49C63DB44CD82B719C1473FEFC2 |
| 3 | Variable | 4811409318570F0FC3A8096F18B1E8BD |
| 4 | PackageDefinition | 6EF2CECDEE1B428C91D2043007596E53 |
| 5 | DatabaseUpgrade | B279961B81364E1AA33DDC4054541144 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only r11-ac-attribute-actions --force`.
