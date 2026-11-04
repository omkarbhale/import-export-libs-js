import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conformanceCases, longPathUnder, probeCapabilities, type HostFsFixture } from "./fs-conformance.js";
import { nodeFs } from "./node-fs.js";

/**
 * The suite is itself a piece of the contract (HOST-214), so it is checked: it is big enough, every HostFs member has a case, and the capability probe says what it should on a disk and on a host
 * that has nothing.
 *
 * @spec HOST-214
 */

describe("HOST-214: the conformance suite describes itself", () => {
  const cases = conformanceCases();

  it("has at least sixty cases, with unique names inside a group", () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
    const keys = cases.map((c) => `${c.group}/${c.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every HostFs member and the groups of the ticket", () => {
    const members = new Set(cases.flatMap((c) => c.needs.map((n) => n.call)));
    expect([...members].sort()).toEqual(["exists", "mkdir", "openAppend", "readFile", "readdir", "rm", "stat", "writeFile"]);
    expect([...new Set(cases.map((c) => c.group))]).toEqual(["stat", "readdir", "mkdir", "writeFile", "readFile", "exists", "rm", "openAppend", "paths", "case", "layer"]);
  });

  it("marks only the cases a host may fail to meet as optional, and every capability is used", () => {
    const optional = cases.filter((c) => c.optional !== undefined);
    expect([...new Set(optional.map((c) => c.optional))].sort()).toEqual(["caseSensitive", "enotdir", "longName", "longPath", "normalization", "symlink", "trailing"]);
    expect(optional.length).toBeLessThan(cases.length / 2);
  });

  it("the long path is exactly 4 095 characters, of names of at most 255", () => {
    for (const root of ["/tmp/x", "/var/folders/ab/cdef0123456789/T/libsjs-hostfs-AbCdEf", "/r"]) {
      const { dirs, file } = longPathUnder(root);
      const full = [root, ...dirs, file].join("/");
      expect(full.length).toBe(4095);
      for (const name of [...dirs, file]) {
        expect(name.length).toBeGreaterThan(0);
        expect(name.length).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("HOST-214: the capability probe asks the host", () => {
  it("finds a host with no links, no folding and no limit to be fully capable but for links", () => {
    // a minimal in-memory host, written here only to prove that the probe reads the host and not the platform
    const files = new Map<string, Uint8Array>();
    const dirs = new Set<string>(["/r"]);
    const fixture = (): HostFsFixture => ({
      root: "/r",
      fs: {
        stat: (path) => {
          if (dirs.has(path)) return { isFile: false, isDirectory: true };
          if (files.has(path)) return { isFile: true, isDirectory: false };
          const parent = path.slice(0, path.lastIndexOf("/"));
          throw Object.assign(new Error("x"), { code: files.has(parent) ? "ENOTDIR" : "ENOENT" });
        },
        readdir: (path) => {
          const prefix = `${path}/`;
          const names = [...files.keys(), ...dirs].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/")).map((p) => p.slice(prefix.length));
          return names.map((name) => ({ name, isFile: files.has(prefix + name), isDirectory: dirs.has(prefix + name), isSymbolicLink: false }));
        },
        readFile: (path) => {
          const bytes = files.get(path);
          if (bytes === undefined) throw Object.assign(new Error("x"), { code: "ENOENT" });
          return bytes;
        },
        writeFile: (path, data) => void files.set(path, data.slice()),
        mkdir: (path) => void dirs.add(path),
        rm: () => undefined,
        exists: (path) => files.has(path) || dirs.has(path),
        openAppend: () => ({ write: () => undefined, close: () => undefined }),
      },
    });
    expect(probeCapabilities(fixture)).toEqual({ symlink: false, caseSensitive: true, normalization: true, trailing: true, longName: true, longPath: true, enotdir: true });
  });

  it("on this disk, finds what the disk can do, and cleans up after itself", () => {
    const made: string[] = [];
    const wrapped = (): HostFsFixture => {
      const root = mkdtempSync(join(tmpdir(), "libsjs-probe-"));
      made.push(root);
      return { fs: nodeFs, root, dispose: () => rmSync(root, { recursive: true, force: true }) };
    };
    const capabilities = probeCapabilities(wrapped);
    expect(made.length).toBe(1);
    expect(existsSync(made[0] as string)).toBe(false);
    expect(capabilities.symlink).toBe(false); // this fixture has no `symlink`, so the probe reports none
  });
});
