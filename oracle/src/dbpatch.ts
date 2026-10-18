import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The oracle's `dbpatch` command (14.35 `ApplyDBUpdateManifest`) applies one
 * patch only: the clearly non-destructive no-op of DBP-070, committed in
 * `oracle/dbpatch/`. Any other manifest or patch file is refused before a
 * connection is made (DBP-071), because a patch runs server code as the Super
 * User and nothing else is known to be safe (AGENTS.md, Live Aras).
 */

/** The committed test patch folder. */
export const DBPATCH_DIR = fileURLToPath(new URL("../dbpatch", import.meta.url));

/** The manifest's file name, and the patch file it names (`<name>.xml`, DBP-040). */
export const MANIFEST_FILE = "manifest.xml";
export const PATCH_NAME = "LIBSJS-SCRATCH-noop";
export const PATCH_FILE = `${PATCH_NAME}.xml`;

/** `up_number` of the patch's one entry, and the release its `software_version` 9999 gives (DBP-021). */
export const PATCH_NUMBER = "LIBSJS-SCRATCH-001";
export const PATCH_RELEASE = "99.99";

/** The only `ToolName` the guard accepts: the engine's own default (DBP-002). */
export const TOOL_NAME = "Libs";

/** sha256 of the committed files; the guard needs the inputs byte-identical to them. */
export const MANIFEST_SHA256 = "0ce4cc67b6406b2cad3fbab8dae4f8d37c40beb98223c00c139a889265e016e2";
export const PATCH_SHA256 = "67353888652da296ce768a4689e89e5705a7a2809e06391295052692f7e14369";

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * Refuses everything but the committed test patch: the manifest and the patch
 * file in the patches folder must be byte-identical to the committed ones, and
 * the tool name must be `Libs`. Returns the full paths to hand the engine.
 */
export function assertTestPatch(manifest: string, patchesFolder: string, toolName: string): { manifest: string; folder: string } {
  const problems: string[] = [];
  if (basename(manifest) !== MANIFEST_FILE) problems.push(`the manifest is not named ${MANIFEST_FILE}`);
  if (toolName !== TOOL_NAME) problems.push(`--tool-name is '${toolName}', not '${TOOL_NAME}'`);
  const read = (what: string, path: string, expected: string): void => {
    let actual: string;
    try {
      actual = sha256(path);
    } catch (error) {
      problems.push(`${what} ${path} is unreadable: ${(error as Error).message}`);
      return;
    }
    if (actual !== expected) problems.push(`${what} ${path} is not the committed test patch file (sha256 ${actual})`);
  };
  const manifestPath = resolve(manifest);
  const folder = resolve(patchesFolder);
  read("manifest", manifestPath, MANIFEST_SHA256);
  read("patch", join(folder, PATCH_FILE), PATCH_SHA256);
  if (problems.length > 0) {
    throw new Error(`refusing to apply a DB patch other than oracle/dbpatch's no-op (DBP-071): ${problems.join("; ")}`);
  }
  return { manifest: manifestPath, folder };
}
