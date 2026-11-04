import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { CItemHelper } from "../client/item-helper.js";
import { ArasVersion } from "../client/version.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { createMessagesFactory } from "../export/messages.js";
import { RunLog } from "../export/run-log.js";
import { nodeFs } from "../host/node-fs.js";
import type { AppendHandle, HostFs } from "../host/types.js";
import { SUImportContext } from "../import/import-context.js";
import { loadPackage } from "../import/load-package-dom.js";
import { directoryGetDirectories, directoryGetXmlFiles, directoryGetXmlFilesRecursive, newFileInfo, readListedFile } from "../import/package-files.js";
import { languagePackImport } from "../language-pack/lp-import.js";
import { DEFAULT_LANGUAGES, cfg } from "../language-pack/probe-harness.js";
import { DirectoryNotFoundException, FileNotFoundException, IOException, UnauthorizedAccessException } from "./errors.js";
import { fileExists, readFileBytes, translateFileError, writeFileBytes } from "./host-path.js";
import type { PathEnvironment } from "./host-path.js";
import { directoryCreateDirectory, directoryDelete, directoryExists, fileWriteAllText, writeVolumeFile } from "./windows-fs.js";

/**
 * Every file the file layer touches goes through the environment's `HostFs` (HOST-210). The spy below wraps `nodeFs` and records
 * each call. The folder `/virtual` it serves is a folder of a temporary directory that the spy maps it to, and `/virtual` does not
 * exist on the disk: a path that reached `node:fs` without the spy would fail with `ENOENT`, so an operation that succeeds on one
 * went through the spy, and the record says which calls it made.
 *
 * @spec HOST-210 HOST-211 HOST-212 HOST-213
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
/** The log files a test opened, closed again after it so that the process-wide one-writer set stays empty. */
const held: RunLog[] = [];

beforeEach(() => {
  const spy = spyFs();
  calls = spy.calls;
  // `/virtual` is the root of the volume, and the current directory is a folder of it
  env = { platform: "linux", cwd: `${VIRTUAL}/cwd`, fs: spy.fs };
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, "cwd"), { recursive: true });
});

afterEach(() => {
  for (const log of held.splice(0)) log.dispose();
  vi.restoreAllMocks();
});

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

/** A `HostFs` that wraps another and lists every folder in an order of its own. */
function listingIn(fs: HostFs, order: (names: string[]) => string[]): HostFs {
  return {
    ...fs,
    readdir: (path) => {
      const entries = fs.readdir(path);
      const byName = new Map(entries.map((entry) => [entry.name, entry]));
      return order(entries.map((entry) => entry.name)).map((name) => byName.get(name)!);
    },
  };
}

const put = (relativePath: string, text = "<AML/>"): void => {
  mkdirSync(join(work, relativePath, ".."), { recursive: true });
  writeFileSync(join(work, relativePath), text);
};

describe("HOST-212: the package listing goes through environment.fs", () => {
  beforeEach(() => {
    for (const name of ["b.xml", "A.xml", "c.XML", "ä.xml", "long name.xml", "d.txt", "e.xmlbak"]) put(`pkg/one/${name}`);
    put("pkg/two/z.xml");
    put("pkg/two/deep/y.xml");
    mkdirSync(onDisk("pkg", "three"));
    put("pkg/loose.xml");
    calls.length = 0;
  });

  it("lists the folders, the files and the files below a folder, all on the spy, as virtual paths", () => {
    const folders = directoryGetDirectories(`${VIRTUAL}/pkg`, env);
    expect(folders).toEqual([`${VIRTUAL}/pkg/one`, `${VIRTUAL}/pkg/three`, `${VIRTUAL}/pkg/two`]);
    const files = directoryGetXmlFiles(`${VIRTUAL}/pkg/one`, env);
    expect(files.map((file) => file.slice(`${VIRTUAL}/pkg/one/`.length))).toEqual(["A.xml", "b.xml", "c.XML", "e.xmlbak", "long name.xml", "ä.xml"]);
    expect(directoryGetXmlFilesRecursive(`${VIRTUAL}/pkg`, env)).toEqual([
      `${VIRTUAL}/pkg/loose.xml`,
      ...files,
      `${VIRTUAL}/pkg/two/z.xml`,
      `${VIRTUAL}/pkg/two/deep/y.xml`,
    ]);
    expect([...ops()]).toEqual(["readdir"]);
    expect(calls.every((call) => call.path === VIRTUAL || call.path.startsWith(`${VIRTUAL}/`))).toBe(true);
  });

  it("gives the same lists whatever order the host lists a folder in: reversed, rotated or descending (NTFS order is the engine's)", () => {
    const lists = (environment: PathEnvironment): unknown => ({
      folders: directoryGetDirectories(`${VIRTUAL}/pkg`, environment),
      files: directoryGetXmlFiles(`${VIRTUAL}/pkg/one`, environment),
      all: directoryGetXmlFilesRecursive(`${VIRTUAL}/pkg`, environment),
    });
    const wanted = lists(env);
    const rotated = (names: string[]): string[] => [...names.slice(2), ...names.slice(0, 2)];
    for (const order of [(names: string[]) => [...names].reverse(), rotated, (names: string[]) => [...names].sort().reverse()]) {
      expect(lists({ ...env, fs: listingIn(env.fs!, order) })).toEqual(wanted);
    }
  });

  it("two names that differ only by case are ordered by their code units, whatever the host lists first", () => {
    put("case/x.xml");
    put("case/X.xml");
    const fs = listingIn(env.fs!, (names) => [...names].sort().reverse());
    const forward = listingIn(env.fs!, (names) => [...names].sort());
    expect(directoryGetXmlFiles(`${VIRTUAL}/case`, { ...env, fs })).toEqual(directoryGetXmlFiles(`${VIRTUAL}/case`, { ...env, fs: forward }));
    expect(directoryGetXmlFiles(`${VIRTUAL}/case`, { ...env, fs })).toEqual([`${VIRTUAL}/case/X.xml`, `${VIRTUAL}/case/x.xml`]);
  });

  it("asks the host what a link points to, and a link to nowhere is neither a folder nor a file", () => {
    mkdirSync(onDisk("links", "real"), { recursive: true });
    put("links/file.xml");
    symlinkSync(onDisk("links", "real"), onDisk("links", "dirlink"));
    symlinkSync(onDisk("links", "file.xml"), onDisk("links", "filelink.xml"));
    symlinkSync(onDisk("links", "gone"), onDisk("links", "brokenlink.xml"));
    calls.length = 0;
    expect(directoryGetDirectories(`${VIRTUAL}/links`, env)).toEqual([`${VIRTUAL}/links/dirlink`, `${VIRTUAL}/links/real`]);
    expect(directoryGetXmlFiles(`${VIRTUAL}/links`, env)).toEqual([`${VIRTUAL}/links/file.xml`, `${VIRTUAL}/links/filelink.xml`]);
    const statted = calls.filter((call) => call.op === "stat").map((call) => call.path);
    expect(statted).toContain(`${VIRTUAL}/links/dirlink`);
    expect(statted).toContain(`${VIRTUAL}/links/brokenlink.xml`);
  });

  it("turns the failures of a listing into the exceptions of .NET, naming the path against environment.cwd", () => {
    const processCwd = vi.spyOn(process, "cwd");
    expect(() => directoryGetDirectories("nowhere", env)).toThrow(new DirectoryNotFoundException(`${VIRTUAL}/cwd/nowhere`));
    expect(() => directoryGetXmlFiles(`${VIRTUAL}/pkg/loose.xml`, env)).toThrow(new IOException("The directory name is invalid.\r\n"));
    for (const code of ["EACCES", "EPERM"]) {
      const refusing: PathEnvironment = {
        ...env,
        fs: {
          ...env.fs!,
          readdir: () => {
            throw Object.assign(new Error("no"), { code });
          },
        },
      };
      expect(() => directoryGetXmlFilesRecursive("sub", refusing)).toThrow(new UnauthorizedAccessException(`${VIRTUAL}/cwd/sub`));
    }
    expect(processCwd).not.toHaveBeenCalled();
  });

  it("readListedFile reads through the host into a Buffer, also from a host that gives a plain Uint8Array", () => {
    const bytes = readListedFile(`${VIRTUAL}/pkg/one/b.xml`, env);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.toString("utf8")).toBe("<AML/>");
    expect(calls.at(-1)).toEqual({ op: "readFile", path: `${VIRTUAL}/pkg/one/b.xml` });
    const plain = readListedFile("x.xml", { ...env, fs: { ...env.fs!, readFile: () => Uint8Array.from([0x3c, 0x61, 0x2f, 0x3e]) } });
    expect(Buffer.isBuffer(plain)).toBe(true);
    expect(plain.toString("hex")).toBe("3c612f3e");
  });

  it("readListedFile: EBUSY is the sharing violation of .NET, the other failures go through translateFileError", () => {
    const failing = (code: string): PathEnvironment => ({
      ...env,
      fs: {
        ...env.fs!,
        readFile: () => {
          throw Object.assign(new Error("x"), { code });
        },
      },
    });
    expect(() => readListedFile("pkg/a.xml", failing("EBUSY"))).toThrow(
      new IOException(`The process cannot access the file '${VIRTUAL}/cwd/pkg/a.xml' because it is being used by another process.`),
    );
    expect(() => readListedFile("pkg/a.xml", failing("EISDIR"))).toThrow(new UnauthorizedAccessException(`${VIRTUAL}/cwd/pkg/a.xml`));
    expect(() => readListedFile(`${VIRTUAL}/pkg/one/gone.xml`, env)).toThrow(new FileNotFoundException(`${VIRTUAL}/pkg/one/gone.xml`));
  });

  it("newFileInfo resolves the full name against environment.cwd, with the platform's rules", () => {
    const processCwd = vi.spyOn(process, "cwd");
    expect(newFileInfo("pkg/a.xml", env)).toEqual({ name: "a.xml", fullName: `${VIRTUAL}/cwd/pkg/a.xml` });
    expect(newFileInfo("pkg\\a.xml", { platform: "win32", cwd: "C:\\run", fs: env.fs! })).toEqual({ name: "a.xml", fullName: "C:\\run\\pkg\\a.xml" });
    expect(processCwd).not.toHaveBeenCalled();
  });

  it("loadPackage lists and reads a whole package through the spy, and reaches the disk by no other way", () => {
    put("cwd/pkg/ItemTypes/a.xml", '<AML><Item type="ItemType" id="A1"/></AML>');
    put("cwd/pkg/ItemTypes/b.xml", '<AML><Item type="ItemType" id="B1"/></AML>');
    put("cwd/pkg/Methods/m.xml", "<AML/>");
    calls.length = 0;
    const lines: string[] = [];
    const loaded = loadPackage(`${VIRTUAL}/cwd/pkg`, { writeLine: (text) => void lines.push(text) }, { environment: env });
    expect(loaded.files.map((file) => file.path)).toEqual(
      ["ItemTypes/a.xml", "ItemTypes/b.xml", "Methods/m.xml"].map((path) => `${VIRTUAL}/cwd/pkg/${path}`),
    );
    expect(loaded.files.map((file) => file.skipped ?? false)).toEqual([false, false, true]);
    expect(lines).toHaveLength(1);
    expect(new Set(calls.map((call) => call.op))).toEqual(new Set(["readdir", "readFile"]));
  });
});

describe("HOST-213: the log goes through environment.fs, and the one-writer rule is the log's", () => {
  /** A host whose files are bytes in memory, which counts what is opened, written and closed. */
  function memoryLog(): { fs: HostFs; opened: string[]; written: Uint8Array[]; closed: number[]; failWrite: { value: boolean } } {
    const opened: string[] = [];
    const written: Uint8Array[] = [];
    const closed: number[] = [];
    const failWrite = { value: false };
    const fs: HostFs = {
      ...env.fs!,
      openAppend: (path: string): AppendHandle => {
        opened.push(path);
        return {
          write(bytes) {
            if (failWrite.value) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
            written.push(Uint8Array.from(bytes));
          },
          close: () => void closed.push(opened.length),
        };
      },
    };
    return { fs, opened, written, closed, failWrite };
  }
  const open = (path: string | null, environment: PathEnvironment): RunLog => {
    const log = RunLog.open(path, environment);
    held.push(log);
    return log;
  };

  it("opens the file for append on the spy at once, writes the UTF-8 text through the handle when disposed, and appends", () => {
    const log = open(`${VIRTUAL}/engine.log`, env);
    expect(calls).toEqual([{ op: "openAppend", path: `${VIRTUAL}/engine.log` }]);
    expect(existsSync(onDisk("engine.log"))).toBe(true);
    log.writeLine("first ä");
    log.write("tail");
    expect(readFileSync(onDisk("engine.log"), "utf8")).toBe("");
    log.dispose();
    log.dispose();
    expect(readFileSync(onDisk("engine.log"))).toEqual(Buffer.from("first ä\r\ntail", "utf8"));
    open(`${VIRTUAL}/engine.log`, env).dispose();
    expect(calls.filter((call) => call.op === "openAppend")).toHaveLength(2);
  });

  it("gives the handle the bytes once, as UTF-8 with no BOM, and closes it once, also when the write fails", () => {
    const host = memoryLog();
    const log = open("run.log", { ...env, fs: host.fs });
    expect(host.opened).toEqual(["run.log"]);
    log.writeLine("a");
    log.dispose();
    expect(host.written.map((bytes) => Buffer.from(bytes).toString("hex"))).toEqual(["610d0a"]);
    expect(host.closed).toEqual([1]);

    const empty = open("empty.log", { ...env, fs: host.fs });
    empty.dispose();
    expect(host.written).toHaveLength(1); // nothing was written, so no write call
    expect(host.closed).toHaveLength(2);

    const failing = open("fail.log", { ...env, fs: host.fs });
    failing.writeLine("x");
    host.failWrite.value = true;
    expect(() => failing.dispose()).toThrow("disk full");
    expect(host.closed).toHaveLength(3);
    failing.dispose();
    expect(host.closed).toHaveLength(3);
    // a failed dispose still lets another writer in
    host.failWrite.value = false;
    open("fail.log", { ...env, fs: host.fs }).dispose();
  });

  it("refuses a second writer without asking the host, and lets one in after dispose (EXP-541)", () => {
    const host = memoryLog();
    const environment: PathEnvironment = { ...env, fs: host.fs };
    const first = open("held.log", environment);
    expect(() => open("held.log", environment)).toThrow(
      new IOException(`The process cannot access the file '${VIRTUAL}/cwd/held.log' because it is being used by another process.`),
    );
    // the same file under another spelling is the same file
    expect(() => open(`${VIRTUAL}/cwd/./sub/../held.log`, environment)).toThrow(IOException);
    expect(host.opened).toEqual(["held.log"]);
    first.dispose();
    open("held.log", environment).dispose();
    expect(host.opened).toEqual(["held.log", "held.log"]);
  });

  it("keys the writers by the environment's current directory, never the process's", () => {
    const processCwd = vi.spyOn(process, "cwd");
    const host = memoryLog();
    const first = open("engine.log", { platform: "linux", cwd: "/one", fs: host.fs });
    const other = open("engine.log", { platform: "linux", cwd: "/two", fs: host.fs });
    expect(() => open("engine.log", { platform: "linux", cwd: "/one", fs: host.fs })).toThrow("'/one/engine.log'");
    expect(() => open("/one/engine.log", { platform: "linux", cwd: "/two", fs: host.fs })).toThrow("'/one/engine.log'");
    first.dispose();
    other.dispose();
    expect(processCwd).not.toHaveBeenCalled();
  });

  it("names a Windows path in the message as GetFullPath does, with the environment's folder", () => {
    const host = memoryLog();
    const environment: PathEnvironment = { platform: "win32", cwd: "C:\\run", fs: host.fs };
    const first = open("logs\\engine.log", environment);
    expect(() => open("logs\\.\\engine.log", environment)).toThrow(IOException);
    expect(() => open("logs\\engine.log", environment)).toThrow("'C:\\run\\logs\\engine.log'");
    first.dispose();
  });

  it("a failed open is a failure of a write, and does not hold the path", () => {
    expect(() => open(`${VIRTUAL}/missing/engine.log`, env)).toThrow(new DirectoryNotFoundException(`${VIRTUAL}/missing/engine.log`));
    const denied: PathEnvironment = {
      ...env,
      fs: {
        ...env.fs!,
        openAppend: () => {
          throw Object.assign(new Error("no"), { code: "EACCES" });
        },
      },
    };
    expect(() => open("x.log", denied)).toThrow(new UnauthorizedAccessException(`${VIRTUAL}/cwd/x.log`));
    open(`${VIRTUAL}/cwd/x.log`, env).dispose();
  });
});

describe("HOST-210 HOST-212 HOST-213: a whole language-pack run reaches the disk through the spy and no other way", () => {
  class FakeConnection implements ServerConnection {
    async callAction(): Promise<ResponseDocument> {
      return ResponseDocument.parse(DEFAULT_LANGUAGES);
    }
  }

  function setup(engine: "14.0.7" | "14.35") {
    mkdirSync(onDisk("pack", "xml"), { recursive: true });
    mkdirSync(onDisk("tmp"), { recursive: true });
    put("pack/ImportConfig.xml", cfg("de", ['<itemtype name="Foo"/>']));
    put("pack/xml/Foo.xml", '<export><Item type="Foo" id="A1"><property __name="name" de="Hallo"/></Item></export>');
    const context = new SolutionUpgradeContext();
    context.action = "LPImport";
    context.url = "http://localhost/db";
    context.dataBase = "db";
    context.userName = "root";
    context.workingDirectory = VIRTUAL;
    context.logFilePath = `${VIRTUAL}/engine.log`;
    context.lpPath = `${VIRTUAL}/pack/ImportConfig.xml`;
    context.lpPackage = "PKG";
    const helper = new CItemHelper(new FakeConnection(), { engine });
    helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
    helper.logout = async () => undefined;
    return { context, helper, options: { platform: "linux" as const, cwd: VIRTUAL, fs: env.fs!, tempPath: `${VIRTUAL}/tmp/`, randomFileName: () => "abcdefgh.xyz" } };
  }
  const messages = createMessagesFactory();

  it("14.0.7: the preprocessor, the manager's manifest and the log (a run that stops at its import context)", async () => {
    const s = setup("14.0.7");
    await expect(languagePackImport(s.context, null as unknown as SUImportContext, messages, s.helper, s.options)).rejects.toThrow(
      "Parameter name: importContext",
    );
    expect(readFileSync(onDisk("engine.log"), "utf8")).toContain("System.ArgumentNullException");
    expect(readdirSync(onDisk("tmp"))).toEqual([]); // the temp package was removed again, through the spy
    expect(ops()).toEqual(new Set(["stat", "readFile", "readdir", "mkdir", "writeFile", "rm", "openAppend"]));
    expect(calls.every((call) => call.path === VIRTUAL || call.path.startsWith(`${VIRTUAL}/`))).toBe(true);
    expect(calls.filter((call) => call.op === "openAppend")).toEqual([{ op: "openAppend", path: `${VIRTUAL}/engine.log` }]);
  });

  it("14.35: the language scan of the temp package lists a missing folder through the spy", async () => {
    const s = setup("14.35");
    s.context.lpPackage = "My.Pkg";
    const failure = await languagePackImport(s.context, new SUImportContext(), messages, s.helper, s.options).catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "DirectoryNotFoundException" });
    expect(readFileSync(onDisk("engine.log"), "utf8")).toMatch(/^System\.IO\.DirectoryNotFoundException: Could not find a part of the path '\/virtual\/.*Pkg.Import'\.\r\n$/);
    expect(calls.some((call) => call.op === "readdir" && call.path.endsWith("My.Pkg.Import") === false)).toBe(true);
    expect(calls.every((call) => call.path === VIRTUAL || call.path.startsWith(`${VIRTUAL}/`))).toBe(true);
  });
});
