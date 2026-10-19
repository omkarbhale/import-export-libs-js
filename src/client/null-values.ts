import { nullReference } from "./dotnet.js";
import type { ArasVersion } from "./version.js";

/** The threshold object of the engine: `new ArasVersion(14, 0, 22, 39629, 0)`, whose `22` is in the service-pack position (LP-040). */
const THRESHOLD = { major: 14, minor: 0, servicePack: 22 } as const;

/**
 * `ArasVersionExtensions.NeedToHandleNullPropertyValues(version)` (LP-040): true for every server that needs the language-pack import
 * to set the labels of a `Property` by SQL, which is every server below 14.0 SP22. It compares the major, minor and service pack and
 * never the service update, so a 14.0 server that reports its fixes there is still "needs handling" (bug LP-040). A version that has
 * not been read is a null reference.
 *
 * @spec LP-040
 */
export function needToHandleNullPropertyValues(version: ArasVersion | undefined): boolean {
  if (version === undefined) throw nullReference();
  if (version.major > THRESHOLD.major) return false;
  if (version.major === THRESHOLD.major && version.minor >= THRESHOLD.minor && version.minor > 0) return false;
  if (version.major === THRESHOLD.major && version.minor >= THRESHOLD.minor && version.servicePack >= THRESHOLD.servicePack) return false;
  return true;
}
