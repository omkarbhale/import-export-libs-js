# non-root

The login is not root. Engine 14.35, `ApplyDBUpdateManifest` on the dev instance with the committed no-op test patch (`oracle/dbpatch/`, DBP-070): manifest entry `LIBSJS-SCRATCH-001`, release `99.99`, tool name `Libs`.

## Exercises

The `admin` login (a different user from the profile's `root`, with the same password) is refused by the engine's own name check before any DB request: the log header, the start lines, the `error` message and the end lines, and no `ValidateUser`, `GetItem`, `ApplyItem` or `ApplyUpdate` call after the engine's own login. Nothing is created.

## Steps

One oracle `dbpatch` run. It deletes what it created when it is done.

| Step | Name | Login | Expected | Host exit | Calls | `error` messages |
|---|---|---|---|---|---|---|
| 1 | admin login | `admin` | refused: Login name is not root. It is 'admin'. Check your config file. | 2 | 6 | 1 |

## Ids created and deleted

Created, per step, in the order the run made them: the `DatabaseUpgrade` row (an `add` the recorder saw), the "Applied Updates" item (the item `ApplyUpdate` answered with) and the `DatabaseUpgradePatch` link. A second run creates nothing: its `ApplyUpdate` is refused.

### Step 1: created 0

None.

### Deleted by the cleanup: 0

Newest first. A delete needs the item to match the test patch (the row: name, release and type; the update: `up_number`; a link: its update's `up_number`), and a read-back then found no item of release `99.99` or number `LIBSJS-SCRATCH-001`. Nothing was kept, and nothing is left on the server.

None.

## Spec rules

DBP-003, DBP-005, DBP-010, DBP-050 (`spec/db-patches.md`).

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

Re-record: `ARAS_PASSWORD=… npm run oracle:dbpatch-cases -- --only non-root --force`.
