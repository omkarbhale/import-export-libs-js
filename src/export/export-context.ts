/**
 * What to do with references from an exported item to an element of a package that is not exported (EXP-501, EXP-600). `DoNotRemove`
 * skips the unknown-package machinery. The engine's enum has these three members, `RemoveSilently` first.
 */
export type ReferencesToUnknownPackages = "RemoveSilently" | "RemoveWithWarning" | "DoNotRemove";

/**
 * The settings every run shares: the engine's `SolutionUpgradeContext`. All are plain properties with no validation. Export reads
 * `action`, `url`, `dataBase`, `userName`, `workingDirectory`, `logFilePath`, `manifestFile`, `lpPath` and `lpPackage` for the log
 * header, and `timeout` once, in the manager's constructor. It never reads `password`, `verbose` or `lpDebug`.
 *
 * @spec EXP-501
 */
export class SolutionUpgradeContext {
  /** The header's `Action:` line. The export library always runs `Export`. */
  action = "Export";
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
