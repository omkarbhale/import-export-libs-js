import type { Engine } from "../engines.js";
import { ExportItem } from "../export/export-item.js";
import type { ImportExportManager, SelectionTable } from "../export/import-export-manager.js";
import { packageTableFromSolutions } from "../export/manifest-selection.js";
import { RunLog } from "../export/run-log.js";
import { getItemsFromPackageDom, isImportableType } from "../import/items.js";
import { loadPackageDom } from "../import/load-package-dom.js";
import type { PathEnvironment } from "../io/host-path.js";
import { getDirectoryName } from "../io/win-path.js";
import { DuplicateKeyError, ManifestFile, NetfxHashtable, getSolutionPath } from "../manifest/index.js";
import { documentElementOf } from "../xml/index.js";
import type { XmlElement } from "../xml/index.js";

/**
 * The three ways Aras's console tool (`ConsoleUpgrade.exe`, `ProcessExport`) builds the table of packages to items that
 * `ExportSolutions` is given: from the structure of an import manifest (`--use-import`), from the packages a manifest names
 * (`--from-manifest`) and from every package of the database (`--all-packages`). They are the tool's loops and not the engine's
 * (spec/export-modes.md, `HOST-` rules); the engine's own part is `ImportExportManager.generateHashtableFromManifest`.
 */

/**
 * The engines whose package loading the CLI offers `--use-import` for: all three (HOST-113). 14.35's was enabled by its live parity,
 * which found the mode equal to ConsoleUpgrade's on dev.
 *
 * @spec HOST-113
 */
export const USE_IMPORT_ENGINES: readonly Engine[] = ["12.0", "14.0.7", "14.35"];

/** What `--use-import` needs besides the manifest: the engine, the host's file system and the log the conflicts go to. */
export interface UseImportOptions extends PathEnvironment {
  engine: Engine;
  /** The `LogFilePath` of the context. The loop appends to it before the engine opens it for the export. */
  logFilePath: string | null;
}

/** The `Conflict:` line of two importable items with one id (HOST-111). */
function conflictLine(id: string, name: string, type: string, existing: ExportItem): string {
  return `\nConflict: id = ${id}; itemName = '${name}' type = '${type}' and itemName = '${existing.keyedName ?? ""}' type = '${existing.typeName ?? ""}'`;
}

const attributeOf = (element: XmlElement, name: string): string => element.getAttributeNode(name)?.value ?? "";

/**
 * `--use-import <manifest>`: for each package of the manifest, in document order, the top-level items its folder would import
 * with `action="add"` and an importable type, keyed by `id` and named by the `tempKeyName` that loading stamped on the first item
 * of each file. A second item with a taken id is written to the log and dropped. The package is added to the outer table after its
 * items, so a repeated package name fails after its folder was read again.
 *
 * @spec HOST-110 HOST-111 HOST-112
 */
export function useImportTable(manifestPath: string, options: UseImportOptions): SelectionTable {
  const { engine, logFilePath, ...environment } = options;
  const manifestFolder = getDirectoryName(manifestPath);
  const log = RunLog.open(logFilePath, environment);
  try {
    const manifest = new ManifestFile(manifestPath, { ...environment, engine });
    const table: SelectionTable = new NetfxHashtable("the selected packages");
    for (const packageName of manifest.getAllPackageNames()) {
      const inner = new NetfxHashtable<ExportItem>(`the selected items of package ${JSON.stringify(packageName)}`);
      const solutionPath = getSolutionPath(packageName, manifestFolder, manifest);
      const packageDom = loadPackageDom(solutionPath, log, { engine, environment });
      for (const itemDocument of getItemsFromPackageDom(packageDom)) {
        const item = documentElementOf(itemDocument);
        if (item === null || attributeOf(item, "action") !== "add") continue;
        const id = attributeOf(item, "id");
        const type = attributeOf(item, "type");
        const name = attributeOf(item, "tempKeyName");
        if (!isImportableType(type)) continue;
        try {
          inner.add(id, new ExportItem(name, id, type));
        } catch (error) {
          if (!(error instanceof DuplicateKeyError)) throw error;
          log.writeLine(conflictLine(id, name, type, inner.get(id) as ExportItem));
        }
      }
      table.add(packageName, inner);
    }
    return table;
  } finally {
    log.dispose();
  }
}

/**
 * `--all-packages`: every package definition of the database with all its elements, the way the console tool does when it has no
 * manifest to select from. A database with no package definitions fails with a null reference after the engine's warning.
 *
 * @spec HOST-121
 */
export async function allPackagesTable(manager: ImportExportManager): Promise<SelectionTable> {
  return packageTableFromSolutions(await manager.getSolutions2Xml(), () => true);
}

/**
 * `--from-manifest <manifest>`: the engine's `GenerateHashtableFromManifest`. The console tool falls back to every package when the
 * engine answers null (the file is missing); that fallback is `fallBack`, and the CLI, which checks the file first, passes false.
 *
 * @spec HOST-120
 */
export async function fromManifestTable(manager: ImportExportManager, manifestPath: string | null, fallBack: boolean): Promise<SelectionTable> {
  const table = await manager.generateHashtableFromManifest(manifestPath);
  if (table !== null) return table;
  if (!fallBack) throw new Error(`the manifest '${manifestPath ?? ""}' does not exist`);
  return allPackagesTable(manager);
}
