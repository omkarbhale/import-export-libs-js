import { describe, expect, it } from "vitest";
import { localWindowsTimeZoneId } from "../client/timezone.js";
import { defaultOsUser } from "../import/import-helper.js";
import { pathGetRandomFileName, pathGetTempPath } from "../io/temp-path.js";
import { directoryCreateDirectory, directoryExists } from "../io/windows-fs.js";
import { PathNotUsableError } from "../io/errors.js";
import { toHostPath } from "../io/host-path.js";
import * as nodeDefaultHost from "../host/default-host.js";
import * as browserDefaultHost from "../host/default-host.browser.js";
import type { HostFs } from "../host/types.js";
import {
  type BrowserGlobals,
  type CryptoLike,
  type MessageChannelConstructorLike,
  createBrowserEnv,
  createBrowserHost,
  noFileSystem,
  unmountedFs,
} from "./host.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A `crypto` that fills with a counter, so that a test sees which bytes came from where, and counts its calls. */
function counterCrypto(withUuid: boolean): CryptoLike & { calls: number[] } {
  const calls: number[] = [];
  let next = 0;
  return {
    calls,
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      calls.push(array.byteLength);
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = next++ & 0xff;
      return array;
    },
    ...(withUuid ? { randomUUID: () => "11111111-2222-4333-8444-555555555555" } : {}),
  };
}

/** @spec HOST-243 */
describe("HOST-243: the browser host's values", () => {
  it("is a POSIX platform with the root as the current directory and /tmp as the temporary folder", () => {
    const env = createBrowserEnv();
    expect(env.platform).toBe("browser");
    expect(env.cwd()).toBe("/");
    expect(env.tmpdir()).toBe("/tmp");
    expect(createBrowserEnv({ cwd: "/work" }).cwd()).toBe("/work");
    expect(pathGetTempPath({ host: env })).toBe("/tmp/");
  });

  it("names the account `browser\\user` for 12.0 and 14.0.7 and the user alone for 14.35 (IMP-452)", () => {
    const env = createBrowserEnv({ osUser: "alice" });
    expect(env.osUser()).toEqual({ user: "alice", machine: "browser" });
    expect(defaultOsUser(undefined, "14.0.7", env)).toBe("browser\\alice");
    expect(defaultOsUser(undefined, "12.0", env)).toBe("browser\\alice");
    expect(defaultOsUser(undefined, "14.35", env)).toBe("alice");
    // a placeholder when the caller gives none, so that nothing throws
    expect(defaultOsUser(undefined, "14.0.7", createBrowserEnv())).toBe("browser\\user");
  });

  describe("availableParallelism", () => {
    const of = (navigator: BrowserGlobals["navigator"]) => createBrowserEnv({ globals: { navigator } }).availableParallelism();
    it("is navigator.hardwareConcurrency when it is a whole number of at least 1", () => {
      expect(of({ hardwareConcurrency: 8 })).toBe(8);
      expect(of({ hardwareConcurrency: 1 })).toBe(1);
    });
    it("is 4 when the page gives none, or an unusable one", () => {
      expect(of({})).toBe(4);
      expect(of({ hardwareConcurrency: 0 })).toBe(4);
      expect(of({ hardwareConcurrency: 2.5 })).toBe(4);
      expect(of({ hardwareConcurrency: Number.NaN })).toBe(4);
    });
  });

  it("monotonicNs is performance.now() in nanoseconds, rounded, and does not go back", () => {
    let now = 1.5;
    const env = createBrowserEnv({ globals: { performance: { now: () => now } } });
    expect(env.monotonicNs()).toBe(1_500_000n);
    now = 1.5000004;
    expect(env.monotonicNs()).toBe(1_500_000n);
    now = 1234.567891;
    expect(env.monotonicNs()).toBe(1_234_567_891n);
    expect(typeof createBrowserEnv().monotonicNs()).toBe("bigint");
    const a = createBrowserEnv().monotonicNs();
    expect(createBrowserEnv().monotonicNs() >= a).toBe(true);
  });

  describe("randomBytes", () => {
    it("returns n bytes from crypto.getRandomValues", () => {
      const crypto = counterCrypto(false);
      const bytes = createBrowserEnv({ globals: { crypto } }).randomBytes(5);
      expect(Array.from(bytes)).toEqual([0, 1, 2, 3, 4]);
      expect(createBrowserEnv({ globals: { crypto } }).randomBytes(0)).toEqual(new Uint8Array(0));
    });
    it("fills in pieces of at most 65 536 bytes, the quota of one call", () => {
      const crypto = counterCrypto(false);
      const bytes = createBrowserEnv({ globals: { crypto } }).randomBytes(65_536 * 2 + 10);
      expect(bytes.length).toBe(65_536 * 2 + 10);
      expect(crypto.calls).toEqual([65_536, 65_536, 10]);
      expect(bytes[65_536]).toBe(65_536 & 0xff);
      expect(bytes[65_536 * 2 + 9]).toBe((65_536 * 2 + 9) & 0xff);
    });
    it("uses the real crypto of the runtime when none is given, and the draws differ", () => {
      const env = createBrowserEnv();
      expect(env.randomBytes(16)).not.toEqual(env.randomBytes(16));
    });
    it("gives pathGetRandomFileName its shape (xxxxxxxx.xxx over a-z0-5)", () => {
      const env = createBrowserEnv();
      for (let i = 0; i < 200; i += 1) expect(pathGetRandomFileName({ host: env })).toMatch(/^[a-z0-5]{8}\.[a-z0-5]{3}$/);
    });
    it("throws a readable error where the runtime has no Web Crypto", () => {
      const env = createBrowserEnv({ globals: { crypto: undefined } });
      const saved = Object.getOwnPropertyDescriptor(globalThis, "crypto");
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
      try {
        expect(() => env.randomBytes(1)).toThrow(/no Web Crypto/);
      } finally {
        if (saved) Object.defineProperty(globalThis, "crypto", saved);
      }
    });
  });

  describe("randomUuid", () => {
    it("is crypto.randomUUID() when the page has it", () => {
      expect(createBrowserEnv({ globals: { crypto: counterCrypto(true) } }).randomUuid()).toBe("11111111-2222-4333-8444-555555555555");
    });
    it("is built from random bytes as a version 4 UUID when the page lacks randomUUID", () => {
      const env = createBrowserEnv({ globals: { crypto: counterCrypto(false) } });
      // the bytes 00 01 02 … 0f with the version and variant bits set
      expect(env.randomUuid()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    });
    it("matches the version 4 shape for every draw, with and without randomUUID", () => {
      const without = createBrowserEnv({ globals: { crypto: { getRandomValues: (array) => globalThis.crypto.getRandomValues(array) } } });
      const withNative = createBrowserEnv();
      const seen = new Set<string>();
      for (let i = 0; i < 2000; i += 1) {
        const a = without.randomUuid();
        const b = withNative.randomUuid();
        expect(a).toMatch(UUID_V4);
        expect(b).toMatch(UUID_V4);
        seen.add(a);
      }
      expect(seen.size).toBe(2000);
    });
    it("sets the version and variant bits whatever the random bytes are", () => {
      for (const fill of [0x00, 0xff]) {
        const crypto: CryptoLike = { getRandomValues: (array) => (new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(fill), array) };
        const uuid = createBrowserEnv({ globals: { crypto } }).randomUuid();
        expect(uuid).toMatch(UUID_V4);
      }
    });
  });

  describe("yieldTurn", () => {
    it("waits for a MessageChannel round trip and closes both ports", async () => {
      const log: string[] = [];
      class FakeChannel {
        readonly port1 = {
          onmessage: null as ((event: unknown) => void) | null,
          postMessage: () => undefined,
          close: () => void log.push("close1"),
        };
        readonly port2 = {
          onmessage: null as ((event: unknown) => void) | null,
          postMessage: () => {
            log.push("post");
            queueMicrotask(() => this.port1.onmessage?.({}));
          },
          close: () => void log.push("close2"),
        };
      }
      const env = createBrowserEnv({ globals: { messageChannel: FakeChannel as MessageChannelConstructorLike } });
      await env.yieldTurn();
      expect(log).toEqual(["post", "close1", "close2"]);
    });
    it("lets a task that is already queued run first, with the real MessageChannel of the runtime", async () => {
      const order: string[] = [];
      const env = createBrowserEnv();
      setTimeout(() => order.push("timer"), 0);
      const turn = env.yieldTurn().then(() => order.push("yield"));
      order.push("sync");
      await turn;
      expect(order[0]).toBe("sync");
      expect(order).toContain("yield");
    });
    it("serves overlapping yields, each with its own channel", async () => {
      const env = createBrowserEnv();
      await Promise.all([env.yieldTurn(), env.yieldTurn(), env.yieldTurn()]);
    });
    it("falls back to setTimeout(0) when the page has no MessageChannel", async () => {
      const waits: number[] = [];
      const env = createBrowserEnv({
        globals: { messageChannel: null, setTimeout: (callback, milliseconds) => (waits.push(milliseconds), callback()) },
      });
      await env.yieldTurn();
      expect(waits).toEqual([0]);
    });
  });

  it("windowsTimeZoneId is undefined, so the CLDR mapping of the IANA zone answers (HOST-242)", () => {
    const env = createBrowserEnv();
    expect(env.windowsTimeZoneId()).toBeUndefined();
    expect(localWindowsTimeZoneId({ host: env, ianaZone: "Europe/Paris" })).toBe("Romance Standard Time");
    expect(localWindowsTimeZoneId({ host: env, ianaZone: "Asia/Calcutta" })).toBe("India Standard Time");
  });

  it("locale is the resolved locale of Intl", () => {
    expect(createBrowserEnv().locale()).toBe(Intl.DateTimeFormat().resolvedOptions().locale);
  });
});

/** @spec HOST-243 */
describe("HOST-243: createBrowserHost", () => {
  it("is the environment, the file system and the transport of the options", () => {
    const fs = {} as HostFs;
    const transport = { send: () => Promise.reject(new Error("unused")) };
    const host = createBrowserHost({ fs, transport, cwd: "/w", osUser: "bob" });
    expect(host.fs).toBe(fs);
    expect(host.transport).toBe(transport);
    expect(host.env.platform).toBe("browser");
    expect(host.env.cwd()).toBe("/w");
    expect(host.env.osUser().user).toBe("bob");
  });

  it("has the fetch transport and no file system by default", () => {
    const host = createBrowserHost();
    expect(typeof host.transport?.send).toBe("function");
    expect(host.fs).toBe(unmountedFs);
  });

  it("fails every file call of a host with no file system, exists included, with ENOSYS and a message that says what to do", () => {
    const calls: Array<[string, () => unknown]> = [
      ["stat", () => unmountedFs.stat("/x")],
      ["readdir", () => unmountedFs.readdir("/x")],
      ["readFile", () => unmountedFs.readFile("/x")],
      ["writeFile", () => unmountedFs.writeFile("/x", new Uint8Array())],
      ["mkdir", () => unmountedFs.mkdir("/x")],
      ["rm", () => unmountedFs.rm("/x", { recursive: false })],
      ["exists", () => unmountedFs.exists("/x")],
      ["openAppend", () => unmountedFs.openAppend("/x")],
    ];
    for (const [name, call] of calls) {
      expect(call, name).toThrow(/pass `fs`/);
      try {
        call();
      } catch (error) {
        expect((error as { code?: string }).code, name).toBe("ENOSYS");
      }
    }
    expect(noFileSystem().code).toBe("ENOSYS");
  });
});

/** @spec HOST-243 */
describe("HOST-243: default-host.browser", () => {
  it("exports what default-host does", () => {
    expect(Object.keys(browserDefaultHost).sort()).toEqual(Object.keys(nodeDefaultHost).sort());
  });

  it("answers one browser host, made on first use", () => {
    const host = browserDefaultHost.defaultHost();
    expect(browserDefaultHost.defaultHost()).toBe(host);
    expect(host.env.platform).toBe("browser");
    expect(browserDefaultHost.defaultHostEnv()).toBe(host.env);
    expect(browserDefaultHost.defaultTransport()).toBe(host.transport);
    expect(host.transport).toBeDefined();
  });
});

/** @spec HOST-216 HOST-243 */
describe("HOST-216: a drive or a UNC path is refused on the browser platform", () => {
  const env = { host: createBrowserEnv() };

  it("refuses a drive letter and a UNC share before any file is touched", () => {
    for (const path of ["C:\\out", "c:rel", "D:/x", "\\\\server\\share\\x"]) {
      expect(() => toHostPath(path, env), path).toThrow(PathNotUsableError);
    }
  });

  it("takes a relative path, and a path rooted by a backslash, as POSIX", () => {
    expect(toHostPath("out\\sub\\f.xml", env)).toBe("out/sub/f.xml");
    expect(toHostPath("\\out\\f.xml", env)).toBe("/out/f.xml");
    expect(toHostPath("../x", env)).toBe("../x");
  });

  it("refuses them in the folder operations too, through the path model, with the path in the message", () => {
    const touched: string[] = [];
    const fs = new Proxy({}, { get: (_, name) => () => (touched.push(String(name)), false) }) as unknown as HostFs;
    const withFs = { ...env, fs };
    expect(() => directoryCreateDirectory("C:\\out", withFs)).toThrow(PathNotUsableError);
    expect(() => directoryExists("C:\\out", withFs)).toThrow(/C:\\out/);
    expect(touched).toEqual([]);
  });
});
