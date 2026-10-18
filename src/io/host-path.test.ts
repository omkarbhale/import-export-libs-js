import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isWhiteSpace } from "./dotnet-text.js";
import { ArgumentException, DirectoryNotFoundException, FileNotFoundException, NotSupportedException, PathNotUsableError, UnauthorizedAccessException } from "./errors.js";
import { normalizeLongPath, readFileBytes, toHostPath, writeFileBytes } from "./host-path.js";
import { isPathRooted, pathCombine } from "./win-path.js";
import { probeSection, quotedStrings, resultOf, observe } from "../manifest/probe-output.js";

const work = mkdtempSync(join(tmpdir(), "libsjs-io-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const windows = { platform: "win32", cwd: "C:\\work\\tmp5" } as const;

describe("MAN-004: NormalizeLongPath", () => {
  it("returns a null or empty path as it is", () => {
    expect(normalizeLongPath(null, windows)).toBeNull();
    expect(normalizeLongPath("", windows)).toBe("");
  });

  it("returns the trimmed path, not the full path, below 255 characters", () => {
    expect(normalizeLongPath("rel.mf", windows)).toBe("rel.mf");
    expect(normalizeLongPath("..\\tmp\\n2.mf", windows)).toBe("..\\tmp\\n2.mf");
    expect(normalizeLongPath("C:/work/fwd.mf", windows)).toBe("C:/work/fwd.mf");
  });

  it("removes every leading backslash and question mark, as the characters of \\\\?\\ and not as a prefix", () => {
    expect(normalizeLongPath("\\\\\\C:\\work\\n3.mf", windows)).toBe("C:\\work\\n3.mf");
    expect(normalizeLongPath("?C:\\work\\n4.mf", windows)).toBe("C:\\work\\n4.mf");
    expect(normalizeLongPath("???C:\\work\\qq.mf", windows)).toBe("C:\\work\\qq.mf");
    expect(normalizeLongPath("\\\\?\\C:\\work\\pre.mf", windows)).toBe("C:\\work\\pre.mf");
  });

  it("makes a UNC path and a drive-less path relative to the current directory (bug MAN-005)", () => {
    expect(normalizeLongPath("\\\\localhost\\C$\\work\\tmp5\\unc.mf", windows)).toBe("localhost\\C$\\work\\tmp5\\unc.mf");
    expect(normalizeLongPath("\\work\\tmp5\\rooted.mf", windows)).toBe("work\\tmp5\\rooted.mf");
  });

  it("returns \\\\?\\ and the full path from 255 characters", () => {
    const folder = "C:\\work\\";
    const make = (length: number) => folder + "e".repeat(length - folder.length);
    expect(normalizeLongPath(make(254), windows)).toBe(make(254));
    expect(normalizeLongPath(make(255), windows)).toBe(`\\\\?\\${make(255)}`);
    const relative = "e".repeat(255 - "C:\\work\\tmp5\\".length);
    expect(normalizeLongPath(relative, windows)).toBe(`\\\\?\\C:\\work\\tmp5\\${relative}`);
    expect(normalizeLongPath(relative.slice(1), windows)).toBe(relative.slice(1));
  });

  it("counts the full path: dots resolve, trailing dots and spaces go, separators fold", () => {
    const deep = `${"d\\".repeat(130)}x.mf`;
    expect(normalizeLongPath(`${"d\\..\\".repeat(130)}x.mf`, windows)).toBe(`${"d\\..\\".repeat(130)}x.mf`);
    expect(normalizeLongPath(deep, windows)).toBe(`\\\\?\\C:\\work\\tmp5\\${deep}`);
    const padded = `${"e".repeat(255 - "C:\\work\\tmp5\\".length)}. .`;
    expect(normalizeLongPath(padded, windows)).toBe(`\\\\?\\C:\\work\\tmp5\\${"e".repeat(255 - "C:\\work\\tmp5\\".length)}`);
  });

  // probe 08 section 15 and the GetFullPath runs: the exceptions of Path.GetFullPath
  it("fails as GetFullPath does", () => {
    expect(() => normalizeLongPath("   ", windows)).toThrow(new ArgumentException("The path is not of a legal form."));
    expect(() => normalizeLongPath("\t", windows)).toThrow("The path is not of a legal form.");
    expect(() => normalizeLongPath("\\\\", windows)).toThrow("The path is not of a legal form.");
    for (const bad of ["a|b", "a<b", "a>b", 'a"b', "a\tb", "a?b", "a*b", "a\\*\\b"]) {
      expect(() => normalizeLongPath(bad, windows)).toThrow(new ArgumentException("Illegal characters in path."));
    }
    for (const bad of ["C:\\x:y", ":x", "1:\\x", "ab:\\x", "C::", "C:\\a\\:b"]) {
      expect(() => normalizeLongPath(bad, windows)).toThrow(new NotSupportedException("The given path's format is not supported."));
    }
    expect(normalizeLongPath("a:b", windows)).toBe("a:b");
    expect(normalizeLongPath("x:", windows)).toBe("x:");
  });
});

describe("MAN-033: the host path", () => {
  it("passes a Windows path through the normalisation on Windows", () => {
    expect(toHostPath("\\\\\\C:\\work\\x.mf", windows)).toBe("C:\\work\\x.mf");
    expect(() => toHostPath("a?b", windows)).toThrow("Illegal characters in path.");
  });

  it("turns every backslash into a slash elsewhere, so a rooted path stays rooted", () => {
    const linux = { platform: "linux" } as const;
    expect(toHostPath("/home/u/m\\Pkg\\Import", linux)).toBe("/home/u/m/Pkg/Import");
    expect(toHostPath("\\Users\\me\\imports.mf", linux)).toBe("/Users/me/imports.mf");
    expect(toHostPath("Pkg\\Import\\x.mf", { platform: "darwin" })).toBe("Pkg/Import/x.mf");
    expect(toHostPath("/home/u/a|b?", linux)).toBe("/home/u/a|b?");
    expect(toHostPath(null, linux)).toBeNull();
    expect(toHostPath("", linux)).toBe("");
  });

  it("stops at a drive or a share, which have no meaning there, naming the path", () => {
    for (const path of ["C:\\abs\\x", "D:rel", "\\\\host\\share\\x"]) {
      expect(() => toHostPath(path, { platform: "linux" })).toThrow(PathNotUsableError);
      expect(() => toHostPath(path, { platform: "linux" })).toThrow(path);
    }
  });
});

describe("MAN-003 MAN-006: reading and writing files", () => {
  it("writes and reads a file by a Windows-looking relative path on this platform", () => {
    const path = join(work, "x.bin");
    writeFileBytes(path, Buffer.from("abc"));
    expect(readFileBytes(path).toString()).toBe("abc");
  });

  it("fails as .NET does for a null path, an empty path, a missing file, a missing folder and a folder", () => {
    expect(() => readFileBytes(null)).toThrow("Value cannot be null.\r\nParameter name: path");
    expect(() => writeFileBytes(null, Buffer.alloc(0))).toThrow("Path cannot be null.\r\nParameter name: path");
    expect(() => readFileBytes("")).toThrow(new ArgumentException("Empty path name is not legal."));
    expect(() => writeFileBytes("", Buffer.alloc(0))).toThrow("Empty path name is not legal.");
    const missing = join(work, "missing");
    expect(() => readFileBytes(missing)).toThrow(new FileNotFoundException(missing));
    expect(() => readFileBytes(join(missing, "x"))).toThrow(new DirectoryNotFoundException(join(missing, "x")));
    expect(() => writeFileBytes(join(missing, "x"), Buffer.alloc(0))).toThrow(DirectoryNotFoundException);
    expect(() => readFileBytes(work)).toThrow(UnauthorizedAccessException);
  });

  it("overwrites an existing file", () => {
    const path = join(work, "over.bin");
    writeFileSync(path, "long old content");
    writeFileBytes(path, Buffer.from("new"));
    expect(readFileBytes(path).toString()).toBe("new");
  });
});

describe("MAN-030: Path.IsPathRooted and Path.Combine", () => {
  it("tells rooted paths: \\ or / first, or : second", () => {
    for (const path of ["\\x", "/x", "C:\\x", "D:x", "a:b", "1:\\x", "\\\\h\\s", "C:"]) expect(isPathRooted(path)).toBe(true);
    for (const path of ["ab:\\x", ":x", "x", "", ".\\x"]) expect(isPathRooted(path)).toBe(false);
    expect(isPathRooted(null)).toBe(false);
  });

  it("combines as probe 08 section 13 shows", () => {
    for (const row of probeSection("08-path-chars-and-edges.out", "13 Combine / IsPathRooted shapes")) {
      const [folder, path] = quotedStrings(row) as [string, string];
      // Combine is what GetPackagePath calls for a path that is not rooted; a rooted path is returned as it is
      expect(observe(() => pathCombine(folder, path))).toEqual(resultOf(row));
    }
  });

  it("refuses null and illegal characters in the order .NET checks them", () => {
    expect(() => pathCombine(null, "x")).toThrow("Value cannot be null.\r\nParameter name: path1");
    expect(() => pathCombine("x", null)).toThrow("Value cannot be null.\r\nParameter name: path2");
    expect(() => pathCombine("a|b", "x")).toThrow("Illegal characters in path.");
    expect(() => pathCombine("x", "a|b")).toThrow("Illegal characters in path.");
    expect(pathCombine("C:\\m", "a?b*c")).toBe("C:\\m\\a?b*c");
  });
});

describe("MAN-012: the white space of String.Trim", () => {
  it("is the 25 characters of the probe", () => {
    const probe = probeSection("02-manifest-edit-save.out", "4 Trim whitespace set (Char.IsWhiteSpace vs String.Trim) over BMP")
      .find((line) => line.startsWith("Trim-empty =>"))
      ?.split("=> ")[1]
      ?.split(" ")
      .map((hex) => Number.parseInt(hex, 16));
    const ours: number[] = [];
    for (let code = 0; code <= 0xffff; code += 1) if (isWhiteSpace(code)) ours.push(code);
    expect(ours).toEqual(probe);
  });
});
