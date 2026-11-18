# Command line reference

`aras-pkg` (also installed as `import-export-libs-js`) exports and imports Aras Innovator packages from any OS with Node 20 or newer. This page covers every command and option. Run `aras-pkg --help`, or `aras-pkg <command> --help`, for the same information in your terminal.

- [Connecting](#connecting)
- [Choosing an engine](#choosing-an-engine)
- [`export`](#export)
- [`import`](#import)
- [`plan import`](#plan-import)
- [`import-language-pack`](#import-language-pack)
- [`apply-db-patches`](#apply-db-patches)
- [Options for every command](#options-for-every-command)
- [Output and exit codes](#output-and-exit-codes)

## Connecting

Every command except `plan import` talks to an Aras server. Give the connection as flags or as environment variables; a flag wins over its variable.

| Flag | Variable | Meaning |
|---|---|---|
| `--url <url>` | `ARAS_URL` | The server's URL, such as `http://aras.example/InnovatorServer` |
| `--database <name>` | `ARAS_DATABASE` | The database |
| `--user <name>` | `ARAS_USER` | The login name |
| | `ARAS_PASSWORD` | The password |

The password comes from `ARAS_PASSWORD`, or from standard input with `--password-stdin`. There is no flag for it, and it is never written to the log, the summary or any file:

```sh
echo "$PASSWORD" | aras-pkg import ./out/imports.mf --password-stdin
```

## Choosing an engine

Each Aras release ships its own build of the engine, and `aras-pkg` reproduces three of them. Pick one with `--engine 12.0|14.0.7|14.35`, or with `ARAS_PKG_ENGINE`; the default is `14.0.7`.

| Engine | Server versions it accepts | Export | Import | Language packs | DB patches |
|---|---|---|---|---|---|
| `12.0` | 10 to 12 | yes | yes | no | no |
| `14.0.7` (default) | 12 to 14 | yes | yes | yes | no |
| `14.35` | 12 to 14 | yes, items in parallel, and translation export | yes, with batching, error collection and language filtering | yes | yes |

After login, the engine checks the server's version. A server outside its range is refused, and the message names the engines that would accept it. `--skip-version-check` runs the engine anyway. The engine used appears in the log header and in the summary. The same command can produce different output on two engines, because each reproduces its own build's behaviour.

## `export`

```sh
aras-pkg export <outDir> --package <name> [--package <name>…] [options]
aras-pkg export <outDir> Type:id [Type:id…] [options]
aras-pkg export <outDir> - [options]                   # Type:id lines from standard input
aras-pkg export <outDir> --use-import <manifest> | --from-manifest <manifest> | --all-packages [options]
```

Exports items into `<outDir>`, one folder per package, with an `imports.mf` manifest that imports them again. The items come from exactly one of:

| Selection | Exports |
|---|---|
| `--package <name>` (repeatable) | Every element of the named package. An unknown name is refused with suggestions. |
| `Type:id…` | The items named as arguments (the id is split off at the first colon) |
| `-` | The items on standard input, one `Type:id` per line |
| `--use-import <manifest>` | The items that the package folders of an import manifest would add |
| `--from-manifest <manifest>` | Every element of the database's packages that the manifest names |
| `--all-packages` | Every element of every package in the database |

The last three are the modes of Aras's own console tool, and none of them can be combined with another selection. Each item's package is looked up on the server. If an item is in no package, or is not found, it is refused by name and nothing is exported.

`<outDir>` is used the way Aras's tool uses it: it need not exist or be empty, and the subfolder of each exported package is deleted before it is written.

| Option | Meaning |
|---|---|
| `--level <text>` | The levels of the fetch for types without a fixed one (default: the engine's 1) |
| `--export-referenced` | Also export the elements that the packages' dependencies reference |
| `--unknown-references <mode>` | `remove-silently`, `remove-with-warning` or `do-not-remove` (the default) |
| `--on-item-error <answer>` | `continue` (the default) or `abort-package`. Not on 14.35. |

With `--engine 14.35` only:

| Option | Meaning |
|---|---|
| `--parallelism <n>` | How many items of a package are exported at once (default: one per logical processor; `1` runs them one after another) |
| `--language-resources only\|with-metadata` | Export translations: `only` writes just the translations, `with-metadata` the whole item with them. Needs `--languages`. |
| `--languages <codes\|*>` | A comma-separated list of language codes, or `*` for every language of the server. Each code must be installed. The list must include `en` unless it starts with `*`. |

## `import`

```sh
aras-pkg import <manifest> [--package <name>…] [options]
```

Imports the packages of an `imports.mf`, in dependency order. Without `--package`, every package of the manifest is imported.

| Option | Meaning |
|---|---|
| `--package <name>` | Import only this package (repeatable) |
| `--release <text>` | The `target_release` of the upgrade records the import writes |
| `--description <text>` | Their description |
| `--merge` | Merge into existing items. The default, `--no-merge`, skips them. |
| `--os-user <name>` | The `os_user` of the upgrade records (default: `DOMAIN\user` on Windows, `<host>\<user>` elsewhere) |

With `--engine 14.35` only:

| Option | Meaning |
|---|---|
| `--batch` | Send the items that have no relationships in one request. A refused batch is imported one item at a time. |
| `--batch-max <n>` | Send a batch when `n` items are waiting (needs `--batch`; default `0`: after every item) |
| `--collect-errors` | Keep importing when an item fails, and report every error at the end. The exit code is `1` when any was collected. |
| `--max-errors <n>` | Stop once `n` errors are collected (needs `--collect-errors`; default `0`: at the first) |
| `--languages <codes\|*>` | Import only the content of these languages, or `*` for every language the packages use. Each must be installed. Every package is scanned for its languages, so a malformed `*.xml` file in any package fails the run. The list must include `en` unless it starts with `*`. |

## `plan import`

```sh
aras-pkg plan import <manifest> [--package <name>…] [--engine <version>] [--json]
```

Previews an import without contacting a server. It reads the manifest and the package folders and prints, per package in import order, the items the import would send, the repeats, and every item the import would silently drop, with the check that drops it. Dependencies outside the selected packages are assumed to exist in the database.

Exit codes: `0` done, `1` a package could not be loaded, `64` usage error.

## `import-language-pack`

```sh
aras-pkg import-language-pack <path/to/ImportConfig.xml> --lp-package <name> [options]
```

Turns a language pack into a temporary package and imports it. Not available on engine 12.0, which has no language-pack import.

| Option | Meaning |
|---|---|
| `--lp-package <name>` | The name of the package made from the pack (required) |
| `--lp-debug` | Keep the temporary package on disk |

It also takes `--release`, `--description`, `--merge`, `--os-user` and, on 14.35, `--languages`, as [`import`](#import) does.

## `apply-db-patches`

```sh
aras-pkg apply-db-patches <manifest> --engine 14.35 --user root [options]
```

Applies the database update patches that an updates manifest lists, through the server's `ApplyUpdate` action, and records them in an "Applied Updates" upgrade record for the manifest's release. It exists only on engine 14.35 and only for the login `root`; anything else is refused before a request is sent. Each patch is the file `<name>.xml` in the patches folder. A patch the server refuses is reported as an error and the run goes on with the next one, as Aras's engine does.

| Option | Meaning |
|---|---|
| `--patches-folder <dir>` | The folder of the patch files (default: the manifest's folder) |
| `--tool-name <text>` | The description of the upgrade record (default: `Libs`) |
| `--os-user <name>` | The `os_user` of that record |

## Options for every command

| Option | Meaning |
|---|---|
| `--engine <version>` | `12.0`, `14.0.7` or `14.35` (`ARAS_PKG_ENGINE`; default `14.0.7`) |
| `--log <path>` | The engine's log file (default `./aras-pkg-<command>-<date>.log`) |
| `--timeout <ms>` | Response timeout. `0` keeps the engine's default; `-1` waits for ever (write it as `--timeout=-1`). |
| `--time-zone <id>` | The Windows time zone id sent to the server (default: this machine's own, such as `India Standard Time`). Needed only when the local zone has no mapping. |
| `--skip-version-check` | Run even when the server is outside the engine's version range |
| `--verbose` | Verbose engine output |
| `--json` | Print the summary as JSON |
| `--help` | Show the command's help |

## Output and exit codes

Engine messages go to standard error, one `[INFO]`, `[WARN]`, `[ERROR]` or `[PKG]` line each, with the engine's own console text between them. The summary goes to standard output, as `key: value` lines or as JSON with `--json`, and names the engine used.

| Exit code | Meaning |
|---|---|
| `0` | Done |
| `1` | Failed: the engine returned failure, the login or the version check refused, or an error ended the run |
| `2` | Done, but the engine reported at least one error |
| `64` | Usage error. Nothing was sent to the server. |

Before contacting the server, `aras-pkg` checks that the options parse, the manifest exists, every `--package` is in it and the log folder can be created. For `export`, it also checks that every item is `Type:id` (or that a console mode's manifest exists) and that the output path can be a folder.
