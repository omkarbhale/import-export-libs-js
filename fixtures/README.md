# Fixtures

Recorded oracle runs that the unit tests replay on any OS, with no server and no .NET.

Fixture tickets add one folder per engine version and fixture family. `wire/` holds the proxy captures of each engine's reference host (see `wire/14.0.7-reference-host/README.md` and `wire/12.0-reference-host/README.md`). `unknown-refs/enumeration/` holds replays of .NET's `SelectNodes`-while-removing behaviour on the real framework (spec rule EXP-615; no server involved). Each other fixture holds:

- the AML transcript: every request the engine sent and every response it got, in order;
- the export output folder (item files and `imports.mf`), or the import input package;
- the engine's log and messages.

`14.0.7/export/` holds the 14.0.7 export cases from ticket 05's catalogue, one folder per case (see its `README.md`). Each case folder has the oracle's run record, `transcript.jsonl`, `messages.jsonl`, `engine.log`, `host.log` and `output/`, plus `case.json` (the input, with the `Hashtable` insertion order, and the result) and a `README.md`. A transcript response of 64 KB or more is stored once under `14.0.7/export/_blobs/<sha256>.xml` and named by `responseBlob` in its line, because every export begins with the same 2.7 MB list of PackageDefinitions. `oracle/src/transcript.ts` reads a transcript with the blobs put back.

Rules for this folder:

- **Bytes are exact.** Files keep the engine's BOM, CRLF line endings and indentation. `.gitattributes` turns off line-ending conversion here, so never re-save these files with an editor.
- **Credentials are scrubbed.** No password, auth or access token, or password hash is ever committed. `oracle/src/fixtures-scrubbed.test.ts` fails `npm test` if any file here holds credential-shaped text.
- **14.35 logs compare as a set.** 14.35 exports in parallel, so its log line order is not deterministic.
- Fixtures are recorded only on the dev instance. Imports use `LIBSJS-SCRATCH-*` packages and items, cleaned up after each run.

`export-write/` is evidence for `spec/export-write.md`, not an engine run: the output of `oracle/export-write-probe/` (offline calls of the 14.0.7 post-XSL, file-layout and file-system code, and `probe-12.0.txt` for the 12.0 steps that differ) and the NTFS case-collision table it measured.

`import-load/` is evidence for `spec/import-load.md`, not an engine run: probes of the 14.0.7 package loader and `build.xsl`. Its own README lists the files.

`import-merge/` is evidence for `spec/import-merge.md`, not an engine run: the output of `oracle/merge-probe/` (offline calls of the 14.0.7 import merge, validation and versionable code against stubs). Its own README says how to re-record.

`import-run/` is evidence for `spec/import-run.md`, not an engine run against a server: probes of the 14.0.7 import orchestration, package registration, audit row and SQL handling against a stub connection. Its own README lists the files.

`language-pack/` is evidence for `spec/language-pack.md`, not an engine run: probes of the 14.0.7 `LanguagePackPreprocessor` against a fake IOM connection, the host's argument parser, and the invariant lower-casing table. Its own README lists the files.
