# s0-mini-locked-row

A re-import when the package's DatabaseUpgrade row is locked. Engine 14.35, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, DatabaseUpgrade row locked (tickets 05 and 75).

## Exercises

WriteReleaseData's unlock path: the lock check (`locked_by_id`), the unlock, then the edit. The host locks the row between the steps, outside the recording.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | first import | `LIBSJS-SCRATCH-MINI` | merge=true | success (0) | 0 | 58 |
| 2 | import with the row locked | `LIBSJS-SCRATCH-MINI` | merge=true, lockUpgradeRows=true | success (0) | 0 | 50 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 1B94A7858F184F87836DFD66A47B3313 |
| 2 | PackageDefinition | 6851D4E8331D4595A2641E07DF95BF85 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 0FFD5D3D92DF4FF6AF677B10461941FA |
| 5 | PackageElement | 7266363899784C648F6E0E5C30761512 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | FF4576B6BF5A49229446DC24F6AA7034 |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | A2502B88BAC44485B26C0F15CCD4760D |
| 10 | PackageElement | 4EE7C0B408DA485385A786F5053B8F1A |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 7CEE5475F94C45BE9D643AE6F5043DCA |
| 13 | PackageElement | FBF5AE9FD25F460A8E01A4D8044B0F85 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | C4998C74713549179A86F9D1CD5A4562 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | B82EB8CAF3A945A8875F9BF8EBEA3C7F |

### Step 2: created 0

None.

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | B82EB8CAF3A945A8875F9BF8EBEA3C7F |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | C4998C74713549179A86F9D1CD5A4562 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | FBF5AE9FD25F460A8E01A4D8044B0F85 |
| 6 | PackageGroup | 7CEE5475F94C45BE9D643AE6F5043DCA |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 4EE7C0B408DA485385A786F5053B8F1A |
| 9 | PackageGroup | A2502B88BAC44485B26C0F15CCD4760D |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | FF4576B6BF5A49229446DC24F6AA7034 |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | 7266363899784C648F6E0E5C30761512 |
| 14 | PackageGroup | 0FFD5D3D92DF4FF6AF677B10461941FA |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 6851D4E8331D4595A2641E07DF95BF85 |
| 17 | DatabaseUpgrade | 1B94A7858F184F87836DFD66A47B3313 |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 14.35 --only s0-mini-locked-row --force`.
