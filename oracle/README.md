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
- **`xsl-cases/`**: this repo's own synthetic inputs for the `xsl` command (`export/` and `build/`), one XML file per case. They are byte-exact (some hold CRLF), so editors must not re-save them.
- **`export-write-probe/`**: offline probes of the export write path (post-XSL steps, output layout, file-system rules), for `spec/export-write.md`. `probe.ps1` is 14.0.7's and `probe-12.0.ps1` covers the 12.0 steps that differ. How to re-run is in its README.
- **`wire-capture/`**: a one-off recording of an engine's reference host below the AML, for the wire fixtures in `fixtures/wire/`. `ReferenceHost.cs` (14.0.7) and `ReferenceHost-12.0.cs` connect as each version's ConsoleUpgrade does, `proxy.mjs` records every HTTP exchange, and `fixture.ts` scrubs the recording. How to re-record is in each fixture's README.
- **`xml-core-probe/`**: records the .NET Framework `System.Xml`, `WebUtility` and `File.ReadAllText` results that the XML core of `src/xml/` has to reproduce, as `fixtures/xml-core/vectors.json`. It needs no `Libs.dll`. The README of the folder says how to re-record.
- **`request-probe/`**: drives engine 14.0.7's `CExportItems` and `CItemHelper` against a stub connection that never touches a network, to pin the requests they build and how their lookups react to scripted answers. It needs no server or password. The recording is `fixtures/export-requests/14.0.7-probe/`, and its README says how to re-record. `probe-14.35.ps1` does the same for 14.35 (IOM 15, `fixtures/export-requests/14.35-probe/`).
- **`merge-probe/`**: drives engine 14.0.7's `CImportItems` against a scriptable stub helper, and its `CItemHelper` merge lookups against the request probe's stub connection, to pin the validation, merge and versionable processing of `spec/import-merge.md`. It needs no server or password. The recording is `fixtures/import-merge/14.0.7-probe/`, and `run.sh` re-records it.

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

   - `xsl` runs no engine action and needs no server or password; see "The XSL probe".

   Running 14.35's `ImportDPPatch` / `ApplyDBUpdateManifest` is not wired yet (ticket 72).
6. **The scratch guard.** Right before `ImportSolutions`, the host checks what the engine is about to get. Every package in the set must be named `LIBSJS-SCRATCH-*`; for `lpimport` that is the temp manifest's package, `--lp-package`. For `import`, so must every item file `LoadPackageDom` reads for those packages (the file name is the keyed name the engine records), and every top-level item's `name`. For `lpimport`, so must the `keyed_name` of every item in the language pack's `xml/` folder. An empty package set is refused too. Before anything is staged, the WSL side checks the package names the same way. The guard checks names only (see Rules).
7. **Cleanup.** After `import` or `lpimport`, the host stops recording, so nothing from here on reaches the transcript. It then deletes what the run created, newest first. The run created every top-level item that a successful call sent with `action="add"`. For the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows, the id comes from the response. A call that failed in transport may still have been committed: either it threw, or IOM wrote its own fault (faultactor `HttpServerConnection`, as for a timeout or a dropped connection). So its `add` and `create` items count too, marked `unconfirmed`, with only the ids the request names. Each is looked up by id and deleted if it exists. One that is not found goes to `unverified`, because the server may still commit it after the client gave up; re-check those ids later. An unconfirmed item with no id is kept. An item is deleted only when it belongs to a `LIBSJS-SCRATCH-*` name: a relationship by its source's name, any other item by its name or keyed name. Anything else is kept and reported. Relationships nested inside an added item go with it.

## Export fixture cases

`npm run oracle:export-cases` records ticket 05's 14.0.7 export catalogue (`src/export-cases.ts`) into `fixtures/14.0.7/export/<case>/`, one oracle export per case, read-only on dev. `--only <id>,…` picks cases, `--force` re-records, `--list` shows what is recorded, `--readme-only` rewrites the READMEs and index from the case list without running the engine. Each case lists its packages and items in the order the host inserts them into the engine's `Hashtable`; the multi-package ordering cases (`p1-*`) rely on that. The password arrives through `ARAS_PASSWORD` or stdin like any oracle run.

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

The folder it writes holds `run.json` (engine, toolset identity, stylesheet size and hash, `PreserveWhitespace`, culture, CLR, and per case the input hash, source and the outcome of each step) and `cases/<name>/` with `input.xml`, `transform.xml` and `applied.xml`. Inputs are scrubbed before the engine sees them, so every output derives from the committed input. Recordings are committed as `fixtures/<engine>/xsl/<set>/` (`export`, `build`, and `build-sv-SE` for the culture case), and `oracle/src/xsl-fixtures.ts` loads them for the unit tests that replay them on any OS. `oracle/src/xsl.test.ts` checks every recording against its vendored `Libs.dll` and the case inputs it came from.

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

- **Dev only.** `xsl` contacts no server. The other commands: the oracle refuses any server but the dev instance (`http://localhost/12sp9` from Windows, or `172.19.0.1` from WSL). `import` and `lpimport` refuse any package or item not named `LIBSJS-SCRATCH-*` (step 6). Each one deletes what it created (step 7) and prints the created, deleted, kept and unverified ids. A run that keeps anything, leaves anything unverified, or whose host reports no cleanup, exits 1.
- **The scratch guard catches mistakes; it does not resolve targets.** It checks names: package names, item file names, `name` and `keyed_name`. The engine picks the item it changes by `id` or `where`, and the guard never looks those up. So feed the oracle only this repo's own `LIBSJS-SCRATCH-*` fixture packages. Never feed it a foreign package or language pack whose items carry real ids, a package with `edit`, `merge` or `delete` post-actions, or `--merge` against non-scratch items.
- **The password** arrives only through `ARAS_PASSWORD` or stdin. It reaches PowerShell through `WSLENV` and never through a command line or a file. 14.35's host sends IOM the MD5 hex, because IOM 15 would otherwise send the plain password first. 12.0 and 14.0.7 send it plain.
- **Scrubbing** (`src/scrub.ts`) runs over every collected file. It replaces password elements and fields, `Authorization` headers, bearer tokens, OAuth token fields, JWTs, and the run password's MD5 and SHA-256 forms. A file with nothing to scrub keeps its exact bytes. A run fails if credential-shaped text survives. `npm test` fails if any file under `fixtures/` contains it.
- Only Aras's shipped binaries live under `native/`. **Decompiled C# never does**; it goes to the gitignored `.decomp/` (see `AGENTS.md`). `host/` is this repo's own code.
- To refresh a toolset, run `npm run oracle -- --engine <v> vendor [--from <folder>]`. It re-copies the folder and rewrites its manifest entry.
