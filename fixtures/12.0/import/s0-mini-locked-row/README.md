# s0-mini-locked-row

A re-import when the package's DatabaseUpgrade row is locked. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, DatabaseUpgrade row locked (ticket 05).

## Exercises

WriteReleaseData's unlock path: the lock check (`locked_by_id`), the unlock, then the edit. The host locks the row between the steps, outside the recording.

## Steps

Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | first import | `LIBSJS-SCRATCH-MINI` | merge=true | success (0) | 0 | 57 |
| 2 | import with the row locked | `LIBSJS-SCRATCH-MINI` | merge=true, lockUpgradeRows=true | success (0) | 0 | 49 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 22837A3B983F43F595DAFCD13071762A |
| 2 | PackageDefinition | E6BDC6E7859C4E699CD4BC3E0E2AFF3F |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 4E397A4BD29E431DA9A2793BF193334C |
| 5 | PackageElement | C0A24AE83D18487BA061C9F8FD8490D6 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | F012C4327BB645C4BB7CD46DCFF3081C |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | EA52D1A7EA164546929732724BDA4EE2 |
| 10 | PackageElement | 39670C5C897341B395BE7C0ACBEA0847 |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | 27F04066C3A34D1B9CA707BE048C6FA2 |
| 13 | PackageElement | 959A2CB548DD4A7FBDB3EBC9C7196BC7 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | F829C2B32CC1488FA5F64B9162243A67 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 697E185D2F934289851149B9EAECD2E5 |

### Step 2: created 0

None.

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 697E185D2F934289851149B9EAECD2E5 |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | F829C2B32CC1488FA5F64B9162243A67 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 959A2CB548DD4A7FBDB3EBC9C7196BC7 |
| 6 | PackageGroup | 27F04066C3A34D1B9CA707BE048C6FA2 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 39670C5C897341B395BE7C0ACBEA0847 |
| 9 | PackageGroup | EA52D1A7EA164546929732724BDA4EE2 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | F012C4327BB645C4BB7CD46DCFF3081C |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | C0A24AE83D18487BA061C9F8FD8490D6 |
| 14 | PackageGroup | 4E397A4BD29E431DA9A2793BF193334C |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | E6BDC6E7859C4E699CD4BC3E0E2AFF3F |
| 17 | DatabaseUpgrade | 22837A3B983F43F595DAFCD13071762A |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s0-mini-locked-row --force`.
