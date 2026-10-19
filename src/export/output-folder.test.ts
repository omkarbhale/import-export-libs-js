import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ArgumentException, DirectoryNotFoundException, IOException, NotSupportedException } from "../io/errors.js";
import { directoryCreateDirectory } from "../io/windows-fs.js";
import { loadXml } from "../xml/index.js";
import { createOutputDir, outputFolderName, writeItemFile } from "./output-folder.js";

const work = mkdtempSync(join(tmpdir(), "libsjs-out-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const env = { cwd: work };
const shown = (...parts: string[]): string => [work.replace(/\//g, "\\"), ...parts].join("\\");
const document = (id: string) => loadXml(`<AML><Item id="${id}"/></AML>`, { preserveWhitespace: false });

describe("CreateOutputDir: the folder of a package (EXP-414)", () => {
  // probe COD, fixtures/export-write/probe-14.0.7.txt
  const cases: Array<[string, string]> = [
    ["com.aras.innovator.core", "com\\aras\\innovator\\core"],
    ["com.aras.innovator.solution.PLM", "PLM\\Import"],
    ["com.aras.innovator.Core", "com\\aras\\innovator\\Core"],
    ["COM.ARAS.DEFAULTS.x", "COM\\ARAS\\DEFAULTS\\x"],
    ["com.aras.defaults", "defaults\\Import"],
    ["com.aras.defaults.", "com\\aras\\defaults\\"],
    ["com.aras.innovator.", "com\\aras\\innovator\\"],
    ["com.aras.innovator", "innovator\\Import"],
    ["com.acme.thing", "thing\\Import"],
    ["Thing", "Thing\\Import"],
    ["a.b.", "\\Import"],
    ["a.b.c.", "\\Import"],
    [".", "\\Import"],
    ["", "\\Import"],
    ["a..b", "b\\Import"],
    ["a.b.CON", "CON\\Import"],
    ["a b.c d", "c d\\Import"],
    ["a.b/c", "b/c\\Import"],
  ];

  it.each(cases)("%j is %j", (name, relativeFolder) => {
    expect(outputFolderName(name)).toBe(relativeFolder);
  });

  it("joins the working directory and the folder with no separator logic", () => {
    const wd = join(work, "joined");
    mkdirSync(wd);
    expect(createOutputDir(wd, "com.aras.innovator.core", env)).toBe(`${wd}\\com\\aras\\innovator\\core`);
    expect(createOutputDir(`${wd}\\`, "com.x.PLM", env)).toBe(`${wd}\\\\PLM\\Import`);
    expect(createOutputDir("rel_out", "com.x.PLM", env)).toBe("rel_out\\PLM\\Import");
    expect(existsSync(join(work, "rel_out", "PLM", "Import"))).toBe(true);
    expect(createOutputDir(wd, "a.b.", env)).toBe(`${wd}\\\\Import`);
    expect(existsSync(join(wd, "Import"))).toBe(true);
  });

  it("makes the folders of a standard package from its dotted name", () => {
    const wd = join(work, "standard");
    mkdirSync(wd);
    createOutputDir(wd, "com.aras.defaults.x", env);
    expect(existsSync(join(wd, "com", "aras", "defaults", "x"))).toBe(true);
  });

  it("fails as the file functions do for names a Windows path cannot hold", () => {
    const wd = join(work, "bad");
    mkdirSync(wd);
    expect(() => createOutputDir(wd, "a.b ", env)).toThrow(new DirectoryNotFoundException(shown("bad", "b ", "Import")));
    expect(() => createOutputDir(wd, "a.b\n", env)).toThrow(new ArgumentException("Illegal characters in path."));
    expect(() => createOutputDir(wd, "a.b.c:d", env)).toThrow(new NotSupportedException("The given path's format is not supported."));
    expect(() => createOutputDir(wd, null, env)).toThrow("Object reference not set to an instance of an object.");
  });

  it("refuses to make a folder where a file has the name", () => {
    const wd = join(work, "filedir");
    mkdirSync(join(wd, "FF"), { recursive: true });
    writeFileSync(join(wd, "FF", "Import"), "x");
    expect(() => createOutputDir(wd, "a.FF", env)).toThrow(
      new IOException(`Cannot create "${shown("filedir", "FF", "Import")}\\" because a file or directory with the same name already exists.`),
    );
  });
});

describe("CreateOutputDir: the wipe (EXP-415, EXP-416)", () => {
  it("deletes the folder with everything in it before it creates it again", () => {
    const wd = join(work, "wipe");
    mkdirSync(join(wd, "PLM", "Import", "sub"), { recursive: true });
    writeFileSync(join(wd, "PLM", "Import", "keep.txt"), "x");
    writeFileSync(join(wd, "PLM", "other.txt"), "x");
    createOutputDir(wd, "com.x.PLM", env);
    expect(readdirSync(join(wd, "PLM", "Import"))).toEqual([]);
    expect(readdirSync(join(wd, "PLM"))).toContain("other.txt");
  });

  it("matches the folder without regard to case, and leaves it spelled as the new request spells it", () => {
    const wd = join(work, "wipecase");
    mkdirSync(join(wd, "com", "aras", "innovator", "Core"), { recursive: true });
    writeFileSync(join(wd, "com", "aras", "innovator", "Core", "x.txt"), "x");
    createOutputDir(wd, "com.aras.innovator.core", env);
    expect(readdirSync(join(wd, "com", "aras", "innovator"))).toEqual(["core"]);
    expect(readdirSync(join(wd, "com", "aras", "innovator", "core"))).toEqual([]);
  });

  it("gives two packages with one last segment one folder, and the second wipes the first", () => {
    const wd = join(work, "collide");
    mkdirSync(wd);
    const folder = createOutputDir(wd, "com.x.PLM", env);
    writeItemFile(folder, "Method", "a.xml", document("one"), env);
    expect(createOutputDir(wd, "org.y.PLM", env)).toBe(folder);
    expect(existsSync(join(wd, "PLM", "Import", "Method", "a.xml"))).toBe(false);
  });
});

describe("the engines", () => {
  it("builds the layout of 12.0 and 14.0.7 only", () => {
    expect(() => createOutputDir(work, "a.b", env, "14.35")).toThrow("engine 14.35 is not yet supported");
    expect(() => writeItemFile(work, "T", "a.xml", document("x"), env, "14.35")).toThrow("engine 14.35 is not yet supported");
  });
});

describe("the item file: its folder and its name (EXP-417, EXP-419)", () => {
  const folder = join(work, "fs5");
  mkdirSync(folder);
  const written: Array<[string, string]> = [];

  const write = (type: string | null, name: string, id: string): string => {
    const path = writeItemFile(folder, type, name, document(id), env);
    written.push([type ?? "", name]);
    return path;
  };

  // probe TW, "Engine call form for the type directory"
  it("writes a type's items below a folder of that name", () => {
    expect(write("Method", "a.xml", "m1")).toBe(`${folder}\\Method\\a.xml`);
    write("method", "b.xml", "m2");
    write("METHOD", "A.XML", "m3");
    write("Item Type", "with space.xml", "sp-name");
    expect(readdirSync(join(folder, "Method")).sort()).toEqual(["a.xml", "b.xml"]);
    expect(readFileSync(join(folder, "Method", "a.xml"), "utf8")).toContain('id="m3"');
  });

  it("nests folders for / and \\, and ignores a trailing dot", () => {
    write("a/b", "x.xml", "slash");
    write("a\\b", "y.xml", "backslash");
    write("Dot.", "a.xml", "dot");
    write("Dot", "b.xml", "dot-plain");
    expect(readdirSync(join(folder, "a", "b")).sort()).toEqual(["x.xml", "y.xml"]);
    expect(readdirSync(join(folder, "Dot")).sort()).toEqual(["a.xml", "b.xml"]);
  });

  it("makes the folder of a type that ends in a space and then fails to write below it", () => {
    for (const type of ["Sp ", "Two   ", "Sp.. "]) {
      expect(() => write(type, "a.xml", "x")).toThrow(new DirectoryNotFoundException(shown("fs5", `${type}`, "a.xml")));
    }
    write("Sp", "b.xml", "sp-plain");
    expect(readdirSync(join(folder, "Sp"))).toEqual(["b.xml"]);
    expect(existsSync(join(folder, "Two"))).toBe(true);
  });

  it("refuses a colon and the illegal characters of a path", () => {
    expect(() => write("a:b", "x.xml", "x")).toThrow(new NotSupportedException("The given path's format is not supported."));
    for (const type of ["a*b", "a?b", 'a"b', "a<b", "a|b"]) expect(() => write(type, "x.xml", "x")).toThrow(new ArgumentException("Illegal characters in path."));
  });

  it("writes into the folder itself for an empty type, into it for `.`, and into its parent for `..`", () => {
    write("", "x.xml", "empty-type");
    write(".", "cur.xml", "dot");
    write("..", "up.xml", "up");
    expect(readdirSync(folder)).toEqual(expect.arrayContaining(["x.xml", "cur.xml"]));
    expect(existsSync(join(work, "up.xml"))).toBe(true);
    write(null, "nul.xml", "null-type");
    expect(existsSync(join(folder, "nul.xml"))).toBe(true);
  });

  it("cannot write below NUL, and writes below CON", () => {
    expect(() => write("NUL", "x.xml", "x")).toThrow(new DirectoryNotFoundException(shown("fs5", "NUL", "x.xml")));
    write("CON", "x.xml", "con");
    expect(existsSync(join(folder, "CON", "x.xml"))).toBe(true);
  });

  it("writes a file name of spaces and dots as it is", () => {
    write("T", " .xml", "space-name");
    write("T", "..xml", "dots-name");
    write("T", ".xml", "only-ext");
    expect(readdirSync(join(folder, "T")).sort()).toEqual([" .xml", "..xml", ".xml"]);
  });

  it("lists nothing that the probe did not write", () => {
    const tree = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? [`${entry.name}/`, ...tree(join(dir, entry.name)).map((child) => `${entry.name}/${child}`)] : [entry.name],
      );
    expect(tree(folder).sort()).toEqual(
      [
        "CON/",
        "CON/x.xml",
        "Dot/",
        "Dot/a.xml",
        "Dot/b.xml",
        "Item Type/",
        "Item Type/with space.xml",
        "Method/",
        "Method/a.xml",
        "Method/b.xml",
        "Sp/",
        "Sp/b.xml",
        "T/",
        "T/ .xml",
        "T/..xml",
        "T/.xml",
        "Two/",
        "a/",
        "a/b/",
        "a/b/x.xml",
        "a/b/y.xml",
        "cur.xml",
        "nul.xml",
        "x.xml",
      ].sort(),
    );
  });

  it("makes the type folder with the bytes of EXP-423", () => {
    const path = writeItemFile(folder, "Bytes", "b.xml", loadXml('<AML><Item type="a"><name>x</name></Item></AML>', { preserveWhitespace: false }), env);
    expect(readFileSync(path.replace(/\\/g, "/"))).toEqual(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('<AML>\r\n <Item type="a">\r\n  <name>x</name>\r\n </Item>\r\n</AML>')]));
    directoryCreateDirectory(`${folder}\\Bytes\\`, env);
  });
});
