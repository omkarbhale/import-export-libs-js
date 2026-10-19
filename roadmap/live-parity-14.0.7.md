# Live parity for 14.0.7: the port against the DLL on dev

Wayfinder ticket 44. `npm run parity -- --engine 14.0.7 --include-slow` ran the oracle (the vendored `Libs.dll` 14.0.7.35492 through the Windows host) and the port on the same inputs against the dev instance (Aras 12.0 SP9 build 24090, database `12sp9`), case by case, on 2026-10-19. This record is that run. The command is described in `oracle/README.md`, "Live parity".

Per the round 5 correction, **equal cases do not prove the engines the same.** They show that these inputs reach no difference. What the run can do is find the differences the recorded fixtures could not, because the fixtures were replayed against recorded answers and this run asked a live server.

## What was compared

For each case, the request AML in order (the login and the version probe included; the envelope and the headers are not recorded), the output folder byte for byte, the engine log, the messages by channel, the console text, and how the run ended (the value `ImportSolutions` returned, or the exception's type and message, and the host's exit code). Only these were normalised: ids the server assigned during the run, the date-times of the log, and the run's own paths. The oracle's credential scrubber was applied to the port's side as well, because the oracle stores `collection["password"]` in an item's code as `…=SCRUBBED"password"]`.

| Family | Cases | Equal | Known difference | Skipped | Requests compared (oracle side) |
|---|---|---|---|---|---|
| Export catalogue (ticket 05, read-only; includes `RemoveSilently`, `RemoveWithWarning` and `DoNotRemove`) | 75 | 75 | 0 | 0 | 3 001 |
| Scratch-seeded export (ticket 67) | 14 | 14 | 0 | 0 | 280 |
| Import on `LIBSJS-SCRATCH-*` copies (ticket 25), 37 cases, 50 steps in all | 37 | 36 | 1 | 0 | 3 599 |
| Language-pack import (ticket 45) | 5 | 0 | 0 | 5 | 0 |
| Console export modes (ticket 66): `--from-manifest` ×3, `--use-import` ×2, `--all-packages` | 6 | 6 | 0 | 0 | 22 683 |
| **Total** | **137** | **131** | **1** | **5** | **29 563** |

The console modes were run with Aras's own `ConsoleUpgrade.exe` `ProcessExport` for the oracle (the table is built by Aras's loops) against the port's `src/cli/console-modes.ts`. `--all-packages` exported all 55 packages of dev, 10 100 elements, in 22 534 requests each side, and its output tree (about ten thousand files and `imports.mf`) is byte for byte equal.

## What the run found

**The port.** One difference: `fs-odd-files`, below. No case differed in the requests, the output, the log, the messages or the return code in any other way.

**The harness.** Eight things in the first live passes were the script's, and are fixed in `oracle/src/parity/`; each is a reason a replay against recorded answers could not have shown the difference:

1. The oracle host sends no `Logoff` (its connection is not the exact `HttpConnectorExtension` that `CItemHelper.Logout` logs off, WIRE-040); the port's connection is a subclass for the same reason.
2. The unknown-package dependency table outlives a helper (EXP-619). The oracle runs each case in a process of its own; the port ran the cases in one, so a later case found a table an earlier one had filled (`e06-scopecachedependency-removewithwarning` sent 92 requests instead of 94). Each port run now starts with the table empty.
3. The ids the server assigns (PackageDefinition, PackageGroup and the rest) differ per run; they are numbered in order of first appearance, across the steps of a case, and with the new generations that `versionBefore` makes before the run.
4. The oracle scrubs the files it collects (`password` in item code), so the port's side is scrubbed the same way.
5. A committed fixture cannot hold an empty folder; the live trees can, and both are compared.
6. The port's work folder has to exist before the engine opens its log.
7. The port's temporary language-pack package is outside the working directory, as the oracle's is.
8. One import step of `s4-del-refused` once ended with no result and no error on the oracle side (a transient failure of the host or the server); its rerun was equal.

## Known difference: `fs-odd-files`

Step 1 of `fs-odd-files` imports the same six items in a different order. The engine lists a package folder with `Directory.GetFiles(*.xml)`, and NTFS also matches a file whose extension only starts with `xml` (`LIBSJS-SCRATCH-Fs_Backup.xmlbak`) through its 8.3 short name, at the short name's place in the directory index. The port's loader (IMP-003, IMP-004) orders by long name, so that file reaches the run elsewhere. The recorded fixture `fixtures/14.0.7/import/fs-odd-files/` pins the engine's order (the replay test skips the step, `KNOWN_LOADER_GAPS` in `src/import/import-run.replay.test.ts`), and the map lists it as a follow-up of ticket 40. It is a gap of the port, not an engine bug, so it is not in `spec/bugs.md`; closing it needs 8.3 short-name generation and the NTFS index order, a ticket of its own. The script reports it as `known` (`oracle/src/parity/known.ts`) so that a run fails only on a new difference, and says when the entry can go.

## Not run

- **Language-pack import (5 cases)** needs the Languages `de` and `fr` and two scratch Forums on dev (`fixtures/14.0.7/language-pack/setup.aml`). Dev has `en` only, and adding a Language adds a column to every table with a multilingual property, which is not clearly non-destructive, so the script does not add one and skips the cases with the reason. The port's side of these runs was checked against the recorded runs of ticket 45 (`oracle/src/parity/port-run.test.ts`: `lp01`, `lp04`, `lp05` equal, no server). The captain can apply `setup.aml` and run `npm run parity -- --kind language-pack`, then `teardown.aml`.
- **12.0 and 14.35** are out of this ticket (14.0.7 only); the script lists `PARITY_ENGINES` and the host options for them arrive with tickets 50 and 76.

## What dev held

Before the run and after it, dev had no PackageDefinition and no DatabaseUpgrade named `LIBSJS-SCRATCH-*` (the script checks this before it starts and the cleanups check it after each case). The scratch items every import case and seed created were deleted again by the side that made them, newest first, each only after the cleanup read the owner's name; no cleanup kept or left unverified an item. The ids are in the run's `report.json`.

## 14.0.7 is complete

Every reachable 14.0.7 method of `spec/source-map.json` is mapped or `not-ported`, so this PR adds `14.0.7` to `COMPLETE_ENGINES` (`src/engines.ts`) and clears `inProgress` on its build (`AGENTS.md` rule 3). From now on an unmapped 14.0.7 method fails the gate.
