import type { Engine } from "../../src/engines.js";

/**
 * The options of the reference page: one entry per control, each with the CLI flag it stands for (`src/cli/usage.ts`) and the
 * flag's help text, shortened. `options.test.ts` holds the lists to the usage text of the commands, so that a flag the CLI adds or
 * drops shows up here as a failing test (HOST-280).
 *
 * @spec HOST-280
 */

export type OptionKind = "flag" | "text" | "number" | "choice";

export interface OptionSpec {
  /** The key in the page's values. */
  key: string;
  /** The CLI flag the control stands for. */
  flag: string;
  label: string;
  help: string;
  kind: OptionKind;
  /** For `choice`: the values, `""` being "not given". */
  choices?: readonly string[];
  placeholder?: string;
  /** The engines that have the option; the page notes it, and the library refuses it on another (HOST-272). */
  engines?: readonly Engine[];
}

export type Mode = "export" | "import" | "language-pack" | "db-patches";

export const MODES: ReadonlyArray<{ mode: Mode; label: string; command: string }> = [
  { mode: "export", label: "Export", command: "export" },
  { mode: "import", label: "Import", command: "import" },
  { mode: "language-pack", label: "Language pack", command: "import-language-pack" },
  { mode: "db-patches", label: "DB patches", command: "apply-db-patches" },
];

/** What every run takes (the CLI's "Run" options that do not name a file on a disk). */
export const RUN_OPTIONS: readonly OptionSpec[] = [
  { key: "timeoutMs", flag: "--timeout", label: "Response timeout (ms)", kind: "number", placeholder: "0", help: "0 keeps the engine's default, -1 waits for ever." },
  { key: "timeZone", flag: "--time-zone", label: "Time zone id", kind: "text", placeholder: "the page's own", help: 'Windows time zone id sent as TIMEZONE_NAME, e.g. "India Standard Time". Default: the one of this page\'s time zone.' },
  { key: "skipVersionCheck", flag: "--skip-version-check", label: "Skip the version check", kind: "flag", help: "Run even when the server is outside the engine's window." },
  { key: "verbose", flag: "--verbose", label: "Verbose engine output", kind: "flag", help: "More text in the log and in the messages." },
];

const OS_USER: OptionSpec = {
  key: "osUser",
  flag: "--os-user",
  label: "OS user",
  kind: "text",
  placeholder: "the login name",
  help: "The os_user of the rows the run writes. Default: the login name.",
};

/** The settings an import and a language-pack import share. */
const IMPORT_RUN: readonly OptionSpec[] = [
  { key: "release", flag: "--release", label: "Release", kind: "text", help: "The target_release of the DatabaseUpgrade rows." },
  { key: "description", flag: "--description", label: "Description", kind: "text", help: "The description of the DatabaseUpgrade rows." },
  { key: "merge", flag: "--merge", label: "Merge", kind: "flag", help: "Merge into existing items instead of skipping them." },
  OS_USER,
  { key: "languages", flag: "--languages", label: "Languages", kind: "text", placeholder: "de,fr or *", engines: ["14.35"], help: "Only 14.35: import only the nodes of these languages, a comma-separated list of codes, or * for every language the packages use. The list must include en unless it starts with *." },
];

const IMPORT_BATCH_ERRORS: readonly OptionSpec[] = [
  { key: "batch", flag: "--batch", label: "AML batch", kind: "flag", engines: ["14.35"], help: "Send the items that have no Relationships in one <AML> request." },
  { key: "batchMax", flag: "--batch-max", label: "Batch size", kind: "number", engines: ["14.35"], placeholder: "0", help: "Send a batch when n items are waiting (needs the batch; 0: after every item)." },
  { key: "collectErrors", flag: "--collect-errors", label: "Collect errors", kind: "flag", engines: ["14.35"], help: "Keep importing when an item fails, and report all the errors at the end." },
  { key: "maxErrors", flag: "--max-errors", label: "Error limit", kind: "number", engines: ["14.35"], placeholder: "0", help: "End the run when n errors have been collected (needs collect errors; 0: at the first)." },
];

export const EXPORT_OPTIONS: readonly OptionSpec[] = [
  { key: "level", flag: "--level", label: "Level", kind: "text", help: "The levels of the fetch for types without a fixed one (default: the engine's 1)." },
  { key: "exportReferenced", flag: "--export-referenced", label: "Export referenced", kind: "flag", help: "Also export the elements the packages' dependencies reference." },
  { key: "unknownReferences", flag: "--unknown-references", label: "Unknown references", kind: "choice", choices: ["", "remove-silently", "remove-with-warning", "do-not-remove"], help: "What to do with references to elements of packages that are not exported (default: do-not-remove)." },
  { key: "onItemError", flag: "--on-item-error", label: "On item error", kind: "choice", choices: ["", "continue", "abort-package"], engines: ["12.0", "14.0.7"], help: "The answer to the error question: continue (default) or abort-package. Not on 14.35." },
  { key: "parallelism", flag: "--parallelism", label: "Parallelism", kind: "number", engines: ["14.35"], placeholder: "1", help: "Only 14.35: how many items of a package are exported at once." },
  { key: "languageResources", flag: "--language-resources", label: "Language resources", kind: "choice", choices: ["", "only", "with-metadata"], engines: ["14.35"], help: "Only 14.35: only (the translations alone) or with-metadata (the whole item); needs the languages." },
  { key: "languages", flag: "--languages", label: "Languages", kind: "text", placeholder: "de,fr or *", engines: ["14.35"], help: "Only 14.35: the language codes to export, or *. The list must include en unless it starts with *." },
];

export const IMPORT_OPTIONS: readonly OptionSpec[] = [
  { key: "packages", flag: "--package", label: "Packages", kind: "text", placeholder: "all of the manifest", help: "Import only these packages, separated by commas (default: every package of the manifest)." },
  ...IMPORT_RUN,
  ...IMPORT_BATCH_ERRORS,
];

export const LANGUAGE_PACK_OPTIONS: readonly OptionSpec[] = [
  { key: "lpPackage", flag: "--lp-package", label: "Package name", kind: "text", help: "The name of the package made from the pack (required)." },
  { key: "lpDebug", flag: "--lp-debug", label: "Keep the temporary package", kind: "flag", help: "Keep the temporary package the preprocessor makes." },
  ...IMPORT_RUN,
];

export const DB_PATCH_OPTIONS: readonly OptionSpec[] = [
  { key: "patchesFolder", flag: "--patches-folder", label: "Patches folder", kind: "text", placeholder: "the manifest's folder", help: "The folder of the patch files (default: the folder of the manifest)." },
  { key: "toolName", flag: "--tool-name", label: "Tool name", kind: "text", placeholder: "Libs", help: "The description of the DatabaseUpgrade row a run creates (default: Libs)." },
  OS_USER,
];

/** The options of a mode (the run options are the same for all). */
export function optionsOf(mode: Mode): readonly OptionSpec[] {
  switch (mode) {
    case "export":
      return EXPORT_OPTIONS;
    case "import":
      return IMPORT_OPTIONS;
    case "language-pack":
      return LANGUAGE_PACK_OPTIONS;
    case "db-patches":
      return DB_PATCH_OPTIONS;
  }
}

/** The CLI flags that have no control on the page, and why: they name a file on a disk, are the CLI's own, or are not an option. */
export const FLAGS_NOT_ON_THE_PAGE: Readonly<Record<string, string>> = {
  "--help": "the CLI's own",
  "--version": "the CLI's own",
  "--json": "the page shows the summary itself",
  "--log": "names a file on a disk; the page keeps the log in the tree and offers it for download",
  "--url": "a connection field",
  "--database": "a connection field",
  "--user": "a connection field",
  "--engine": "a connection field",
  "--password-stdin": "the password is a field of the page, and an option of nothing (HOST-281)",
  "--use-import": "a choice of the selection of an export",
  "--from-manifest": "a choice of the selection of an export",
  "--all-packages": "a choice of the selection of an export",
  "--package": "the packages of an export are its selection; those of an import are the Packages option",
};
