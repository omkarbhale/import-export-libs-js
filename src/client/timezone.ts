import { defaultHostEnv } from "../host/default-host.js";
import type { HostEnv } from "../host/types.js";
import { WINDOWS_ZONE_IDS } from "./windows-zones.js";

/** The machine's time zone has no Windows id, so the `TIMEZONE_NAME` header cannot be derived. */
export class UnmappedTimeZoneError extends Error {
  constructor(readonly zone: string) {
    super(`The local time zone '${zone}' has no Windows time zone id; pass the Windows id with --time-zone <id>.`);
    this.name = "UnmappedTimeZoneError";
  }
}

export interface TimeZoneSource {
  /** The platform whose rule applies: the host's own when absent (HOST-203). */
  platform?: string;
  /** The local IANA zone id; the runtime's own when absent. */
  ianaZone?: string;
  /** The Windows id of the zone, which a Windows run asks the host for (`tzutil /g` on Node); the host's own answer when absent. */
  windowsZone?: () => string | undefined;
  /** The environment whose platform and Windows zone are the defaults; the default environment of the running platform when absent. */
  host?: HostEnv;
}

/**
 * The Windows time zone id of this machine: what `TimeZoneInfo.Local.Id` says
 * on Windows, and the CLDR mapping of the local IANA zone elsewhere (and in a
 * browser, which has no Windows id of its own: HOST-242).
 *
 * @spec WIRE-005 HOST-242
 */
export function localWindowsTimeZoneId(source: TimeZoneSource = {}): string {
  const host = source.host ?? defaultHostEnv();
  if ((source.platform ?? host.platform) === "win32") {
    const id = source.windowsZone === undefined ? host.windowsTimeZoneId() : source.windowsZone();
    if (id !== undefined) return id.trim();
  }
  const zone = source.ianaZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const id = WINDOWS_ZONE_IDS[zone];
  if (id === undefined) throw new UnmappedTimeZoneError(zone);
  return id;
}
