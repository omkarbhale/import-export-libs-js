# Readiness: the three engines, the final parity run and what is still open

Wayfinder ticket 65. The state of the repository when the map's last ticket landed, on 2026-10-20: what is complete, the last full `npm run parity` on dev for all three engines, what this ticket fixed, and **every gap still open, with its reason**.

Per the round 5 correction, **equal cases do not prove two engines the same.** They show that these inputs reach no difference, and the catalogue is only the inputs ticket 05 chose.

## Complete

| | 12.0 | 14.0.7 (default) | 14.35 |
|---|---|---|---|
| Build in `spec/source-map.json` | 200 mapped, 15 not-ported | 251 mapped, 36 not-ported | 458 mapped, 38 not-ported |
| Unmapped reachable methods | 0 | 0 | 0 |
| In `COMPLETE_ENGINES` (`src/engines.ts`), `inProgress` cleared | yes | yes | yes |

`spec/coverage.test.ts` passes for the three builds. Every `not-ported` method has a reason: the held pieces of `roadmap/hold/` (the certificate login is 22 methods of 14.0.7 and of 14.35), host-only code that no operation of the library calls, compiler-generated helpers, and interface forwarders. The four hold records (certificate login, the raw `<GetDB/>` list, `applySQL` outside 14.35's language-pack path, the C# testability wrappers) each say what the piece is, why it is held and what would bring it in.

`README.md` covers install from git, every command and flag, the engines and their defaults, and the credentials. `AGENTS.md` says how to add a new Aras build (REA diff, rules, fixtures, parity, completion).

## The final parity run

`npm run parity -- --engine <v>` on 2026-10-19 and 20, against dev (Aras 12.0 SP9 build 24090, database `12sp9`), once per engine, then `--case mode-all-packages` (the slow case, which the default run leaves out) once per engine. The command and the comparison are those of `live-parity-14.0.7.md`; 14.35's export is compared by EXP-558 (`live-parity-14.35-export.md`). Every run exited 0.

| Engine | Cases | Equal | Different | Skipped | Requests compared (oracle side) |
|---|---|---|---|---|---|
| 12.0 | 135 | 135 | 0 | 0 | 22 128 |
| 14.0.7 | 137 | 132 | 0 | 5 | 28 675 |
| 14.35 | 215 | 192 | 0 | 23 | 18 476 |

By family (equal / skipped):

| Family | 12.0 | 14.0.7 | 14.35 |
|---|---|---|---|
| Export catalogue (read-only) | 75 | 75 | 104 (the 75, and 29 cases of 14.35's own rules) |
| Scratch-seeded export | 14 | 14 | 14 / 10 skipped |
| Import on `LIBSJS-SCRATCH-*` copies | 40 | 37 | 66 / 5 skipped |
| Language-pack import | none (12.0 has none) | 0 / 5 skipped | 0 / 8 skipped |
| DB patch | none | none | 2 |
| Console export modes (`--from-manifest`, `--use-import`) | 5 | 5 | 5 |
| Console export mode `--all-packages` (slow) | 1 (16 468 calls) | 1 (22 534 calls) | 1 (10 464 calls on the oracle's side, 10 463 on the port's; the run is equal under EXP-558, which compares the requests as a set) |

The numbers of calls grew with dev (14.0.7's `--all-packages` made 16 468 calls on the first run). 14.35's 192 equal cases are the ones that can run on dev; the 23 skipped are the language cases below.

**Dev after the runs.** The three runs report 1 824 (12.0), 1 802 (14.0.7) and 2 390 (14.35) scratch items created and 10 fewer deleted each. The difference is the same ten in every run, and the script's own report lists nothing kept or unverified. The runs of earlier tickets show the same kind of gap (`created 130 item(s); deleted 126`); its cause was not traced here. A read-only check afterwards found no `LIBSJS*` PackageDefinition, ItemType, Identity or Method on dev. It did not look at every ItemType, so the report is the evidence, and the check only supports it.

## What this ticket fixed

The sweep for features the build tickets promised and no ticket landed:

- **`export --language-resources only|with-metadata` and `--languages <codes|*>` (14.35).** Ticket 61 built the engine side (LP-100 to LP-187) and named the two flags, but `export-command.ts` never read them; the library function that maps the flag to the action (`languageResourcesAction`) said the command was ticket 43's. They are wired now, with the host's own checks made before any request (list not empty, `en` present unless the list starts with `*`), refused on 12.0 and 14.0.7. Rule `HOST-031` in `spec/cli-export.md`. Checked live against dev with `only` and `with-metadata` (the log header names `ExportLanguageResourcesOnly` and `ExportMetadataWithLanguageResources`).
- **`export --parallelism <n>` (14.35).** Ticket 59 named it; the library supported it and the command did not pass it. Wired, and refused on engines that export one item at a time (`HOST-007`).
- **Stale text in `spec/cli-export.md`**: HOST-008 and HOST-009 still said 12.0's export and 14.35's language modes were not yet supported.
- **The documents**: the README said "in progress", `AGENTS.md` and `spec/README.md` said the readiness ticket would complete the engines (they already were).

## Open gaps, with the reason

**Cannot be tested on this dev, and not made testable.**
- **Language cases that need `de` and `fr`**: the five language-pack cases of 14.0.7, eight of 14.35, 14.35's ten `lang-ml` export cases and its five import cases with language selection (the 23 skipped above). Dev has `en` only, and adding a Language adds a column to every table with a multilingual property, which is not clearly non-destructive, so the script never adds one. The port's side of all of them is replayed offline against the recorded runs (`oracle/src/parity/port-run*.test.ts`), so what is missing is the live comparison on a server with those Languages. The captain excluded them from this reopening (2026-10-20). To close it: add the Languages as `fixtures/14.0.7/language-pack/setup.aml` says, and run `npm run parity -- --engine <v> --kind language-pack,…`.
- **`hidden`, `locked` and `unc` of the file-loading replay** (nine skips, three per engine, `WINDOWS_ONLY` in `src/import/load-package-dom.cases.ts`): they need Windows file attributes, a held file lock and a UNC share. The engine's behaviour for each is recorded in the fixture. A Windows CI job would run them.
- **Two live-server tests** (`src/client/live.test.ts`) skip unless a dev password is in the environment. Parity covers the same ground.

**Differences the port knowingly keeps.**
- **The `GAPS` vectors of `src/xml/vectors.test.ts`** (15 skips): each names a framework difference in the XML or XPath stack that no engine query reaches (numbers with a trailing point, exponent notation, axes the engine never uses, a DOCTYPE the engine refuses before loading it). They change no engine output.
- **Culture-sensitive comparisons** (`spec/export-write.md`, `spec/import-load.md`): the port compares ordinally, which differs from .NET only for names holding ignorable code points such as U+00AD and for cultures whose word sort differs from the invariant order. The recording machine's culture (en-US, de-DE) agrees. Reproducing Windows' NLS tables is a ticket of its own, and no catalogue case reaches it.
- **The merge of core Forum and Change Controlled Relationship** (R13, R14): captain decision of 2026-10-13, option (a); pinned by unit tests, not exercisable on dev.
- **Long and UNC output paths** (R16): the run folder on dev is short, so no live run reaches the difference. The offline probe is `fixtures/export-write/probe-12.0.txt`.
- **The deviations that cannot be avoided** (round 5 line 9, `spec/bugs.md`): bounded recursion where the engine recurses without bound, and the deterministic `Hashtable` after 100 collisions.

**Not covered by the live comparison.**
- **14.35's parallel export** is not compared request for request, line for line (the two sides cannot agree): EXP-558 compares it by what is fixed, and a run that a failure or cancel stopped only by its fixed parts.
- **The CLI's own flags are not under parity.** `oracle/src/parity/port-run.ts` drives the library's runners, not `aras-pkg`. The CLI is covered by its unit tests and by the recorded-run replays of `src/cli/`; the language-resource and `--parallelism` flags of this ticket had one manual live run each. They are not combined with `--use-import`, `--from-manifest` or `--all-packages` in any test or live run: `HOST-031` leaves the combination to the engine, and the engine's behaviour for it was not probed.
- **The oracle needs Windows PowerShell 5.1 and a dev server**, so `npm run parity` and the recorders are not part of the CI gate (`npm run typecheck && npm test`). A fixture is only as current as its last recording.
- **A future Aras build** has no ticket until a `Libs.dll` arrives; `AGENTS.md` says how it would be added.

**Out of scope on purpose** (`roadmap/hold/`): certificate login, the raw `<GetDB/>` list, `applySQL` outside 14.35's language-pack path, the C# testability wrappers. Also outside the map: aras-axi and aras-harness, and any "fixed" mode that changes engine behaviour.
