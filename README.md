<div align="center">

# import-export-libs-js

**Aras Innovator package import and export, rebuilt in TypeScript. Runs anywhere Node runs, and right inside your browser.**

[![CI](https://github.com/omkarbhale/import-export-libs-js/actions/workflows/ci.yml/badge.svg)](https://github.com/omkarbhale/import-export-libs-js/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](package.json)

<sub>Aras's own import/export engine, the Windows-only <code>Libs.dll</code>, as a CLI and a library for macOS, Linux, Windows and the web.</sub>

</div>

<br>

## Why it's useful

- **No Windows or .NET needed.** One `npm install` gives you a command line tool on any OS with Node 20 or newer. No PowerShell, no Aras DLLs.
- **Runs in Node and in the browser.** Export and import from a script, a CI job or a plain web page, with live progress, cancellation and a background Worker.
- **Byte-identical to Aras's own engine.** The same requests, logs and output files as the original, quirks included. Export and import are proven side by side with the real `Libs.dll` on live Aras 12, 14.0.7 and 14.35 servers.
- **Everything the engine does.** Export, import, language packs and database patches, with an offline preview of what an import will do.

## Getting started

Install from git (the repository is private; the package builds itself on install):

```sh
npm install git+ssh://git@github.com/omkarbhale/import-export-libs-js.git
```

Tell it where your server is. The password can also come from standard input with `--password-stdin`:

```sh
export ARAS_URL=http://aras.example/InnovatorServer ARAS_DATABASE=InnovatorSolutions ARAS_USER=admin ARAS_PASSWORD=…
```

Export a package to a folder:

```sh
aras-pkg export ./out --package "My Package"
```

Preview the import offline: its order, and every item it would skip:

```sh
aras-pkg plan import ./out/imports.mf
```

Import it into another database:

```sh
aras-pkg import ./out/imports.mf --release R1
```

Import a language pack:

```sh
aras-pkg import-language-pack ./my-language-pack/ImportConfig.xml --lp-package "My Language Pack"
```

Run against a Release 35 server, and get the summary as JSON:

```sh
aras-pkg export ./out --package "My Package" --engine 14.35 --json
```

Every command and option is in the [command line reference](docs/cli.md).

## Browser

The same engine, in a web page. Import from `import-export-libs-js/browser`.

Export from a web page into a zip, ready to download:

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

Import a zip the user dropped or picked (`file` is the `File`):

```ts
import { connect, importPackages } from "import-export-libs-js/browser";

const zip = new Uint8Array(await file.arrayBuffer());
const session = await connect({ url, database, userName, password });
const { summary, messages } = await importPackages(session, { source: { zip }, release: "R1" });
await session.close();
```

Run in a Worker, so the page never freezes:

```ts
import { createEngineWorker } from "import-export-libs-js/browser";

const engine = createEngineWorker();
const session = await engine.connect({ url, database, userName, password });
const { files, zip, summary } = await engine.exportPackages(session, { packages: ["My Package"], zip: true });
await engine.dispose();
```

These examples are run exactly as written in Chromium, Firefox and WebKit on every change. Want to click instead of code? [`examples/browser/`](examples/browser/README.md) is a ready-made page with all four operations and drag-and-drop. Folders, drops, directory handles, cancelling and the rest are in the [browser guide](docs/browser.md).

## Supported versions

| Engine | Aras servers it accepts | Proven live on |
|---|---|---|
| `14.0.7` (default) | 12 to 14 | Aras 12.0 SP9 and Release 23 |
| `14.35` | 12 to 14 | Aras 12.0 SP9 and Release 35 |
| `12.0` | 10 to 12 | Aras 12.0 SP9 |

Pick one with `--engine` on the command line. In the browser, `connect` picks it from the server's version.

| | `12.0` | `14.0.7` | `14.35` |
|---|---|---|---|
| Export | ✓ | ✓ | ✓ |
| Import and offline preview | ✓ | ✓ | ✓ |
| Language-pack import | | ✓ | ✓ |
| Translation export | | | ✓ |
| Database patches | | | ✓ |

## Good to know

- **Browser imports top out around 50 MB.** A tab holds the whole package in memory. Use the command line for bigger packages ([details](docs/browser.md#size-limit)).
- **A web page on another site needs your Aras server's permission.** The administrator adds the page's origin to the server's CORS settings once ([how](docs/browser.md#server-configuration-cors)). A page inside the Aras client needs nothing.
- **Your password stays put.** It is read from the environment, standard input or the page's own field, held in memory only, and never written to a log, a file, a URL or browser storage. There is no command line flag for it.
- **Each engine keeps its quirks.** The same command can give different output on two engines, because each one reproduces its own Aras build, bugs included.

---

## How it's built

- **Spec first.** Every behaviour of the original engine is written down as a numbered rule in [`spec/`](spec/README.md), with a variant per engine, before it is coded. The code links back to its rules, and every reachable method of each Aras build is mapped to rules and code. Engine bugs are reproduced on purpose and listed in [`spec/bugs.md`](spec/bugs.md).
- **Checked against the real thing.** A harness in [`oracle/`](oracle/README.md) drives the real `Libs.dll` and the port on the same inputs against a live server, and compares the requests, output folders, logs, messages and exit codes. The live runs are recorded in [`roadmap/`](roadmap/README.md).
- **Tested offline.** Recorded runs of the real engine are replayed in unit tests under Node and in three browsers, so no server is needed to test.
- **No Node in the browser build.** The browser bundle is checked to reach no Node API.

## Development

```sh
npm install
npm run typecheck   # the static checks
npm test            # unit tests, recorded-run replays and the spec coverage check
npm run build       # dist/: the Node library, the CLI and the browser build
npx playwright install chromium firefox webkit && npm run test:browser   # the browser tests
```

CI runs the type checks, the tests and the browser tests on every pull request. Development needs Node 20.19 or newer. [`AGENTS.md`](AGENTS.md) has the rules every change follows and how to add support for a new Aras build.

## Documentation

| Document | What's in it |
|---|---|
| [Command line reference](docs/cli.md) | Every command, option and exit code |
| [Browser guide](docs/browser.md) | The browser API, the Worker, file sources, server setup, size limits and security |
| [Reference page](examples/browser/README.md) | A ready-made page for the browser build, and how to serve it |
| [`spec/`](spec/README.md) | The behavioural spec of the engine |
| [`oracle/`](oracle/README.md) | Recording the real engine and running live comparisons |
| [`roadmap/`](roadmap/README.md) | Design decisions, live comparison records and what is out of scope |

## Licence

This repository is private and carries no open-source licence (`"license": "UNLICENSED"` in `package.json`).
