/**
 * The import settings: the engine's `SUImportContext`, five plain properties with no validation. The names in the C# are
 * `bMerge`, `bFast`, `Release`, `Description` and `bVault`. It is separate from the manager's `SolutionUpgradeContext`, which
 * holds the log, the manifest and the connection settings (IMP-401).
 *
 * @spec IMP-401
 */
export class SUImportContext {
  /** The banner text, whether an existing item is skipped and the `mergeMode` of `doImport`; logged in the header (IMP-403). */
  merge = false;
  /** The `target_release` of the `DatabaseUpgrade` row (IMP-451); logged in the header. */
  release: string | null = null;
  /** The `description` of the row (IMP-451); not logged. */
  description: string | null = null;
  /** Stored and never read: no file or vault upload exists on the import path. */
  vault = false;

  /** The engine's `bFast` discards what is set and reads `false`, so the fast mode never exists. */
  get fast(): boolean {
    return false;
  }

  set fast(_value: boolean) {
    // the setter of the engine does nothing
  }
}
