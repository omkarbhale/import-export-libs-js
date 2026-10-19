import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import type { PathEnvironment } from "./host-path.js";

/** The 32 characters .NET Framework's `Path.GetRandomFileName` draws from. */
const BASE32 = "abcdefghijklmnopqrstuvwxyz012345";

/**
 * `Path.GetTempPath`: the host's temp folder with a trailing separator, as .NET gives it (`\` on Windows). On another platform it
 * is the host path with `/`, which the path functions of the engine take as they take `\` (MAN-033).
 * @spec LP-030
 */
export function pathGetTempPath(environment: PathEnvironment = {}): string {
  const folder = tmpdir();
  if (/[\\/]$/.test(folder)) return folder;
  return `${folder}${(environment.platform ?? process.platform) === "win32" ? "\\" : "/"}`;
}

/**
 * `Path.GetRandomFileName`: eleven random characters of `a-z0-5`, a dot after the eighth: `xxxxxxxx.xxx`.
 * @spec LP-030
 */
export function pathGetRandomFileName(): string {
  const name = Array.from(randomBytes(11), (byte) => BASE32.charAt(byte & 0x1f)).join("");
  return `${name.slice(0, 8)}.${name.slice(8)}`;
}
