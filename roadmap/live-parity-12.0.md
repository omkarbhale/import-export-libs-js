# Live parity for 12.0: the port against the DLL on dev

Wayfinder ticket 44, reopened by the captain on 2026-10-20 ("other than language things not on my dev server, go ahead and implement 12.0 for parity, and anything else that we might have missed"). `npm run parity -- --engine 12.0` ran the oracle (the vendored `Libs.dll` 12.0.0.13341 through the Windows host) and the port on the same inputs against the dev instance (Aras 12.0 SP9 build 24090, database `12sp9`), case by case, on 2026-10-20. The command and what it compares are those of `roadmap/live-parity-14.0.7.md` and `oracle/README.md`, "Live parity": the request AML in order (the login and the version probe included), the output folder byte for byte, the engine log, the messages, the console text, and how the run ended. Only the server's ids, the log's date-times and the run's own paths are normalised.

Per the round 5 correction, **equal cases do not prove the engines the same.** They show that these inputs reach no difference.

## Result

| Family | Cases | Equal | Difference | Requests compared (oracle side) |
|---|---|---|---|---|
| Export catalogue (ticket 05, read-only; includes `RemoveSilently`, `RemoveWithWarning` and `DoNotRemove`) | 75 | 75 | 0 | 2 542 |
| Scratch-seeded export (ticket 67's groups, seeded with the 12.0 oracle) | 14 | 14 | 0 | 254 |
| Import on `LIBSJS-SCRATCH-*` copies, 40 cases (the 37 shared and the three `r*` cases of 12.0's variant rules), 53 steps in all | 40 | 40 | 0 | 3 608 |
| Console export modes, with 12.0's own `ConsoleUpgrade.exe` `ProcessExport`: `--from-manifest` ×3, `--use-import` ×2 | 5 | 5 | 0 | 131 |
| Console export mode `--all-packages`: every package of dev | 1 | 1 | 0 | 16 468 |
| **Total** | **135** | **135** | **0** | **23 003** |

There are no language-pack cases: 12.0 has no `LanguagePackPreprocessor`, and `import-language-pack` refuses on it. The 14.0.7 run was repeated on the same code for the harness changes below: the import family is 37 of 37 equal (3 599 requests), and `fs-odd-files` is equal (see the end of this record).

The 12.0 console modes were the first to run 12.0's `ConsoleUpgrade.exe` (sha256 pinned in `oracle/src/console-tool.ts`) on a live server. `--all-packages` exported all packages of dev, 16 468 requests each side, and its output tree is byte for byte equal.

## What the run found

**The port.** No difference. Every 12.0 variant rule that the catalogue reaches (`fixtures/12.0/README.md` lists the cases per rule) gave the same requests, files, log, messages and return code as the DLL on a live server: the `ac_PolicyAccessItemAttribute` actions in the last bucket (IMP-021, IMP-022), the dropped `mp_PromoteItem` (R12), the encoding the loader honours (R15), the 12.0 log framing (IMP-421, IMP-422), the `error` message for every failed item (IMP-427), the unflushed package log (IMP-406) and the export variants (EXP-116 to EXP-118, EXP-315, EXP-324, EXP-405).

**The harness.** Four things in the first passes were the script's, not the port's, and are fixed in `oracle/src/parity/`; each is something a replay against recorded answers could not show or that only 12.0 has:

1. **12.0's login.** 12.0's `CItemHelper.Login()` logs in only a connection of exactly the type `HttpConnectorExtension` (WIRE-017). The oracle host connects through a subclass, so it logs in first with IOM 12's login (`ValidateUser`, `GetCurrentUserID`, the user read). The port's session did not, so it began its transcript five requests late. `openSession` now logs in first on 12.0 too. The offline replay tests of the port's runner (`port-run.test.ts`) now include 12.0 export and import cases, with the fake server of 12.0's login.
2. **The log's date-times.** 12.0 writes three of them in the current culture (EXP-505); the Windows host's is `en-IN` (`dd-MM-yyyy HH:mm:ss`) and the port's process on WSL is `en-US`. The port is now given the host's culture (`ORACLE_HOST_CULTURE`).
3. **The in-memory package log.** 12.0 reads a package's log only up to `1024 × ⌊(N − 1) / 1024⌋` UTF-16 code units (IMP-406). In `fs-odd-files` the log holds the path of a skipped file, and the run folders of the two sides have paths of different length, so the cut fell on different characters: the oracle's log ended in the middle of the keyed name of one line and the port's a few characters earlier. The port's package folder is now made as long as the oracle's `input/` folder (`inputDirLikeOracle`), and the warning's own path is normalised (`normalize.ts`) as the header lines and `File full name` paths already were.
4. **The cleanup report.** The report listed what the port's cleanup deleted for no case, so `deleted` counted only the oracle's. It now holds both sides'. Ids of items that are not versionable are the same on both sides (they are `sid(name)` in the package builders), so a case's `created` list can name an id twice and its `deleted` list once per side; the cleanups' read-backs, not the counts, are what show that nothing was left.

## What dev held

Before the run and after it, dev had no PackageDefinition, no DatabaseUpgrade and no `LIBSJS_SCRATCH_*` ItemType, Variable, Method, SQL, Form or Identity (the script checks the first two before it starts, and the cleanups check each item they delete; a last read of all of them came back empty). The scratch items every import case and seed created were deleted by the side that made them, newest first, each only after its cleanup read the owner's name; none was kept or left unverified. The ids are in the run's `report.json` files.

Dev was shared with another worker's live parity run for 14.35 (ticket 76) during these runs. The two were serialised: this ticket ran only while no other `parity` process was on dev, and the script refuses a dev that already holds a scratch PackageDefinition or DatabaseUpgrade.

## The sweep: gaps nobody owned

The reopening asked for every recorded gap not owned by an open ticket. What the sweep of `src/`, `oracle/`, `spec/`, the fixture READMEs, `roadmap/` and the map found:

**Closed here**
- **`fs-odd-files`** was listed as a known difference of 14.0.7 (`oracle/src/parity/known.ts`) and as skipped in the replay test. PR #87 (the 8.3 short-name order of IMP-003 and IMP-004) had closed the replay; the live run now shows it equal on 12.0 and on 14.0.7. The `known` entry is removed (the script said so itself: "listed in known.ts but now equal"), and `roadmap/live-parity-14.0.7.md` says the gap is closed.
- **A replay test that depended on the day it ran.** `src/import/import-run.replay.test.ts` compared 12.0's package log, which the engine cuts mid-line (IMP-412), after replacing whole date-times only. When the cut left `end of execution : 10/19/20` the recorded day (19th) differed from the day of the run, and `s1-reimport/step-2` failed from the day after the recording. The incomplete date-time is now replaced like the others.
- **12.0 not covered by the parity command**, the follow-up the map recorded from tickets 50 and 44.
- **Engines in progress.** 12.0 and 14.0.7 are in `COMPLETE_ENGINES` with no unmapped reachable method (`spec/coverage.test.ts` passes for both); the only build with `inProgress` is 14.35's.

**Left, with the reason**
- **14.35**: its parity (the whole of ticket 76), its 34 unmapped methods, the `ui-*` console scenarios its replay test skips until its loader lands, and its language-pack and language-export cases. The captain put them out of scope for this reopening.
- **Language-pack cases that need `de` and `fr`** (the five of 14.0.7; 12.0 has none). Dev has `en` only, and a Language adds a column to every table with a multilingual property, which is not clearly non-destructive.
- **`hidden`, `locked` and `unc` of the file-loading replay** (`WINDOWS_ONLY` in `src/import/load-package-dom.test.ts`): they need Windows file attributes and a UNC share, so they cannot run on the OS the port is developed on. The engine's behaviour for them is recorded in the fixture; a Windows CI job would run them.
- **The xml and xpath vectors in `GAPS`** (`src/xml/vectors.test.ts`): each names a framework difference that no engine query reaches (numbers with a trailing point, exponents, axes the engine never uses, a DOCTYPE the engine refuses before it loads). They change no engine output.
- **Culture-sensitive comparisons** (`spec/export-write.md`, `spec/import-load.md`): the port compares ordinally, which differs from .NET only for names with ignorable code points such as U+00AD, and for cultures whose word sort differs from the invariant order; the recording machine's culture, en-US and de-DE agree. Reproducing Windows' NLS tables is a ticket of its own and no catalogue case reaches it.
- **The merge of core Forum and Change Controlled Relationship** (R13, R14): captain decision of 2026-10-13, option (a); they are pinned by unit tests and are not exercisable on dev.
- **Long and UNC output paths** (R16): the run's folder on dev is short, so no server run reaches the difference; the offline probe is `fixtures/export-write/probe-12.0.txt`.
