import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { unescapeProbe } from "../manifest/probe-output.js";
import { ArgumentException, DirectoryNotFoundException, IOException, NotSupportedException, PathTooLongException, UnauthorizedAccessException } from "./errors.js";
import { normalizeLongPath } from "./host-path.js";
import { NTFS_UPCASE_RUNS } from "./ntfs-upcase-data.js";
import { directoryCreateDirectory, directoryDelete, directoryExists, ntfsFoldKey, writeVolumeFile } from "./windows-fs.js";

const work = mkdtempSync(join(tmpdir(), "libsjs-winfs-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A path of the engine's form: the work folder, then Windows separators. */
const at = (...parts: string[]): string => [work, ...parts].join("\\");
/** The path as .NET words it in a message. */
const shown = (...parts: string[]): string => [work.replace(/\//g, "\\"), ...parts].join("\\");
const env = { cwd: work };
const bytes = (text: string): Buffer => Buffer.from(text);

describe("the NTFS upcase table (EXP-420)", () => {
  const recorded = readFileSync(new URL("../../fixtures/export-write/ntfs-upcase-bmp.txt", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[0-9A-F]{4} ~ [0-9A-F]{4}$/.test(line))
    .map((line) => [Number.parseInt(line.slice(0, 4), 16), Number.parseInt(line.slice(7, 11), 16)] as const);

  it("folds exactly the 973 code units the volume folds", () => {
    const expanded: Array<readonly [number, number]> = [];
    for (const [first, last, stride, delta] of NTFS_UPCASE_RUNS) for (let at = first; at <= last; at += stride) expanded.push([at, at + delta]);
    expect(recorded).toHaveLength(973);
    expect(expanded).toEqual(recorded);
  });

  it("differs from toUpperCase where the volume does", () => {
    expect(ntfsFoldKey("a\u00E4")).toBe(ntfsFoldKey("A\u00C4"));
    expect(ntfsFoldKey("\u00B5")).not.toBe(ntfsFoldKey("\u039C"));
    expect(ntfsFoldKey("\u0131")).not.toBe(ntfsFoldKey("I"));
    expect(ntfsFoldKey("\u017F")).not.toBe(ntfsFoldKey("S"));
    expect(ntfsFoldKey("\u212A")).not.toBe(ntfsFoldKey("k"));
    expect(ntfsFoldKey("\u1F88")).toBe(ntfsFoldKey("\u1F80"));
  });

  it("folds each UTF-16 unit on its own and never normalizes", () => {
    expect(ntfsFoldKey("\uD801\uDC00")).not.toBe(ntfsFoldKey("\uD801\uDC28"));
    expect(ntfsFoldKey("e\u0301")).not.toBe(ntfsFoldKey("\u00E9"));
  });
});

describe("one name for names the volume folds together (EXP-419, EXP-420)", () => {
  const cases = readFileSync(new URL("../../fixtures/export-write/probe-14.0.7.txt", import.meta.url), "utf8")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^CASE .* \(U\+([0-9A-F]{4}) \/ U\+([0-9A-F]{4})\) -> files: (.*)$/.exec(line);
      return match ? [{ first: String.fromCharCode(Number.parseInt(match[1] as string, 16)), second: String.fromCharCode(Number.parseInt(match[2] as string, 16)), files: unescapeProbe(match[3] as string).split(" | ") }] : [];
    });

  it("has the recorded cases", () => expect(cases.length).toBeGreaterThanOrEqual(12));

  it.each(cases.map((c) => [`U+${c.first.charCodeAt(0).toString(16)} and U+${c.second.charCodeAt(0).toString(16)}`, c] as const))("%s", (_, c) => {
    const folder = at(`c_${c.first.charCodeAt(0).toString(16)}_${c.second.charCodeAt(0).toString(16)}`);
    directoryCreateDirectory(`${folder}\\`, env);
    writeVolumeFile(`${folder}\\${c.first}.xml`, bytes("one"), env);
    writeVolumeFile(`${folder}\\${c.second}.xml`, bytes("two"), env);
    const written = readdirSync(join(work, `c_${c.first.charCodeAt(0).toString(16)}_${c.second.charCodeAt(0).toString(16)}`));
    expect([...written].sort()).toEqual([...c.files].sort());
  });

  it("keeps the spelling of the first creation and the content of the last write (T1)", () => {
    directoryCreateDirectory(at("t1") + "\\", env);
    for (const [name, text] of [["y.XML", "first"], ["y.Xml", "second"], ["Y.xml", "third"]] as const) writeVolumeFile(at("t1", name), bytes(text), env);
    expect(readdirSync(join(work, "t1"))).toEqual(["y.XML"]);
    expect(readFileSync(join(work, "t1", "y.XML"), "utf8")).toBe("third");
  });

  it("keeps a folder under the spelling it was made with, and finds it through another", () => {
    directoryCreateDirectory(at("Case") + "\\", env);
    expect(directoryExists(at("case") + "\\", env)).toBe(true);
    directoryCreateDirectory(at("CASE", "sub") + "\\", env);
    expect(readdirSync(join(work, "Case"))).toEqual(["sub"]);
  });
});

describe("trailing dots and spaces (EXP-420)", () => {
  it("drops them from the last name of a file", () => {
    directoryCreateDirectory(at("w2") + "\\", env);
    for (const name of ["tr.xml ", "tr.xml.", "tr2.xml   ", "tr3 .xml", "dot.."]) writeVolumeFile(at("w2", name), bytes(name), env);
    expect(readdirSync(join(work, "w2")).sort()).toEqual(["dot", "tr.xml", "tr2.xml", "tr3 .xml"]);
  });

  it("makes a folder without them, and cannot reach it by the name with a space before a separator", () => {
    directoryCreateDirectory(at("Sp ") + "\\", env);
    expect(existsSync(join(work, "Sp"))).toBe(true);
    expect(directoryExists(at("Sp ") + "\\", env)).toBe(false);
    expect(directoryExists(at("Sp"), env)).toBe(true);
    expect(directoryExists(at("Sp "), env)).toBe(true);
    expect(() => writeVolumeFile(at("Sp ", "a.xml"), bytes("x"), env)).toThrow(new DirectoryNotFoundException(shown("Sp ", "a.xml")));
  });

  it("removes one trailing dot of a name before a separator, and all of the last name", () => {
    directoryCreateDirectory(at("Dotx.") + "\\", env);
    expect(readdirSync(work)).toContain("Dotx");
    expect(directoryExists(at("Dotx..", "x"), env)).toBe(false);
    directoryCreateDirectory(at("doty..") + "\\", env);
    expect(readdirSync(work)).toContain("doty");
    expect(readdirSync(work)).not.toContain("doty..");
  });
});

describe("the names of a path (EXP-420)", () => {
  it("takes both separators, drops empty names and resolves . and ..", () => {
    directoryCreateDirectory(`${work}\\n1\\\\n2/n3\\.\\..\\n3\\`, env);
    expect(existsSync(join(work, "n1", "n2", "n3"))).toBe(true);
    expect(directoryExists(`${work}\\n1/n2\\n3`, env)).toBe(true);
    writeVolumeFile(`${work}\\n1\\n2\\..\\n2\\f.xml`, bytes("x"), env);
    expect(readdirSync(join(work, "n1", "n2")).sort()).toEqual(["f.xml", "n3"]);
  });

  it("reads a relative path from the current directory", () => {
    directoryCreateDirectory("rel_dir\\inner\\", env);
    expect(existsSync(join(work, "rel_dir", "inner"))).toBe(true);
    writeVolumeFile(".\\rel_dir\\inner\\f.xml", bytes("x"), env);
    expect(directoryExists("rel_dir\\inner", env)).toBe(true);
  });

  it("refuses illegal characters and a colon as .NET does", () => {
    for (const bad of ["a*b", "a?b", 'a"b', "a<b", "a|b"]) expect(() => directoryCreateDirectory(at(bad) + "\\", env)).toThrow(new ArgumentException("Illegal characters in path."));
    expect(() => directoryCreateDirectory(at("a:b") + "\\", env)).toThrow(new NotSupportedException("The given path's format is not supported."));
  });

  it("refuses a name of more than 255 code units, and a path of 258 or 259 characters or more", () => {
    expect(() => directoryExists(at("x".repeat(256)), env)).toThrow(PathTooLongException);
    expect(() => directoryExists("x".repeat(258), env)).toThrow(PathTooLongException);
    expect(() => directoryExists("/" + "x".repeat(258), env)).toThrow(PathTooLongException);
    expect(directoryExists("x".repeat(255), env)).toBe(false);
  });
});

describe("device names (EXP-417, EXP-420)", () => {
  it("cannot write below a folder called NUL, but CON, aux and LPT1 are ordinary folders", () => {
    directoryCreateDirectory(at("dev") + "\\", env);
    expect(() => writeVolumeFile(at("dev", "NUL", "x.xml"), bytes("x"), env)).toThrow(new DirectoryNotFoundException(shown("dev", "NUL", "x.xml")));
    expect(() => writeVolumeFile(at("dev", "nul", "x.xml"), bytes("x"), env)).toThrow(DirectoryNotFoundException);
    for (const device of ["CON", "aux", "LPT1"]) {
      directoryCreateDirectory(at("dev", device) + "\\", env);
      writeVolumeFile(at("dev", device, "x.xml"), bytes("x"), env);
    }
    expect(readdirSync(join(work, "dev")).sort()).toEqual(["CON", "LPT1", "aux"]);
  });
});

describe("failures of the volume (EXP-415, EXP-420)", () => {
  it("does not create a folder where a file has the name, and says so", () => {
    writeFileSync(join(work, "isfile"), "x");
    expect(directoryExists(at("isfile"), env)).toBe(false);
    expect(() => directoryCreateDirectory(at("isfile"), env)).toThrow(
      new IOException(`Cannot create "${shown("isfile")}\\" because a file or directory with the same name already exists.`),
    );
    expect(() => directoryCreateDirectory(at("isfile", "below"), env)).toThrow(DirectoryNotFoundException);
  });

  it("does not write a file where a folder has the name", () => {
    directoryCreateDirectory(at("isdir") + "\\", env);
    expect(() => writeVolumeFile(at("isdir"), bytes("x"), env)).toThrow(UnauthorizedAccessException);
  });

  it("does not write into a folder that is missing", () => {
    expect(() => writeVolumeFile(at("nothere", "f.xml"), bytes("x"), env)).toThrow(new DirectoryNotFoundException(shown("nothere", "f.xml")));
  });

  it("makes the folder of a name that ends in a space before more path, then fails below it (COD)", () => {
    expect(() => directoryCreateDirectory(at("b ", "Import"), env)).toThrow(new DirectoryNotFoundException(shown("b ", "Import")));
    expect(existsSync(join(work, "b"))).toBe(true);
    expect(existsSync(join(work, "b", "Import"))).toBe(false);
  });

  it("deletes a folder with everything in it, and refuses one that is missing", () => {
    directoryCreateDirectory(at("del", "sub") + "\\", env);
    writeVolumeFile(at("del", "keep.txt"), bytes("x"), env);
    directoryDelete(at("del"), true, env);
    expect(existsSync(join(work, "del"))).toBe(false);
    expect(() => directoryDelete(at("del"), true, env)).toThrow(new DirectoryNotFoundException(shown("del")));
  });

  it("refuses a null or empty path as .NET does", () => {
    expect(directoryExists(null, env)).toBe(false);
    expect(directoryExists("", env)).toBe(false);
    expect(() => directoryCreateDirectory(null, env)).toThrow("Value cannot be null.\r\nParameter name: path");
    expect(() => writeVolumeFile(null, bytes("x"), env)).toThrow("Path cannot be null.\r\nParameter name: path");
    expect(() => writeVolumeFile("", bytes("x"), env)).toThrow(new ArgumentException("Empty path name is not legal."));
  });
});

describe("NormalizeLongPath input limits (EXP-421)", () => {
  const windows = { platform: "win32", cwd: "C:\\work\\tmp5" } as const;
  const absolute = (length: number): string => `C:\\${"d".repeat(length - 3)}`;

  it("adds the prefix to the full path from 255 characters and refuses an absolute input of 259 (NLPL)", () => {
    expect(normalizeLongPath(absolute(254), windows)).toBe(absolute(254));
    expect(normalizeLongPath(absolute(255), windows)).toBe(`\\\\?\\${absolute(255)}`);
    expect(normalizeLongPath(absolute(258), windows)).toBe(`\\\\?\\${absolute(258)}`);
    expect(() => normalizeLongPath(absolute(259), windows)).toThrow(PathTooLongException);
  });

  it("refuses a relative input of 258 (NLPL)", () => {
    const relative = (length: number): string => "d".repeat(length);
    expect(normalizeLongPath(relative(200), windows)).toBe(relative(200));
    expect(normalizeLongPath(relative(257), windows)).toBe(`\\\\?\\C:\\work\\tmp5\\${relative(257)}`);
    expect(() => normalizeLongPath(relative(258), windows)).toThrow(PathTooLongException);
  });

  it("writes through the prefix and sends a UNC path to a folder below the current directory (EXP-422)", () => {
    directoryCreateDirectory(at("unc") + "\\", env);
    expect(() => writeVolumeFile("\\\\server\\share\\f.xml", bytes("x"), env)).toThrow(DirectoryNotFoundException);
    directoryCreateDirectory("server\\share\\", env);
    writeVolumeFile("\\\\server\\share\\f.xml", bytes("x"), env);
    expect(readFileSync(join(work, "server", "share", "f.xml"), "utf8")).toBe("x");
  });
});
