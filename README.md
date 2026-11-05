# import-export-libs-js

A readable TypeScript re-implementation of Aras Innovator's package import/export engine (`Libs.dll`, `Aras.Tools.SolutionUpgrade`). It runs on any OS with Node ≥ 20, with no .NET, PowerShell or Aras DLLs.

It reproduces three engine builds exactly, bugs included: **12.0** (12.0.0.13341), **14.0.7** (14.0.7.35492, the default) and **14.35** (14.35.0.43890).

**Status: complete.** All three engines are built and complete in `spec/source-map.json` (every reachable method of each build is mapped or held), and each has live parity on the dev instance (`roadmap/live-parity-*.md`, summed up in `roadmap/readiness.md`) and on an arashouse lease of its own server version (`roadmap/live-parity-*-on-leases.md`). The pieces that are deliberately out of scope are in `roadmap/hold/`, and the gaps still open are listed in `roadmap/readiness.md`.

| | 12.0 | 14.0.7 (default) | 14.35 |
|---|---|---|---|
| Export, console export modes | yes | yes | yes (items of a package in parallel) |
| Import, offline `plan import` | yes | yes | yes, with `--batch`, `--collect-errors` and `--languages` |
| Language-pack import | no (the engine has none) | yes | yes |
| Language-resource export (`export --language-resources`) | no | no | yes |
| DB patch application | no | no | yes (`apply-db-patches`, login `root`) |

An engine is chosen with `--engine`. Each one is a separate build of Aras's `Libs.dll`, and the library reproduces its behaviour, bugs included (`spec/bugs.md`). The same command on two engines can produce different output.

## Install

The repo is private, so install it from git:

```sh
npm install git+ssh://git@github.com/omkarbhale/import-export-libs-js.git
```

## CLI

`import-export-libs-js`, alias `aras-pkg`. Run `aras-pkg <command> --help` for every option.

| Command | What it does |
|---|---|
| `aras-pkg export <outDir> [Type:id…]` | Exports items into a folder with an `imports.mf`. The items are arguments, `-` for one per line on standard input, or `--package <name>` (repeatable) for whole packages. Each item's package is found on the server; an item in no package is refused by name and nothing is exported. Aras's console tool's three selections are also modes of `export`: `--use-import <manifest>` (the items an import manifest's package folders would add), `--from-manifest <manifest>` (all elements of the database's packages the manifest names) and `--all-packages`. |
| `aras-pkg import <manifest> [--package <name>…]` | Imports the packages of an `imports.mf`, in dependency order. With `--engine 14.35`, `--batch` and `--batch-max <n>` send the items without Relationships in one `<AML>` request, and `--collect-errors` and `--max-errors <n>` keep importing after a failed item and report every error at the end. |
| `aras-pkg plan import <manifest> [--package <name>…]` | Offline: the order an import follows and, per package, the item sequence, the repeats and every item the import silently drops. |
| `aras-pkg import-language-pack <lppath> --lp-package <name>` | Imports a language pack (`ImportConfig.xml`) as a package. `--lp-debug` keeps the temporary package on disk. Not on `--engine 12.0`. |
| `aras-pkg apply-db-patches <manifest> [--patches-folder <dir>] [--tool-name <text>]` | Applies the database update patches an updates manifest lists, through the server's `ApplyUpdate` action. Only `--engine 14.35`, and only the login `root`: both are refused before anything is sent. Exit `1` when any patch was refused. |

```sh
export ARAS_URL=http://aras.example/InnovatorServer ARAS_DATABASE=InnovatorSolutions ARAS_USER=admin
echo "$PASSWORD" | aras-pkg import ./imports.mf --password-stdin --release R1 --json
```

- **Engine.** `--engine 12.0|14.0.7|14.35`, or `ARAS_PKG_ENGINE`; the default is 14.0.7. The engine used is in the log header and the summary.
- **Connection and credentials.** `--url`, `--database`, `--user` (or `ARAS_URL`, `ARAS_DATABASE`, `ARAS_USER`; a flag wins). The password comes from `ARAS_PASSWORD`, or from standard input with `--password-stdin`; there is no flag for it, and it is never written to the log, the summary or any file. `apply-db-patches` accepts the login `root` only. `--time-zone` sets the Windows time zone id sent as `TIMEZONE_NAME` for a machine whose zone has no mapping.
- **Export options.** `--level`, `--export-referenced`, `--unknown-references remove-silently|remove-with-warning|do-not-remove` (default `do-not-remove`) `--on-item-error continue|abort-package`, and, with `--engine 14.35`, `--parallelism <n>` (items of a package exported at once; default one per logical processor) and the language-resource export: `--language-resources only|with-metadata` with `--languages <codes|*>` (`only` writes just the translations of the listed languages, `with-metadata` the whole item with them; the list must include `en` unless it starts with `*`, and each code must be installed). The output folder is used as the engine uses it: it need not exist or be empty, and the engine deletes the subfolder of each package it exports before writing it.
- **Options.** `--release`, `--description`, `--merge` (`--no-merge`, the default, skips existing items), `--os-user`, `--languages <codes|*>` (`import` and `import-language-pack`, `--engine 14.35` only: import only the nodes of the listed languages, or of every language the packages use with `*`; each must be installed, and every package is scanned for its languages, so a malformed `*.xml` file in any of them fails the run), `--verbose`, `--log <path>` (default `./aras-pkg-<command>-<date>.log`), `--timeout <ms>` (write `--timeout=-1` for no limit) and `--skip-version-check` (run an engine against a server outside its window; a refusal names the engines that fit).
- **Output.** Engine messages go to standard error, one `[INFO]`, `[WARN]`, `[ERROR]` or `[PKG]` line each, with the engine's own console text between them. The summary goes to standard output, as `key: value` lines or as JSON with `--json`, and includes the engine used.
- **Exit codes.** `0` done; `1` failed (the engine returned failure, the login or the version gate refused, or an exception ended the run); `2` done, but the engine sent at least one error message; `64` usage error (nothing was sent to the server).
- **Checked before the server is contacted.** The options parse, the manifest exists, every `--package` is in it, and the log folder can be made. For `export`: every item is `Type:id` (or one of the three console modes is chosen, its manifest exists), the output path can be a folder, and the options are valid.

## Library

`import { … } from "import-export-libs-js"` gives the engines without the CLI. The classes keep the names of the engine's own: `CItemHelper` (login, version probe and gate, the lookups), `ImportExportManager` and `CExportItems` for export, `ImportItems` for import, `LanguagePackPreprocessor` and `languagePackImport`, `DbPatchApplication`, and the manifest reader and writer. The CLI in `src/cli/` is a thin host over them and shows how they fit together (`session.ts` opens the connection). Every unit that implements a rule carries an `@spec <RULE-ID>` tag, so `spec/` explains it.

In a browser, the same import resolves to `dist/browser.js` through the package's `browser` condition (or import `"import-export-libs-js/browser"` explicitly). It has the same core, plus `createBrowserHost`, `createFetchTransport`, `MemoryVfs`, `mountFileList` and `mountDataTransfer` (they mount a folder input's files, or a drop, into the in-memory tree) with `defaultInclude`, `stubsOf` and `STUB_THRESHOLD`, `mountDirectory`, `commitToDirectory`, `isFileSystemAccessSupported` and `CommitError` (they copy a directory handle's folder into the tree and write a tree back to one), the zip adapter (`vfsFromZip`, `vfsToZip`, `ZipError`), the browser API below and `LIBRARY_VERSION`, and no Node API. `spec/browser-host.md` (HOST-252 to HOST-255, HOST-260, HOST-261; the zip adapter in HOST-250, HOST-251) has the details.

The browser API runs the CLI's commands on a tree in memory. `connect` makes a session and picks the engine from the server's version unless you name one; `exportPackages`, `importPackages`, `importLanguagePack` and `applyDbPatches` run on it, and `planImport` needs no server. Each operation takes `onProgress`, `onMessage` and an `AbortSignal`. It has no UI and prints nothing:

```ts
const session = await connect({ url, database, userName, password });
const { vfs, summary } = await exportPackages(session, { packages: ["My Package"], onProgress, signal });
const zip = vfsToZip(vfs, "/export");
await importPackages(session, { source: { zip }, release: "R1" });
await session.close();
```

A page inside a signed-in Aras client can pass `tokenProvider` instead of `password` to use that session; the library never takes it by itself. `spec/browser-host.md` (HOST-270 to HOST-273) has the options, the results and where abort stops.

To keep a long export or import off the page's thread, run the engine in a Web Worker. `createEngineWorker()` starts `dist/browser-worker.js` (a module Worker, found by `new URL("./browser-worker.js", import.meta.url)`; pass `worker` for another form, such as a `?worker` import of `import-export-libs-js/browser-worker.js`) and has the same operations as calls. Callbacks (`onProgress`, `onMessage`, `onItemError`, `tokenProvider`, a `transport` of your own) stay on the page and are called as the Worker reports. Inputs are `{zip}`, `{files}`, `{fileList}`, `{dataTransfer}` (a drop's items: start the call in the `drop` handler, before any `await`) or `{directory}`; the bytes of a zip or a map are transferred (your array is empty afterwards; pass a copy to keep the bytes), a `File` or a directory handle is read in the Worker. An export resolves with `files` (and `zip` with `zip: true`, when the run made its folder) as transferred buffers, and an error comes back as an object of the library's class, so `instanceof` works. `abort()` or a `signal` cancels a run; `dispose({force: true})` stops a Worker that does not answer. The password crosses once, in `connect`.

```ts
const engine = createEngineWorker();
const session = await engine.connect({ url, database, userName, password });
const { files, zip } = await engine.exportPackages(session, { packages: ["My Package"], zip: true, onProgress });
await engine.importPackages(session, { source: { zip: uploadedZipBytes } });
await engine.dispose();
```

`spec/browser-host.md` (HOST-274 to HOST-276) has the protocol, the transfer rules and the bundle.

A package is held in memory, and the engine's parsed documents make an import cost about 40 to 70 times the package's size in a browser tab (an export about 6 times plus a fixed 370 MB); 50 MB was imported in Chromium at 2.9 GB. Larger packages belong to the CLI until the follow-up of `roadmap/browser-limits.md` lands.

The XML core's loader and item-file writer are public too, for a host that wants to know whether a file is one the engine would write: `readAllText(bytes)` (14.0.7 and 14.35) or `decodeXmlFile(bytes)` (12.0) decodes the bytes of a file, `loadXml(text, { preserveWhitespace })` loads the text, and `encodeItemFile(doc)` gives the bytes of the item file the engine writes for it; compare those with the original bytes. The choice of `preserveWhitespace` is the caller's, and neither setting alone decides whether a file round-trips. With `false` (as the import loads files) whitespace-only element text is dropped, so a file holding `<name> </name>` is reported as not round-tripping. With `true` (as the export loads documents) that value is kept, but so is the indentation, so a file indented with four spaces is reported as round-tripping. `XmlDocument` is the type of the loaded document, and the same one `applyExportTransform` and `applyXsl` take.

## Verify against the real engine

The vendored `Libs.dll` of each engine (`oracle/native/`) can be driven from WSL with Windows PowerShell 5.1, to record fixtures and to compare the port with the DLL on a live dev server:

```sh
npm run parity -- --list                      # the catalogue; no server
ARAS_PASSWORD=… npm run parity -- --engine 14.35
```

Parity touches only `LIBSJS-SCRATCH-*` items and deletes them again. See `oracle/README.md`; it is not part of `npm test`.

## Develop

```sh
npm install
npm run typecheck
npm test
npm run build
```

- `AGENTS.md`: the rules every change follows, and how to add a new Aras build.
- `spec/`: the behavioural spec, rule ids, bug register and source map.
- `roadmap/`: the design decisions, the live-parity records, `readiness.md`, and `hold/` for what is out of scope.
