import { CItemException } from "../client/fault.js";
import { DEFAULT_ENGINE } from "../engines.js";
import type { Engine } from "../engines.js";
import { IOException } from "../io/errors.js";
import { pathEnvironmentFor } from "../io/host-path.js";
import type { PathEnvironment } from "../io/host-path.js";
import { ELEMENT_NODE, documentElementOf } from "../xml/dom.js";
import type { XmlDocument, XmlElement } from "../xml/dom.js";
import { XmlException } from "../xml/errors.js";
import { decodeXmlFile } from "../xml/load-file.js";
import { loadXml } from "../xml/parser.js";
import { readAllText } from "../xml/read-text.js";
import { outerXml } from "../xml/writer-legacy.js";
import { applyBuildXsl } from "./build-output.js";
import type { NestedRepeat } from "./build-output.js";
import { isPlainElement } from "./build-order.js";
import type { BuildPlan } from "./build-order.js";
import { directoryGetDirectories, directoryGetXmlFiles, newFileInfo, readListedFile } from "./package-files.js";

/** What `LoadPackageDom` writes its warnings to: the engine's log writer. The line ends are the writer's. */
export interface LogWriter {
  writeLine(text: string): void;
}

export interface LoadPackageOptions {
  /** The engine whose rules apply; the default is 14.0.7. */
  engine?: Engine;
  /** The host the paths are read on; the default is the process's own. */
  environment?: PathEnvironment;
}

/** One file of a package folder that the load visited. */
export interface PackageFile {
  /** The path as the listing gave it. */
  path: string;
  /** `FileInfo.FullName`, the absolute path that `tempFullName` holds. */
  fullName: string;
  /** `Path.GetFileNameWithoutExtension`, the stamp `tempKeyName` of the first item. */
  tempKeyName: string;
  /** True for a file without `AML/Item`: logged and left out (IMP-008). */
  skipped: boolean;
}

/** The result of loading a package folder: the engine's document, and the facts the plan reports (IMP-033). */
export interface LoadedPackage {
  engine: Engine;
  /** The `AML` document `LoadPackageDom` returns. */
  document: XmlDocument;
  /** Every file the load visited, in the order it did. */
  files: PackageFile[];
  plan: BuildPlan;
  nestedRepeats: NestedRepeat[];
}

const UNABLE_TO_GET_FILES = " Unable to get solutions files by path in .mf file ";
const UNABLE_TO_LOAD = " Unable to load ";
/** 12.0 has two spaces after `load` (IMP-011). */
const UNABLE_TO_LOAD_12_0 = " Unable to load  ";
const UNABLE_TO_APPLY_BUILD_XSL = " Unable to apply build.xsl.";

/**
 * The warning for a file without `AML/Item`.
 * @spec IMP-008
 */
export function skippedFileWarning(path: string, engine: Engine = DEFAULT_ENGINE): string {
  if (engine === "12.0") return `WARNING: File '${path}' doesn't have root tag 'AML/Item'. File is skipped.`;
  return `WARNING: File '${path}' doesn't have any items by next xpath : 'AML/Item'. File is skipped.`;
}

/** The engine's `CItemException(-1, stack, message + suffix, error)`. */
function wrapped(error: Error, suffix: string): CItemException {
  return new CItemException(-1, error.stack ?? null, error.message + suffix, error);
}

/** `Path.GetFileNameWithoutExtension(name)`: the name up to its last dot. */
function withoutExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? name : name.slice(0, dot);
}

/** `SelectSingleNode("AML/Item")` of a loaded file: the first `Item` child of a root element named `AML`. */
function firstItemOf(doc: XmlDocument): XmlElement | null {
  const root = documentElementOf(doc);
  if (!root || !isPlainElement(root, "AML")) return null;
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === ELEMENT_NODE && isPlainElement(child, "Item")) return child;
  }
  return null;
}

/**
 * `ImportExportManager.LoadPackageDom` with the facts of the load kept for the plan. Every immediate subdirectory of the
 * package folder is visited in NTFS order, every `*.xml` file in it in NTFS order. A file without `AML/Item` is logged and
 * skipped; the first item of every other file is stamped with its file name and path, and the files are joined into one
 * `AML` string that `build.xsl` orders.
 *
 * Failures are the engine's (IMP-011): listing the package folder or reading a file fails as a `CItemException` with the
 * suffix the engine adds; a parse error of a file is an `XmlException` as it is; a parse error of the joined string is wrapped.
 * @spec IMP-001 IMP-002 IMP-003 IMP-004 IMP-005 IMP-006 IMP-007 IMP-008 IMP-009 IMP-010 IMP-011 IMP-012
 */
export function loadPackage(solutionPath: string, logWriter: LogWriter, options: LoadPackageOptions = {}): LoadedPackage {
  const engine = options.engine ?? DEFAULT_ENGINE;
  const environment = pathEnvironmentFor(options.environment ?? {}, engine);
  let directories: string[];
  try {
    directories = directoryGetDirectories(solutionPath, environment);
  } catch (error) {
    if (error instanceof IOException) throw wrapped(error, UNABLE_TO_GET_FILES + solutionPath);
    throw error;
  }
  const files: PackageFile[] = [];
  const parts: string[] = [];
  let current = "";
  try {
    for (const directory of directories) {
      for (const path of directoryGetXmlFiles(directory, environment)) {
        current = path;
        // IMP-007: 12.0's `XmlDocument.Load(path)` decodes the file itself; 14.0.7 reads text first
        const bytes = readListedFile(path, environment);
        const doc = loadXml(engine === "12.0" ? decodeXmlFile(bytes) : readAllText(bytes), { preserveWhitespace: false });
        const info = newFileInfo(path, environment);
        const item = firstItemOf(doc);
        const tempKeyName = withoutExtension(info.name);
        if (!item) {
          logWriter.writeLine(skippedFileWarning(path, engine));
          files.push({ path, fullName: info.fullName, tempKeyName, skipped: true });
          continue;
        }
        item.setAttribute("tempKeyName", tempKeyName);
        if (engine !== "12.0") item.setAttribute("tempFullName", info.fullName);
        parts.push(outerXml(doc));
        files.push({ path, fullName: info.fullName, tempKeyName, skipped: false });
      }
    }
  } catch (error) {
    if (error instanceof IOException) throw wrapped(error, (engine === "12.0" ? UNABLE_TO_LOAD_12_0 : UNABLE_TO_LOAD) + current);
    throw error;
  }
  try {
    const joined = loadXml(`<AML>${parts.join("")}</AML>`, { preserveWhitespace: false });
    const applied = applyBuildXsl(joined, engine);
    return { engine, document: applied.document, files, plan: applied.plan, nestedRepeats: applied.nestedRepeats };
  } catch (error) {
    if (error instanceof XmlException) throw wrapped(error, UNABLE_TO_APPLY_BUILD_XSL);
    throw error;
  }
}

/**
 * `ImportExportManager.LoadPackageDom(solutionPath, logWriter)`: the ordered `AML` document of a package folder.
 * @spec IMP-001
 */
export function loadPackageDom(solutionPath: string, logWriter: LogWriter, options: LoadPackageOptions = {}): XmlDocument {
  return loadPackage(solutionPath, logWriter, options).document;
}
