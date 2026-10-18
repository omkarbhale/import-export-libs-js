/**
 * The item the engine exports or reads from a manifest: three strings (EXP-002). The export slices own where the
 * values come from; the manifest reads a `referenced_element` into one (MAN-015).
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
