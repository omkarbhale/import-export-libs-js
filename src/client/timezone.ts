import { execFileSync } from "node:child_process";
import { WINDOWS_ZONE_IDS } from "./windows-zones.js";

/** The machine's time zone has no Windows id, so the `TIMEZONE_NAME` header cannot be derived. */
export class UnmappedTimeZoneError extends Error {
  constructor(readonly zone: string) {
    super(`The local time zone '${zone}' has no Windows time zone id; pass the Windows id with --time-zone <id>.`);
    this.name = "UnmappedTimeZoneError";
  }
}

export interface TimeZoneSource {
  platform?: NodeJS.Platform;
  /** The local IANA zone id; the runtime's own when absent. */
  ianaZone?: string;
  /** Runs `tzutil /g` on Windows. */
  windowsZone?: () => string;
}

/**
 * The Windows time zone id of this machine: what `TimeZoneInfo.Local.Id` says
 * on Windows, and the CLDR mapping of the local IANA zone elsewhere.
 *
 * @spec WIRE-005
 */
export function localWindowsTimeZoneId(source: TimeZoneSource = {}): string {
  if ((source.platform ?? process.platform) === "win32") {
    return (source.windowsZone ?? (() => execFileSync("tzutil", ["/g"], { encoding: "utf8" })))().trim();
  }
  const zone = source.ianaZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const id = WINDOWS_ZONE_IDS[zone];
  if (id === undefined) throw new UnmappedTimeZoneError(zone);
  return id;
}
