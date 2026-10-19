import type { Engine } from "../engines.js";

/** The engines that have the DB patch operation: only 14.35's `Libs.dll` has the `DBPatches` namespace (DBP-001). */
export const DB_PATCH_ENGINES: readonly Engine[] = ["14.35"];

/** The operation asked of a build that does not have it. */
export class DbPatchesNotInEngineError extends Error {
  override name = "DbPatchesNotInEngineError";

  constructor(readonly engine: Engine) {
    super(`engine ${engine} has no DB patch application; it exists only in ${DB_PATCH_ENGINES.join(", ")} (DBP-001)`);
  }
}
