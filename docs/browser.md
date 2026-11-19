# Browser guide

The library runs in a web page: export, import, language-pack import and DB-patch application, for all three engines, in Chromium, Firefox and WebKit. It needs no server of its own and no Node API, and its output is the same as the Node build's, byte for byte.

- [Install and import](#install-and-import)
- [Export and import](#export-and-import)
- [Run in a Web Worker](#run-in-a-web-worker)
- [Getting packages in and out](#getting-packages-in-and-out)
- [Server configuration (CORS)](#server-configuration-cors)
- [Size limit](#size-limit)
- [Security](#security)
- [How the browser differs from Node](#how-the-browser-differs-from-node)
- [Reference page](#reference-page)

## Install and import

Install the package as the [README](../README.md#getting-started) shows. In a page, import `"import-export-libs-js/browser"`, or import `"import-export-libs-js"` with a bundler that honours the `browser` condition; both resolve to `dist/browser.js`.

`npm run build` writes three bundles:

| Bundle | What it is |
|---|---|
| `dist/index.js` | The Node build, with the CLI's `dist/cli.js` |
| `dist/browser.js` | The browser build: one ES2022 module that imports nothing, with its type declarations |
| `dist/browser-worker.js` | The Web Worker's module |

The browser entry has the core of the Node entry, plus the browser API below, the in-memory file system `MemoryVfs`, the adapters, `createBrowserHost` and `createFetchTransport`.

## Export and import

The browser API runs the CLI's commands on a tree of files held in memory.

| Call | What it does |
|---|---|
| `connect({ url, database, userName, password })` | Logs in, and picks the engine from the server's version unless you name one with `engine` |
| `exportPackages(session, options)` | Exports packages |
| `importPackages(session, options)` | Imports packages |
| `importLanguagePack(session, options)` | Imports a language pack |
| `applyDbPatches(session, options)` | Applies database patches (14.35) |
| `planImport(options)` | Previews an import, with no server |

Each operation takes `onProgress`, `onMessage` and an `AbortSignal` as `signal`. It resolves with the tree the run used (an export also with its `files`), the log, the engine's messages and a summary. The library has no UI and prints nothing: your page decides where the inputs come from and where the files go.

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

A page inside a signed-in Aras client can pass `tokenProvider` instead of `password` to use that client's session. The library never picks up that session on its own.

## Run in a Web Worker

The engine's work is synchronous, so a long export or import blocks the thread it runs on. `createEngineWorker()` runs the engine in a module Worker instead, with the same operations as calls:

```ts
import { createEngineWorker } from "import-export-libs-js/browser";

const engine = createEngineWorker();
const session = await engine.connect({ url, database, userName, password });
const { files, zip, summary } = await engine.exportPackages(session, { packages: ["My Package"], zip: true });
await engine.dispose();
```

- **Finding the Worker.** By default it loads `dist/browser-worker.js` with `new URL("./browser-worker.js", import.meta.url)`. Pass `worker` for another form, such as a `?worker` import of `import-export-libs-js/browser-worker.js`.
- **Callbacks** (`onProgress`, `onMessage`, `onItemError`, `tokenProvider`, a `transport` of your own) stay on the page and are called as the Worker reports.
- **Inputs** are `{zip}` (bytes or a `File`), `{files}`, `{fileList}`, `{dataTransfer}` or `{directory}`. For a drop, start the call in the `drop` handler, before any `await`.
- **Transfers.** The bytes of a zip or a file map are transferred to the Worker, so your array is empty afterwards; pass a copy to keep it. A `File` or a directory handle is read in the Worker.
- **Results.** An export resolves with `files` (and `zip` with `zip: true`, when the run made its folder) as transferred buffers.
- **Errors** come back as objects of the library's own classes, so `instanceof` works.
- **Cancelling.** `abort()` or a `signal` cancels a run, and `dispose({force: true})` stops a Worker that does not answer.

## Getting packages in and out

The adapters turn what a page's controls give you into the tree the engine reads, and the tree it writes into something to hand back.

| In or out | Adapter | Chromium | Firefox | WebKit |
|---|---|---|---|---|
| A zip, chosen or downloaded | `vfsFromZip`, `vfsToZip` (`{zip}`) | yes | yes | yes |
| A folder, chosen with `<input type="file" webkitdirectory>` | `mountFileList` (`{fileList}`) | yes | yes | yes |
| A folder or files, dropped | `mountDataTransfer` (`{dataTransfer}`) | yes | yes | yes |
| A folder behind a directory handle, read and written | `mountDirectory`, `commitToDirectory` (`{directory}`) | yes, and `showDirectoryPicker` | the origin private file system only | the origin private file system only, not in a private window |

`isFileSystemAccessSupported()` says whether the page can ask for a folder with `showDirectoryPicker`.

The tested browsers are Chromium, Firefox and WebKit (Playwright 1.64.1: Chromium 156, Firefox 157, WebKit 27.2). The build targets ES2022, and the Worker needs module Workers, which all three have.

## Server configuration (CORS)

A page served from a different origin than the Aras server works only after the server's administrator lists the page's origin. As shipped, no Aras server answers the whole login sequence for an unknown origin. Two edits are needed:

- **The OAuth server, every version.** Add the page's origin to `allowedCorsOrigins` in `OAuthServer/OAuth.config`.
- **The SOAP endpoint.** Release 23 and Release 35 already send `Access-Control-Allow-Origin: *` and allow the headers the client sends, which is enough (for the 14.35 engine, also allow `Aras-Request-ReadOnly`). 12 SP9 sends no CORS headers: add an `<httpProtocol><customHeaders>` block to `Server/web.config`.

The reference page's [server prerequisites](../examples/browser/README.md#server-prerequisites) have the exact XML, and [`roadmap/browser-cors-poc.md`](../roadmap/browser-cors-poc.md) (section 3) has the measurements behind them.

A page embedded in the Aras client is on the server's own origin and needs neither edit. The session cookie is not used: requests are sent without credentials (`credentials: "omit"`), and a bearer token carries the session. An `https` page cannot call an `http` server in Firefox and WebKit.

## Size limit

A package is held in memory, and the engine's parsed documents make an import cost about 40 to 70 times the package's size in a browser tab. An import of about **50 MB** completes in Chromium (using 2.9 GB of memory). Use the command line tool (`aras-pkg import`) for larger packages.

The command line tool runs the same import code at about the same cost: 43 times, measured under Node at 10 MB, and an estimated 4.3 GB at 100 MB and 21 GB at 500 MB (extrapolated, not measured). So it can exceed Node's default heap: a large import needs `node --max-old-space-size=<MB>` and a machine with that much memory.

`importPackages` warns in its messages (`source: "host"`) when the package it is given is above 50 MB, then goes on. An export costs about 7 times the package, plus a fixed 340 MB.

| Package | Browser | Import: time, memory | Export: time, memory |
|---|---|---|---|
| 10 MB | Chromium | 18 s, 730 MB | 49 s, 379 MB |
| 50 MB | Chromium | 67 s, 2.9 GB | 90 s, 698 MB |
| 10 MB | Firefox | 35 s, 634 MB | 45 s, 385 MB |
| 50 MB | Firefox | 87 s, 2.7 GB | 102 s, 877 MB |

Memory is the browser's peak above idle. WebKit was not measured. [`roadmap/browser-limits.md`](../roadmap/browser-limits.md) has every number and how they were taken.

## Security

The password is held in memory only, in the connection object (in the Worker, when one is used). The library never writes it to storage, the URL, a file, the log or a message, and it crosses to a Worker once, in `connect`. A page that embeds the library owns its own fields and should do the same: the reference page shows a banner when it is served over `http:`, where the password would cross the network in clear. The library reads no cookie and sends none. A signed-in Aras client's session is used only when the page passes a `tokenProvider`.

## How the browser differs from Node

The engine's behaviour is the same on both. What differs is what a browser does not let a page do:

- The file system is a tree in memory: a package is mounted into it before a run, and the output is taken out after.
- A drive-letter or UNC path is refused, as on Linux and macOS.
- A failed connection, a refused CORS request, an unresolved name and a TLS failure all give the same error, "Unable to connect to the remote server", because the browser hides the cause.
- Headers the browser forbids (`Host`, `Cookie`, `Content-Length`, …) are left to the browser, and an empty HTTP/2 reason phrase is filled in from the status.
- The client's own cookie jar stays empty; the browser keeps its cookies.
- A redirect is followed, and a compressed answer is decompressed by `fetch`.
- The time zone sent to the server is the Windows equivalent of the browser's time zone.
- The platform is `"browser"`, the current folder `/` and the temporary folder `/tmp`. A short duration in a log can read `00:00:00`, because the browser's clock moves in steps.
- The `os_user` of the upgrade records is made from the login name (`browser\<login>` on 12.0 and 14.0.7) unless `osUser` is given.
- An import above about 50 MB gets a warning.
- The library runs in a page that has replaced `startsWith` and `endsWith`, as the Aras 12 client does: it never calls them, or `includes`, with a position.

Each difference is a rule of [`spec/browser-host.md`](../spec/browser-host.md), which also specifies every option, result and error of the browser API.

## Reference page

[`examples/browser/`](../examples/browser/README.md) is a static page that uses this API for all four operations, with upload and download, a folder input, a drop zone, and the directory picker where the browser has one. From a clone of this repository:

```sh
npm run example:browser   # builds the page and serves it on http://127.0.0.1:8080/
```
