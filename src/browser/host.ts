import type { HttpTransport } from "../client/transport.js";
import type { AppendHandle, Host, HostEnv, HostFs, HostFsError, HostStat } from "../host/types.js";
import { createFetchTransport } from "./fetch-transport.js";

/**
 * The browser's host: the {@link HostEnv} a page, a Worker or a test under Node gives the engine, and the {@link Host} that holds
 * it with a file system and a transport (HOST-243). It imports nothing from Node and reads the page's globals only through the
 * members of {@link BrowserGlobals}, which a test replaces with fakes.
 *
 * @spec HOST-200 HOST-243
 */

/** The part of `navigator` the host reads: `hardwareConcurrency`, which a browser may leave out. */
export interface NavigatorLike {
  readonly hardwareConcurrency?: number | undefined;
}

/** The part of `performance` the host reads: the monotonic clock in milliseconds. */
export interface PerformanceLike {
  now(): number;
}

/** The part of `crypto` the host reads. `randomUUID` exists only in a secure context, so it may be absent. */
export interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID?: (() => string) | undefined;
}

/** The part of a `MessagePort` the yield uses. */
export interface MessagePortLike {
  onmessage: ((event: unknown) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

/** The part of the `MessageChannel` constructor the yield uses. */
export type MessageChannelConstructorLike = new () => { readonly port1: MessagePortLike; readonly port2: MessagePortLike };

/** The part of `setTimeout` the fallback of the yield uses. */
export type SetTimeoutLike = (callback: () => void, milliseconds: number) => unknown;

/**
 * The ambient objects the host reads, each replaceable. A member left out is the page's own global of that name, read when it is
 * used, not when the host is made. `messageChannel` may be `null` to say the page has none, which is how a test reaches the
 * `setTimeout` fallback of `yieldTurn`.
 */
export interface BrowserGlobals {
  navigator?: NavigatorLike | undefined;
  performance?: PerformanceLike | undefined;
  crypto?: CryptoLike | undefined;
  messageChannel?: MessageChannelConstructorLike | null | undefined;
  setTimeout?: SetTimeoutLike | undefined;
}

/** What the host takes from a caller. Every member is optional. */
export interface BrowserHostOptions {
  /**
   * The current directory of the engine's relative paths, a POSIX path. Default `"/"`.
   */
  cwd?: string;
  /**
   * The account the audit row's `os_user` names (IMP-452), the user part of it: `<machine>\<user>` for the engines that write the
   * machine, and the user alone for 14.35. The machine is `"browser"`. A caller that knows the Aras login name passes it; the
   * default, `"user"`, is a placeholder so that a run never throws for the want of one.
   */
  osUser?: string;
  /**
   * The file system the run reads and writes. A host made without one has none: every file call fails with the error of
   * {@link noFileSystem}, and the caller mounts a file system (a `MemoryVfs`) first.
   */
  fs?: HostFs;
  /** The transport of a run that talks to a server. Default: {@link createFetchTransport} with its defaults. */
  transport?: HttpTransport;
  /** The ambient objects, for tests. */
  globals?: BrowserGlobals;
}

/** The members of {@link HostEnv} with the platform written down: the browser's host environment. */
export interface BrowserEnv extends HostEnv {
  readonly platform: "browser";
}

/** `hardwareConcurrency` when it is a whole number of at least 1, else 4 (HOST-243). */
const DEFAULT_PARALLELISM = 4;

/** `crypto.getRandomValues` fills at most this many bytes in one call (the Web Crypto quota). */
const RANDOM_QUOTA = 65_536;

/** A page's global of this name, or undefined where the platform has none. */
function ambient<T>(name: string): T | undefined {
  return (globalThis as Record<string, unknown>)[name] as T | undefined;
}

/**
 * The error a file call of a host with no file system fails with: not an errno of {@link HostFs} on purpose, so that the file
 * layer does not turn it into a .NET exception for a file that is "missing", and the message says what to do.
 */
export function noFileSystem(): HostFsError {
  return Object.assign(new Error("No file system is mounted: pass `fs` (a MemoryVfs) to createBrowserHost."), { code: "ENOSYS" });
}

/** The file system of a host made without one (HOST-243): each call, `exists` included, fails with {@link noFileSystem}. */
export const unmountedFs: HostFs = {
  stat(): HostStat {
    throw noFileSystem();
  },
  readdir() {
    throw noFileSystem();
  },
  readFile(): Uint8Array {
    throw noFileSystem();
  },
  writeFile() {
    throw noFileSystem();
  },
  mkdir() {
    throw noFileSystem();
  },
  rm() {
    throw noFileSystem();
  },
  exists(): boolean {
    throw noFileSystem();
  },
  openAppend(): AppendHandle {
    throw noFileSystem();
  },
};

/**
 * The browser's {@link HostEnv}. `platform` is `"browser"`, which every `platform === "win32"` test of the core reads as POSIX
 * (HOST-243); the current directory is `/` and the temporary folder `/tmp`, in the file system the caller mounts.
 *
 * @spec HOST-200 HOST-243
 */
export function createBrowserEnv(options: BrowserHostOptions = {}): BrowserEnv {
  const globals = options.globals ?? {};
  const cwd = options.cwd ?? "/";
  const user = options.osUser ?? "user";
  const crypto = (): CryptoLike => {
    const found = globals.crypto ?? ambient<CryptoLike>("crypto");
    if (found === undefined) throw new Error("This environment has no Web Crypto (crypto.getRandomValues).");
    return found;
  };
  const randomBytes = (n: number): Uint8Array => {
    const bytes = new Uint8Array(n);
    const source = crypto();
    for (let offset = 0; offset < n; offset += RANDOM_QUOTA) source.getRandomValues(bytes.subarray(offset, Math.min(n, offset + RANDOM_QUOTA)));
    return bytes;
  };
  return {
    platform: "browser",
    cwd: () => cwd,
    tmpdir: () => "/tmp",
    osUser: () => ({ user, machine: "browser" }),
    availableParallelism: () => {
      const cores = (globals.navigator ?? ambient<NavigatorLike>("navigator"))?.hardwareConcurrency;
      return typeof cores === "number" && Number.isInteger(cores) && cores >= 1 ? cores : DEFAULT_PARALLELISM;
    },
    monotonicNs: () => {
      const clock = globals.performance ?? ambient<PerformanceLike>("performance");
      if (clock === undefined) throw new Error("This environment has no monotonic clock (performance.now).");
      return BigInt(Math.round(clock.now() * 1e6));
    },
    randomBytes,
    randomUuid: () => {
      const source = crypto();
      if (typeof source.randomUUID === "function") return source.randomUUID();
      return uuidV4(randomBytes(16));
    },
    yieldTurn: () => {
      const Channel = globals.messageChannel === undefined ? ambient<MessageChannelConstructorLike>("MessageChannel") : globals.messageChannel;
      if (Channel === undefined || Channel === null) {
        const timer = globals.setTimeout ?? ambient<SetTimeoutLike>("setTimeout");
        return new Promise<void>((resolve) => {
          if (timer === undefined) resolve();
          else timer(resolve, 0);
        });
      }
      return new Promise<void>((resolve) => {
        const channel = new Channel();
        channel.port1.onmessage = () => {
          channel.port1.onmessage = null;
          channel.port1.close();
          channel.port2.close();
          resolve();
        };
        channel.port2.postMessage(null);
      });
    },
    windowsTimeZoneId: () => undefined,
    locale: () => Intl.DateTimeFormat().resolvedOptions().locale,
  };
}

/** RFC 4122 version 4: sixteen random bytes with the version and variant bits set, as lower-case hyphenated hexadecimal. */
function uuidV4(bytes: Uint8Array): string {
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The browser's {@link Host}: {@link createBrowserEnv}, the file system of the options (none by default, {@link unmountedFs}) and
 * the transport of the options (the fetch transport by default).
 *
 * @spec HOST-200 HOST-243
 */
export function createBrowserHost(options: BrowserHostOptions = {}): Host {
  return { fs: options.fs ?? unmountedFs, env: createBrowserEnv(options), transport: options.transport ?? createFetchTransport() };
}
