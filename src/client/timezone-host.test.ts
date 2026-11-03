import { describe, expect, it } from "vitest";
import type { HostEnv } from "../host/types.js";
import { nodeHost } from "../host/node.js";
import { UnmappedTimeZoneError, localWindowsTimeZoneId } from "./timezone.js";
import { WINDOWS_ZONE_IDS } from "./windows-zones.js";

/** A host environment that answers only what the time zone reads; any other member is a bug of the caller. */
function fakeHost(platform: string, windowsTimeZoneId: () => string | undefined): HostEnv & { asked: string[] } {
  const asked: string[] = [];
  const refuse = (name: string) => () => {
    throw new Error(`the time zone read ${name}`);
  };
  return {
    asked,
    platform,
    cwd: refuse("cwd"),
    tmpdir: refuse("tmpdir"),
    osUser: refuse("osUser"),
    availableParallelism: refuse("availableParallelism"),
    monotonicNs: refuse("monotonicNs"),
    randomBytes: refuse("randomBytes"),
    randomUuid: refuse("randomUuid"),
    yieldTurn: refuse("yieldTurn"),
    locale: refuse("locale"),
    windowsTimeZoneId: () => {
      asked.push("windowsTimeZoneId");
      return windowsTimeZoneId();
    },
  };
}

/** @spec HOST-242 WIRE-005 */
describe("HOST-242: the time zone id comes from the host", () => {
  it("a win32 host answers the id, whose line break is trimmed", () => {
    const host = fakeHost("win32", () => "Pacific Standard Time\r\n");
    expect(localWindowsTimeZoneId({ host })).toBe("Pacific Standard Time");
    expect(host.asked).toEqual(["windowsTimeZoneId"]);
  });

  it("a win32 host is not asked for the IANA zone, and its answer wins over a zone the caller names", () => {
    const host = fakeHost("win32", () => "  W. Europe Standard Time \n");
    expect(localWindowsTimeZoneId({ host, ianaZone: "Asia/Kolkata" })).toBe("W. Europe Standard Time");
  });

  it("a browser-like host (not win32, no Windows id) maps its IANA zone through the table", () => {
    const host = fakeHost("browser", () => undefined);
    expect(localWindowsTimeZoneId({ host, ianaZone: "Asia/Kolkata" })).toBe("India Standard Time");
    expect(localWindowsTimeZoneId({ host, ianaZone: "Europe/London" })).toBe("GMT Standard Time");
    expect(host.asked).toEqual([]);
  });

  it("a browser-like host reads its IANA zone from Intl when the caller names none", () => {
    const host = fakeHost("browser", () => undefined);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(localWindowsTimeZoneId({ host })).toBe(WINDOWS_ZONE_IDS[zone]);
  });

  it("a browser-like host with a zone that has no Windows id throws the existing error", () => {
    const host = fakeHost("browser", () => undefined);
    const error = (() => {
      try {
        return localWindowsTimeZoneId({ host, ianaZone: "Mars/Olympus" });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(UnmappedTimeZoneError);
    expect((error as UnmappedTimeZoneError).zone).toBe("Mars/Olympus");
    expect((error as Error).message).toBe(
      "The local time zone 'Mars/Olympus' has no Windows time zone id; pass the Windows id with --time-zone <id>.",
    );
  });

  it("a win32 host with no id to give falls back to the IANA zone", () => {
    const host = fakeHost("win32", () => undefined);
    expect(localWindowsTimeZoneId({ host, ianaZone: "America/New_York" })).toBe("Eastern Standard Time");
  });

  it("the platform of the source wins over the host's", () => {
    const host = fakeHost("win32", () => "Tokyo Standard Time");
    expect(localWindowsTimeZoneId({ host, platform: "linux", ianaZone: "Asia/Kolkata" })).toBe("India Standard Time");
    expect(host.asked).toEqual([]);
    const posix = fakeHost("linux", () => "never asked");
    expect(localWindowsTimeZoneId({ host: posix, platform: "win32" })).toBe("never asked");
  });

  it("a windowsZone of the source wins over the host's, and the host's platform picks the path", () => {
    const host = fakeHost("win32", () => "from the host");
    expect(localWindowsTimeZoneId({ host, windowsZone: () => "Pacific Standard Time\r\n" })).toBe("Pacific Standard Time");
    expect(host.asked).toEqual([]);
  });

  it("the default host is the Node host of the running platform", () => {
    expect(localWindowsTimeZoneId({ platform: "linux", ianaZone: "Asia/Kolkata" })).toBe("India Standard Time");
    if (process.platform !== "win32") {
      expect(nodeHost.windowsTimeZoneId()).toBe(WINDOWS_ZONE_IDS[Intl.DateTimeFormat().resolvedOptions().timeZone]);
    }
  });
});

/** The zones that no Windows id exists for, each decided in `spec/browser-host.md` (HOST-242); an unknown miss fails the test. */
const DOCUMENTED_UNMAPPED = ["Antarctica/Troll"];

/**
 * Every zone a runtime can report as its own is in the table (HOST-242). `Intl.supportedValuesOf("timeZone")` lists the canonical
 * zones of the ICU of the running engine; the browser project runs this again in the browsers.
 *
 * @spec HOST-242
 */
describe("HOST-242: the table covers the zones the runtime can report", () => {
  it("has an entry for every zone of Intl.supportedValuesOf('timeZone') that is not documented as unmapped", () => {
    const misses = Intl.supportedValuesOf("timeZone").filter((zone) => WINDOWS_ZONE_IDS[zone] === undefined);
    expect(misses.filter((zone) => !DOCUMENTED_UNMAPPED.includes(zone))).toEqual([]);
  });

  it("documents only zones that are still unmapped", () => {
    expect(DOCUMENTED_UNMAPPED.filter((zone) => WINDOWS_ZONE_IDS[zone] !== undefined)).toEqual([]);
  });

  it("throws UnmappedTimeZoneError for a documented zone", () => {
    for (const zone of DOCUMENTED_UNMAPPED) {
      expect(() => localWindowsTimeZoneId({ platform: "browser", ianaZone: zone })).toThrow(UnmappedTimeZoneError);
    }
  });

  it("maps every entry to a non-empty Windows id", () => {
    expect(Object.entries(WINDOWS_ZONE_IDS).filter(([, id]) => id.trim() === "")).toEqual([]);
  });
});
