import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CItemHelper } from "../client/item-helper.js";
import type { ServerConnection } from "../client/innovator.js";
import { SUExportContext } from "../export/export-context.js";
import { ImportExportManager, defaultParallelism } from "../export/import-export-manager.js";
import { createMessagesFactory } from "../export/messages.js";
import { createOutputDir } from "../export/output-folder.js";
import { currentCultureDateTime, processCulture } from "../export/run-log.js";
import { defaultOsUser } from "../import/import-helper.js";
import { envOf } from "../io/host-path.js";
import { pathGetRandomFileName, pathGetTempPath } from "../io/temp-path.js";
import { nodeHost } from "./node.js";
import type { HostEnv } from "./types.js";

/**
 * A run with a fake host environment uses it and never reads the process (HOST-203): every member answers a value no real machine
 * would, and a spy on the process calls fails the test when one is made.
 * @spec HOST-203 HOST-241
 */
function fakeHost(overrides: Partial<HostEnv> = {}): HostEnv & { calls: string[] } {
  const calls: string[] = [];
  const spy = <T>(name: string, value: T) => () => {
    calls.push(name);
    return value;
  };
  return {
    platform: "linux",
    cwd: spy("cwd", "/fake/cwd"),
    tmpdir: spy("tmpdir", "/fake/tmp"),
    osUser: spy("osUser", { user: "alice", machine: "BOX", domain: "CORP" }),
    availableParallelism: spy("availableParallelism", 7),
    monotonicNs: spy("monotonicNs", 1n),
    randomBytes: (n) => {
      calls.push("randomBytes");
      return Uint8Array.from({ length: n }, (_, index) => index);
    },
    randomUuid: spy("randomUuid", "00000000-0000-4000-8000-000000000000"),
    yieldTurn: () => {
      calls.push("yieldTurn");
      return Promise.resolve();
    },
    windowsTimeZoneId: spy("windowsTimeZoneId", "UTC"),
    locale: spy("locale", "en-IN"),
    ...overrides,
    calls,
  };
}

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function noProcess() {
  return [vi.spyOn(process, "cwd"), vi.spyOn(process.hrtime, "bigint")];
}

describe("HOST-203: a fake HostEnv is used and the process is not read", () => {
  it("envOf takes the platform and the current directory from the host, and the environment's own over them", () => {
    const spies = noProcess();
    const host = fakeHost({ platform: "darwin" });
    expect(envOf({ host })).toMatchObject({ platform: "darwin", cwd: "/fake/cwd" });
    expect(envOf({ host, platform: "win32", cwd: "C:\\here" })).toMatchObject({ platform: "win32", cwd: "C:\\here" });
    // the host is asked for the directory only when the environment has none
    const asked = fakeHost();
    expect(envOf({ host: asked, cwd: "/mine" }).cwd).toBe("/mine");
    expect(asked.calls).toEqual([]);
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it("createOutputDir resolves a relative folder against the host's current directory", () => {
    const root = mkdtempSync(join(tmpdir(), "host-env-"));
    roots.push(root);
    const host = fakeHost({ cwd: () => root });
    const path = createOutputDir("work", "pkg", { host });
    expect(path).toBe("work\\pkg\\Import");
    // the folder is made below the host's directory, which is not the process's
    expect(existsSync(join(root, "work", "pkg", "Import"))).toBe(true);
    expect(existsSync(join(process.cwd(), "work"))).toBe(false);
    // `node:path` still reads `process.cwd()` inside `win32.resolve` for this POSIX-form directory; the portable path (ticket 03) removes it
  });

  it("pathGetTempPath uses the host's temp folder and the platform's separator; pathGetRandomFileName its random bytes", () => {
    const spies = noProcess();
    const host = fakeHost();
    expect(pathGetTempPath({ host })).toBe("/fake/tmp/");
    expect(pathGetTempPath({ host: fakeHost({ tmpdir: () => "C:\\Fake\\Tmp" }), platform: "win32" })).toBe("C:\\Fake\\Tmp\\");
    expect(pathGetTempPath({ host: fakeHost({ platform: "win32", tmpdir: () => "C:\\Fake\\Tmp" }) })).toBe("C:\\Fake\\Tmp\\");
    // bytes 0..10 map to characters 0..10 of the alphabet, with the dot after the eighth
    expect(pathGetRandomFileName({ host })).toBe("abcdefgh.ijk");
    expect(host.calls).toContain("randomBytes");
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it("defaultOsUser reads the account from the host: DOMAIN or machine with the user, the user alone in 14.35", () => {
    const host = fakeHost();
    expect(defaultOsUser("win32", "14.0.7", host)).toBe("CORP\\alice");
    expect(defaultOsUser("linux", "14.0.7", host)).toBe("BOX\\alice");
    expect(defaultOsUser(undefined, "14.0.7", host)).toBe("BOX\\alice");
    expect(defaultOsUser(undefined, "14.0.7", fakeHost({ platform: "win32" }))).toBe("CORP\\alice");
    expect(defaultOsUser("win32", "14.0.7", fakeHost({ osUser: () => ({ user: "bob", machine: "M", domain: "" }) }))).toBe("M\\bob");
    expect(defaultOsUser("win32", "14.35", host)).toBe("alice");
  });

  it("a 14.35 export is bound by the host's processor count, and the option still wins", () => {
    const host = fakeHost();
    expect(defaultParallelism(host)).toBe(7);
    const helper = new CItemHelper({} as ServerConnection, { engine: "14.35" });
    const messages = createMessagesFactory({ engine: "14.35" });
    const parallelism = (options: ConstructorParameters<typeof ImportExportManager>[3]): number =>
      (new ImportExportManager(new SUExportContext(), messages, helper, options) as unknown as { parallelism: number }).parallelism;
    expect(parallelism({ host })).toBe(7);
    expect(parallelism({ host, parallelism: 2 })).toBe(2);
  });

  it("the process culture is the host's locale, and a given culture is not asked for", () => {
    const host = fakeHost();
    expect(processCulture(host)).toBe("en-IN");
    expect(currentCultureDateTime(new Date(2024, 0, 5, 14, 3, 9), processCulture(host))).toBe("05-01-2024 14:03:09");
    expect(processCulture()).toBe(nodeHost.locale());
  });
});
