/**
 * The import settings: the engine's `SUImportContext`, five plain properties with no validation. The names in the C# are
 * `bMerge`, `bFast`, `Release`, `Description` and `bVault`. It is separate from the manager's `SolutionUpgradeContext`, which
 * holds the log, the manifest and the connection settings (IMP-401).
 *
 * 14.35 adds four more, all off by default (IMP-500): the AML batch mode and its size, and the collected-errors mode and its
 * limit. The other engines have none of them, so a run of those engines never reads them.
 *
 * @spec IMP-401 IMP-500
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
  /** [14.35] Sends many items in one `<AML>` and falls back to one by one when it fails (IMP-510 to IMP-526). */
  amlBatchMode = false;
  /** [14.35] The queue length at which a batch is sent; 0 or less sends after every item (IMP-511). */
  amlBatchMaxSize = 0;
  /** [14.35] Keeps importing after an item fails and reports the failures at the end (IMP-540 to IMP-551). */
  collectImportErrors = false;
  /** [14.35] The number of collected errors that ends the run; 0 or less ends it at the first (IMP-541). */
  collectImportErrorsMaxCount = 0;

  /** The engine's `bFast` discards what is set and reads `false`, so the fast mode never exists. */
  get fast(): boolean {
    return false;
  }

  set fast(_value: boolean) {
    // the setter of the engine does nothing
  }
}
