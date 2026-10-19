# import-export-libs-js

A readable TypeScript re-implementation of Aras Innovator's package import/export engine (`Libs.dll`, `Aras.Tools.SolutionUpgrade`). It runs on any OS with Node ≥ 20, with no .NET, PowerShell or Aras DLLs.

It reproduces three engine builds exactly, bugs included: **12.0** (12.0.0.13341), **14.0.7** (14.0.7.35492, the default) and **14.35** (14.35.0.43890).

**Status: in progress.** The 14.0.7 engine is built for export, import, language-pack import and the offline import plan; the other engine slices are still to come. An engine whose slice has not landed reports `engine <v> is not yet supported`.

## Install

The repo is private, so install it from git:

```sh
npm install git+ssh://git@github.com/omkarbhale/import-export-libs-js.git
```

## CLI

`import-export-libs-js`, alias `aras-pkg`. Run `aras-pkg <command> --help` for every option.

| Command | What it does |
|---|---|
| `aras-pkg export <outDir> [Type:id…]` | Exports items into a folder with an `imports.mf`. The items are arguments, `-` for one per line on standard input, or `--package <name>` (repeatable) for whole packages. Each item's package is found on the server; an item in no package is refused by name and nothing is exported. |
| `aras-pkg import <manifest> [--package <name>…]` | Imports the packages of an `imports.mf`, in dependency order. |
| `aras-pkg plan import <manifest> [--package <name>…]` | Offline: the order an import follows and, per package, the item sequence, the repeats and every item the import silently drops. |
| `aras-pkg import-language-pack <lppath> --lp-package <name>` | Imports a language pack (`ImportConfig.xml`) as a package. Not on `--engine 12.0`. |

```sh
export ARAS_URL=http://aras.example/InnovatorServer ARAS_DATABASE=InnovatorSolutions ARAS_USER=admin
echo "$PASSWORD" | aras-pkg import ./imports.mf --password-stdin --release R1 --json
```

- **Engine.** `--engine 12.0|14.0.7|14.35`, or `ARAS_PKG_ENGINE`; the default is 14.0.7. The engine used is in the log header and the summary.
- **Connection.** `--url`, `--database`, `--user` (or `ARAS_URL`, `ARAS_DATABASE`, `ARAS_USER`). The password comes from `ARAS_PASSWORD`, or from standard input with `--password-stdin`; there is no flag for it. `--time-zone` sets the Windows time zone id sent as `TIMEZONE_NAME` for a machine whose zone has no mapping.
- **Export options.** `--level`, `--export-referenced`, `--unknown-references remove-silently|remove-with-warning|do-not-remove` (default `do-not-remove`) and `--on-item-error continue|abort-package`. The output folder is used as the engine uses it: it need not exist or be empty.
- **Options.** `--release`, `--description`, `--merge`, `--os-user`, `--verbose`, `--log <path>` (default `./aras-pkg-<command>-<date>.log`), `--timeout <ms>` (write `--timeout=-1` for no limit) and `--skip-version-check` (run an engine against a server outside its window; a refusal names the engines that fit).
- **Output.** Engine messages go to standard error, one `[INFO]`, `[WARN]`, `[ERROR]` or `[PKG]` line each, with the engine's own console text between them. The summary goes to standard output, as `key: value` lines or as JSON with `--json`, and includes the engine used.
- **Exit codes.** `0` done; `1` failed (the engine returned failure, the login or the version gate refused, or an exception ended the run); `2` done, but the engine sent at least one error message; `64` usage error (nothing was sent to the server).
- **Checked before the server is contacted.** The options parse, the manifest exists, every `--package` is in it, and the log folder can be made. For `export`: every item is `Type:id`, the output path can be a folder, and the options are valid.

## Develop

```sh
npm install
npm run typecheck
npm test
npm run build
```

- `AGENTS.md`: the rules every change follows.
- `spec/`: the behavioural spec, rule ids, bug register and source map.
- `roadmap/`: the design decisions.
