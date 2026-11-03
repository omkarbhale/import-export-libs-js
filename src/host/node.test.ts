import { randomBytes } from "node:crypto";
import { availableParallelism, hostname, tmpdir, userInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { localWindowsTimeZoneId } from "../client/timezone.js";
import { defaultHostEnv } from "./default-host.js";
import { nodeHost } from "./node.js";

/** @spec HOST-203 HOST-241 */
describe("HOST-203: nodeHost wraps the Node call each member replaces", () => {
  it("is the default environment of this platform", () => {
    expect(defaultHostEnv()).toBe(nodeHost);
  });

  it("platform, cwd and tmpdir are process.platform, process.cwd() and os.tmpdir()", () => {
    expect(nodeHost.platform).toBe(process.platform);
    expect(nodeHost.cwd()).toBe(process.cwd());
    expect(nodeHost.tmpdir()).toBe(tmpdir());
  });

  it("osUser is os.userInfo().username, os.hostname() and process.env.USERDOMAIN", () => {
    const saved = process.env.USERDOMAIN;
    try {
      process.env.USERDOMAIN = "CORP";
      expect(nodeHost.osUser()).toEqual({ user: userInfo().username, machine: hostname(), domain: "CORP" });
      delete process.env.USERDOMAIN;
      const without = nodeHost.osUser();
      expect(without).toEqual({ user: userInfo().username, machine: hostname() });
      expect("domain" in without).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.USERDOMAIN;
      else process.env.USERDOMAIN = saved;
    }
  });

  it("availableParallelism is os.availableParallelism()", () => {
    expect(nodeHost.availableParallelism()).toBe(availableParallelism());
    expect(nodeHost.availableParallelism()).toBeGreaterThanOrEqual(1);
  });

  it("monotonicNs is process.hrtime.bigint(), and never goes back (HOST-241)", () => {
    const first = nodeHost.monotonicNs();
    const second = nodeHost.monotonicNs();
    const third = process.hrtime.bigint();
    expect(typeof first).toBe("bigint");
    expect(second >= first).toBe(true);
    expect(third >= second).toBe(true);
  });

  it("randomBytes gives n bytes, as crypto.randomBytes does", () => {
    for (const n of [0, 1, 11, 64]) {
      const bytes = nodeHost.randomBytes(n);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(n);
      expect(randomBytes(n).length).toBe(n);
    }
    expect(Buffer.from(nodeHost.randomBytes(32)).equals(Buffer.from(nodeHost.randomBytes(32)))).toBe(false);
  });

  it("randomUuid is a version 4 UUID in lower-case hyphenated form, as crypto.randomUUID is", () => {
    const uuid = nodeHost.randomUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nodeHost.randomUuid()).not.toBe(uuid);
  });

  it("yieldTurn resolves after the work that is ready, as setImmediate does", async () => {
    const order: string[] = [];
    setImmediate(() => order.push("immediate"));
    const turn = nodeHost.yieldTurn().then(() => order.push("turn"));
    queueMicrotask(() => order.push("microtask"));
    await turn;
    expect(order).toEqual(["microtask", "immediate", "turn"]);
  });

  it("windowsTimeZoneId is the machine's time zone id, or undefined when it cannot say", () => {
    let expected: string | undefined;
    try {
      expected = localWindowsTimeZoneId();
    } catch {
      expected = undefined;
    }
    expect(nodeHost.windowsTimeZoneId()).toBe(expected);
  });

  it("locale is Intl.DateTimeFormat().resolvedOptions().locale", () => {
    expect(nodeHost.locale()).toBe(Intl.DateTimeFormat().resolvedOptions().locale);
  });
});
