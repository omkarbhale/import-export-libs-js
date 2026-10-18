# Fixtures

Recorded oracle runs that the unit tests replay on any OS, with no server and no .NET.

Fixture tickets add one folder per engine version and fixture family. `wire/` holds the proxy captures of each engine's reference host (see `wire/14.0.7-reference-host/README.md`). `unknown-refs/enumeration/` holds replays of .NET's `SelectNodes`-while-removing behaviour on the real framework (spec rule EXP-615; no server involved). Each other fixture holds:

- the AML transcript: every request the engine sent and every response it got, in order;
- the export output folder (item files and `imports.mf`), or the import input package;
- the engine's log and messages.

Rules for this folder:

- **Bytes are exact.** Files keep the engine's BOM, CRLF line endings and indentation. `.gitattributes` turns off line-ending conversion here, so never re-save these files with an editor.
- **Credentials are scrubbed.** No password, auth or access token, or password hash is ever committed. `oracle/src/fixtures-scrubbed.test.ts` fails `npm test` if any file here holds credential-shaped text.
- **14.35 logs compare as a set.** 14.35 exports in parallel, so its log line order is not deterministic.
- Fixtures are recorded only on the dev instance. Imports use `LIBSJS-SCRATCH-*` packages and items, cleaned up after each run.
