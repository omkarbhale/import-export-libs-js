import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ArgumentNullException, FileNotFoundException, KeyNotFoundException } from "./errors.js";
import { directoryGetParentFullName, toHostPath } from "./host-path.js";
import { pathGetRandomFileName, pathGetTempPath } from "./temp-path.js";
import { getDirectoryName, pathCombineAll } from "./win-path.js";
import { fileWriteAllText } from "./windows-fs.js";

/** The file-system primitives of `IOWrapper` that the language-pack preprocessor uses (LP-010, LP-020, LP-026, LP-030, LP-031). */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("LP-031: Path.Combine(params string[])", () => {
  it("joins the names with one backslash, skips empty ones and lets a rooted one restart the path", () => {
    expect(pathCombineAll("C:\\temp\\LanguagePack_x", "PKG", "Import", "Fixes")).toBe("C:\\temp\\LanguagePack_x\\PKG\\Import\\Fixes");
    expect(pathCombineAll("C:\\temp\\LanguagePack_x", "", "Import", "Fixes")).toBe("C:\\temp\\LanguagePack_x\\Import\\Fixes");
    expect(pathCombineAll("", "xml")).toBe("xml");
    expect(pathCombineAll("", "imports.mf")).toBe("imports.mf");
    expect(pathCombineAll("C:\\temp\\", "a", "b")).toBe("C:\\temp\\a\\b");
    expect(pathCombineAll("/tmp/", "LanguagePack_x")).toBe("/tmp/LanguagePack_x");
    expect(pathCombineAll("C:\\temp\\LanguagePack_x", "C:\\x\\Lp", "Import", "Fixes")).toBe("C:\\x\\Lp\\Import\\Fixes");
    expect(pathCombineAll("C:\\temp\\LanguagePack_x", "a:b", "Import")).toBe("a:b\\Import");
    expect(pathCombineAll("C:\\temp\\LanguagePack_x", "..", "Import", "Fixes")).toBe("C:\\temp\\LanguagePack_x\\..\\Import\\Fixes");
  });

  it("refuses a null element and an illegal character, in order", () => {
    expect(() => pathCombineAll("a", null, "b")).toThrow(new ArgumentNullException("paths"));
    expect(() => pathCombineAll(null, "x")).toThrow("Value cannot be null.\r\nParameter name: paths");
    expect(() => pathCombineAll("C:\\temp", "a|b", "Import")).toThrow("Illegal characters in path.");
  });
});

describe("LP-010 LP-020: Path.GetDirectoryName", () => {
  it.each([
    ["C:\\pack\\ImportConfig.xml", "C:\\pack"],
    ["C:/pack/ImportConfig.xml", "C:\\pack"],
    ["C:\\pack\\x\\..\\ImportConfig.xml", "C:\\pack"],
    ["C:\\pack\\.\\ImportConfig.xml", "C:\\pack"],
    ["C:\\pack\\\\ImportConfig.xml", "C:\\pack"],
    ["ImportConfig.xml", ""],
    ["pack\\ImportConfig.xml", "pack"],
    ["..\\pack\\ImportConfig.xml", "..\\pack"],
    ["\\ImportConfig.xml", "\\"],
    ["C:\\ImportConfig.xml", "C:\\"],
    ["/home/u/pack/ImportConfig.xml", "\\home\\u\\pack"],
    ["\\\\server\\share\\ImportConfig.xml", "\\\\server\\share"],
  ])("%s gives %j", (path, directory) => {
    expect(getDirectoryName(path)).toBe(directory);
  });

  it("gives null for a root and for null, and refuses an empty, blank or illegal path", () => {
    expect(getDirectoryName("C:\\")).toBeNull();
    expect(getDirectoryName("\\\\server\\share")).toBeNull();
    expect(getDirectoryName(null)).toBeNull();
    expect(() => getDirectoryName("")).toThrow("The path is not of a legal form.");
    expect(() => getDirectoryName("  ")).toThrow("The path is not of a legal form.");
    expect(() => getDirectoryName("a|b")).toThrow("Illegal characters in path.");
  });
});

describe("LP-030: Path.GetTempPath and Path.GetRandomFileName", () => {
  it("gives the temp folder with a trailing separator", () => {
    expect(pathGetTempPath({ platform: "linux" })).toMatch(/[\\/]$/);
    expect(pathGetTempPath({ platform: "win32" })).toMatch(/[\\/]$/);
  });

  it("gives eight characters, a dot and three characters of a-z and 0-5", () => {
    const names = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const name = pathGetRandomFileName();
      expect(name).toMatch(/^[a-z0-5]{8}\.[a-z0-5]{3}$/);
      names.add(name);
    }
    expect(names.size).toBeGreaterThan(190);
  });
});

describe("LP-010: the host path resolves . and .. in the text, as Windows does", () => {
  it("collapses them before the host opens anything", () => {
    const linux = { platform: "linux" } as const;
    expect(toHostPath("/home/u/x\\..\\pack\\ImportConfig.xml", linux)).toBe("/home/u/pack/ImportConfig.xml");
    expect(toHostPath("pack\\.\\ImportConfig.xml", linux)).toBe("pack/ImportConfig.xml");
    expect(toHostPath("..\\pack\\ImportConfig.xml", linux)).toBe("../pack/ImportConfig.xml");
    expect(toHostPath("/home/u/pack/", linux)).toBe("/home/u/pack/");
  });
});

describe("LP-004: the parent folder of a path the engine built with Combine", () => {
  it("keeps the Windows form for a path with a backslash in it, and the host form for one without", () => {
    const linux = { platform: "linux", cwd: "/work" } as const;
    expect(directoryGetParentFullName("/tmp/LanguagePack_x\\imports.mf", linux)).toBe("\\tmp\\LanguagePack_x");
    expect(directoryGetParentFullName("/tmp/LanguagePack_x/imports.mf", linux)).toBe("/tmp/LanguagePack_x");
    expect(directoryGetParentFullName("C:\\tmp\\LanguagePack_x\\imports.mf", linux)).toBe("C:\\tmp\\LanguagePack_x");
  });
});

describe("LP-026: File.WriteAllText", () => {
  it("writes UTF-8 without a byte-order mark and overwrites", () => {
    const root = mkdtempSync(join(tmpdir(), "libsjs-lp-io-"));
    roots.push(root);
    const file = join(root, "Foo.xml");
    fileWriteAllText(file, "<AML>\u00fc\u{1f600}</AML>");
    expect(readFileSync(file)).toEqual(Buffer.from("<AML>\u00fc\u{1f600}</AML>", "utf8"));
    writeFileSync(file, "old and longer than the new text");
    fileWriteAllText(file, "new");
    expect(readFileSync(file, "utf8")).toBe("new");
  });

  it("fails as .NET does for a null path and a missing folder", () => {
    expect(() => fileWriteAllText(null, "x")).toThrow("Path cannot be null.");
    const root = mkdtempSync(join(tmpdir(), "libsjs-lp-io-"));
    roots.push(root);
    expect(() => fileWriteAllText(join(root, "missing", "Foo.xml"), "x")).toThrow("Could not find a part of the path");
  });
});

describe("the exceptions the preprocessor raises", () => {
  it("has the text of .NET's", () => {
    expect(new KeyNotFoundException().message).toBe("The given key was not present in the dictionary.");
    expect(new FileNotFoundException("a.xml", "File not found : a.xml.").message).toBe("File not found : a.xml.");
    expect(new FileNotFoundException("a.xml").message).toBe("Could not find file 'a.xml'.");
  });
});
