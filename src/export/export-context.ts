/**
 * What to do with references from an exported item to an element of a package that is not exported (EXP-501, EXP-600). `DoNotRemove`
 * skips the unknown-package machinery. The engine's enum has these three members, `RemoveSilently` first.
 */
export type ReferencesToUnknownPackages = "RemoveSilently" | "RemoveWithWarning" | "DoNotRemove";

/** The `ImportExport.Export` action: a plain export. */
export const EXPORT_ACTION = "Export";
/** `ImportExport.ExportLanguageResourcesOnly` (14.35): the item files hold only the language elements and what locates them (LP-100). */
export const LANGUAGE_RESOURCES_ONLY = "ExportLanguageResourcesOnly";
/** `ImportExport.ExportMetadataWithLanguageResources` (14.35): the whole item, with the translations of the selected languages (LP-100). */
export const LANGUAGE_RESOURCES_WITH_METADATA = "ExportMetadataWithLanguageResources";

/** Whether an action is one of the two language modes. The engine tests each value by equality, never as a group (LP-100). */
export const isLanguageMode = (action: string): boolean => action === LANGUAGE_RESOURCES_ONLY || action === LANGUAGE_RESOURCES_WITH_METADATA;

/**
 * The settings every run shares: the engine's `SolutionUpgradeContext`. All are plain properties with no validation. Export reads
 * `action`, `url`, `dataBase`, `userName`, `workingDirectory`, `logFilePath`, `manifestFile`, `lpPath` and `lpPackage` for the log
 * header, and `timeout` once, in the manager's constructor. It never reads `password`, `verbose` or `lpDebug`.
 *
 * @spec EXP-501
 */
export class SolutionUpgradeContext {
  /**
   * The engine's `ImportExport` value, which the header's `Action:` line shows. An export runs `Export`; 14.35 adds the two language
   * modes {@link LANGUAGE_RESOURCES_ONLY} and {@link LANGUAGE_RESOURCES_WITH_METADATA} (LP-100).
   */
  action: string = EXPORT_ACTION;
  url: string | null = null;
  password: string | null = null;
  dataBase: string | null = null;
  userName: string | null = null;
  /** The root of the output directories and of `imports.mf`. */
  workingDirectory: string | null = null;
  verbose = false;
  /** The log file. */
  logFilePath: string | null = null;
  /** An existing manifest is loaded by the manager's constructor, though an export never uses it. */
  manifestFile: string | null = null;
  /** Applied to the connection by the constructor when it is above 0 or exactly -1 (WIRE-031). */
  timeout = 0;
  lpPath: string | null = null;
  lpPackage: string | null = null;
  lpDebug = false;
  /**
   * 14.35's `Languages`: the language codes to export or import, null unless a host sets it (LP-101, IMP-600). The manager's
   * constructor rewrites it in place (LP-110), so a caller that reads it afterwards sees the resolved list. 14.0.7 and 12.0 have no
   * such setting and never read it.
   *
   * @spec LP-101 LP-110 IMP-600
   */
  languages: string[] | null = null;
}

/**
 * The export settings: the engine's `SUExportContext`. The names in the C# are `sLevel`, `bExportReferencedItems`, `RefToUnknownPacks`
 * and `UseImport`.
 *
 * @spec EXP-501
 */
export class SUExportContext extends SolutionUpgradeContext {
  /** The `levels` of the fetch of a type without a fixed one, logged as `Export level`. */
  level: string | null = null;
  /** Whether the referenced elements of the dependencies are exported in a second pass (EXP-512, EXP-519). */
  exportReferencedItems = false;
  refToUnknownPacks: ReferencesToUnknownPackages = "RemoveSilently";
  /** Logged only: the host that sets it builds the selection differently. */
  useImport = false;
}
