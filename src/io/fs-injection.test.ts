import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodeFs } from "../host/node-fs.js";
import type { HostFs } from "../host/types.js";
import { DirectoryNotFoundException, FileNotFoundException, UnauthorizedAccessException } from "./errors.js";
import { fileExists, readFileBytes, translateFileError, writeFileBytes } from "./host-path.js";
import type { PathEnvironment } from "./host-path.js";
import { directoryCreateDirectory, directoryDelete, directoryExists, fileWriteAllText, writeVolumeFile } from "./windows-fs.js";

/**
 * Every file the file layer touches goes through the environment's `HostFs` (HOST-210). The spy below wraps `nodeFs` and records
 * each call. The folder `/virtual` it serves is a folder of a temporary directory that the spy maps it to, and `/virtual` does not
 * exist on the disk: a path that reached `node:fs` without the spy would fail with `ENOENT`, so an operation that succeeds on one
 * went through the spy, and the record says which calls it made.
 *
 * @spec HOST-210 HOST-211
 */
const VIRTUAL = "/virtual";
const work = mkdtempSync(join(tmpdir(), "libsjs-fsinj-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

interface Call {
  op: keyof HostFs;
  path: string;
}

function spyFs(): { fs: HostFs; calls: Call[] } {
  const calls: Call[] = [];
  const real = (path: string): string => {
    if (path !== VIRTUAL && !path.startsWith(`${VIRTUAL}/`)) throw Object.assign(new Error(`not a virtual path: ${path}`), { code: "ENOENT", path });
    return join(work, path.slice(VIRTUAL.length));
  };
  const spy = <Args extends [string, ...unknown[]], Result>(op: keyof HostFs, call: (path: string, ...rest: Args extends [string, ...infer R] ? R : never) => Result) =>
    (...args: Args): Result => {
      calls.push({ op, path: args[0] });
      const [path, ...rest] = args;
      // the errors of the disk name the real path; the layer must not depend on that, so the spy puts the virtual one back
      try {
        return (call as (path: string, ...rest: unknown[]) => Result)(real(path), ...rest);
      } catch (error) {
        const failure = error as { path?: string };
        if (typeof failure.path === "string" && failure.path.startsWith(work)) failure.path = join(VIRTUAL, relative(work, failure.path)).replace(/\\/g, "/");
        throw error;
      }
    };
  const fs: HostFs = {
    stat: spy("stat", (path: string) => nodeFs.stat(path)),
    readdir: spy("readdir", (path: string) => nodeFs.readdir(path)),
    readFile: spy("readFile", (path: string) => nodeFs.readFile(path)),
    writeFile: spy("writeFile", (path: string, data: Uint8Array) => nodeFs.writeFile(path, data)),
    mkdir: spy("mkdir", (path: string) => nodeFs.mkdir(path)),
    rm: spy("rm", (path: string, options: { recursive: boolean }) => nodeFs.rm(path, options)),
    exists: spy("exists", (path: string) => nodeFs.exists(path)),
    openAppend: spy("openAppend", (path: string) => nodeFs.openAppend(path)),
  };
  return { fs, calls };
}

let calls: Call[];
let env: PathEnvironment;

beforeEach(() => {
  const spy = spyFs();
  calls = spy.calls;
  // `/virtual` is the root of the volume, and the current directory is a folder of it
  env = { platform: "linux", cwd: `${VIRTUAL}/cwd`, fs: spy.fs };
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, "cwd"), { recursive: true });
});

afterEach(() => vi.restoreAllMocks());

const ops = (): Set<string> => new Set(calls.map((call) => call.op));
const onDisk = (...parts: string[]): string => join(work, ...parts);

describe("HOST-210: the folder the spy serves is not on the disk", () => {
  it("has no /virtual, so a touch of node:fs that skips the spy cannot succeed", () => {
    expect(existsSync(VIRTUAL)).toBe(false);
  });
});

describe("HOST-210: io/host-path.ts goes through environment.fs", () => {
  it("fileExists asks the spy, and answers false for a folder and a missing path", () => {
    writeFileBytes(`${VIRTUAL}/f.txt`, Buffer.from("x"), env);
    calls.length = 0;
    expect(fileExists(`${VIRTUAL}/f.txt`, env)).toBe(true);
    expect(fileExists(`${VIRTUAL}/cwd`, env)).toBe(false);
    expect(fileExists(`${VIRTUAL}/missing.txt`, env)).toBe(false);
    expect(calls).toEqual([
      { op: "stat", path: `${VIRTUAL}/f.txt` },
      { op: "stat", path: `${VIRTUAL}/cwd` },
      { op: "stat", path: `${VIRTUAL}/missing.txt` },
    ]);
  });

  it("writeFileBytes and readFileBytes go through the spy and give a Buffer", () => {
    writeFileBytes(`${VIRTUAL}/cwd/a.xml`, Buffer.from("<a/>"), env);
    expect(readFileSync(onDisk("cwd", "a.xml"), "utf8")).toBe("<a/>");
    const bytes = readFileBytes(`${VIRTUAL}/cwd/a.xml`, env);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString("utf8")).toBe("<a/>");
    expect(calls).toEqual([
      { op: "writeFile", path: `${VIRTUAL}/cwd/a.xml` },
      { op: "readFile", path: `${VIRTUAL}/cwd/a.xml` },
    ]);
  });

  it("readFileBytes makes a Buffer of the bytes of a host that returns a plain Uint8Array", () => {
    const fs: HostFs = { ...nodeFs, readFile: () => Uint8Array.from([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e]) };
    const bytes = readFileBytes("/anything.xml", { platform: "linux", cwd: "/", fs });
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString("hex")).toBe("efbbbf3c612f3e");
  });

  it("a read of a missing file asks the spy whether the folder exists, in translateFileError", () => {
    expect(() => readFileBytes(`${VIRTUAL}/cwd/missing.xml`, env)).toThrow(FileNotFoundException);
    expect(() => readFileBytes(`${VIRTUAL}/nowhere/missing.xml`, env)).toThrow(DirectoryNotFoundException);
    expect(calls).toEqual([
      { op: "readFile", path: `${VIRTUAL}/cwd/missing.xml` },
      { op: "exists", path: `${VIRTUAL}/cwd` },
      { op: "readFile", path: `${VIRTUAL}/nowhere/missing.xml` },
      { op: "exists", path: `${VIRTUAL}/nowhere` },
    ]);
  });

  it("translateFileError asks the environment's file system, and not the disk, for the folder of the file", () => {
    const missing = (host: string): unknown => translateFileError(Object.assign(new Error("x"), { code: "ENOENT" }), host, false, env);
    expect(missing(`${VIRTUAL}/cwd/x.xml`)).toBeInstanceOf(FileNotFoundException);
    expect(missing(`${VIRTUAL}/gone/x.xml`)).toBeInstanceOf(DirectoryNotFoundException);
    // `forWrite` never asks
    translateFileError(Object.assign(new Error("x"), { code: "ENOENT" }), `${VIRTUAL}/cwd/x.xml`, true, env);
    expect(calls).toEqual([
      { op: "exists", path: `${VIRTUAL}/cwd` },
      { op: "exists", path: `${VIRTUAL}/gone` },
    ]);
  });

  it("a write into a missing folder is a DirectoryNotFoundException that names the virtual path", () => {
    expect(() => writeFileBytes(`${VIRTUAL}/gone/a.xml`, Buffer.from("x"), env)).toThrow(
      new DirectoryNotFoundException(`${VIRTUAL}/gone/a.xml`),
    );
  });

  it("translates EISDIR and EACCES the host raises, whatever host raised them", () => {
    const refusing = (code: string): PathEnvironment => ({
      ...env,
      fs: {
        ...nodeFs,
        readFile: () => {
          throw Object.assign(new Error("refused"), { code });
        },
      },
    });
    for (const code of ["EISDIR", "EACCES", "EPERM"]) {
      expect(() => readFileBytes(`${VIRTUAL}/cwd/x.xml`, refusing(code))).toThrow(new UnauthorizedAccessException(`${VIRTUAL}/cwd/x.xml`));
    }
    expect(() => readFileBytes(`${VIRTUAL}/cwd/x.xml`, refusing("ENOTDIR"))).toThrow(DirectoryNotFoundException);
    const other = Object.assign(new Error("busy"), { code: "EBUSY" });
    expect(translateFileError(other, `${VIRTUAL}/cwd/x.xml`, false, env)).toBe(other);
  });
});

describe("HOST-210: io/windows-fs.ts goes through environment.fs", () => {
  it("creates folders, writes a file, finds a fold-equal spelling, tests and deletes, every touch on the spy", () => {
    directoryCreateDirectory(`${VIRTUAL}\\out\\Types\\Sub`, env);
    writeVolumeFile(`${VIRTUAL}\\out\\Types\\Sub\\Item.xml`, Buffer.from("<i/>"), env);
    expect(directoryExists(`${VIRTUAL}\\OUT\\types\\sub`, env)).toBe(true); // the volume folds case: a listing finds `out`
    writeVolumeFile(`${VIRTUAL}\\OUT\\TYPES\\sub\\ITEM.XML`, Buffer.from("<j/>"), env); // the same file under another spelling
    fileWriteAllText(`${VIRTUAL}\\out\\note.txt`, "text", env);
    directoryDelete(`${VIRTUAL}\\out\\Types`, true, env);

    expect(readdirSync(onDisk("out"))).toEqual(["note.txt"]);
    expect(readFileSync(onDisk("out", "note.txt"), "utf8")).toBe("text");
    expect([...ops()].sort()).toEqual(["mkdir", "readdir", "rm", "stat", "writeFile"]);
    expect(calls.every((call) => call.path === VIRTUAL || call.path.startsWith(`${VIRTUAL}/`))).toBe(true);
  });

  it("the single files written under a fold-equal spelling is the one file the first spelling made", () => {
    directoryCreateDirectory(`${VIRTUAL}\\out`, env);
    writeVolumeFile(`${VIRTUAL}\\out\\Item.xml`, Buffer.from("one"), env);
    writeVolumeFile(`${VIRTUAL}\\out\\ITEM.XML`, Buffer.from("two"), env);
    expect(readdirSync(onDisk("out"))).toEqual(["Item.xml"]);
    expect(readFileSync(onDisk("out", "Item.xml"), "utf8")).toBe("two");
    expect(calls.filter((call) => call.op === "readdir").map((call) => call.path)).toContain(`${VIRTUAL}/out`);
  });

  it("directoryCreateDirectory makes one folder at a time with mkdir, and does nothing for one that exists", () => {
    directoryCreateDirectory(`${VIRTUAL}\\a\\b\\c`, env);
    expect(calls.filter((call) => call.op === "mkdir").map((call) => call.path)).toEqual([`${VIRTUAL}/a`, `${VIRTUAL}/a/b`, `${VIRTUAL}/a/b/c`]);
    calls.length = 0;
    directoryCreateDirectory(`${VIRTUAL}\\a\\b\\c`, env);
    expect(ops().has("mkdir")).toBe(false);
  });

  it("reads EEXIST, EACCES and EPERM from the errors of the host's mkdir", () => {
    const failing = (code: string): PathEnvironment => ({
      ...env,
      fs: {
        ...env.fs!,
        mkdir: () => {
          throw Object.assign(new Error("no"), { code });
        },
      },
    });
    expect(() => directoryCreateDirectory(`${VIRTUAL}\\raced`, failing("EEXIST"))).not.toThrow();
    for (const code of ["EACCES", "EPERM"]) {
      expect(() => directoryCreateDirectory(`${VIRTUAL}\\denied`, failing(code))).toThrow(UnauthorizedAccessException);
    }
    expect(() => directoryCreateDirectory(`${VIRTUAL}\\busy`, failing("EBUSY"))).toThrow(expect.objectContaining({ code: "EBUSY" }));
  });

  it("reads EACCES and the failing path from the errors of the host's rm and writeFile", () => {
    directoryCreateDirectory(`${VIRTUAL}\\d`, env);
    const refusingRm: PathEnvironment = {
      ...env,
      fs: {
        ...env.fs!,
        rm: () => {
          throw Object.assign(new Error("no"), { code: "EACCES", path: "/virtual/d/locked.xml" });
        },
      },
    };
    expect(() => directoryDelete(`${VIRTUAL}\\d`, true, refusingRm)).toThrow(new UnauthorizedAccessException("locked.xml")); // it names the file the host refused to delete (EXP-415)
    const refusingWrite: PathEnvironment = {
      ...env,
      fs: {
        ...env.fs!,
        writeFile: () => {
          throw Object.assign(new Error("no"), { code: "EPERM" });
        },
      },
    };
    expect(() => writeVolumeFile(`${VIRTUAL}\\d\\x.xml`, Buffer.from("x"), refusingWrite)).toThrow(UnauthorizedAccessException);
  });

  it("a file with no spy at all is written to the disk, which is the default", () => {
    const at = join(work, "plain");
    nodeFs.mkdir(at);
    writeVolumeFile(`${at.replace(/\\/g, "/")}\\f.xml`, Buffer.from("d"), { platform: process.platform === "win32" ? "win32" : "linux", cwd: work });
    expect(readFileSync(join(at, "f.xml"), "utf8")).toBe("d");
  });
});

describe("HOST-211: the exception names the path against the environment's current directory", () => {
  it("resolves a relative host path against environment.cwd and never reads the process's", () => {
    const processCwd = vi.spyOn(process, "cwd");
    const error = translateFileError(Object.assign(new Error("x"), { code: "EISDIR" }), "sub/x.xml", false, env);
    expect(error).toEqual(new UnauthorizedAccessException(`${VIRTUAL}/cwd/sub/x.xml`));
    const missing = translateFileError(Object.assign(new Error("x"), { code: "ENOENT" }), "sub/x.xml", false, env);
    expect(missing).toEqual(new DirectoryNotFoundException(`${VIRTUAL}/cwd/sub/x.xml`));
    expect(processCwd).not.toHaveBeenCalled();
  });

  it("uses the host environment's current directory when the environment gives none", () => {
    const host = { ...nodeHostLike(), cwd: () => "/from/host" };
    const error = translateFileError(Object.assign(new Error("x"), { code: "EACCES" }), "x.xml", false, { platform: "linux", fs: env.fs!, host });
    expect(error).toEqual(new UnauthorizedAccessException("/from/host/x.xml"));
  });

  it("follows the Windows rules of the environment's platform for the full path", () => {
    const error = translateFileError(Object.assign(new Error("x"), { code: "EACCES" }), "sub\\x.xml", false, { platform: "win32", cwd: "C:\\run", fs: env.fs! });
    expect(error).toEqual(new UnauthorizedAccessException("C:\\run\\sub\\x.xml"));
  });
});

function nodeHostLike(): import("../host/types.js").HostEnv {
  return {
    platform: "linux",
    cwd: () => "/",
    tmpdir: () => "/tmp",
    osUser: () => ({ user: "u", machine: "m" }),
    availableParallelism: () => 1,
    monotonicNs: () => 0n,
    randomBytes: (n) => new Uint8Array(n),
    randomUuid: () => "00000000-0000-4000-8000-000000000000",
    yieldTurn: () => Promise.resolve(),
    windowsTimeZoneId: () => undefined,
    locale: () => "en-US",
  };
}
