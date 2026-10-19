# Live parity for 14.35: the port against the DLL on dev, and 14.35's final slice

Wayfinder ticket 76, part B. `npm run parity -- --engine 14.35` ran the oracle (the vendored `Libs.dll` 14.35.0.43890 through the Windows host) and the port on the same inputs against the dev instance (Aras 12.0 SP9 build 24090, database `12sp9`, user `root`), case by case, on 2026-10-20. Part A, the export side, is [`live-parity-14.35-export.md`](live-parity-14.35-export.md); this record adds the import side and the DB patch, reruns the export side with the code of this PR, and ends with the completion of the engine. The command is described in `oracle/README.md`, "Live parity".

Per the round 5 correction, **equal cases do not prove the engines the same.** They show that these inputs reach no difference.

## What was compared

As for 14.0.7 and part A (the request AML, the output folder, the log, the messages by channel, the console text, how the run ended and the host's exit code, after the normalisations below), with 14.35's exports compared by EXP-558 because the items of a package run in parallel. Imports and DB patches do not race and are compared request for request, in full.

| Family | Cases | Equal | Different | Skipped |
|---|---|---|---|---|
| Import on `LIBSJS-SCRATCH-*` copies (tickets 25, 53, 55, 73 and 75): 71 cases, 81 steps and 4 698 oracle requests in the first pass | 71 | 66 | 0 | 5 |
| DB patch with the committed no-op patch (ticket 72): as `root`, again, and as `admin` | 2 | 2 | 0 | 0 |
| Language-pack import (`lp01` to `lp08`) | 8 | 0 | 0 | 8 |
| Export catalogue and the cases of the 14.35 export rules (read-only), rerun | 104 | 104 | 0 | 0 |
| Scratch-seeded export, rerun | 24 | 14 | 0 | 10 |
| Console export modes, rerun (`--all-packages`, 10 463 requests a side, is part A's) | 5 | 5 | 0 | 0 |

The import family was run once (57 equal, 9 different, 5 skipped), and its 9 differences were fixed (below) and rerun (9 equal), so 66 are equal. The export, scratch-export, console-mode and DB patch families were then run again with the final code: 125 equal, 10 skipped, 4 277 requests on the oracle's side.

**Skipped, for the Languages dev does not have.** Dev has `en` only. Adding a Language adds a column to every table with a multilingual property, which is not clearly non-destructive, so the script never adds or removes one, and skips a case that needs them with the reason:
- the 5 import cases whose recorded result needs `de` and `fr` installed (`lang-select-de`, `lang-star-installed`, `lang-unset-installed`, `lang-two-packages`, `lang-batch-select`);
- the 8 language-pack cases (they also need the two scratch Forums of `setup.aml`);
- the 10 `lang-ml` cases (the language-resource modes on translated values).

The port's side of these is replayed offline against the recorded runs (`oracle/src/parity/port-run-import-1435.test.ts`, `port-run-1435.test.ts`, no server): the language selection, `lp01` and `lp05` to `lp08`, and the language-resource cases that dev's `en` allows. The captain can add the Languages as `fixtures/14.35/language-pack/README.md` says, run `npm run parity -- --engine 14.35 --kind language-pack,import,scratch-export`, and remove them again.

## What the run found

**The port.** One difference in the live import run, `lang-scan-stray-file`: the scan of the package folders (IMP-612) ends with an `AggregateException` whose first line the DLL shows as `System.AggregateException: One or more errors occurred. ---> System.Xml.XmlException: Data at the root level is invalid. Line 1, position 1.`, and the port showed it without the inner exception. `Exception.ToString()` passes the first inner exception to the base class, so the first line continues with its own (`exceptionText` in `src/language-pack/exception-text.ts`). The recorded fixture already held it; the replay test had compared the two halves separately, so it did not see the line. It is fixed, and the offline replay of the recorded run is equal (`port-run-import-1435.test.ts`).

No case differed in the requests, the files, the log, the messages or the return code in any other way. The two differences the DLL's code shows and dev cannot, below, were found while mapping the methods.

**By reading the code.** Mapping the 34 unmapped 14.35 methods meant reading each against its 14.0.7 twin (`.decomp/14.35/` against `.decomp/14.0.7/`, method by method). They do the same work, with these changes: the caches of the unknown-package removal are `ConcurrentDictionary` fields now (the items of a package run in parallel), and the element ids of a package are cached as a `Lazy`. A `Lazy` keeps the exception of a failed factory, so a failed R1 lookup stays failed for the run, where 14.0.7 and 12.0 ask again. That is a new engine bug, **EXP-621** (`spec/export-unknown-refs.md`, `spec/bugs.md`), and the port reproduces it (`src/client/package-lookups.ts`, `package-lookups.test.ts`). It is inferred from the code, not seen: a failing R1 needs the connection to fail during a run. The workers that ask together share one request, as the engine's `Lazy` makes them. Every other rule of `EXP-600` to `EXP-620` now has a `[14.35]` variant that says it is the same, and `EXP-615`, `EXP-619` and `EXP-620` list 14.35 in `bugs.md`.

**The harness.** Things the first live passes showed that were the script's, fixed in `oracle/src/parity/`:
1. 14.35's AML batch mode logs and sends its elapsed times (`AML batch time: 00:00:00.0237003`): 9 batch cases differed only there. Durations are normalised, as the date-times are.
2. The ISO date-times of the items a server answers with (`created_on`, `date_applied`) differ between two runs: normalised with the date-times.
3. A DB patch run stages its manifest in the working directory, whose path the log and messages show with `\` on Windows and `/` here, and the Windows path appears in messages as well as in the log: the working directory and the slashes below it are normalised in both. The ids the DB patch makes up (the engine gives the `id` of the items it adds; the server gives the "Applied Updates" item's) are numbered like the ids the server assigns.
4. The oracle's host runs the steps of `lpimport` without ConsoleUpgrade's `catch` (no log line, and a `CItemException` is an exception, not a return of 1); the port's `languagePackImport` takes the option `hostCatch` (default true) and the script turns it off. The folder the language-pack preprocessor makes in the temporary folder (`LanguagePack_<random>`) is the run's own and is normalised.
5. A report's `deleted` list now holds what the port's cleanup deleted as well as the oracle's.

**The known difference of 14.0.7 is gone.** `fs-odd-files` (a file whose extension only starts with `xml`, listed through its 8.3 name) was a known difference in `roadmap/live-parity-14.0.7.md`; PR #87 closed it, and the case is now equal on 14.0.7 and on 14.35. `KNOWN_DIFFERENCES` is empty.

**Enabled by the run.** `export --use-import` was refused for 14.35 until the slice that enables it (HOST-113). `mode-use-import-scratch` and `mode-use-import-absent-items` were equal on dev, and the probe of ConsoleUpgrade's loop on 14.35 replays equal, so the mode is offered for all three engines now.

## What dev held

Before the runs and after them, dev had no PackageDefinition and no DatabaseUpgrade named `LIBSJS-SCRATCH-*` (the script checks this before it starts, and the cleanups check it after each case). The import family's two sides created 1 946 scratch items in all, and each side's cleanup deleted its own again, newest first, each item only after the cleanup read the owner's name (a cleanup that left an item behind would have stopped the run with exit status 3; none did). The ids are in the run's `report.json`. The DB patch cases created 6 items (a `DatabaseUpgrade` row for release `99.99`, an "Applied Updates" item `LIBSJS-SCRATCH-001` and the `DatabaseUpgradePatch` link, three for each side) and deleted them with the oracle's DB patch cleanup, which deletes an item only when it matches the test patch and reads back that nothing of the release or the number is left. The patch is the committed no-op of DBP-070 (`return this;`), and both sides refuse any other (DBP-071). No Language was added or removed.

## 14.35 is complete

Every reachable 14.35 method of `spec/source-map.json` is mapped or `not-ported`: the 34 that were unmapped (`CItemHelper`, `ImportExportManager.ImportPackage`, `CheckWorkItem` and the constructor, `RemovedReference`, `InnovatorServer.GetInnovatorServerPath` and the closures of their lambdas) are, so this PR adds `14.35` to `COMPLETE_ENGINES` (`src/engines.ts`) and clears `inProgress` on its build (`AGENTS.md` rule 3). From now on an unmapped 14.35 method fails the gate. All three engines are complete.

Not done: 12.0 has had no live parity run (`COMPLETE_ENGINES` has it from ticket 50, which built its variants offline), and ticket 65 runs the final `npm run parity` across all three engines.
