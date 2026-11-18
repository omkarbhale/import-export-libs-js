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

The same library runs in a browser; see [Browser](#browser).

The XML core's loader and item-file writer are public too, for a host that wants to know whether a file is one the engine would write: `readAllText(bytes)` (14.0.7 and 14.35) or `decodeXmlFile(bytes)` (12.0) decodes the bytes of a file, `loadXml(text, { preserveWhitespace })` loads the text, and `encodeItemFile(doc)` gives the bytes of the item file the engine writes for it; compare those with the original bytes. The choice of `preserveWhitespace` is the caller's, and neither setting alone decides whether a file round-trips. With `false` (as the import loads files) whitespace-only element text is dropped, so a file holding `<name> </name>` is reported as not round-tripping. With `true` (as the export loads documents) that value is kept, but so is the indentation, so a file indented with four spaces is reported as round-tripping. `XmlDocument` is the type of the loaded document, and the same one `applyExportTransform` and `applyXsl` take.

## Browser

The library also runs in a web page: export, import, language-pack import and DB-patch application, for all three engines (each with the operations of the table above), in Chromium, Firefox and WebKit, with no server of its own and no Node API. Its output is the Node build's, byte for byte. The recorded fixtures replay in the three browsers (`npm run test:browser`), and a live run on one arashouse lease per engine found no unexplained difference between the real engine, the Node port and the browser ([`roadmap/live-parity-browser.md`](roadmap/live-parity-browser.md)). The rules of the browser host are `HOST-200` to `HOST-299` in [`spec/browser-host.md`](spec/browser-host.md), and the decisions behind them are in [`roadmap/browser-host.md`](roadmap/browser-host.md).

### Install and import

Install the package as above. In a page, import `"import-export-libs-js/browser"`, or import `"import-export-libs-js"` with a bundler that honours the `browser` condition; both resolve to `dist/browser.js`. `npm run build` writes three bundles: `dist/index.js` (Node, with the CLI's `dist/cli.js`), `dist/browser.js` (one ES2022 module that imports nothing, with its declarations) and `dist/browser-worker.js` (the Web Worker's module). The browser entry has the core of the Node entry, plus the browser API below, the in-memory file system `MemoryVfs`, the adapters and `createBrowserHost` and `createFetchTransport`. It has no Node API.

### Export and import

The browser API runs the CLI's commands on a tree of files in memory. `connect` logs in and picks the engine from the server's version, unless you name one with `engine`. `exportPackages`, `importPackages`, `importLanguagePack` and `applyDbPatches` run on the session, and `planImport` needs no server. Each operation takes `onProgress`, `onMessage` and an `AbortSignal` as `signal`, and resolves with the tree the run used (an export also with its `files`), the log, the engine's messages and a summary. The library has no UI and prints nothing: the page decides where the inputs come from and where the files go.

An export, offered as a zip to download:

```ts
import { connect, exportPackages, vfsToZip } from "import-export-libs-js/browser";

const session = await connect({ url, database, userName, password });
const { vfs, summary } = await exportPackages(session, {
  packages: ["My Package"],
  onProgress: (event) => console.log(event.phase, event.package, event.index, event.total),
});
await session.close();
const zip = vfsToZip(vfs, "/export");
```

An import of a zip that the user chose (`file` is a `File` from an `<input type="file">` or a drop):

```ts
import { connect, importPackages } from "import-export-libs-js/browser";

const zip = new Uint8Array(await file.arrayBuffer());
const session = await connect({ url, database, userName, password });
const { summary, messages } = await importPackages(session, { source: { zip }, release: "R1" });
await session.close();
```

These snippets run as they are written in a browser test (`src/browser/readme.browser.test.ts`, HOST-282), against a server that answers over HTTP from another origin. A page inside a signed-in Aras client can pass `tokenProvider` instead of `password` to use that client's session; the library never takes it by itself. `spec/browser-host.md` (HOST-270 to HOST-273) has every option, the results and where an abort stops.

### In a Web Worker

The engine's work is synchronous, so a long export or import holds the thread it runs on. `createEngineWorker()` runs the engine in a module Worker, `dist/browser-worker.js` (found by `new URL("./browser-worker.js", import.meta.url)`; pass `worker` for another form, such as a `?worker` import of `import-export-libs-js/browser-worker.js`), with the same operations as calls:

```ts
import { createEngineWorker } from "import-export-libs-js/browser";

const engine = createEngineWorker();
const session = await engine.connect({ url, database, userName, password });
const { files, zip, summary } = await engine.exportPackages(session, { packages: ["My Package"], zip: true });
await engine.dispose();
```

Callbacks (`onProgress`, `onMessage`, `onItemError`, `tokenProvider`, a `transport` of your own) stay on the page and are called as the Worker reports. Inputs are `{zip}` (bytes or a `File`), `{files}`, `{fileList}`, `{dataTransfer}` (a drop's items: start the call in the `drop` handler, before any `await`) or `{directory}`. The bytes of a zip or a map are transferred, so your array is empty afterwards (pass a copy to keep the bytes); a `File` or a directory handle is read in the Worker. An export resolves with `files` (and `zip` with `zip: true`, when the run made its folder) as transferred buffers. An error comes back as an object of the library's class, so `instanceof` works. `abort()` or a `signal` cancels a run, and `dispose({force: true})` stops a Worker that does not answer. The password crosses to the Worker once, in `connect`. `spec/browser-host.md` (HOST-274 to HOST-276) has the protocol, the transfer rules and the bundle.

### Packages in and out, and supported browsers

The tested browsers are Chromium, Firefox and WebKit (Playwright 1.64.1: Chromium 156, Firefox 157, WebKit 27.2). The build targets ES2022, and the Worker form needs module Workers, which all three have. The adapters turn what a page's controls give into the tree the engine reads, and the tree it writes into something to hand back:

| In or out | Adapter | Chromium | Firefox | WebKit |
|---|---|---|---|---|
| A zip, chosen or downloaded | `vfsFromZip`, `vfsToZip` (`{zip}`) | yes | yes | yes |
| A folder, chosen with `<input type="file" webkitdirectory>` | `mountFileList` (`{fileList}`) | yes | yes | yes |
| A folder or files, dropped | `mountDataTransfer` (`{dataTransfer}`) | yes | yes | yes |
| A folder behind a directory handle, read and written | `mountDirectory`, `commitToDirectory` (`{directory}`) | yes, and `showDirectoryPicker` | the origin private file system only | the origin private file system only, not in a private window |

`isFileSystemAccessSupported()` says whether the page can ask for a folder with `showDirectoryPicker`. `roadmap/browser-adapter-tests.md` has what each adapter does in each browser, and `spec/browser-host.md` (HOST-250 to HOST-255) the rules.

`examples/browser/` is a reference page that uses this API for all four operations, with upload and download, a folder input, a drop zone and the picker where the browser has one. [Its README](examples/browser/README.md) says how to build and serve it.

### Server configuration (CORS)

A page served from another origin than the Aras server works only after the server's administrator lists the page's origin. No server answers the whole login chain to an unknown origin as shipped. Two edits are needed (section 3 of [`roadmap/browser-cors-poc.md`](roadmap/browser-cors-poc.md) has them in full):

- **The OAuth server, every version.** Add the page's origin to `allowedCorsOrigins` in `OAuthServer/OAuth.config`.
- **The SOAP endpoint.** Release 23 and Release 35 ship `Access-Control-Allow-Origin: *` and the headers the client sends, which is enough (for the 14.35 engine, also allow `Aras-Request-ReadOnly`). 12 SP9 sends no CORS headers: add the `<httpProtocol><customHeaders>` block of the record to `Server/web.config`.

A page embedded in the Aras client is on the server's origin and needs neither. The session cookie is not used: the transport sends no credentials (`credentials: "omit"`), and the bearer token carries the session. An `https` page cannot call an `http` server in Firefox and WebKit.

### Size limit

A package is held in memory, and the engine's parsed documents make an import cost about 40 to 70 times the package's size in a browser tab. An import of about **50 MB** completes in Chromium (at 2.9 GB of memory). Larger packages should go through the command line tool (`aras-pkg import`). The command line tool runs the same `importSolutions` code at about the same cost (43 times measured under Node at 10 MB; about 4.3 GB at 100 MB and 21 GB at 500 MB, extrapolated and not measured), so it can exceed Node's default heap: a large import needs `node --max-old-space-size=<MB>` and a machine with that much memory. `importPackages` warns, in its messages (`source: "host"`), when the package it is given is above 50 MB, and goes on. An export costs about 7 times the package plus a fixed 340 MB.

| Package | Browser | Import: time, memory | Export: time, memory |
|---|---|---|---|
| 10 MB | Chromium | 18 s, 730 MB | 49 s, 379 MB |
| 50 MB | Chromium | 67 s, 2.9 GB | 90 s, 698 MB |
| 10 MB | Firefox | 35 s, 634 MB | 45 s, 385 MB |
| 50 MB | Firefox | 87 s, 2.7 GB | 102 s, 877 MB |

Memory is the browser's peak above idle. WebKit was not measured. `roadmap/browser-limits.md` has every number and how they were taken.

### Security

The password is held in memory only, in the connection object (in the Worker, when one is used). The library never writes it to storage, the URL, a file, the log or a message, and it crosses to a Worker once. A page that embeds the library owns its fields and should do the same: the reference page shows a banner when it is served over `http:`, where the password would cross the network in clear. The library reads no cookie and sends none. A signed-in Aras client's session is used only when the page passes a `tokenProvider`.

### How the browser differs from Node

The engine's behaviour is the same on both hosts. What differs is what a browser does not let a page do, and each difference is a rule of `spec/browser-host.md`, not an engine bug:

| Difference | Rule |
|---|---|
| The file system is a tree in memory: a package is mounted into it before a run and the output is taken out after | HOST-215 |
| A drive-letter or UNC path of the engine is refused, as on Linux and macOS | HOST-216 |
| A failed connection, a refused CORS request, an unresolved name and a TLS failure are one error, "Unable to connect to the remote server" | HOST-231 |
| The headers a browser forbids (`Host`, `Cookie`, `Content-Length`, …) are left to the browser, and an empty reason phrase (HTTP/2) is filled in from the status | HOST-232 |
| The client's cookie jar stays empty; the browser keeps its own cookies | HOST-233 |
| A redirect is followed, and a compressed answer is decompressed by `fetch` | HOST-230 |
| The time zone sent is the CLDR mapping of the browser's IANA zone | HOST-242 |
| The platform is `"browser"`, the current folder `/`, the temporary folder `/tmp`; a short duration in a log can read `00:00:00`, because the browser's clock moves in steps | HOST-243 |
| The audit row's `os_user` is made from the login name (`browser\<login>` on 12.0 and 14.0.7) unless `osUser` is given | HOST-243, HOST-270 |
| An import above about 50 MB is warned about | HOST-278 |

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
