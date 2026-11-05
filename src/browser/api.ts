/**
 * The browser API (HOST-270 to HOST-273): `connect` makes a session on a server, and `exportPackages`, `importPackages`,
 * `importLanguagePack` and `applyDbPatches` run the CLI's four commands on it, with the files in a tree in memory, progress and
 * messages as callbacks, and an `AbortSignal`. `planImport` is `plan import`, with no server. There is no UI and no `console`.
 *
 * @spec HOST-270 HOST-271 HOST-272 HOST-273
 */
export { SessionBusyError, SessionClosedError, Session, connect, engineForServer } from "./api-session.js";
export type { ConnectOptions } from "./api-session.js";
export { OptionError, describeFailure } from "./api-run.js";
export type {
  ApiMessage,
  MessageCounts,
  MessageLevel,
  MessageSource,
  OnItemErrorOption,
  Operation,
  OperationResult,
  ProgressEvent,
  ProgressPhase,
  RunOptions,
  RunResult,
  RunSummary,
} from "./api-run.js";
export { exportPackages } from "./api-export.js";
export type { ExportOptions, ExportResult, ManifestMode } from "./api-export.js";
export { applyDbPatches, importLanguagePack, importPackages, planImport } from "./api-import.js";
export type {
  DbPatchesOptions,
  ImportOptions,
  ImportPlanResult,
  ImportResult,
  ImportSettings,
  ImportLanguagePackOptions,
  PackageSource,
  PlanImportOptions,
  PlannedPackage,
} from "./api-import.js";
