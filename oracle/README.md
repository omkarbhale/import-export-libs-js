# Oracle

The oracle is the real engine: Aras's own `Libs.dll` builds, run on Windows and driven from WSL. Fixtures are recorded from it, and live parity compares the port against it.

```sh
ARAS_PASSWORD=… npm run oracle -- --engine 14.0.7 export \
  --package com.aras.innovator.servicereporting \
  "List:1854A8A75F5940A78369146966674FA6:Report Format Types"
```

That writes a scrubbed fixture folder to `oracle/out/<engine>-<command>-<time>/` (gitignored; pass `--out` to choose). `npm run oracle -- --help` lists every command and option.

## Layout

- **`native/<engine>/`**: each engine's tool folder, vendored whole (round 3, Q4):
  - `12.0/` from `Desktop\ImportExport\12\Import`: Libs and IOM 12.0.0.13341;
  - `14.0.7/` from `Desktop\ImportExport\23\Import`: Libs and IOM 14.0.7.35492, the same `Libs.dll` as aras-harness `native/Libs.dll`;
  - `14.35/` from `Desktop\Delete me\PackageImportExportUtilities35\Import`: Libs 14.35.0.43890 with IOM 15.0.0.0 and its 30-odd dependencies. Its `Libs.dll` differs in bytes from `Desktop\Delete me\Libs.dll`, but both have MVID `bdb15286-…`, so they are the same build.

  The GUI tool's `log/` folder and `config.xml` (saved server, user and paths) are left out. They are per-user state, not code.
- **`native/manifest.json`**: for each engine, the source folder, every file's size and sha256, the Libs and IOM version and MVID, and the excluded entries. `npm test` checks the vendored folders against it on any OS, reading MVIDs straight from PE metadata (`src/pe.ts`).
- **`host/`**: the Windows side. `engine-<version>.ps1` is one host per engine. Each exposes that engine's `SolutionUpgradeContext`, `SUExportContext` and `SUImportContext` options as parameters, so an option a build lacks cannot be passed. They share `common.ps1` and `OracleHost.cs`, the recorder, which `Add-Type` compiles against the staged DLLs.
- **`src/`**: the WSL side (`npm run oracle`): manifest checks, staging, the launcher, collection and scrubbing.
- **`dbpatch/`**: the one DB patch the oracle will apply (DBP-070): `manifest.xml` with one entry, and the patch file `LIBSJS-SCRATCH-noop.xml`, a no-op server method. They are byte-exact and committed with their sha256 in `src/dbpatch.ts`.
- **`xsl-cases/`**: this repo's own synthetic inputs for the `xsl` command (`export/`, `export-items/`, `export-fix/` and `build/`), one XML file per case. `export-items/` is the probe set of the export transform's part 1 (`spec/export-transform.md`), recorded with `npm run oracle -- --engine 14.0.7 xsl --xsl export.xsl oracle/xsl-cases/export-items --out fixtures/14.0.7/xsl/export-items`. `export-fix/` is the probe set of its part 2, recorded the same way into `fixtures/14.0.7/xsl/export-fix`. They are byte-exact (some hold CRLF), so editors must not re-save them.
- **`export-write-probe/`**: offline probes of the export write path (post-XSL steps, output layout, file-system rules), for `spec/export-write.md`. `probe.ps1` is 14.0.7's and `probe-12.0.ps1` covers the 12.0 steps that differ. How to re-run is in its README.
- **`wire-capture/`**: a one-off recording of an engine's reference host below the AML, for the wire fixtures in `fixtures/wire/`. `ReferenceHost.cs` (14.0.7), `ReferenceHost-12.0.cs` and `ReferenceHost-14.35.cs` connect as each version's ConsoleUpgrade does, `proxy.mjs` records every HTTP exchange (with timings, connections, and an optional delay to provoke a client timeout), and `fixture.ts` scrubs the recording. How to re-record is in each fixture's README.
- **`wire-probe/`**: runs the real `CItemHelper`, `CItemException` and IOM 15 helpers (14.35, and 14.0.7 for comparison) against a stub connection that never touches a network, to pin the login, version probe, gate and exception texts. The recordings are `fixtures/wire/14.35-probe/` and `fixtures/wire/14.0.7-probe/`.
- **`export-output-probe/`**: runs 14.35's (and, for contrast, 14.0.7's) export code offline against a scripted connection that never touches a network: single methods on in-memory documents, and whole `ExportSolutions` runs with the parallel loop, a failed item, a cancel and the path rules. For the 14.35 rules of `spec/export-*.md`. The recordings are `fixtures/export-output/`, and its README says how to re-run.
- **`xml-core-probe/`**: records the .NET Framework `System.Xml`, `WebUtility` and `File.ReadAllText` results that the XML core of `src/xml/` has to reproduce, as `fixtures/xml-core/vectors.json`. It needs no `Libs.dll`. The README of the folder says how to re-record.
- **`language-export-probe/`**: runs 14.35's language-resource export code offline (the manager's constructor in the two language actions, the requests `CExportItems.Export` builds, the four language steps on in-memory documents, and whole exports) against a scripted connection that extends the export-output probe's `Stub.cs`. For `spec/language-export.md`. The recording is `fixtures/export-language/probe-14.35.txt`, and its README says how to re-run.
- **`request-probe/`**: drives engine 14.0.7's `CExportItems` and `CItemHelper` against a stub connection that never touches a network, to pin the requests they build and how their lookups react to scripted answers. It needs no server or password. The recording is `fixtures/export-requests/14.0.7-probe/`, and its README says how to re-record. `probe-14.35.ps1` does the same for 14.35 (IOM 15, `fixtures/export-requests/14.35-probe/`).
- **`export-modes-probe/`**: runs, offline, the engine's `GenerateHashtableFromManifest` and `ConsoleUpgrade.exe`'s own `ProcessExport` (internal, driven by reflection) for `spec/export-modes.md`: the three ways the console tool builds the package → items table. It needs no server or password: a scripted connection answers the package-definition request from a document the scenario gives, including the recorded dev answer of ticket 24, and the `--use-import` loop runs on every input folder the import fixtures of ticket 25 recorded. Each table is recorded in `Hashtable` enumeration order. `ConsoleUpgrade.exe` is not vendored: `run.sh` reads it from the captain's toolset folder and checks the sha256 pinned in the script. The recordings are `fixtures/export-modes/<engine>-probe.json` (`ENGINE=12.0|14.0.7|14.35 oracle/export-modes-probe/run.sh`), replayed by `src/cli/console-modes.test.ts`.
- **`merge-probe/`**: drives engine 14.0.7's `CImportItems` against a scriptable stub helper, and its `CItemHelper` merge lookups against the request probe's stub connection, to pin the validation, merge and versionable processing of `spec/import-merge.md`. It needs no server or password. The recording is `fixtures/import-merge/14.0.7-probe/`, and `run.sh` re-records it; `ENGINE=12.0 run.sh` runs the same scenarios through engine 12.0 into `fixtures/import-merge/12.0-probe/`.

## How a run works

1. **Hash check before anything loads.** The vendored folder, then the staged copy, must match `manifest.json` exactly: file set, sizes, sha256 and MVIDs. The host then re-hashes `Libs.dll` and `IOM.dll`. After loading, it asserts that both came from the staged folder with the recorded MVID and version.
2. **Staging.** .NET Framework will not load assemblies from `\\wsl.localhost`. So each toolset is copied once to `%LOCALAPPDATA%\import-export-libs-js\oracle\<engine>-<digest>\`, where the digest is taken over the manifest's file list. The host scripts go to `host-<digest>\` and each run gets `runs\<id>\`. A run folder is deleted after collection.
3. **Recording.** This is ticket 03's design: `RecordingHttpServerConnection` subclasses IOM's `HttpServerConnection` and overrides `CallAction`. Libs' `is HttpServerConnection` casts (Login, Timeout) therefore behave exactly as they do under Aras's tools.
   - The recorder is thread-safe, because 14.35 exports through `Parallel.ForEach`.
   - Every call records completion order `seq`, start order `start`, nesting `depth` (IOM's auto-relogin runs inside a call), the managed thread id and Stopwatch ticks.
   - 12.0's `CItemHelper.Login()` skips any connection that is not exactly `HttpConnectorExtension`. So the 12.0 host logs in first, which matches Aras's own 12.0 tool. The 14.x hosts leave login to Libs.
   - `CItemHelper.logout()` is always called at the end, as ConsoleUpgrade does. It has the same exact-type check, so with the recorder it sends nothing.
4. **Messages.** All five `IMessagesFactory` channels are recorded as `error`, `errorQuestion`, `warning`, `status` and `currentPackage`. `errorQuestion` answers `--error-question-answer` (default `no`). The other channels return null, like ConsoleUpgrade.
5. **Commands.**
   - `export` calls `ExportSolutions` with the given items.
   - `import` calls `ImportSolutions` with every package in the manifest, or with `--packages`.
   - `lpimport` (14.0.7 and 14.35) runs ConsoleUpgrade's sequence: `LanguagePackPreprocessor`, then `Action = Import` on its temp manifest.
   - `cleanup` connects, deletes the items an earlier run created (`--from-runs <run.json>,...`) and exits. It is how a multi-step case is cleaned up when a step fails.

   - `xsl` runs no engine action and needs no server or password; see "The XSL probe".

   - `dbpatch <manifest.xml>` (14.35 only) calls `ImportExportManager.ApplyDBUpdateManifest` with a `DBUpdateConfig` built from the manifest, `--patches-folder` (default the manifest's folder) and `--tool-name` (default `Libs`), with `Action = ImportDPPatch` as Aras Update sets it (DBP-002). See "The DB patch command".
6. **Import steps.** An `import` can act around the recorded run (none of it reaches the transcript):
   - `--cancel-after-status <n>` presses Cancel (`ImportExportManager.Cancel()`) once the n-th status message has been delivered, which is where the GUI's button acts: the loop reads the flag before its next item. An `export` takes it too (14.35's parallel loop reads the flag at the start of every item, EXP-557).
   - `--lock-upgrade-rows` locks the packages' `DatabaseUpgrade` rows first (the engine's unlock path), `--version-before <type>:<id>,...` gives scratch items a new generation first (the merge's current-generation path). Both refuse anything without a scratch name (step 7) and are made through a connection of their own.
   - `--keep-created` skips the cleanup and reports what the run created as `deferred`; a later run (or `cleanup`) deletes it. This is how a case re-imports what an earlier step imported. The recorder (`oracle:import-cases`) cleans up in a `finally`, so a failed case leaves nothing behind.
7. **The scratch guard.** Right before `ImportSolutions`, the host checks what the engine is about to get. Every package in the set must be named `LIBSJS-SCRATCH-*`; for `lpimport` that is the temp manifest's package, `--lp-package`. For `import`, so must every item file `LoadPackageDom` reads for those packages (the file name is the keyed name the engine records), and every top-level item's `name`. Aras restricts ItemType, SQL item and other names to word characters (`^[a-zA-Z]\w*$`), so an item `name` (and the cleanup's owner check, below) may also start with `LIBSJS_SCRATCH_`; package names and file names never may. An extended property's name must match `^xp-\w+$` and the server stores it in lower case, so `xp-LIBSJS_SCRATCH_` also counts, compared without regard to case. For `lpimport`, so must the `keyed_name` of every item in the language pack's `xml/` folder. An empty package set is refused too. Before anything is staged, the WSL side checks the package names the same way. The guard checks names only (see Rules).
8. **Cleanup.** After `import` or `lpimport`, the host stops recording, so nothing from here on reaches the transcript. It then deletes what the run created, newest first. The run created every top-level item that a successful call sent with `action="add"`. For the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows, the id comes from the response. A call that failed in transport may still have been committed: either it threw, or IOM wrote its own fault (faultactor `HttpServerConnection`, as for a timeout or a dropped connection). So its `add` and `create` items count too, marked `unconfirmed`, with only the ids the request names. Each is looked up by id and deleted if it exists. One that is not found goes to `unverified`, because the server may still commit it after the client gave up; re-check those ids later. An unconfirmed item with no id is kept. An item is deleted only when it belongs to a `LIBSJS-SCRATCH-*` (or ItemType-safe `LIBSJS_SCRATCH_*`) name: a relationship by its source's name, any other item by its name or keyed name. Anything else is kept and reported. Relationships nested inside an added item go with it. A delete the server refuses because another scratch item still refers to it (an ItemType used as a Property's data_source, an Identity used in a Member) is tried again after the others, for as long as a pass deletes something.

## Export fixture cases

`npm run oracle:export-cases` records ticket 05's 14.0.7 export catalogue (`src/export-cases.ts`) into `fixtures/14.0.7/export/<case>/`, one oracle export per case, read-only on dev. `--engine 14.35` records the same catalogue and the cases of the `[14.35]` export rules (`src/export-cases-1435.ts`: the request tree and its level, the first failure that stops the export, a cancel through `--cancel-after-status`, parallel runs, and the language modes on a server with `en` only) into `fixtures/14.35/export/<case>/`. 14.35 exports a package's items in parallel, so the cases whose outcome depends on timing exist three times (`-run1` to `-run3`) and their logs compare as sets (EXP-558). `--only <id>,…` picks cases, `--force` re-records, `--list` shows what is recorded, `--readme-only` rewrites the READMEs and index from the case list without running the engine. Each case lists its packages and items in the order the host inserts them into the engine's `Hashtable`; the multi-package ordering cases (`p1-*`) rely on that. The password arrives through `ARAS_PASSWORD` or stdin like any oracle run.

`--engine 12.0` records the same catalogue from engine 12.0 into `fixtures/12.0/export/` (ticket 48); `fixtures/12.0/README.md` maps the 12.0 variant rules to cases. The same flag works for `oracle:export-scratch-cases` and `oracle:import-cases`.

## Engine diffs

```sh
npm run oracle:engine-diff                                  # compare the committed fixtures of the three engines; no server
npm run oracle:engine-diff -- --write                       # re-pin fixtures/engine-diffs/ after a re-record
ARAS_PASSWORD=… npm run oracle:engine-diff -- --live <dir>  # record the catalogue again, on all three engines, then compare
```

Ticket 64. It compares the export fixtures of 12.0 and 14.0.7, and of 14.0.7 and 14.35, case by case (`oracle/src/engine-diff.ts`): the output folders byte for byte, then the host exit, the calls, the messages and the engine log (with times and paths left out). It also compares `export.xsl` on the same inputs across the three engines (`fixtures/<engine>/xsl/export`, `export-items` and `export-fix`). `fixtures/engine-diffs/` pins the result, and `oracle/src/engine-diff.test.ts` fails on any change and on a difference that no rule explains. `roadmap/engine-diffs.md` reads it.

`--live <dir>` is read-only on dev. It records ticket 05's catalogue (the cases every engine has; not the scratch-seeded ones, which need `oracle:export-scratch-cases`) into `<dir>/<engine>/<case>/`, one case after the other so that all three engines see the same dev state, skips a case that is already there, and then prints the comparison and how far each engine's new output is from its committed fixtures.

## Live parity

```sh
ARAS_PASSWORD=… npm run parity -- --engine 14.0.7                 # the whole catalogue (not the slow cases); --engine 12.0 the 12.0 one
ARAS_PASSWORD=… npm run parity -- --engine 14.0.7 --case e24-grid,s0-mini-merge
ARAS_PASSWORD=… npm run parity -- --engine 14.0.7 --kind import   # export, scratch-export, import, language-pack, console-mode
npm run parity -- --list                                          # the catalogue; no server, no password
arashouse run --lease <lease_id> -- npm run parity -- --engine 12.0   # the same run on an arashouse lease
```

The server is `--url`, else `ARAS_URL`, else the dev instance (`http://172.19.0.1/12sp9`), as WSL reaches it, with the database `ARAS_DATABASE` (default `12sp9`). The oracle's Windows side reaches the same path at `localhost`. `arashouse run` sets `ARAS_URL`, `ARAS_DATABASE`, `ARAS_USER` and `ARAS_PASSWORD` for a lease, so a lease needs no other change. Which servers are allowed is in Rules.

Ticket 44. For each case the script runs the oracle (the vendored `Libs.dll` through the Windows host, `oracle/src/record.ts`) and the port (`oracle/src/parity/port-run.ts`, the same classes the CLI uses) on the same inputs against dev, one after the other, and diffs (`oracle/src/parity/diff.ts`):

- the request AML, in order. A transcript holds the AML of each call, not the envelope or the headers, and it starts with the login and the version probe;
- the output folder, byte for byte (an empty folder counts);
- the engine log, the messages by channel and the console text;
- how the run ended: the value `ImportSolutions` returned, the exception that ended the host (its type and message, without the stack), and the host's exit code.

**What is normalised, and nothing else** (`oracle/src/parity/normalize.ts`): the ids the server assigned during the run (each side's run makes its own PackageDefinition and PackageGroup ids; they are numbered in order of first appearance), the date-times of the log, and the header lines, `File full name` paths and skipped-file warnings that name a run's own folders. A difference in anything else is a difference.

**The catalogue** (`npm run parity -- --list`, with `--engine 12.0` for 12.0) is every recorded case of the engine, as code (12.0 has the same families but no language-pack cases, and its import list adds the `r*` cases that pin its variant rules): ticket 05's export catalogue and option matrix (`export-cases.ts`, which includes the three unknown-package reference modes `RemoveSilently`, `RemoveWithWarning` and `DoNotRemove`), the scratch-seeded export cases of ticket 67 (`export-scratch-cases.ts`), the import cases of ticket 25 (`import-cases.ts`), ticket 45's language-pack cases, and the console export modes of ticket 66 (`parity/cases.ts`). The case `mode-all-packages` exports every package of dev, about ten thousand items, so it runs only when named with `--case` or `--include-slow`.

**What it changes on the server.** Exports are reads. Everything else touches `LIBSJS-SCRATCH-*` packages and items only, as AGENTS.md says:

- An **import case** is run by the oracle first (its steps keep what they created, the last step deletes all of it), then by the port from fresh copies of the same package folders. The port's side of the oracle host's guard and cleanup is `oracle/src/parity/scratch.ts`: it refuses a package folder, an item file or an item name that is not scratch, and afterwards deletes what the port created, newest first, and only an item whose own name (or whose source's) is a scratch name. A cleanup that leaves an item behind stops the whole run with exit status 3 and the ids.
- A **scratch-seeded export case** is seeded by the oracle like `oracle:export-scratch-cases`, exported by both sides, and cleaned up by the oracle's `cleanup` command.
- A **language-pack case** needs the Languages `de` and `fr` and the two scratch Forums of `fixtures/14.0.7/language-pack/setup.aml`. The script never adds a Language (that adds a column to every table with a multilingual property): without them the case is skipped, with the reason.
- A **console-mode case** (`--use-import`, `--from-manifest`, `--all-packages`) has the oracle run the toolset's own `ConsoleUpgrade.exe` `ProcessExport` by reflection (`ConsoleExport` in `host/OracleHost.cs`, the host parameter `ConsoleMode`), so the table is built by Aras's loops and the port's `src/cli/console-modes.ts` is compared with them on a live server. `ConsoleUpgrade.exe` is not vendored: it is read from the captain's toolset folder and checked against the sha256 pinned in `src/console-tool.ts`.
- Before it starts, the script refuses a server that already has a PackageDefinition or DatabaseUpgrade named `LIBSJS-SCRATCH-*`. A fresh lease has none.

The port connects through a subclass of `HttpConnectorExtension`, as the oracle host connects through its own subclass of IOM's `HttpServerConnection`: `CItemHelper.Logout` logs off only the exact type (WIRE-040), so neither side sends a `Logoff`.

**12.0 differs in three ways the harness mirrors.** Its `CItemHelper.Login()` logs in only a connection of exactly the type `HttpConnectorExtension` (WIRE-017), so the oracle host logs in first with IOM 12's login (`ValidateUser`, `GetCurrentUserID`, the user read) and the port's session does the same before the helper's version probe. Its log writes three date-times in the current culture (EXP-505), which on the Windows host is `en-IN` (`dd-MM-yyyy HH:mm:ss`), so the port is given that culture (`ORACLE_HOST_CULTURE`). And it reads a package's in-memory log only up to `1024 × ⌊(N − 1) / 1024⌋` UTF-16 code units (IMP-406), a cut that moves with the length of any path in the log (the warning for a file without a root tag), so the port's package folder is made as long as the oracle's `input/` folder (`inputDirLikeOracle` in `oracle/src/parity/runners.ts`). `oracle/host/engine-12.0.ps1` also takes the console-mode parameters, so 12.0's own `ConsoleUpgrade.exe` runs for the `console-mode` cases. The run is recorded in `roadmap/live-parity-12.0.md`.

**A difference** is printed with the first requests, lines or bytes that differ, and its folders are kept in `--out` (default `oracle/out/parity-<engine>-<time>/<case>/`): `oracle/` is the oracle's recorded run, in the layout of every fixture, and `port/` is the port's, in the same layout. An equal case's folders are removed (`--keep-all` keeps them). Each difference becomes a fixture (`fixtures/14.0.7/parity/`), then a fix or a newly registered bug (`spec/bugs.md`). `report.json` in the folder lists every case. The roadmap record of a run is `roadmap/live-parity-14.0.7.md`.

**Engine 14.35** (ticket 76). `--engine 14.35` runs every family. The catalogue is the export cases of ticket 57 (`export-cases-1435.ts`: ticket 05's catalogue, the parallel runs `-run1` to `-run3`, the first-failure and cancel cases, and the language-resource modes that need no translated data), the scratch-seeded groups of `SEED_GROUPS_1435`, the import cases of tickets 25, 53, 55 and 73 as ticket 75 recorded them for 14.35 (`import-cases.ts`: the language selection, the AML batch mode and the collected errors among them), the language-pack cases `lp01` to `lp08`, the console modes, and the DB patch cases of ticket 72 (`dbpatch-apply`, `dbpatch-non-root`).

- The cases that need Languages dev does not have are skipped, with the reason, and the script never adds or removes a Language (that adds or drops a column of every table with a multilingual property): the group `lang-ml`, the language-pack cases, and the import cases whose `devLanguages` differ from dev's (`importCasePrecondition`).
- 14.35 exports the items of a package in parallel, so the two sides cannot agree request for request. `oracle/src/parity/diff-1435.ts` compares an export by EXP-558: the login requests in order, the other requests as a set, the log header and the package headers, the success lines as a multiset, the item statuses as a set (the engine may repeat or drop one: EXP-553), the other messages in order, and the files byte for byte. A run that a failure or a cancel stopped is compared by its fixed parts, the manifest and the bytes of the files both sides wrote (the items in flight are not fixed: EXP-572). A package with one item has nothing racing and is compared in full, unless the pass over the referenced items (EXP-543) runs. The port exports with its default `parallelism`, one item per logical processor. Imports and DB patches are not parallel and are compared in full.
- The `dbpatch` kind applies the one committed no-op patch (`oracle/dbpatch/`, DBP-070; the port's runner takes the same guard as the oracle's, `assertTestPatch`): the oracle applies it as `root`, applies it again (the server refuses it: DBP-042) and applies it as `admin` (the engine refuses the login: DBP-010), then the port does the same. The ids the engine makes up for the items it adds, and the one the server gives the "Applied Updates" item, are numbered like the ids the server assigns (`dbPatchIds`). The oracle's `cleanup --db-patch` deletes what each side made, and only an item that matches the test patch.

`oracle/src/parity/*.test.ts` need no server: they run the port's live code against a fake server that serves a recorded fixture, so the runner and the diff are known to find a recorded case equal before they meet dev.

## The DB patch command

```sh
ARAS_PASSWORD=… npm run oracle -- --engine 14.35 dbpatch oracle/dbpatch/manifest.xml
ARAS_PASSWORD=… npm run oracle -- --engine 14.35 dbpatch oracle/dbpatch/manifest.xml --user admin   # the non-root refusal
```

`dbpatch` records the engine's `ApplyDBUpdateManifest` the way `import` records an import: the recording connection captures every `CallAction`, including the raw `ValidateUser`, `GetItem` and `ApplyUpdate` calls that go through the engine's own helper, and all five message channels, and the engine's log. The login defaults to `root` like every command, because the engine accepts that name only (DBP-010). `--keep-created` skips the cleanup for a later run (the recorder uses it for the second run of `apply`); `cleanup --db-patch --from-runs <run.json>` deletes what such a run kept.

**Only one patch runs.** A DB patch is server code that runs as the Super User, so the oracle applies the committed no-op of DBP-070 and nothing else:

- The WSL side refuses, before it stages anything, a manifest that is not named `manifest.xml` or not byte-identical to `oracle/dbpatch/manifest.xml`, a patch file `LIBSJS-SCRATCH-noop.xml` in the patches folder that is not byte-identical to the committed one, and any `--tool-name` but `Libs`. The host checks the same two digests again on the staged copies, right before the engine runs.
- Before the run, with no recording, the host reads that no `DatabaseUpgrade` row of type 0 for release `99.99` and no "Applied Updates" item numbered `LIBSJS-SCRATCH-001` exists, so the run only adds: a `DatabaseUpgrade` row, an "Applied Updates" item and the `DatabaseUpgradePatch` that links them. If either exists, it stops.
- The cleanup deletes those three items by the ids the recorded calls show, newest first, and only when each still matches the test patch (the row by name, release and type, the update by its number, the link by its update's number). A read-back must then find nothing of the release or the number. The report is the import cleanup's (`created`, `deleted`, `kept`, `unverified`); anything kept exits 1.
- A patch that the server refuses is an `error` message, not an exception (DBP-050): the host exits 1 for any text on the `error` channel, and 2 when the engine throws (the non-root refusal). `run.json` `host.errorMessages` counts the texts.

`npm run oracle:dbpatch-cases` records the fixture, `fixtures/14.35/dbpatch/<case>/step-<n>/`, with the same layout as an import step: `non-root` (the `admin` login) and `apply` (the patch as `root`, then the same patch again, which the server refuses as already applied). `--only <id>,…`, `--force`, `--list` and `--readme-only` work as for `oracle:import-cases`. It writes to dev, but only the three items above, and deletes them (a failed case is cleaned up too). The password arrives through `ARAS_PASSWORD` or stdin like any oracle run.

## Scratch-seeded export cases

`npm run oracle:export-scratch-cases` records the export cases whose items do not exist on dev (ticket 67, ticket 05's "24b" pass) into `fixtures/14.0.7/export/<case>/` (`--engine 14.35` repeats the groups below for 14.35 into `fixtures/14.35/export/`, and adds the `lang-ml` group, which needs the Languages `de` and `fr` on dev: see "Language state" below), in the same layout as `oracle:export-cases` plus a `seed` record in `case.json` and a "Seed" section in the README. `--only <case or group>,…`, `--force`, `--list` and `--readme-only` work as there. It writes to dev, but only `LIBSJS-SCRATCH-*` packages and items, and deletes everything it created, even when a step fails.

**The recipe** (the same for any engine; ticket 48 ran it for 12.0 with `--engine 12.0`, and ticket 57 repeats it for 14.35 with `--engine 14.35`, which `EXPORT_ENGINES` in `src/case-engine.ts` allows, and with `src/export-cases-1435.ts` where an engine differs):

1. **Import.** A seed group (`SEED_GROUPS` in `src/export-scratch-cases.ts`) lists import steps. Each is one oracle `import` of scratch packages built by `src/seed-packages.ts` (and `src/import-packages.ts` for S2 and S8), run with `--keep-created`, so the next step finds what it made. Every step must end as its `expect` says. A step that needs what an earlier one made, because the server looks it up when the item is added, is a step of its own.
2. **Export.** Each case of the group is one read-only oracle `export` of the seeded items, named by type, id and keyed name. The id is the one the package file gives the item, except for a versionable item, which the server gives a new id on import: `{ created: n }` names the n-th created item of that type.
3. **Clean up.** One oracle `cleanup` run deletes what every step created, newest first, and the recorder refuses to install anything unless nothing was kept or left unverified. The cleanup runs after a failed step too.

The password arrives through `ARAS_PASSWORD` or stdin. A case README lists the ids created per step and the ids deleted.

| Group | Seeds | Cases |
|---|---|---|
| `s2-ref` | S2: `LIBSJS-SCRATCH-REF` depending on `LIBSJS-SCRATCH-REFDEP`, with three referenced elements | `p5-ref-off`, `p5-ref-on`, `p5-ref-both-on` |
| `s8-coll` | S8: two packages whose names end in `.Coll` | `s8-coll-ab`, `s8-coll-ba` |
| `s7-xprop` | S7: a scratch ItemType in a classification tree whose class holds two extended properties; classified and unclassified instances | `s7-xp-values`, `s7-xp-empty` |
| `s6-special` | S6: an mp_MacPolicy with two `filter_xml`; a derived relationship family with a dr_Relationship and an event handler with `event_data`; an ItemType with a cmf_ContentType; an ac_PolicyAccessItemAttribute; a dac_DomainDefinition; a cmf_TabularView | `s6-mac-two-filters`, `s6-dr-family`, `s6-ac-attribute`, `s6-dac-domain`, `s6-cmf-content-type`, `s6-cmf-itemtype`, `s6-cmf-tabular-view` |
| `lang-ml` (14.35) | S10: a scratch ItemType `LIBSJS_SCRATCH_ML` whose labels and two `ml_string` Properties are translated into `de` and `fr`, and three instances translated twice, once and not at all | `lang-only-*`, `lang-meta-*`, `lang-both-packages-only-star`, `lang-export-de-instances`, `lang-only-upper-case-code` |

What the server taught the seeds (each is a failure the first import hit):
- An extended property's name must match `^xp-\w+$` and is stored in lower case, which the scratch guard allows (`xp-LIBSJS_SCRATCH_`, compared without regard to case). Its value applies to an item only through a class of an xClassificationTree bound to the item's ItemType; binding the property to the ItemType alone stores nothing. The classification tree, the ItemType's `_xClass` relationship type and the Morphae row the server adds are removed by deleting the tree and the ItemType.
- xClassificationTree, ac_ and dac_ names are limited to word characters (`LIBSJS_SCRATCH_*`).
- A derived relationship's `implementation_query` is computed when its family is activated and is dropped from an add, but an edit keeps it (after checking that the query's leaf is the relationship's destination ItemType), so `s6-special` sets it in a third step.
- A dac_SubdomainPermission's `condition_xml` must pass the server's filter schema; a `method_call` with a `constant` parameter does, and a `property` condition is looked up against server state the seed does not build.
- A cmf_ContentType makes the server generate an ItemType for each element and property type, named after them (`LIBSJS_SCRATCH_*`), and deleting the content type removes them.

`--engine 12.0` records the same groups from engine 12.0 into `fixtures/12.0/export/` (ticket 48), seeding with the 12.0 oracle.

### Language state

The 14.35 language-resource export modes (LP-100 and on) return translated values only when the server has more than `en`. Dev has `en` only, so the `lang-ml` group runs between two writes that the recorder does not make:

1. **Add the Languages** (once per code, each add takes longer than 30 s because the server adds a `LABEL_<code>` column to every table with a multilingual property): the first AML of `fixtures/14.0.7/language-pack/setup.aml`.
2. **Record**: `ARAS_PASSWORD=… npm run oracle:export-scratch-cases -- --engine 14.35 --only lang-ml`. It imports the S10 packages, exports, and deletes everything it created.
3. **Delete the Languages** by id, and check that dev has `en` only again.

The cases that need no translations (`l1-*` of `npm run oracle:export-cases -- --engine 14.35`) were recorded with `en` only, and say so in their README.

## The XSL probe

```sh
npm run oracle -- --engine 14.0.7 xsl --xsl export.xsl oracle/xsl-cases/export --out fixtures/14.0.7/xsl/export
npm run oracle -- --engine 14.0.7 xsl --xsl export.xsl --transcript <fixture folder> --seq 11 <more inputs>
npm run oracle -- --engine 14.0.7 xsl --xsl build.xsl --culture sv-SE oracle/xsl-cases/build/sort-type-names.xml
```

`xsl` runs one engine's embedded `export.xsl` or `build.xsl` on given documents, through that engine's own `CItemHelper` in the staged `Libs.dll` (hash-checked and MVID-checked like every run). Inputs are `*.xml` files or folders of them (a case is named after its file), and `--transcript <fixture folder> --seq <n>,…` adds the responses of those calls of a recorded export as `recorded-<n>`. A recorded response is the server's answer, before the engine's own rewrites (`EXP-100` to `EXP-199`), so pick calls whose item passes through unchanged.

For each input the host does two things on fresh documents, in `host/xsl-probe.ps1`:

1. **`transform.xml`**: the compiled stylesheet from the engine's own `GetXslTransform` (the resource read from the DLL at run time, compiled with `XslCompiledTransform`, cached as `ApplyXsl` caches it) transforms the document into a `StringWriter` with the invariant culture. These are the engine's bytes: `<x />` against `<x></x>`, where `xmlns:SOAP-ENV` lands, `cdata-section-elements`, `\r\n` in text, all before anything else touches them.
2. **`applied.xml`**: the engine's `CItemHelper.ApplyXsl` itself: the same transform, the `xmlns:SOAP-ENV` replace, and `LoadXml` into the same document. The file is that document's outer XML afterwards. An exception from either step (a character reference to an invalid character in the transform, `]]>` in character data on the reload) is recorded with its type, message and cause instead of a file.

The stylesheet is never written out: `run.json` holds only its size and sha256. The source document is loaded as the engine loads it: with whitespace kept for `export.xsl` (IOM's response DOM) and dropped for `build.xsl` (`CreateNewXmlDocument()`). `--culture` sets the thread's culture, which `build.xsl`'s `xsl:sort` follows (ticket 06 X7); the culture used is recorded, and is the host's own (`en-IN` on dev) when not given.

The folder it writes holds `run.json` (engine, toolset identity, stylesheet size and hash, `PreserveWhitespace`, culture, CLR, and per case the input hash, source and the outcome of each step) and `cases/<name>/` with `input.xml`, `transform.xml` and `applied.xml`. Inputs are scrubbed before the engine sees them, so every output derives from the committed input. Recordings are committed as `fixtures/<engine>/xsl/<set>/` (`export`, `export-items`, `export-fix` and `build` for every engine, and `build-sv-SE` for the culture case, 14.0.7 only), and `oracle/src/xsl-fixtures.ts` loads them for the unit tests that replay them on any OS. `oracle/src/xsl.test.ts` checks every recording against its vendored `Libs.dll` and the case inputs it came from.

## Import fixture cases

`npm run oracle:import-cases` records ticket 25's 14.0.7 import cases (`src/import-cases.ts`) into `fixtures/14.0.7/import/<case>/step-<n>/`: ticket 05's scratch packages S1 to S5, S8 and S9, its manifest and file-system cases, and its import option matrix (merge, release and description, a locked `DatabaseUpgrade` row, `bFast` and `bVault`, cancel). It writes to dev, but only `LIBSJS-SCRATCH-*` packages and items, and each case deletes what it created. `--only <id>,…` picks cases, `--force` re-records, `--list` shows what is recorded, `--readme-only` rewrites the READMEs and index from the case list and the run records without running the engine.

- A case is a list of steps; a step is one oracle `import` with its own manifest and options. Every step but the last runs with `--keep-created`, so the next step finds what it imported (a re-import, a delete of what an earlier step made, a second generation). The last step deletes everything the case created. If a step fails or ends differently from the case's `expect`, the recorder runs `cleanup` on everything created so far and installs nothing.
- The packages are code (`src/import-packages.ts`): ids come from `sid(name)`, item files are written the way the export writes them, and each step's `input/` is exactly what the builder writes (a test checks it). Names follow `LIBSJS-SCRATCH-*`; ItemType and SQL names use `LIBSJS_SCRATCH_*`.
- Each case README lists the ids created per step and the ids the cleanup deleted. `case.json` holds the same, machine-readable.
- Every import begins with the list of all PackageDefinitions (about 2.7 MB), which differs from step to step because the earlier steps' scratch packages are in it. Large responses are stored once in `fixtures/14.0.7/import/_blobs/` (see `src/transcript.ts`).
- `--engine 12.0` records the cases into `fixtures/12.0/import/` (ticket 48). A case lists the engines it runs on (`engines`; default all), and a step can name another expected outcome per engine (`expectOn`). Cases named `r*` exist only for 12.0, each pinning one of its variant rules. 12.0 has no language-pack import.
- The password arrives through `ARAS_PASSWORD` or stdin like any oracle run.

## 14.35 import fixture cases

`npm run oracle:import-cases -- --engine 14.35` records the 14.35 cases of `src/import-cases.ts` into `fixtures/14.35/import/<case>/step-<n>/`, with the same recorder, layout and rules as the 14.0.7 cases above (`--only`, `--force`, `--list` and `--readme-only` work the same; without `--engine` it records 14.0.7). The list is ticket 05's catalogue with the overrides in `OVERRIDES_14_35` (where 14.35 ends a case differently, such as the cancel), plus the cases only 14.35 has, in `NEW_14_35`:

- `cui-order`, `delayed-duplicate`, `delayed-property-where`: the 14.35 variants of `build.xsl` and the delayed resolution;
- `lang-*`: the `Languages` selection. A step's `languages` option is the `Languages` host parameter; a case lists the `devLanguages` it needs. The cases that need `de` and `fr` installed (`lang-select-de`, `lang-star-installed`, `lang-unset-installed`, `lang-two-packages`, `lang-batch-select`) were recorded while dev had both; the others with `en` only. The oracle cannot add a `Language`: they were added and deleted by hand, as for the language-pack runs below;
- `batch-*` and `collect-*`: the AML batch mode (`amlBatch: { maxSize }`) and the collected errors (`collectErrors: { maxCount }`), on ticket 05's S9 shape (`src/import-packages-14.35.ts`).

A step can end with the engine refusing the run before any item (`"refused"`: the `ImportExportManager` constructor threw, so the host ends with the exception and no return value) or with a count of collected errors (`"returned:n"`). The recorder refuses a run that does not end as its case says, so a run that the server spoiled (a deadlock victim, a foreign key race right after the previous case's cleanup) is repeated, and only the repeat is committed.

## 14.35 language-pack fixture cases

`npm run oracle:lp-cases` records `src/language-pack-cases.ts` (`lpimport` on 14.35) into `fixtures/14.35/language-pack/<case>/`. The packs are the 14.0.7 runs' (ticket 45), built by `writePack`; `lp06` and `lp07` set `Languages`. Dev needs the Languages `de` and `fr` and the two scratch `Forum` items of `fixtures/14.0.7/language-pack/setup.aml`. Apply them by hand (each Language add takes longer than 30 seconds because the server adds a `LABEL_<code>` column to every table with a multilingual property) and remove them with `teardown.aml` afterwards, deleting the Teams of the Forums too. The recorder then imports the package `LIBSJS-SCRATCH-LP` only and deletes what it created.

## A recorded fixture folder

| File | What |
|---|---|
| `run.json` | engine, toolset identity, server, user, host parameters, host info (call and message counts, server version, result, error), `cleanup` for imports (`created`, `deleted`, `kept` with a reason, and `unverified`, each as `type`, `id` and `unconfirmed` when its call failed in transport), and what was scrubbed |
| `transcript.jsonl` | one call per line: `event`, `seq`, `start`, `depth`, `thread`, `startTicks`, `endTicks`, `action` (the SOAP action), `request` (the AML given to `CallAction`), `response` (the full response envelope), `error` if the call threw |
| `messages.jsonl` | one message per line: `event`, `seq`, `thread`, `ticks`, `channel`, `text`, `answer`. `event` counts calls and messages together, so the two streams interleave |
| `engine.log` | the engine's own log (`LogFilePath`) |
| `host.log` | the host's console output |
| `output/` | export: the engine's output folder, byte for byte |
| `input/` | import and lpimport: the package folder the engine read |
| `lp/` | lpimport: the language pack folder (`--lp-dir`) |

The transcript holds the AML exchanged, not the request bytes. IOM adds the SOAP envelope and headers below `CallAction`, and the OAuth token exchange happens outside it, so neither is recorded. `spec/wire.md` specifies them, with a scrubbed proxy capture of the reference host in `fixtures/wire/` as evidence.

## Rules

- **Dev or a lease only.** `xsl` contacts no server. The other commands, the parity script and `src/client/live.test.ts` refuse any server but the dev instance (`http://localhost/12sp9` from Windows, or `172.19.0.1` from WSL) or an arashouse lease (`oracle/src/live-targets.ts`). A lease is allowed only at its own alias and database, `http://<host>/ah-<slot>` and `arashouse_<flavor>_<NN>`, on `localhost`, `127.0.0.1`, the dev instance's address, the WSL default gateway or `ARASHOUSE_HOST_ADDR`, and only while `arashouse status --json` (`ARASHOUSE_BIN`, default `arashouse` on the `PATH`) shows that slot as `leased`. Any leased slot is accepted, not only your own lease, so point `ARAS_URL` and `ARAS_DATABASE` only at your own lease (use `arashouse run --lease <id>`). A missing `arashouse`, a failing one or output that does not parse refuses the lease. A URL or database naming `olm` or `prod` (`OLM_Local` included) is refused whatever arashouse says. The scratch guard and the cleanup below are the same on a lease. `import` and `lpimport` refuse any package or item not named `LIBSJS-SCRATCH-*` (step 6). `dbpatch` applies the committed no-op patch only (see "The DB patch command"). Each one deletes what it created (step 7) and prints the created, deleted, kept and unverified ids. A run that keeps anything, leaves anything unverified, or whose host reports no cleanup, exits 1.
- **The scratch guard catches mistakes; it does not resolve targets.** It checks names: package names, item file names, `name` and `keyed_name`. The engine picks the item it changes by `id` or `where`, and the guard never looks those up. So feed the oracle only this repo's own `LIBSJS-SCRATCH-*` fixture packages. Never feed it a foreign package or language pack whose items carry real ids, a package with `edit`, `merge` or `delete` post-actions, or `--merge` against non-scratch items.
- **The password** arrives only through `ARAS_PASSWORD` or stdin. It reaches PowerShell through `WSLENV` and never through a command line or a file. 14.35's host sends IOM the MD5 hex, because IOM 15 would otherwise send the plain password first. 12.0 and 14.0.7 send it plain.
- **Scrubbing** (`src/scrub.ts`) runs over every collected file. It replaces password elements and fields, `Authorization` headers, bearer tokens, OAuth token fields, JWTs, and the run password's MD5 and SHA-256 forms. A file with nothing to scrub keeps its exact bytes. A run fails if credential-shaped text survives. `npm test` fails if any file under `fixtures/` contains it.
- Only Aras's shipped binaries live under `native/`. **Decompiled C# never does**; it goes to the gitignored `.decomp/` (see `AGENTS.md`). `host/` is this repo's own code.
- To refresh a toolset, run `npm run oracle -- --engine <v> vendor [--from <folder>]`. It re-copies the folder and rewrites its manifest entry.
