import { describe, expect, it } from "vitest";
import { UnmappedTimeZoneError, localWindowsTimeZoneId } from "./timezone.js";

describe("localWindowsTimeZoneId (WIRE-005)", () => {
  it.each([
    ["Asia/Kolkata", "India Standard Time"],
    ["Asia/Calcutta", "India Standard Time"],
    ["America/New_York", "Eastern Standard Time"],
    ["US/Eastern", "Eastern Standard Time"],
    ["America/Indiana/Indianapolis", "US Eastern Standard Time"],
    ["Europe/London", "GMT Standard Time"],
    ["Australia/Sydney", "AUS Eastern Standard Time"],
    ["Etc/UTC", "UTC"],
    ["UTC", "UTC"],
  ])("maps %s to %s", (ianaZone, windows) => {
    expect(localWindowsTimeZoneId({ platform: "linux", ianaZone })).toBe(windows);
  });

  it("asks Windows for its own id", () => {
    expect(localWindowsTimeZoneId({ platform: "win32", windowsZone: () => "Pacific Standard Time\r\n" })).toBe("Pacific Standard Time");
  });

  it("names the zone and the flag when the zone has no Windows id", () => {
    const error = (() => {
      try {
        return localWindowsTimeZoneId({ platform: "linux", ianaZone: "Mars/Olympus" });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(UnmappedTimeZoneError);
    expect((error as Error).message).toBe(
      "The local time zone 'Mars/Olympus' has no Windows time zone id; pass the Windows id with --time-zone <id>.",
    );
  });

  it("resolves this machine's zone, or says it cannot", () => {
    try {
      expect(localWindowsTimeZoneId()).not.toBe("");
    } catch (error) {
      expect(error).toBeInstanceOf(UnmappedTimeZoneError);
    }
  });
});
