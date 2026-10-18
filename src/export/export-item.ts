import { hasOnlyValidFileNameChars } from "../xml/file-names.js";

/**
 * The item the engine exports or reads from a manifest: three strings (EXP-002). The export slices own where the
 * values come from; the manifest reads a `referenced_element` into one (MAN-015), and for an element referenced by a
 * dependency they come from `PackageDefinitionManager.findReferencedElements`.
 *
 * @spec EXP-002
 */
export class ExportItem {
  constructor(
    readonly keyedName: string | null,
    readonly idName: string | null,
    readonly typeName: string | null,
  ) {}

  /** `ToString()` is the keyed name. */
  toString(): string {
    return this.keyedName ?? "";
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
  const keyedName = item.keyedName ?? "";
  const useKeyedName = keyedName !== "" && hasOnlyValidFileNameChars(keyedName);
  return `${useKeyedName ? keyedName : (item.idName ?? "")}.xml`;
}
