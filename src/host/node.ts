import { randomBytes, randomUUID } from "node:crypto";
import { availableParallelism, hostname, tmpdir, userInfo } from "node:os";
import { localWindowsTimeZoneId } from "../client/timezone.js";
import type { HostEnv } from "./types.js";

/**
 * The Node implementation of {@link HostEnv}: each member is the call the code made before the seam, so nothing a Node caller can
 * observe changes. This module is Node only; the core reaches it through `default-host.ts` alone (HOST-203).
 *
 * @spec HOST-200 HOST-203 HOST-241
 */
export const nodeHost: HostEnv = {
  platform: process.platform,
  cwd: () => process.cwd(),
  tmpdir: () => tmpdir(),
  osUser: () => {
    const domain = process.env.USERDOMAIN;
    return { user: userInfo().username, machine: hostname(), ...(domain === undefined ? {} : { domain }) };
  },
  availableParallelism: () => availableParallelism(),
  monotonicNs: () => process.hrtime.bigint(),
  randomBytes: (n) => randomBytes(n),
  randomUuid: () => randomUUID(),
  yieldTurn: () => new Promise<void>((resolve) => setImmediate(resolve)),
  windowsTimeZoneId: () => {
    try {
      return localWindowsTimeZoneId();
    } catch {
      return undefined;
    }
  },
  locale: () => Intl.DateTimeFormat().resolvedOptions().locale,
};
