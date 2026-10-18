# apply

The no-op test patch, applied and applied again. Engine 14.35, `ApplyDBUpdateManifest` on the dev instance with the committed no-op test patch (`oracle/dbpatch/`, DBP-070): manifest entry `LIBSJS-SCRATCH-001`, release `99.99`, tool name `Libs`.

## Exercises

The success path of `ApplyDBUpdateManifest` with the committed no-op patch (DBP-070) as `root`: `ValidateRootUser`'s four requests, the new `DatabaseUpgrade` row, `ApplyUpdate`, the `DatabaseUpgradePatch` link and the row's status edit. Step 2 runs the same patch again before the cleanup: the row now exists (the edit path of DBP-030) and the server refuses `ApplyUpdate` with a fault, because the number was already applied (DBP-042). That is an `error` message and a failed run, not an exception, and the row ends with status 2 (DBP-044).

## Steps

Each step is one oracle `dbpatch` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created.

| Step | Name | Login | Expected | Host exit | Calls | `error` messages |
|---|---|---|---|---|---|---|
| 1 | first run | `root` | applied | 0 | 16 | 0 |
| 2 | second run, same patch | `root` | patch-failed | 1 | 15 | 1 |

## Ids created and deleted

Created, per step, in the order the run made them: the `DatabaseUpgrade` row (an `add` the recorder saw), the "Applied Updates" item (the item `ApplyUpdate` answered with) and the `DatabaseUpgradePatch` link. A second run creates nothing: its `ApplyUpdate` is refused.

### Step 1: created 3

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgrade | 86667168B1724130BA501C7AC81906B3 |
| 2 | Applied Updates | 17DB84D6D4C64E06A499D610C5F250D0 |
| 3 | DatabaseUpgradePatch | 619AFE978CE94A19BCFDEA07327A916A |

### Step 2: created 0

None.

### Deleted by the cleanup: 3

Newest first. A delete needs the item to match the test patch (the row: name, release and type; the update: `up_number`; a link: its update's `up_number`), and a read-back then found no item of release `99.99` or number `LIBSJS-SCRATCH-001`. Nothing was kept, and nothing is left on the server.

| # | Type | Id |
|---|---|---|
| 1 | DatabaseUpgradePatch | 619AFE978CE94A19BCFDEA07327A916A |
| 2 | Applied Updates | 17DB84D6D4C64E06A499D610C5F250D0 |
| 3 | DatabaseUpgrade | 86667168B1724130BA501C7AC81906B3 |

## Spec rules

DBP-002, DBP-011, DBP-012, DBP-020, DBP-021, DBP-022, DBP-030, DBP-040, DBP-041, DBP-042, DBP-043, DBP-044, DBP-060, DBP-061 (`spec/db-patches.md`).

## Files

Each `step-<n>/` folder:

| File | What |
|---|---|
| `run.json` | the oracle's run record: toolset identity, parameters, host info (`errorMessages` counts the texts on the `error` channel) and the cleanup report (created, deleted, kept) |
| `transcript.jsonl` | every call below `CallAction`: the engine's login, `ValidateUser`, `GetItem`, `ApplyItem`, `ApplyUpdate`. Quote marks are those of the DOM IOM serialises, not of the engine's source literals |
| `messages.jsonl` | the engine's messages, by channel |
| `engine.log` | the engine's own log |
| `host.log` | the host's console output |
| `input/` | the manifest and the patch file the engine read |

Times, the run folder's path and the host's `os_user` are those of the recording machine.

Re-record: `ARAS_PASSWORD=… npm run oracle:dbpatch-cases -- --only apply --force`.
