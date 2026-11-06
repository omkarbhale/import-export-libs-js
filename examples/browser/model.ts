import type { ConnectOptions, ExportOptions, ImportLanguagePackOptions, ImportOptions, DbPatchesOptions, RequestedItem, ImportSettings } from "../../src/browser.js";
import type { Engine } from "../../src/engines.js";
import { ENGINES } from "../../src/engines.js";

/**
 * What the page's controls hold, and the options of the browser API that they make (HOST-280): pure functions, so that a test can
 * pin them under Node. A value that cannot be read (a number that is not a whole number, an item that is not `Type:id`) or a required
 * field left empty is a {@link FormError}, which the page shows next to the Run button; every other check belongs to the library
 * (HOST-272), which refuses an option before the first request.
 *
 * @spec HOST-280 HOST-281
 */

/** What a control holds: text, or whether a flag is on. */
export type Values = Record<string, string | boolean>;

/**
 * What a login that failed at the network level probably means (HOST-281). A browser gives a page the same error for a CORS refusal
 * as for a dead host, so the engine's text cannot tell them apart: "Unable to connect" is the SOAP endpoint's, and "An error occurred
 * while sending the request" the OAuth client's. A server that answered, with a refused password say, has neither.
 */
export function connectFailureHint(failure: string): string | undefined {
  if (!/Unable to connect to the remote server|An error occurred while sending the request/.test(failure)) return undefined;
  return "The server could not be reached, and a browser reports a refused cross-origin request the same way. Check the address, then the likely prerequisite: this page's origin missing from the OAuth server's allowedCorsOrigins, and, on 12 SP9, no CORS headers on the SOAP endpoint. See \"What the server needs\" above.";
}

export class FormError extends Error {
  override name = "FormError";
}

/** The text of a field, trimmed; empty when absent. */
export function textOf(values: Values, key: string): string {
  const value = values[key];
  return typeof value === "string" ? value.trim() : "";
}

export function flagOf(values: Values, key: string): boolean {
  return values[key] === true;
}

/** A whole number from a field; `undefined` when the field is empty. */
export function numberOf(values: Values, key: string, label: string): number | undefined {
  const text = textOf(values, key);
  if (text === "") return undefined;
  if (!/^-?\d+$/.test(text)) throw new FormError(`${label} is a whole number, not '${text}'`);
  return Number(text);
}

/** Names separated by commas or line breaks. */
export function listOf(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** `Type:id` per line; the id is what follows the first colon, as the CLI splits it. */
export function itemsOf(text: string): RequestedItem[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const colon = line.indexOf(":");
      if (colon <= 0 || colon === line.length - 1) throw new FormError(`'${line}' is not Type:id`);
      return { type: line.slice(0, colon), id: line.slice(colon + 1) };
    });
}

/** The engine of the engine control: `auto` or one of the three. */
export function engineOf(values: Values): Engine | "auto" {
  const text = textOf(values, "engine");
  if (text === "" || text === "auto") return "auto";
  const engine = ENGINES.find((known) => known === text);
  if (engine === undefined) throw new FormError(`the engine is auto, ${ENGINES.join(", ")}, not '${text}'`);
  return engine;
}

/** The text of a field that has no default. */
function requiredOf(values: Values, key: string, label: string): string {
  const text = textOf(values, key);
  if (text === "") throw new FormError(`${label} is required`);
  return text;
}

/** The connection fields and the run options of the page; `password` is read from its field here and nowhere else (HOST-281). */
export function connectOptionsOf(values: Values): ConnectOptions {
  const timeoutMs = numberOf(values, "timeoutMs", "the response timeout");
  const timeZone = textOf(values, "timeZone");
  return {
    url: textOf(values, "url"),
    database: textOf(values, "database"),
    userName: textOf(values, "userName"),
    password: typeof values.password === "string" ? values.password : "",
    engine: engineOf(values),
    ...(flagOf(values, "skipVersionCheck") ? { skipVersionCheck: true } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(timeZone === "" ? {} : { timeZoneName: timeZone }),
  };
}

/** The settings of an import and a language-pack import. */
export function importSettingsOf(values: Values): ImportSettings {
  const batchMax = numberOf(values, "batchMax", "the batch size");
  const maxErrors = numberOf(values, "maxErrors", "the error limit");
  if (batchMax !== undefined && !flagOf(values, "batch")) throw new FormError("the batch size needs AML batch (--batch-max needs --batch)");
  if (maxErrors !== undefined && !flagOf(values, "collectErrors")) throw new FormError("the error limit needs collect errors (--max-errors needs --collect-errors)");
  const release = textOf(values, "release");
  const description = textOf(values, "description");
  const languages = textOf(values, "languages");
  return {
    ...(flagOf(values, "merge") ? { merge: true } : {}),
    ...(release === "" ? {} : { release }),
    ...(description === "" ? {} : { description }),
    ...(languages === "" ? {} : { languages }),
    ...(flagOf(values, "batch") ? { batch: batchMax === undefined ? true : { maxSize: batchMax } } : {}),
    ...(flagOf(values, "collectErrors") ? { collectErrors: maxErrors === undefined ? true : { maxCount: maxErrors } } : {}),
  };
}

/** Options every operation takes: verbose and the OS user. */
function commonOf(values: Values): { verbose?: boolean; osUser?: string } {
  const osUser = textOf(values, "osUser");
  return { ...(flagOf(values, "verbose") ? { verbose: true } : {}), ...(osUser === "" ? {} : { osUser }) };
}

/** How an export selects what to export. */
export const SELECTIONS = ["packages", "items", "all-packages", "from-manifest", "use-import"] as const;
export type Selection = (typeof SELECTIONS)[number];

/** The folder of an export that a manifest mode writes into the tree of the package, apart from the package's own files. */
export const MANIFEST_EXPORT_FOLDER = "/aras-pkg-export";

/** Whether the selection reads a manifest of a package, which is then the source of the run. */
export function selectionNeedsSource(selection: Selection): boolean {
  return selection === "from-manifest" || selection === "use-import";
}

/** The options of `exportPackages`, without the tree, the signal and the callbacks, which the page adds. */
export function exportOptionsOf(values: Values): ExportOptions {
  const selection = SELECTIONS.find((known) => known === textOf(values, "selection")) ?? "packages";
  const parallelism = numberOf(values, "parallelism", "the parallelism");
  const level = textOf(values, "level");
  const unknown = textOf(values, "unknownReferences");
  const onItemError = textOf(values, "onItemError");
  const languageResources = textOf(values, "languageResources");
  const languages = textOf(values, "languages");
  const selected: ExportOptions =
    selection === "packages"
      ? { packages: listOf(typeof values.packages === "string" ? values.packages : "") }
      : selection === "items"
        ? { items: itemsOf(typeof values.items === "string" ? values.items : "") }
        : selection === "all-packages"
          ? { allPackages: true }
          : { manifest: textOf(values, "manifest") || "/imports.mf", manifestMode: selection };
  return {
    ...selected,
    ...(level === "" ? {} : { level }),
    ...(flagOf(values, "exportReferenced") ? { exportReferencedItems: true } : {}),
    ...(unknown === "" ? {} : { unknownReferences: unknown as NonNullable<ExportOptions["unknownReferences"]> }),
    ...(onItemError === "" ? {} : { onItemError: onItemError as "continue" | "abort-package" }),
    ...(parallelism === undefined ? {} : { parallelism }),
    ...(languageResources === "" ? {} : { languageResources: languageResources as "only" | "with-metadata" }),
    ...(languages === "" ? {} : { languages }),
    ...(selectionNeedsSource(selection) ? { workingDirectory: MANIFEST_EXPORT_FOLDER } : {}),
    // an export writes no audit row, so it has no OS user (the CLI's export has no --os-user)
    ...(flagOf(values, "verbose") ? { verbose: true } : {}),
  };
}

/** The options of `importPackages`, without the source, the signal and the callbacks. */
export function importOptionsOf(values: Values): Omit<ImportOptions, "source"> {
  const packages = listOf(typeof values.packages === "string" ? values.packages : "");
  const manifestPath = textOf(values, "manifestPath");
  return {
    ...importSettingsOf(values),
    ...(manifestPath === "" ? {} : { manifestPath }),
    ...(packages.length === 0 ? {} : { packages }),
    ...commonOf(values),
  };
}

/** The options of `importLanguagePack`, without the source, the signal and the callbacks. */
export function languagePackOptionsOf(values: Values): Omit<ImportLanguagePackOptions, "source"> {
  const lpPath = textOf(values, "lpPath");
  return {
    ...importSettingsOf(values),
    lpPackage: requiredOf(values, "lpPackage", "the package name"),
    ...(lpPath === "" ? {} : { lpPath }),
    ...(flagOf(values, "lpDebug") ? { lpDebug: true } : {}),
    ...commonOf(values),
  };
}

/** The options of `applyDbPatches`, without the source, the signal and the callbacks. */
export function dbPatchOptionsOf(values: Values): Omit<DbPatchesOptions, "source"> {
  const patchesFolder = textOf(values, "patchesFolder");
  const toolName = textOf(values, "toolName");
  return {
    manifestPath: requiredOf(values, "manifestPath", "the manifest in the package"),
    ...(patchesFolder === "" ? {} : { patchesFolder }),
    ...(toolName === "" ? {} : { toolName }),
    ...commonOf(values),
  };
}
