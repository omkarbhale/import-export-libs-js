# s0-mini-release-description

Release and Description both set. Engine 12.0, import, recorded on dev against `LIBSJS-SCRATCH-*` packages only. Catalogue: S0, release/description both set (ticket 05).

## Exercises

The DatabaseUpgrade row carries target_release and description; the in-progress and success writes.

## Steps

One oracle `import` run. It deletes what it created when it is done.

| Step | Name | Packages | Options | Expected | Engine returned | Calls |
|---|---|---|---|---|---|---|
| 1 | import | `LIBSJS-SCRATCH-MINI` | release="LIBSJS-SCRATCH-R1", description="scratch import run" | success (0) | 0 | 54 |

## Ids created and deleted

Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):

### Step 1: created 17

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | ED8C6E9DDE1942CF87BAC62325C1D65F |
| 2 | PackageDefinition | 905DFDFD8543439BAC074F1E3E9CDDA6 |
| 3 | List | C6018EE6DD2187000216C39E55D07AAE |
| 4 | PackageGroup | F8F03A5CE57F4137BC6123FA729FA364 |
| 5 | PackageElement | DE33714234524F76B5F3CEAAEEF3C576 |
| 6 | List | E182B4D73FB907759D5E1BA11441412D |
| 7 | PackageElement | 102E4D3F30644F99945B4BA503E64A8B |
| 8 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 9 | PackageGroup | 748E4975DE61485D8F016A616ABBB847 |
| 10 | PackageElement | 442AFE87C6C148F4BC8D5D0B42867DAE |
| 11 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 12 | PackageGroup | EBABC7F90E7842318E74A00686DB8705 |
| 13 | PackageElement | B4ABE245CC234FDEB699832E3B37B674 |
| 14 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 15 | PackageElement | 208369C71AF94C74B990D52A17DE50A0 |
| 16 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 17 | PackageElement | E2B62604EA6F4A1AA2EE382021E2396F |

### Deleted by the cleanup: 17

Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | PackageElement | E2B62604EA6F4A1AA2EE382021E2396F |
| 2 | Variable | DFF8CFAAEDCFDEAAB1DDB1DAB96BC23D |
| 3 | PackageElement | 208369C71AF94C74B990D52A17DE50A0 |
| 4 | Variable | 6E6B61827EA6F5DB6F735218645E60F3 |
| 5 | PackageElement | B4ABE245CC234FDEB699832E3B37B674 |
| 6 | PackageGroup | EBABC7F90E7842318E74A00686DB8705 |
| 7 | Variable | C64257819194D0C9B4C3BDF82D642D78 |
| 8 | PackageElement | 442AFE87C6C148F4BC8D5D0B42867DAE |
| 9 | PackageGroup | 748E4975DE61485D8F016A616ABBB847 |
| 10 | Sequence | 39AADEEB61E0B66B7E4EFAC25E18229E |
| 11 | PackageElement | 102E4D3F30644F99945B4BA503E64A8B |
| 12 | List | E182B4D73FB907759D5E1BA11441412D |
| 13 | PackageElement | DE33714234524F76B5F3CEAAEEF3C576 |
| 14 | PackageGroup | F8F03A5CE57F4137BC6123FA729FA364 |
| 15 | List | C6018EE6DD2187000216C39E55D07AAE |
| 16 | PackageDefinition | 905DFDFD8543439BAC074F1E3E9CDDA6 |
| 17 | DatabaseUpgrade | ED8C6E9DDE1942CF87BAC62325C1D65F |

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

Re-record: `ARAS_PASSWORD=… npm run oracle:import-cases -- --engine 12.0 --only s0-mini-release-description --force`.
