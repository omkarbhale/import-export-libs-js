# s0-mini-locked-row

A re-import when the package's DatabaseUpgrade row is locked. Engine 14.0.7, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, DatabaseUpgrade row locked (ticket 05).

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
| 1 | DatabaseUpgrade | 1F503413D1EE4D1CB890515A8A9AC76F |
| 2 | PackageDefinition | D1729FD20212492586FBE07DA2347F45 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | 125A3D9EB1524AD2A82D096F568C82A7 |
| 5 | PackageElement | 77F9DE2333334743BED46C98E35BFB86 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 4215DB04D0C945FA91B2705B9E035CBF |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 87D8278F18B847748EDF396A73A962DF |
| 10 | PackageElement | 590FA2E56F1145779A1F7756695EE43B |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | C0DB94FB9AA0491BBA7FB963C6F16F23 |
| 13 | PackageElement | 236BF875DEBC4BFD80408417F26BD34A |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 3C0FD51681BF45269C207095844CD7E5 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | 66F916B596514B4B8D1FF368FFDF1E0A |

### Step 2: created 0

None.

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | 66F916B596514B4B8D1FF368FFDF1E0A |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | 3C0FD51681BF45269C207095844CD7E5 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | 236BF875DEBC4BFD80408417F26BD34A |
| 6 | PackageGroup | C0DB94FB9AA0491BBA7FB963C6F16F23 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 590FA2E56F1145779A1F7756695EE43B |
| 9 | PackageGroup | 87D8278F18B847748EDF396A73A962DF |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 4215DB04D0C945FA91B2705B9E035CBF |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | 77F9DE2333334743BED46C98E35BFB86 |
| 14 | PackageGroup | 125A3D9EB1524AD2A82D096F568C82A7 |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | D1729FD20212492586FBE07DA2347F45 |
| 17 | DatabaseUpgrade | 1F503413D1EE4D1CB890515A8A9AC76F |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --only s0-mini-locked-row --force`.
