import type { HttpTransport } from "../client/transport.js";

/**
 * The host seam: what the engine's code asks of the machine it runs on. Type-only; no member has an implementation here, and no
 * existing call site reads these types yet (the code that does comes in later slices).
 *
 * Each member is named after the Node call it replaces, and its JSDoc lists the call sites of that call in the core, so that
 * the interface can be checked against the code with a grep. The CLI (`src/cli/**`), `oracle/` and `tools/` stay on Node and are
 * not listed. The line numbers are those of the commit that adds this file; later slices move them as they change the call sites.
 *
 * @spec HOST-200 HOST-201
 */

/** What `stat` says about a path. A link counts as what it points to. */
export interface HostStat {
  isFile: boolean;
  isDirectory: boolean;
}

/** One entry of a folder, as `readdirSync(path, { withFileTypes: true })` gives it: the kind of the entry itself, links not followed. */
export interface HostDirent {
  /** The name of the entry, with no folder. */
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

/**
 * The shape of an error a {@link HostFs} method throws (HOST-201): the Node errno `code`, and the `path` the failure names when the
 * host knows it. The file layer reads these two members and nothing else of an error.
 */
export interface HostFsError extends Error {
  code?: string;
  path?: string;
}

/** A file open for appending. */
export interface AppendHandle {
  /**
   * `writeSync(fd, bytes)`: appends the bytes, which are all written or an error is thrown.
   * Node call site: `export/run-log.ts:125`.
   */
  write(bytes: Uint8Array): void;
  /**
   * `closeSync(fd)`: closes the file. Called once, even when `write` threw.
   * Node call site: `export/run-log.ts:128`.
   */
  close(): void;
}

/**
 * The file system. Every method is synchronous (the engine's file calls sit in synchronous chains) and takes a host path, in
 * POSIX form: the Windows path rules stay in the file layer above this interface (MAN-033).
 *
 * A method that fails throws an error whose `code` is the Node errno code of the failure: `ENOENT`, `ENOTDIR`, `EISDIR`,
 * `EACCES`, `EPERM`, `EEXIST` or `EBUSY`. The file layer translates them to the .NET exceptions (`translateFileError` in
 * `io/host-path.ts`, `translateListError` in `import/package-files.ts`).
 *
 * @spec HOST-200 HOST-201
 */
export interface HostFs {
  /**
   * `statSync(path)`: follows links, and throws for a path that does not exist, as Node does.
   * Node call sites: `io/host-path.ts:134`, `io/windows-fs.ts:140` and `:154`, `import/package-files.ts:75` and `:85`.
   */
  stat(path: string): HostStat;
  /**
   * `readdirSync(path, { withFileTypes: true })`: the entries of a folder, without `.` and `..`, in the order the host lists them
   * (callers that need an order sort the names themselves). The kind of each entry is its own; a link is not followed (call
   * `stat` for that). The names alone, which `readdirSync(path)` returns, are the `name` of each entry.
   * Node call sites: `import/package-files.ts:64` (with types), `io/windows-fs.ts:146` (names only).
   */
  readdir(path: string): HostDirent[];
  /**
   * `readFileSync(path)`: the whole file.
   * Node call sites: `io/host-path.ts:181`, `import/package-files.ts:177`.
   */
  readFile(path: string): Uint8Array;
  /**
   * `writeFileSync(path, data)`: creates the file or truncates it, and writes the bytes. The folder must exist.
   * Node call sites: `io/host-path.ts:197`, `io/windows-fs.ts:280`.
   */
  writeFile(path: string, data: Uint8Array): void;
  /**
   * `mkdirSync(path)`: creates one folder, not its parents (no `recursive`), and throws `EEXIST` when the path exists.
   * Node call site: `io/windows-fs.ts:232`.
   */
  mkdir(path: string): void;
  /**
   * `rmSync(path, { recursive, force: false })`: removes a file or a folder; a missing path throws `ENOENT`.
   * Node call site: `io/windows-fs.ts:254`.
   */
  rm(path: string, options: { recursive: boolean }): void;
  /**
   * `existsSync(path)`: true when the path exists, whatever it is; never throws.
   * Node call site: `io/host-path.ts:159`.
   */
  exists(path: string): boolean;
  /**
   * `openSync(path, "a")`: opens the file for appending, creating it when it does not exist; the folder must exist. The handle
   * stands for the `writeSync` and `closeSync` that follow. The rule that a log file is held by one writer at a time stays in
   * `RunLog`, not in the host.
   * Node call site: `export/run-log.ts:101`.
   */
  openAppend(path: string): AppendHandle;
}

/**
 * The rest of the machine: the platform, the clock, the user, randomness and the scheduler. Absent members of a
 * `PathEnvironment` are filled from the default host of the running platform.
 *
 * @spec HOST-200
 */
export interface HostEnv {
  /**
   * `process.platform`: `"win32"`, or any other string, where anything but `"win32"` means POSIX rules.
   * Node call sites: `io/host-path.ts:118`, `:148`, `io/windows-fs.ts:75`, `export/run-log.ts:96`, `export/manifest-selection.ts:26`,
   * `import/package-files.ts:21` and `:51`, `io/temp-path.ts:16`, `import/import-helper.ts:30` and `:75`, `client/timezone.ts:27`.
   */
  readonly platform: string;
  /**
   * `process.cwd()`: the current directory, a Windows path when the platform is `win32`.
   * Node call sites: `io/host-path.ts:65`, `:149`, `:150`, `io/windows-fs.ts:74`, `export/run-log.ts:96`, `export/output-folder.ts:135`.
   */
  cwd(): string;
  /**
   * `os.tmpdir()`: the folder for temporary files, with no trailing separator.
   * Node call site: `io/temp-path.ts:14`.
   */
  tmpdir(): string;
  /**
   * `os.userInfo().username`, `os.hostname()` and, on Windows, `process.env.USERDOMAIN`: the account the run is made under. `user`
   * is the account name, `machine` the name of the computer, and `domain` the Windows domain when there is one (an empty or absent
   * `domain` means the machine name is used, as `defaultOsUser` does).
   * Node call sites: `import/import-helper.ts:31` (`userInfo`), `:33` (`USERDOMAIN`), `:34` (`hostname`).
   */
  osUser(): { user: string; machine: string; domain?: string };
  /**
   * `os.availableParallelism()`: the number of logical processors, at least 1.
   * Node call site: `export/import-export-manager.ts:54`.
   */
  availableParallelism(): number;
  /**
   * `process.hrtime.bigint()`: a monotonic clock in nanoseconds, with an arbitrary origin.
   * Node call sites: `import/import-run.ts:222`, `:224` and `:226`.
   */
  monotonicNs(): bigint;
  /**
   * `crypto.randomBytes(n)`: `n` random bytes.
   * Node call site: `io/temp-path.ts:24`.
   */
  randomBytes(n: number): Uint8Array;
  /**
   * `crypto.randomUUID()`: a version 4 UUID in its lower-case hyphenated form.
   * Node call site: `db-patches/apply.ts:107`.
   */
  randomUuid(): string;
  /**
   * `new Promise((resolve) => setImmediate(resolve))`: resolves after the other work that is ready has had a turn.
   * Node call site: `export/output-folder.ts:111`.
   */
  yieldTurn(): Promise<void>;
  /**
   * The Windows time zone id of the machine (`tzutil /g` on Windows, the CLDR mapping of the local IANA zone elsewhere), or
   * undefined when the host cannot say. The host's own answer, not a setting of the run.
   * Node call sites: `client/timezone.ts:27` (`tzutil`), `:30` (`Intl.DateTimeFormat().resolvedOptions().timeZone`).
   */
  windowsTimeZoneId(): string | undefined;
  /**
   * `Intl.DateTimeFormat().resolvedOptions().locale`: the culture of the process, such as `en-US`.
   * Node call site: `export/run-log.ts:35`.
   */
  locale(): string;
}

/**
 * A host: a file system, an environment and, for a run that talks to a server, a transport. `transport` is absent for a host that
 * leaves it to the caller, who passes an `HttpTransport` to the connection as before.
 *
 * @spec HOST-200
 */
export interface Host {
  fs: HostFs;
  env: HostEnv;
  transport?: HttpTransport;
}
