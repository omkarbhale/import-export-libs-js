# Fixtures

Recorded oracle runs that the unit tests replay on any OS, with no server and no .NET.

Fixture tickets add one folder per engine version and fixture family. `wire/` holds the proxy captures of each engine's reference host (see `wire/14.0.7-reference-host/README.md`, `wire/12.0-reference-host/README.md` and `wire/14.35-reference-host/README.md`) and 14.35's stub-connection probe of login, the version gate and exception texts (`wire/14.35-probe/README.md`). `unknown-refs/enumeration/` holds replays of .NET's `SelectNodes`-while-removing behaviour on the real framework (spec rule EXP-615; no server involved). Each other fixture holds:

- the AML transcript: every request the engine sent and every response it got, in order;
- the export output folder (item files and `imports.mf`), or the import input package;
- the engine's log and messages.

`14.0.7/export/` holds the 14.0.7 export cases from ticket 05's catalogue, one folder per case (see its `README.md`). Each case folder has the oracle's run record, `transcript.jsonl`, `messages.jsonl`, `engine.log`, `host.log` and `output/`, plus `case.json` (the input, with the `Hashtable` insertion order, and the result) and a `README.md`. A transcript response of 64 KB or more is stored once under `14.0.7/export/_blobs/<sha256>.xml` and named by `responseBlob` in its line, because every export begins with the same 2.7 MB list of PackageDefinitions. `oracle/src/transcript.ts` reads a transcript with the blobs put back.

`14.0.7/import/` holds the 14.0.7 import cases (ticket 25), one folder per case with a `step-<n>/` folder per oracle run (see its `README.md`). A step folder has the run record (with the cleanup report), `transcript.jsonl`, `messages.jsonl`, `engine.log`, `host.log` and `input/`, the package folder the engine read. Each case README lists the `LIBSJS-SCRATCH-*` ids created and deleted. Large transcript responses are in `14.0.7/import/_blobs/`.

Rules for this folder:

- **Bytes are exact.** Files keep the engine's BOM, CRLF line endings and indentation. `.gitattributes` turns off line-ending conversion here, so never re-save these files with an editor.
- **Credentials are scrubbed.** No password, auth or access token, or password hash is ever committed. `oracle/src/fixtures-scrubbed.test.ts` fails `npm test` if any file here holds credential-shaped text.
- **14.35 logs compare as a set.** 14.35 exports in parallel, so its log line order is not deterministic.
- Fixtures are recorded only on the dev instance. Imports use `LIBSJS-SCRATCH-*` packages and items, cleaned up after each run.

`<engine>/xsl/<set>/` holds recordings of that engine's embedded `export.xsl` and `build.xsl` on given documents, made by `npm run oracle -- xsl` (see `oracle/README.md`, "The XSL probe"). Each folder has `run.json` and `cases/<name>/{input.xml,transform.xml,applied.xml}`, and `oracle/src/xsl-fixtures.ts` loads them. The inputs are `oracle/xsl-cases/` plus a recorded response of ticket 24's export. The stylesheets themselves are never committed.

`export-write/` is evidence for `spec/export-write.md`, not an engine run: the output of `oracle/export-write-probe/` (offline calls of the 14.0.7 post-XSL, file-layout and file-system code, and `probe-12.0.txt` for the 12.0 steps that differ) and the NTFS case-collision table it measured.

`export-output/` is evidence for the 14.35 export rules (`spec/export-transform.md`, `spec/export-prexsl.md`, `spec/export-write.md`, `spec/export-run.md`), not a server run: the output of `oracle/export-output-probe/`. `run-export-14.35.txt` is one recorded run of the real 14.35 `ExportSolutions` against a scripted connection (scenarios `S1` to `S23`; thread numbers, message order and the race cases differ from run to run, so it is read by the set rules of `EXP-558`). `run-export-14.0.7.txt` runs the scenarios that do not depend on parallelism against 14.0.7. `probe-14.35.txt` and `probe-14.0.7.txt` are the offline method probes. `export-write/probe-14.35.txt` is the existing `export-write` probe run against 14.35, to be read beside `probe-14.0.7.txt`; the rows that print the length of the run folder differ with the folder.

`import-load/` is evidence for `spec/import-load.md`, not an engine run: probes of the 14.0.7 package loader and `build.xsl`. Its own README lists the files.

`import-merge/` is evidence for `spec/import-merge.md`, not an engine run: the output of `oracle/merge-probe/` (offline calls of the 14.0.7 import merge, validation and versionable code against stubs). Its own README says how to re-record.

`import-run/` is evidence for `spec/import-run.md`, not an engine run against a server: probes of the 14.0.7 import orchestration, package registration, audit row and SQL handling against a stub connection. Its own README lists the files.

`14.0.7/language-pack/` holds five recorded `lpimport` runs against dev scratch items (see its `README.md`).

`language-pack/` is evidence for `spec/language-pack.md`, not an engine run: probes of the 14.0.7 `LanguagePackPreprocessor` against a fake IOM connection, the host's argument parser, and the invariant lower-casing table. Its own README lists the files.

`export-requests/` is evidence for `spec/export-requests.md`, not an engine run: `14.0.7-probe/` and `14.35-probe/` hold the requests the engine's own export classes build against a stub connection (`oracle/request-probe/`), and `14.35-probe/server-reactions.json` holds read-only dev gets that compare 14.0.7's and 14.35's request shapes. Each folder's README says how it was recorded.

`xml-core/` is evidence for the XML core (`src/xml/`), not an engine run: `vectors.json` holds about thirteen hundred inputs of .NET Framework's `System.Xml`, `WebUtility`, `File.ReadAllText` and XPath, each with the result .NET gave. The test `src/xml/vectors.test.ts` replays it, and `oracle/xml-core-probe/` records it.

`manifest/14.0.7/` is evidence for `spec/manifest.md`, not an engine run: probes of 14.0.7's `ManifestFile`, `GetPackagePath`, `NormalizeLongPath` and the package ordering (`probes/`, with the output next to each script), `nls-startswith.json`, and `hashtable/`, the probe and digest of the `Hashtable` order. The tests `src/manifest/*.test.ts` and `src/io/host-path.test.ts` replay them. Its own README lists the files.
