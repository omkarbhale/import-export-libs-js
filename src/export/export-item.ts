import { hasOnlyValidFileNameChars } from "../xml/file-names.js";

/**
 * An item to export: the three strings the engine's `ExportItem` holds. Where they come from is the orchestration's
 * business; for an element referenced by a dependency they come from `PackageDefinitionManager.findReferencedElements`.
 *
 * @spec EXP-002
 */
export class ExportItem {
  constructor(
    readonly keyedName: string,
    readonly idName: string,
    readonly typeName: string,
  ) {}

  toString(): string {
    return this.keyedName;
  }
}

/**
 * The file an item is written to, chosen before any request: the keyed name when it is non-empty and has none of
 * Windows' invalid file-name characters, otherwise the requested id (as given, before the current-version
 * resolution), and `.xml`. The keyed name is not trimmed, and the Windows set applies on every platform.
 *
 * @spec EXP-002
 */
export function exportFileName(item: ExportItem): string {
  const useKeyedName = item.keyedName !== "" && hasOnlyValidFileNameChars(item.keyedName);
  return `${useKeyedName ? item.keyedName : item.idName}.xml`;
}
