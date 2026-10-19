import { DEFAULT_ENGINE, ENGINES } from "../engines.js";

/** A command line the CLI refuses before it does anything: exit 64. */
export class UsageError extends Error {
  override name = "UsageError";
}

const ENGINE_LINE = `Engines: ${ENGINES.join(", ")} (default ${DEFAULT_ENGINE})`;

export const USAGE = `Usage: aras-pkg <command> [options]

Commands:
  export <outDir> [Type:id…]     Export items, or whole packages, into a folder with an imports.mf
  import <manifest>              Import the packages of a manifest (imports.mf)
  plan import <manifest>         Show, offline, the order an import follows and the items it drops
  import-language-pack <lppath>  Import a language pack as a package (not on 12.0)

Run \`aras-pkg <command> --help\` for the options of a command.

Options:
  --help       Show this help
  --version    Show the package version

${ENGINE_LINE}
`;

const COMMON = `Connection (a flag wins over its variable):
  --url <url>          Aras server URL           (ARAS_URL)
  --database <name>    Database                  (ARAS_DATABASE)
  --user <name>        Login name                (ARAS_USER)
  The password comes from ARAS_PASSWORD, or from standard input with --password-stdin. There is no flag for it.

Run:
  --engine <version>   12.0, 14.0.7 or 14.35     (ARAS_PKG_ENGINE, default ${DEFAULT_ENGINE})
  --log <path>         The engine's log file     (default ./aras-pkg-<command>-<date>.log)
  --timeout <ms>       Response timeout; 0 keeps the engine's default, -1 waits for ever (write --timeout=-1)
  --time-zone <id>     Windows time zone id sent as TIMEZONE_NAME (default: this machine's own, e.g. "India Standard Time")
  --skip-version-check Run even when the server is outside the engine's window
  --verbose            Verbose engine output
  --json               Print the summary as JSON on standard output
  --help               Show this help

Engine messages go to standard error as [INFO], [WARN], [ERROR] and [PKG] lines; the summary goes to standard output.
Exit codes: 0 done, 1 failed, 2 done but the engine reported errors, 64 usage error.
`;

const IMPORT_RUN = `Import:
  --release <text>      The target_release of the DatabaseUpgrade rows
  --description <text>  Their description
  --merge               Merge into existing items instead of skipping them (--no-merge, the default, skips)
  --os-user <name>      The os_user of the rows (default: DOMAIN\\user on Windows, <host>\\<user> elsewhere)
`;

export const IMPORT_USAGE = `Usage: aras-pkg import <manifest> [options]

Imports the packages of an imports.mf manifest, in dependency order.
  --package <name>      Import only this package (repeatable); default: every package of the manifest

${IMPORT_RUN}
${COMMON}`;

export const PLAN_USAGE = `Usage: aras-pkg plan import <manifest> [options]

Reads the manifest and the package folders offline, and prints, per package in import order, the sequence of items the
import would send, the repeats, and every item the import silently drops with the check it failed. No server is contacted.
Dependencies that are not among the selected packages are taken to exist in the database.

  --package <name>   Plan only this package (repeatable); default: every package of the manifest
  --engine <version> 12.0, 14.0.7 or 14.35 (ARAS_PKG_ENGINE, default ${DEFAULT_ENGINE})
  --json             Print the plan as JSON
  --help             Show this help

Exit codes: 0 done, 1 a package could not be loaded, 64 usage error.
`;

export const LANGUAGE_PACK_USAGE = `Usage: aras-pkg import-language-pack <lppath> --lp-package <name> [options]

Turns the language pack whose ImportConfig.xml is <lppath> into a temporary package of edit items and imports it. Not
available on engine 12.0, which has no language-pack import.
  --lp-package <name>   The name of the package made from the pack (required)
  --lp-debug            Keep the temporary package on disk

${IMPORT_RUN}
${COMMON}`;

export const EXPORT_USAGE = `Usage: aras-pkg export <outDir> [Type:id…] [options]
       aras-pkg export <outDir> - [options]
       aras-pkg export <outDir> --package <name> [--package <name>…] [options]

Exports items into <outDir>, grouped by the package each belongs to, with an imports.mf that imports them again. The items
come from exactly one of:
  Type:id…              the items named as arguments (the id is split off at the first colon)
  -                     the items on standard input, one Type:id per line
  --package <name>      every element of the named package (repeatable); an unknown name is refused with suggestions
Each item's package is found on the server (PackageElement, PackageGroup, PackageDefinition). An item in no package, or not
found, is refused by name and nothing is exported. <outDir> is used as it is: it need not exist or be empty, and the engine
deletes the subfolder of each package it exports before writing it.

Export:
  --level <text>             The levels of the fetch for types without a fixed one (default: the engine's 1)
  --export-referenced        Also export the elements the packages' dependencies reference (default: off)
  --unknown-references <m>   remove-silently, remove-with-warning or do-not-remove (default: do-not-remove)
  --on-item-error <answer>   continue (default) or abort-package: the answer to the error question (not on 14.35)

${COMMON}`;
