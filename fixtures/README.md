# Fixtures

Recorded oracle runs that the unit tests replay on any OS, with no server and no .NET.

Fixture tickets add one folder per engine version and fixture family. `wire/` holds the proxy captures of each engine's reference host (see `wire/14.0.7-reference-host/README.md`, `wire/12.0-reference-host/README.md` and `wire/14.35-reference-host/README.md`) and 14.35's stub-connection probe of login, the version gate and exception texts (`wire/14.35-probe/README.md`). `unknown-refs/enumeration/` holds replays of .NET's `SelectNodes`-while-removing behaviour on the real framework (spec rule EXP-615; no server involved). Each other fixture holds:

- the AML transcript: every request the engine sent and every response it got, in order;
- the export output folder (item files and `imports.mf`), or the import input package;
- the engine's log and messages.

`14.0.7/export/` holds the 14.0.7 export cases from ticket 05's catalogue, one folder per case (see its `README.md`). Each case folder has the oracle's run record, `transcript.jsonl`, `messages.jsonl`, `engine.log`, `host.log` and `output/`, plus `case.json` (the input, with the `Hashtable` insertion order, and the result) and a `README.md`. A transcript response of 64 KB or more is stored once under `14.0.7/export/_blobs/<sha256>.xml` and named by `responseBlob` in its line, because every export begins with the same 2.7 MB list of PackageDefinitions. `oracle/src/transcript.ts` reads a transcript with the blobs put back.

`14.35/export/` holds the 14.35 export cases (ticket 57), in the layout of `14.0.7/export/` (see its `README.md`): ticket 05's catalogue and option matrix again, the scratch-seeded cases again, and the cases of the `[14.35]` export rules: the request tree and its level (`x-level-*`, `x-template-*`), the first failure that stops the whole export (`x-abort-*`), a cancel (`x-cancel-*`), parallel runs (`x-par-*`) and the language-resource modes (`l1-*` on a server with `en` only, `lang-*` against a scratch ItemType and instances whose values are translated into `de` and `fr`). The cases whose outcome depends on timing exist three times (`-run1` to `-run3`). Their `engine.log` is the raw log of that run and is compared as a set (EXP-558). The language cases ran while dev had the Languages `de` and `fr`, added for the recording and deleted again; each case README says so.

`14.0.7/import/` holds the 14.0.7 import cases (ticket 25), one folder per case with a `step-<n>/` folder per oracle run (see its `README.md`). A step folder has the run record (with the cleanup report), `transcript.jsonl`, `messages.jsonl`, `engine.log`, `host.log` and `input/`, the package folder the engine read. Each case README lists the `LIBSJS-SCRATCH-*` ids created and deleted. Large transcript responses are in `14.0.7/import/_blobs/`.

`14.35/import/` holds the 14.35 import cases (ticket 75), in the layout of `14.0.7/import/`: ticket 05's catalogue run again on 14.35, and the cases only 14.35 has (the `cui_` groups of `build.xsl`, the de-duplicated delayed entry, the `Languages` selection, the AML batch mode and the collected errors). Large transcript responses are in `14.35/import/_blobs/`. `14.35/language-pack/` holds eight recorded `lpimport` runs on 14.35 (ticket 75; `lp01` to `lp05` are ticket 45's packs, `lp06` and `lp07` select `de` and `*`, `lp08` is the package name with a dot). Their own READMEs list the files and the dev state.

`14.35/dbpatch/` holds the 14.35 DB patch cases (ticket 72), one folder per case with a `step-<n>/` folder per oracle `dbpatch` run (see its `README.md`): the `admin` login that the engine refuses, and the committed no-op patch applied as `root` and again. A step folder has the run record (with the cleanup report), `transcript.jsonl`, `messages.jsonl`, `engine.log`, `host.log` and `input/`, the manifest and patch file the engine read. Each case README lists the ids created and deleted.

`12.0/export/` and `12.0/import/` (ticket 48) hold the same cases recorded from engine 12.0.0.13341 (`npm run oracle:export-cases -- --engine 12.0`, `oracle:export-scratch-cases` and `oracle:import-cases` likewise), in the same layout. The export catalogue and the scratch-seeded export cases are those of 14.0.7, so the two engines can be compared case by case; the import side adds three cases that exist only for 12.0 (`r11-ac-attribute-actions`, `r15-latin1-file`, `r15-utf16-no-bom`), and some shared cases end differently (a case README's "Expected" column shows it). `12.0/README.md` maps each 12.0 variant rule to its cases. 12.0 has no language-pack import, so there is no `12.0/language-pack/`.

Rules for this folder:

- **Bytes are exact.** Files keep the engine's BOM, CRLF line endings and indentation. `.gitattributes` turns off line-ending conversion here, so never re-save these files with an editor.
- **Credentials are scrubbed.** No password, auth or access token, or password hash is ever committed. `oracle/src/fixtures-scrubbed.test.ts` fails `npm test` if any file here holds credential-shaped text.
- **14.35 logs compare as a set.** 14.35 exports in parallel, so its log line order is not deterministic.
- Fixtures are recorded only on the dev instance. Imports use `LIBSJS-SCRATCH-*` packages and items, cleaned up after each run.

`<engine>/xsl/<set>/` holds recordings of that engine's embedded `export.xsl` and `build.xsl` on given documents, made by `npm run oracle -- xsl` (see `oracle/README.md`, "The XSL probe"). Each folder has `run.json` and `cases/<name>/{input.xml,transform.xml,applied.xml}`, and `oracle/src/xsl-fixtures.ts` loads them. The inputs are `oracle/xsl-cases/` plus a recorded response of ticket 24's export. `src/export/transform.test.ts` replays the 14.0.7 `export`, `export-items` and `export-fix` recordings against the export transform. The stylesheets themselves are never committed.

`engine-diffs/` holds the pinned comparison of the three engines on the same dev items (ticket 64): `export.json` for the export cases and `xsl.json` for `export.xsl` on the same inputs. The inputs of the XSL sets `export-items` and `export-fix` are run by all three engines (`12.0/xsl/`, `14.0.7/xsl/`, `14.35/xsl/`). Its own README says what each file holds, and `roadmap/engine-diffs.md` reads it.

`export-write/` is evidence for `spec/export-write.md`, not an engine run: the output of `oracle/export-write-probe/` (offline calls of the 14.0.7 post-XSL, file-layout and file-system code, and `probe-12.0.txt` for the 12.0 steps that differ) and the NTFS case-collision table it measured.

`export-output/` is evidence for the 14.35 export rules (`spec/export-transform.md`, `spec/export-prexsl.md`, `spec/export-write.md`, `spec/export-run.md`), not a server run: the output of `oracle/export-output-probe/`. `run-export-14.35.txt` is one recorded run of the real 14.35 `ExportSolutions` against a scripted connection (scenarios `S1` to `S23`; thread numbers, message order and the race cases differ from run to run, so it is read by the set rules of `EXP-558`). `run-export-14.0.7.txt` runs the scenarios that do not depend on parallelism against 14.0.7. `probe-14.35.txt` and `probe-14.0.7.txt` are the offline method probes. `export-write/probe-14.35.txt` is the existing `export-write` probe run against 14.35, to be read beside `probe-14.0.7.txt`; the rows that print the length of the run folder differ with the folder.

`import-load/` is evidence for `spec/import-load.md`, not an engine run: probes of the 14.0.7 package loader and `build.xsl`, and of the 12.0 ones (`*.12.0*`). Its own README lists the files.

`import-merge/` is evidence for `spec/import-merge.md`, not an engine run: the output of `oracle/merge-probe/` (offline calls of the 14.0.7 import merge, validation and versionable code against stubs, and the same scenarios through 12.0 in `12.0-probe/`). Its own README says how to re-record.

`import-run/` is evidence for `spec/import-run.md`, not an engine run against a server: probes of the 14.0.7 import orchestration, package registration, audit row and SQL handling against a stub connection, and `probe-12.0.txt` for 12.0. Its own README lists the files.

`14.0.7/language-pack/` holds five recorded `lpimport` runs against dev scratch items (see its `README.md`).

`language-pack/` is evidence for `spec/language-pack.md`, not an engine run: probes of the 14.0.7 `LanguagePackPreprocessor` against a fake IOM connection, the host's argument parser, and the invariant lower-casing table. Its own README lists the files.

`export-requests/` is evidence for `spec/export-requests.md`, not an engine run: `14.0.7-probe/` and `14.35-probe/` hold the requests the engine's own export classes build against a stub connection (`oracle/request-probe/`), and `14.35-probe/server-reactions.json` holds read-only dev gets that compare 14.0.7's and 14.35's request shapes. Each folder's README says how it was recorded.

`xml-core/` is evidence for the XML core (`src/xml/`), not an engine run: `vectors.json` holds about thirteen hundred inputs of .NET Framework's `System.Xml`, `WebUtility`, `File.ReadAllText` and XPath, each with the result .NET gave. The test `src/xml/vectors.test.ts` replays it, and `oracle/xml-core-probe/` records it.

`manifest/14.0.7/` is evidence for `spec/manifest.md`, not an engine run: probes of 14.0.7's `ManifestFile`, `GetPackagePath`, `NormalizeLongPath` and the package ordering (`probes/`, with the output next to each script), `nls-startswith.json`, and `hashtable/`, the probe and digest of the `Hashtable` order. The tests `src/manifest/*.test.ts` and `src/io/host-path.test.ts` replay them. Its own README lists the files.

`import-languages/` is evidence for `spec/import-languages.md` and the 14.35 parts of `spec/language-pack.md`, not an engine run against a server: probes of the 14.35 `LanguageCodesExtractor`, the `ImportExportManager` language selection, the `LanguagePackPreprocessor`, the `lpimport` branch of `CImportItems` and the 14.35 console host's argument parser against a stub connection. Its own README lists the files.
`export-language/` is evidence for `spec/language-export.md` (the 14.35 language-resource export), not an engine run: `probe-14.35.txt` is the output of `oracle/language-export-probe/` (offline calls of the 14.35 constructor, request builders and the four language steps, and whole exports, against a scripted connection) and `server-reactions.json` holds read-only dev gets. Its own README says how each was recorded. The tests replay `probe-14.35.txt` section by section (`src/export/language-requests.test.ts`: `C` and `R`; `language-steps.test.ts`: `MK`, `RM`, `ORD`, `ADD`; `language-export.test.ts`: `E` and `X`), and the `l1-*`, `l3-*` and `lang-*` cases of `14.35/export/` through the whole of `ExportSolutions` (`src/export/run-replay-1435.test.ts`).
