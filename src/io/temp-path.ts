import { defaultHostEnv } from "../host/default-host.js";
import { envOf } from "./host-path.js";
import type { PathEnvironment } from "./host-path.js";

/** The 32 characters .NET Framework's `Path.GetRandomFileName` draws from. */
const BASE32 = "abcdefghijklmnopqrstuvwxyz012345";

/**
 * `Path.GetTempPath`: the host's temp folder with a trailing separator, as .NET gives it (`\` on Windows). On another platform it
 * is the host path with `/`, which the path functions of the engine take as they take `\` (MAN-033).
 * @spec LP-030 HOST-203
 */
export function pathGetTempPath(environment: PathEnvironment = {}): string {
  const folder = (environment.host ?? defaultHostEnv()).tmpdir();
  if (/[\\/]$/.test(folder)) return folder;
  return `${folder}${envOf(environment).platform === "win32" ? "\\" : "/"}`;
}

/**
 * `Path.GetRandomFileName`: eleven random characters of `a-z0-5`, a dot after the eighth: `xxxxxxxx.xxx`.
 * @spec LP-030 HOST-203
 */
export function pathGetRandomFileName(environment: PathEnvironment = {}): string {
  const name = Array.from((environment.host ?? defaultHostEnv()).randomBytes(11), (byte) => BASE32.charAt(byte & 0x1f)).join("");
  return `${name.slice(0, 8)}.${name.slice(8)}`;
}
