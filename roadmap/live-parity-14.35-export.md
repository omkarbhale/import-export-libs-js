# Live parity for 14.35, export side: the port against the DLL on dev

Wayfinder ticket 76, part A. `npm run parity -- --engine 14.35` ran the oracle (the vendored `Libs.dll` 14.35.0.43890 through the Windows host) and the port on the same inputs against the dev instance (Aras 12.0 SP9 build 24090, database `12sp9`, user `root`), case by case, on 2026-10-19 and 2026-10-20. This record is that run. The command is described in `oracle/README.md`, "Live parity", and the 14.0.7 run is in [`live-parity-14.0.7.md`](live-parity-14.0.7.md).

Part A is the export side: export, parallel export, the language-resource modes that need no translated data, the scratch-seeded exports and the console modes. Part B is the import side (import, language selection, lpimport, batch mode, collected errors, the DB patch) and 14.35's final slice (`COMPLETE_ENGINES`, `inProgress`, the unmapped methods). **14.35 is not complete after this record.**

Per the round 5 correction, **equal cases do not prove the engines the same.** They show that these inputs reach no difference.

## What was compared, and how

14.35 exports the items of a package in parallel (EXP-551), so the oracle's run and the port's cannot agree request for request, line for line. The 14.35 cases are compared by EXP-558 (`oracle/src/parity/diff-1435.ts`):

- the login and the version probe, in order;
- the other requests, as a set (two workers that miss a cache together send the same lookup twice: `mode-from-manifest-unknown-package` has 27 oracle requests and 25 port requests, and the same distinct requests);
- the log header and every package header, in order; the success lines of a package as a multiset; the other lines between `start of execution` and `end of execution`;
- the `currentPackage`, error, warning and question messages, in order; the item status texts as a set (the engine's workers can send one text twice and drop another: EXP-553);
- the output folder, byte for byte, when no failure or cancel stopped the run; otherwise the manifest and the bytes of every file both sides wrote (EXP-572);
- how the run ended, the console text and the host's exit code.

A package with one item has nothing racing, and is compared in full, in order, as for 14.0.7. The normalisations are 14.0.7's and nothing more: the ids the server assigned, the date-times of the log and the run's own paths. The port runs with its default `parallelism`, one item per logical processor.

| Family | Cases | Equal | Different | Skipped | Requests (oracle side) |
|---|---|---|---|---|---|
| Export catalogue and the cases of the 14.35 export rules (ticket 57; read-only): the catalogue of ticket 05, the unknown-package modes, parallel runs 1 to 3, first-failure and cancel cases, the language modes that need no translated data | 104 | 104 | 0 | 0 | 3 767 |
| Scratch-seeded export (tickets 57 and 67) | 24 | 14 | 0 | 10 | 306 |
| Console export modes: `--from-manifest` ×3, `--use-import` ×2, `--all-packages` | 6 | 6 | 0 | 0 | 10 629 |

`--all-packages` exported all packages of dev, 10 463 requests each side, in 221 s; the output tree is byte for byte equal.

The ten skipped cases are the group `lang-ml` (the language-resource modes on translated values). They need the Languages `de` and `fr` on dev, which dev does not have. Adding a Language adds a column to every table with a multilingual property, which is not clearly non-destructive, so the script does not add one and skips them with the reason (`seedGroupPrecondition`). Before part B ends, the captain can add the Languages as `fixtures/14.35/language-pack/README.md` says and run `npm run parity -- --engine 14.35 --case lang-only-star-itemtype,…`. The port's side of these cases is replayed offline against the recorded runs (`oracle/src/parity/port-run-1435.test.ts`: `lang-only-de-instances`, `lang-both-packages-only-star`, `l1-only-star`, `l1-meta-star` equal under the same comparison, no server).

## What the run found

**The port.** No difference. No case differed in the requests, the output, the log, the messages or the return code. Nothing becomes a fixture, a fix or an entry in `spec/bugs.md` from this run.

**The harness.** Three things in the first live passes were the script's, and are fixed in `oracle/src/parity/` and `oracle/host/`:

1. The port's runner refused the 14.35 options (`engineAction`, `languages`, `cancelAfterStatus`) and made the manager with `new`, which does not resolve the language list; it now makes it with `ImportExportManager.create` (LP-110), applies the options as the host does and presses `Cancel()` after the Nth status message as the host's `CancelTrigger` does. 14.35 never reads the answer to the error question (EXP-555, EXP-571), so none is given.
2. `p5-ref-on` differed in the order of two requests and two log lines. It lists one item per package, but the pass over the referenced items (EXP-543) exports several items at a time in each package, so the case was compared in order. A run with `exportReferencedItems` is now compared as racing, and `diff-1435.test.ts` pins it. The rerun is equal.
3. `engine-14.35.ps1` lacked the host parameters `ConsoleMode`, `ConsolePath` and `ExpectedConsoleSha256`, so the five console modes failed before they started. They are added as in `engine-14.0.7.ps1`; all six are equal.

## What dev held

Before the runs and after them, dev had no PackageDefinition and no DatabaseUpgrade named `LIBSJS-SCRATCH-*` (the script checks this before it starts, and the cleanups check it after each case). The scratch items the seeds and the console-mode imports created were deleted again, newest first, each only after the cleanup read the owner's name: 404 created and 404 deleted in the scratch-seeded run, 13 and 13 in the rerun of `p5-ref-on`, 34 and 34 in the console modes. The ids are in each run's `report.json`. Nothing was written to dev by an export.

## Not run, and left to part B

- The import side of 14.35 and its DB patch, and the language-resource cases above.
- 14.35's final slice: 34 reachable methods of the build are still unmapped in `spec/source-map.json` (`CItemHelper`, `ImportExportManager.ImportPackage` and `CheckWorkItem`, `RemovedReference`, `InnovatorServer.GetInnovatorServerPath`), so `14.35` stays out of `COMPLETE_ENGINES` and its build stays `inProgress`.
