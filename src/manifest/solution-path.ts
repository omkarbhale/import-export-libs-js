import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { Exception, ArgumentNullException } from "../io/errors.js";
import { formatMessage } from "../io/dotnet-text.js";
import type { ManifestFile } from "./manifest-file.js";
import { getPackagePath } from "./package-path.js";

const NODE_NOT_FOUND = "Node for package '{0}' doesn't exist in the manifest file";
const UNABLE_TO_DETERMINE_PATH = " Enable to detemine path to {0}.";

/**
 * `ImportExportManager.GetSolutionPath(packageName, manifestFolder, manifest)`, which import calls for each package: the
 * folder of the package from the manifest. Every failure of the lookup and of {@link getPackagePath}, the message of a
 * missing package node included, is thrown again as a plain `Exception` with the original message followed by the
 * engine's own text (with its spelling), and the original as inner exception. The interface member forwards here.
 * @spec MAN-032
 */
export function getSolutionPath(
  packageName: string | null,
  manifestFolder: string | null,
  manifest: ManifestFile | null,
  engine: Engine = DEFAULT_ENGINE,
): string {
  if (manifest === null) throw new ArgumentNullException("manifestFile");
  try {
    const node = manifest.getPackageNode(packageName);
    if (node === null) throw new Exception(formatMessage(NODE_NOT_FOUND, packageName));
    return getPackagePath(node, manifestFolder, engine);
  } catch (error) {
    const original = error as Error;
    throw new Exception(original.message + formatMessage(UNABLE_TO_DETERMINE_PATH, packageName), original);
  }
}
