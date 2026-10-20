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
  apply-db-patches <manifest>    Apply the database update patches a manifest lists (14.35 only, login root)

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
  --languages <codes|*> Only 14.35: import only the nodes of these languages, a comma-separated list of codes, or * for every
                        language the packages use. Each code must be installed in the database. Every package is scanned for
                        the languages it uses, so a stray malformed *.xml file in any package fails the run (14.35's own
                        behaviour). The list must include en unless it starts with * (the console host's rule; import-language-pack
                        does not check it).
`;

const IMPORT_BATCH_ERRORS = `Engine 14.35 only:
  --batch               Send the items that have no Relationships in one <AML> request. A refused batch is imported one item at a time
  --batch-max <n>       Send a batch when n items are waiting (needs --batch; default 0: after every item)
  --collect-errors      Keep importing when an item fails, and report all the errors at the end. The exit code is 1 when any was collected
  --max-errors <n>      End the run when n errors have been collected (needs --collect-errors; default 0: at the first)
`;

export const IMPORT_USAGE = `Usage: aras-pkg import <manifest> [options]

Imports the packages of an imports.mf manifest, in dependency order.
  --package <name>      Import only this package (repeatable); default: every package of the manifest

${IMPORT_RUN}
${IMPORT_BATCH_ERRORS}
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

export const DB_PATCHES_USAGE = `Usage: aras-pkg apply-db-patches <manifest> --engine 14.35 --user root [options]

Applies the database update patches that an updates manifest lists, through the server's ApplyUpdate action, and records them in
a DatabaseUpgrade row ("Applied Updates") for the manifest's release. It exists only in engine 14.35, and only for the login
\`root\`: any other engine or user is refused before anything is sent. Each patch is the file <name>.xml in the patches folder.
A patch the server refuses is reported as an error and the run goes on with the next one (the engine's behaviour); the exit code is 1
when any error was reported.
  --patches-folder <dir>  The folder of the patch files (default: the folder of the manifest)
  --tool-name <text>      The description of the DatabaseUpgrade row a run creates (default: Libs)
  --os-user <name>        The os_user of that row (default: DOMAIN\\user on Windows, <host>\\<user> elsewhere)

${COMMON}`;

export const EXPORT_USAGE = `Usage: aras-pkg export <outDir> [Type:id…] [options]
       aras-pkg export <outDir> - [options]
       aras-pkg export <outDir> --package <name> [--package <name>…] [options]
       aras-pkg export <outDir> --use-import <manifest> | --from-manifest <manifest> | --all-packages [options]

Exports items into <outDir>, grouped by the package each belongs to, with an imports.mf that imports them again. The items
come from exactly one of:
  Type:id…              the items named as arguments (the id is split off at the first colon)
  -                     the items on standard input, one Type:id per line
  --package <name>      every element of the named package (repeatable); an unknown name is refused with suggestions
  --use-import <manifest>   the items the package folders of an import manifest would add (Aras's console tool, useimport)
  --from-manifest <manifest>  every element of the database's packages that the manifest names (the manifest must exist)
  --all-packages        every element of every package of the database
The last three are the modes of Aras's console tool and cannot be combined with each other, with items or with --package.
Each item's package is found on the server (PackageElement, PackageGroup, PackageDefinition). An item in no package, or not
found, is refused by name and nothing is exported. <outDir> is used as it is: it need not exist or be empty, and the engine
deletes the subfolder of each package it exports before writing it.

Export:
  --level <text>             The levels of the fetch for types without a fixed one (default: the engine's 1)
  --export-referenced        Also export the elements the packages' dependencies reference (default: off)
  --unknown-references <m>   remove-silently, remove-with-warning or do-not-remove (default: do-not-remove)
  --on-item-error <answer>   continue (default) or abort-package: the answer to the error question (not on 14.35)

Engine 14.35 only:
  --parallelism <n>          How many items of a package are exported at once (default: one per logical processor). With 1 the
                             items run one after another, and none of the engine's timing races can happen (EXP-408, EXP-553).
  The language-resource export (the console tool's export-only-translations and export-with-translations):
  --language-resources <m>   only (the item files hold just the translations and what locates them) or with-metadata (the whole
                             item, with the translations of the languages); needs --languages
  --languages <codes|*>      A comma-separated list of language codes to export, or * for every language of the server. Each
                             code must be installed in the database. The list must include en unless it starts with * (the
                             console host's rule); en itself is not exported, as the engine does.

${COMMON}`;
