import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MemoryVfs } from "../host/memory-fs.js";
import { directoryGetXmlFiles } from "../import/package-files.js";
import { mountFileList } from "./file-list.js";
import type { MountUnzip } from "./mount-options.js";
import { ZipError, vfsFromZip, vfsToZip } from "./zip.js";
import type { ZipErrorCode } from "./zip.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const zipFixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(repoRoot, "fixtures/browser/zips", name)));
const text = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);
const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

/** The files of a folder on disk, by relative path, and its folders, loaded into a tree the way an upload would be. */
function loadFolder(folder: string): MemoryVfs {
  const vfs = new MemoryVfs();
  const visit = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        vfs.mount({ [`${prefix}${name}/`]: new Uint8Array(0) });
        visit(full, `${prefix}${name}/`);
      } else vfs.mount({ [`${prefix}${name}`]: new Uint8Array(readFileSync(full)) });
    }
  };
  visit(folder, "/");
  return vfs;
}

/** The package that the fixture zips of `fixtures/browser/zips/` hold, by path under `Pkg/`. */
const PACKAGE: Record<string, string> = {
  "imports.mf": "<imports>\r\n</imports>\r\n",
  "ItemType/a.xml": '<?xml version="1.0"?>\n<AML><Item type="ItemType" id="1"/></AML>\n',
  "sub/dir/b.xml": `<AML>${"x".repeat(3000)}</AML>\n`,
  "readme.txt": "plain\n",
  "sub/zero.bin": "",
};
const PACKAGE_TREE = ["ItemType/", "ItemType/a.xml", "imports.mf", "readme.txt", "sub/", "sub/dir/", "sub/dir/b.xml", "sub/zero.bin"];

function expectPackage(vfs: MemoryVfs, root = "/"): void {
  expect(vfs.toTree(root)).toEqual(PACKAGE_TREE);
  for (const [file, content] of Object.entries(PACKAGE)) expect(text(vfs.readFile(path.posix.join(root, file))), file).toBe(content);
}

/** A zip built by hand, for the cases no tool makes: every field is the test's. */
interface RawEntry {
  name: string | Uint8Array;
  data?: Uint8Array;
  /** The bytes stored, when they are not `data` (a deflate stream). */
  stored?: Uint8Array;
  method?: number;
  flags?: number;
  crc?: number;
  size?: number;
  compressedSize?: number;
  extra?: Uint8Array;
}

function crcOf(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rawZip(entries: RawEntry[], options: { comment?: Uint8Array; disk?: number } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (part: Uint8Array): void => {
    parts.push(part);
    offset += part.length;
  };
  for (const entry of entries) {
    const name = typeof entry.name === "string" ? encode(entry.name) : entry.name;
    const data = entry.data ?? new Uint8Array(0);
    const stored = entry.stored ?? data;
    const extra = entry.extra ?? new Uint8Array(0);
    const fields = {
      flags: entry.flags ?? 0,
      method: entry.method ?? 0,
      crc: entry.crc ?? crcOf(data),
      compressed: entry.compressedSize ?? stored.length,
      size: entry.size ?? data.length,
    };
    const local = new Uint8Array(30 + name.length + extra.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(6, fields.flags, true);
    lv.setUint16(8, fields.method, true);
    lv.setUint32(14, fields.crc, true);
    lv.setUint32(18, fields.compressed, true);
    lv.setUint32(22, fields.size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, extra.length, true);
    local.set(name, 30);
    local.set(extra, 30 + name.length);
    const record = new Uint8Array(46 + name.length + extra.length);
    const cv = new DataView(record.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(8, fields.flags, true);
    cv.setUint16(10, fields.method, true);
    cv.setUint32(16, fields.crc, true);
    cv.setUint32(20, fields.compressed, true);
    cv.setUint32(24, fields.size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint32(42, offset, true);
    record.set(name, 46);
    record.set(extra, 46 + name.length);
    central.push(record);
    push(local);
    push(stored);
  }
  const start = offset;
  for (const record of central) push(record);
  const comment = options.comment ?? new Uint8Array(0);
  const end = new Uint8Array(22 + comment.length);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, options.disk ?? 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, offset - start, true);
  ev.setUint32(16, start, true);
  ev.setUint16(20, comment.length, true);
  end.set(comment, 22);
  push(end);
  const out = new Uint8Array(offset);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function expectZipError(action: () => unknown, code: ZipErrorCode, message?: RegExp): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ZipError);
    expect((error as ZipError).code).toBe(code);
    if (message !== undefined) expect((error as ZipError).message).toMatch(message);
    return;
  }
  expect.unreachable(`expected a ZipError ${code}`);
}

// -------------------------------------------------------------------------------------------------------------------- reading

// HOST-250: zips made by other tools load to the expected tree.
describe("vfsFromZip on zips made by other tools (HOST-250)", () => {
  const TOOLS: Array<[string, string]> = [
    ["info-zip.zip", "Info-ZIP zip 3.0, deflate"],
    ["info-zip-zip64.zip", "Info-ZIP zip 3.0 with ZIP64 fields (-fz)"],
    ["info-zip-streamed.zip", "Info-ZIP zip 3.0 to a pipe: data descriptors"],
    ["7zip-deflate.zip", "7-Zip 26, deflate"],
    ["7zip-store.zip", "7-Zip 26, store"],
  ];

  it.each(TOOLS)("%s (%s) mounts as written, folder and all", (file) => {
    const vfs = vfsFromZip(zipFixture(file));
    expectPackage(vfs, "/Pkg");
    expect(vfs.toTree("/")).toEqual(["Pkg/", ...PACKAGE_TREE.map((entry) => `Pkg/${entry}`)]);
    // the folder with no file in it is in the tree, though toTree does not list it
    expect(vfs.stat("/Pkg/empty")).toEqual({ isFile: false, isDirectory: true });
  });

  it.each(TOOLS)('%s mounts with the one top-level folder taken off by root: "auto"', (file) => {
    const vfs = vfsFromZip(zipFixture(file), { root: "auto" });
    expectPackage(vfs);
    expect(vfs.stat("/empty").isDirectory).toBe(true);
  });

  it("reads a zip with Windows backslashes as names, folders included", () => {
    const vfs = vfsFromZip(zipFixture("windows-backslash.zip"), { root: "auto" });
    expect(vfs.toTree()).toEqual(["ItemType/", "ItemType/a.xml", "imports.mf", "sub/", "sub/dir/", "sub/dir/b.xml"]);
    expect(text(vfs.readFile("/sub/dir/b.xml"))).toBe(PACKAGE["sub/dir/b.xml"]);
  });

  it("skips __MACOSX, AppleDouble files, .DS_Store and Thumbs.db, and strips the one folder that is left", () => {
    const vfs = vfsFromZip(zipFixture("macos-style.zip"), { root: "auto" });
    expectPackage(vfs);
    const unfiltered = Object.keys(unzipSync(zipFixture("macos-style.zip")));
    expect(unfiltered).toEqual(expect.arrayContaining(["__MACOSX/Pkg/._imports.mf", "Pkg/.DS_Store", "Pkg/ItemType/._b.xml", "Pkg/sub/Thumbs.db"]));
    expect(vfs.toTree()).not.toContainEqual(expect.stringMatching(/__MACOSX|\._|DS_Store|Thumbs/));
  });

  // The point of the filter: the import lists every `*.xml*` file of a folder as a package file (IMP-003).
  it("keeps AppleDouble files out of the import's listing of a package folder", () => {
    const vfs = vfsFromZip(zipFixture("macos-style.zip"), { root: "auto" });
    const environment = { fs: vfs, platform: "linux", cwd: "/" };
    expect(directoryGetXmlFiles("/ItemType", environment)).toEqual(["/ItemType/a.xml"]);

    // what the listing says when the junk gets through (the control: the same folder, mounted without the filter)
    const unfiltered = new MemoryVfs();
    for (const [name, data] of Object.entries(unzipSync(zipFixture("macos-style.zip")))) if (!name.endsWith("/")) unfiltered.mount({ [`/${name}`]: data });
    expect(directoryGetXmlFiles("/Pkg/ItemType", { fs: unfiltered, platform: "linux", cwd: "/" })).toEqual(["/Pkg/ItemType/._b.xml", "/Pkg/ItemType/a.xml"]);
  });

  describe("names outside ASCII", () => {
    const names = (file: string): string[] => vfsFromZip(zipFixture(file)).toTree().filter((entry) => !entry.endsWith("/"));

    it("with the UTF-8 flag (7-Zip: é, CJK)", () => {
      expect(names("names-7zip-utf8.zip")).toEqual(["Pkg/café.xml", "Pkg/日本語/名前.xml"]);
    });

    it("with the UTF-8 flag (Python: é, CJK)", () => {
      expect(names("names-python-utf8.zip")).toEqual(["Pkg/café.xml", "Pkg/日本語/名前.xml"]);
    });

    it("without the flag, in code page 437 (Windows Explorer: é, ü, ß)", () => {
      expect(names("names-cp437.zip")).toEqual(["Pkg/café.xml", "Pkg/straß.xml", "Pkg/über.xml"]);
    });

    it("without the flag, in UTF-8 (Info-ZIP on Linux: é, CJK), as the bytes are valid UTF-8", () => {
      expect(names("names-info-zip.zip")).toEqual(["Pkg/café.xml", "Pkg/日本語/名前.xml"]);
    });

    it("takes the Unicode Path field (0x7075) over the name, when its checksum is the name's", () => {
      const header = Uint8Array.from([0x63, 0x61, 0x66, 0x82, 0x2e, 0x78, 0x6d, 0x6c]); // "caf", 0x82, ".xml"
      const good = new Uint8Array(5 + 9);
      new DataView(good.buffer).setUint8(0, 1);
      new DataView(good.buffer).setUint32(1, crcOf(header), true);
      good.set(encode("café.xml"), 5);
      const field = (payload: Uint8Array): Uint8Array => {
        const out = new Uint8Array(4 + payload.length);
        new DataView(out.buffer).setUint16(0, 0x7075, true);
        new DataView(out.buffer).setUint16(2, payload.length, true);
        out.set(payload, 4);
        return out;
      };
      expect(vfsFromZip(rawZip([{ name: header, data: encode("a"), extra: field(good) }])).toTree()).toEqual(["café.xml"]);
      // a name that was changed after the field was written: the field is not trusted, code page 437 reads the name
      const stale = good.slice();
      new DataView(stale.buffer).setUint32(1, 1, true);
      expect(vfsFromZip(rawZip([{ name: header, data: encode("a"), extra: field(stale) }])).toTree()).toEqual(["café.xml"]);
    });

    it("takes the Unicode Path field over an ASCII placeholder name, and keeps the placeholder when the checksum is stale", () => {
      const placeholder = encode("Pkg/?.xml");
      const field = (path: string, crc: number): Uint8Array => {
        const target = encode(path);
        const out = new Uint8Array(4 + 5 + target.length);
        const view = new DataView(out.buffer);
        view.setUint16(0, 0x7075, true);
        view.setUint16(2, 5 + target.length, true);
        view.setUint8(4, 1);
        view.setUint32(5, crc, true);
        out.set(target, 9);
        return out;
      };
      const crc = crcOf(placeholder);
      const vfs = vfsFromZip(
        rawZip([
          { name: placeholder, data: encode("one"), extra: field("Pkg/日本語/名前.xml", crc) },
          { name: placeholder, data: encode("two"), extra: field("Pkg/日本語/別名.xml", crc) },
        ]),
      );
      expect(text(vfs.readFile("/Pkg/日本語/名前.xml"))).toBe("one");
      expect(text(vfs.readFile("/Pkg/日本語/別名.xml"))).toBe("two");
      expect(vfsFromZip(rawZip([{ name: placeholder, data: encode("x"), extra: field("Pkg/名前.xml", crc ^ 1) }])).toTree()).toEqual(["Pkg/", "Pkg/?.xml"]);
    });

    it("reads a name of code page 437 that is not valid UTF-8 as code page 437, and every byte of the table", () => {
      const bytes = Uint8Array.from({ length: 128 }, (_, index) => 0x80 + index);
      const vfs = vfsFromZip(rawZip(Array.from(bytes, (byte) => ({ name: Uint8Array.of(0x61, byte), data: encode("x") }))));
      const got = vfs.readdir("/").map((entry) => entry.name).sort();
      expect(got).toHaveLength(128);
      // the spot checks of the table: 0x80 Ç, 0x82 é, 0xE1 ß, 0xFB √, 0xFF no-break space
      expect(got).toEqual(expect.arrayContaining(["aÇ", "aé", "aß", "a√", "a "]));
    });
  });

  describe("name rules", () => {
    const files = (entries: Array<string | RawEntry>, options = {}): string[] =>
      vfsFromZip(rawZip(entries.map((entry) => (typeof entry === "string" ? { name: entry, data: encode("x") } : entry))), options).toTree();

    it("drops leading ./ and /, repeated and trailing separators, and . segments, and resolves .. that stays inside", () => {
      expect(files(["./a.xml", "/b.xml", ".//c//d.xml", "e/./f.xml", "g/h/../i.xml", "j/../k.xml"])).toEqual(["a.xml", "b.xml", "c/", "c/d.xml", "e/", "e/f.xml", "g/", "g/i.xml", "k.xml"]);
    });

    it("keeps the case of names apart, as the tree does", () => {
      expect(files(["a.xml", "A.xml"])).toEqual(["A.xml", "a.xml"]);
    });

    it("is a later entry over an earlier one with the same path", () => {
      const vfs = vfsFromZip(rawZip([{ name: "a.xml", data: encode("first") }, { name: "a.xml", data: encode("second") }]));
      expect(text(vfs.readFile("/a.xml"))).toBe("second");
    });

    it("refuses a path that is a file and a folder", () => {
      expectZipError(() => files(["a", "a/b"]), "ZIP_CONFLICT", /"a"/);
      expectZipError(() => files(["a/b", "a"]), "ZIP_CONFLICT");
    });

    it.each(["../x.xml", "a/../../x.xml", "/../x.xml", "..\\x.xml", "a\\..\\..\\x.xml", "a/b/../../../x.xml"])("refuses %s (zip-slip)", (name) => {
      const target = new MemoryVfs({ "/keep.txt": "kept" });
      expectZipError(() => vfsFromZip(rawZip([{ name: "ok.xml", data: encode("x") }, { name, data: encode("x") }]), { into: target }), "ZIP_PATH_ESCAPES_ROOT");
      // refused before anything is written
      expect(target.toTree()).toEqual(["keep.txt"]);
    });

    it("refuses a path that leaves the root even in an entry that would have been skipped", () => {
      expectZipError(() => files(["__MACOSX/../../x"]), "ZIP_PATH_ESCAPES_ROOT");
    });

    it("drops an entry whose name is the root", () => {
      expect(files(["./", "/", "a.xml"])).toEqual(["a.xml"]);
    });

    it("skips junk at any depth, not a name that only looks like it", () => {
      expect(files(["a/.DS_Store", "a/Thumbs.db", "__MACOSX/a.xml", "a/__MACOSX/b.xml", "x/._y.xml", "._z.xml", "thumbs.db", "a._b.xml", ".DS_Store2", "keep.xml"])).toEqual([
        ".DS_Store2",
        "a._b.xml",
        "keep.xml",
        "thumbs.db",
      ]);
    });
  });

  describe("root and into", () => {
    const zip = (): Uint8Array =>
      rawZip([
        { name: "Top/", data: new Uint8Array(0) },
        { name: "Top/a.xml", data: encode("a") },
        { name: "Top/in/b.xml", data: encode("b") },
        { name: "Other/c.xml", data: encode("c") },
      ]);

    it('takes root: "keep" as no root, so that it is the unzip of a mount', async () => {
      const unzip: MountUnzip = vfsFromZip;
      const oneFolder = rawZip([{ name: "Top/a.xml", data: encode("a") }]);
      expect(unzip(oneFolder, { root: "keep" }).toTree()).toEqual(["Top/", "Top/a.xml"]);
      const picked = new File([oneFolder.slice()], "package.zip");
      expect((await mountFileList([picked], { unzip: vfsFromZip, root: "keep" })).toTree()).toEqual(["Top/", "Top/a.xml"]);
      expect((await mountFileList([picked], { unzip: vfsFromZip, root: "auto" })).toTree()).toEqual(["a.xml"]);
    });

    it('keeps the paths when there is no root, and does not strip when "auto" finds two top-level names', () => {
      expect(vfsFromZip(zip()).toTree()).toEqual(["Other/", "Other/c.xml", "Top/", "Top/a.xml", "Top/in/", "Top/in/b.xml"]);
      expect(vfsFromZip(zip(), { root: "auto" }).toTree()).toEqual(["Other/", "Other/c.xml", "Top/", "Top/a.xml", "Top/in/", "Top/in/b.xml"]);
    });

    it('does not strip a lone top-level file with "auto"', () => {
      expect(vfsFromZip(rawZip([{ name: "only.xml", data: encode("x") }]), { root: "auto" }).toTree()).toEqual(["only.xml"]);
      expect(vfsFromZip(rawZip([{ name: "Top/", data: new Uint8Array(0) }]), { root: "auto" }).stat("/Top").isDirectory).toBe(true);
    });

    it("strips only one level, and only when the junk is the other top-level name", () => {
      const vfs = vfsFromZip(rawZip([{ name: "A/B/c.xml", data: encode("c") }, { name: "__MACOSX/A/._c", data: encode("m") }]), { root: "auto" });
      expect(vfs.toTree()).toEqual(["B/", "B/c.xml"]);
    });

    it("mounts at the root of a tree it was given, and keeps what the tree held", () => {
      const into = new MemoryVfs({ "/old.txt": "old", "/Top/a.xml": "replaced" });
      const result = vfsFromZip(zip(), { into });
      expect(result).toBe(into);
      expect(into.toTree()).toEqual(["Other/", "Other/c.xml", "Top/", "Top/a.xml", "Top/in/", "Top/in/b.xml", "old.txt"]);
      expect(text(into.readFile("/Top/a.xml"))).toBe("a");
      expect(text(into.readFile("/old.txt"))).toBe("old");
    });

    it("is a new tree each time without `into`", () => {
      expect(vfsFromZip(zip())).not.toBe(vfsFromZip(zip()));
    });

    it("refuses a path that is the other kind in the tree it was given, and leaves the tree as it was", () => {
      const fileOverFolder = new MemoryVfs({ "/Top": "file" });
      expectZipError(() => vfsFromZip(rawZip([{ name: "A.xml", data: encode("a") }, { name: "Top/b.xml", data: encode("b") }]), { into: fileOverFolder }), "ZIP_CONFLICT", /"Top"/);
      expect(fileOverFolder.toTree()).toEqual(["Top"]);
      const folderOverFile = new MemoryVfs({ "/Top/keep.xml": "k" });
      expectZipError(() => vfsFromZip(rawZip([{ name: "A.xml", data: encode("a") }, { name: "Top", data: encode("b") }]), { into: folderOverFile }), "ZIP_CONFLICT", /"Top"/);
      expect(folderOverFile.toTree()).toEqual(["Top/", "Top/keep.xml"]);
    });

    it('refuses a file and a folder at one path even when root: "auto" would strip the file', () => {
      expectZipError(() => vfsFromZip(rawZip([{ name: "Top", data: encode("t") }, { name: "Top/x.xml", data: encode("x") }]), { root: "auto" }), "ZIP_CONFLICT", /"Top"/);
    });

    it("refuses an entry with no local header or with data past the end before writing to the tree", () => {
      const first = { name: "A.xml", data: encode("new") };
      const noHeader = rawZip([first, { name: "B.xml", data: encode("b") }]);
      new DataView(noHeader.buffer).setUint32(30 + 5 + 3, 0, true);
      const pastEnd = rawZip([first, { name: "B.xml", stored: encode("b"), method: 8, compressedSize: 100000, size: 1 }]);
      for (const zip of [noHeader, pastEnd]) {
        const into = new MemoryVfs({ "/A.xml": "old" });
        expectZipError(() => vfsFromZip(zip, { into }), "ZIP_INVALID", /"B\.xml"/);
        expect(into.toTree()).toEqual(["A.xml"]);
        expect(text(into.readFile("/A.xml"))).toBe("old");
      }
    });

    it("refuses a zip over the remaining capacity of the tree before inflating, whatever maxBytes says", () => {
      const fits = new MemoryVfs({ "/old.txt": "1234567" }, { maxBytes: 10 });
      vfsFromZip(zip(), { into: fits });
      expect(text(fits.readFile("/Top/a.xml"))).toBe("a");
      const full = new MemoryVfs({ "/old.txt": "12345678" }, { maxBytes: 10 });
      expectZipError(() => vfsFromZip(zip(), { into: full, maxBytes: Number.POSITIVE_INFINITY }), "ZIP_TOO_LARGE");
      expect(full.toTree()).toEqual(["old.txt"]);
    });
  });

  describe("refusals", () => {
    it("refuses a zip over maxBytes before inflating anything, and counts only what is kept", () => {
      const zip = zipFixture("macos-style.zip");
      const total = Object.entries(PACKAGE).reduce((sum, [, content]) => sum + content.length, 0);
      expect(() => vfsFromZip(zip, { maxBytes: total })).not.toThrow();
      expectZipError(() => vfsFromZip(zip, { maxBytes: total - 1 }), "ZIP_TOO_LARGE", new RegExp(`${total}`));
      // the first entry is damaged: if anything were inflated first, the error would be the damage and not the size
      const bomb = rawZip([
        { name: "a.xml", data: new Uint8Array(10), stored: Uint8Array.of(1, 2, 3), method: 8, compressedSize: 3, size: 3000 },
        { name: "b.xml", data: new Uint8Array(5) },
      ]);
      expectZipError(() => vfsFromZip(bomb, { maxBytes: 100 }), "ZIP_TOO_LARGE");
    });

    it("refuses over 500 MiB by default before inflating, and lets a caller lift or raise the limit", () => {
      const claimed = 300 * 1024 * 1024;
      const stored = new Uint8Array(Math.ceil(claimed / 1032));
      const bomb = rawZip([
        { name: "a.xml", stored, method: 8, size: claimed },
        { name: "b.xml", stored, method: 8, size: claimed },
      ]);
      expectZipError(() => vfsFromZip(bomb), "ZIP_TOO_LARGE", new RegExp(`${500 * 1024 * 1024}`));
      // past the limit the stream is inflated, and it is damaged
      expectZipError(() => vfsFromZip(bomb, { maxBytes: Number.POSITIVE_INFINITY }), "ZIP_INVALID");
      expectZipError(() => vfsFromZip(bomb, { maxBytes: 2 * claimed }), "ZIP_INVALID");
    });

    it("refuses a size no deflate stream could expand to, before reserving it", () => {
      const lie = rawZip([{ name: "a.xml", data: new Uint8Array(0), stored: Uint8Array.of(3, 0), method: 8, size: 0xfffffffe }]);
      expectZipError(() => vfsFromZip(lie), "ZIP_INVALID", /cannot hold/);
      expectZipError(() => vfsFromZip(rawZip([{ name: "a.xml", data: encode("abc"), size: 4 }])), "ZIP_INVALID", /cannot hold/);
    });

    it("refuses an entry whose data does not inflate to its declared size or its CRC", async () => {
      const { deflateSync } = await import("fflate");
      const data = encode("hello hello hello hello");
      const stored = deflateSync(data);
      expect(text(vfsFromZip(rawZip([{ name: "a", data, stored, method: 8 }])).readFile("/a"))).toBe("hello hello hello hello");
      expectZipError(() => vfsFromZip(rawZip([{ name: "a", data, stored, method: 8, size: data.length - 3 }])), "ZIP_INVALID");
      expectZipError(() => vfsFromZip(rawZip([{ name: "a", data, stored, method: 8, size: data.length + 3 }])), "ZIP_INVALID", /declares/);
      expectZipError(() => vfsFromZip(rawZip([{ name: "a", data, stored, method: 8, crc: 7 }])), "ZIP_INVALID", /CRC/);
      const prefix = data.subarray(0, 5);
      expectZipError(() => vfsFromZip(rawZip([{ name: "a", data: prefix, stored, method: 8 }])), "ZIP_INVALID", /declares/);
      expectZipError(() => vfsFromZip(rawZip([{ name: "a", data, stored: stored.subarray(0, 5), method: 8 }])), "ZIP_INVALID", /damaged|declares/);
      expectZipError(() => vfsFromZip(rawZip([{ name: "a", data: encode("abc"), crc: 1 }])), "ZIP_INVALID", /CRC/);
    });

    it("stops at a damaged entry and leaves the entries before it in a tree it was given", () => {
      const into = new MemoryVfs();
      const zip = rawZip([{ name: "first.xml", data: encode("1") }, { name: "second.xml", data: encode("22"), crc: 5 }]);
      expectZipError(() => vfsFromZip(zip, { into }), "ZIP_INVALID");
      expect(into.toTree()).toEqual(["first.xml"]);
    });

    it("refuses what it cannot read, with a code that says why", () => {
      expectZipError(() => vfsFromZip(rawZip([{ name: "a", data: encode("x"), flags: 1 }])), "ZIP_UNSUPPORTED", /encrypted/);
      expectZipError(() => vfsFromZip(rawZip([{ name: "a", data: encode("x"), method: 12 }])), "ZIP_UNSUPPORTED", /method 12/);
      expectZipError(() => vfsFromZip(rawZip([{ name: "a", data: encode("x") }], { disk: 1 })), "ZIP_UNSUPPORTED", /disks/);
      // a method that is not read is no matter for an entry that is skipped
      expect(vfsFromZip(rawZip([{ name: "__MACOSX/a", data: encode("x"), method: 12 }, { name: "b", data: encode("y") }])).toTree()).toEqual(["b"]);
    });

    it("refuses what is not a zip, or is cut short", () => {
      expectZipError(() => vfsFromZip(new Uint8Array(0)), "ZIP_INVALID");
      expectZipError(() => vfsFromZip(encode("this is not a zip file at all, it is just text")), "ZIP_INVALID", /end-of-central/);
      const zip = zipFixture("info-zip.zip");
      expectZipError(() => vfsFromZip(zip.subarray(0, zip.length - 30)), "ZIP_INVALID");
      expectZipError(() => vfsFromZip(zip.subarray(0, 100)), "ZIP_INVALID");
      // a central directory record with the wrong signature
      const damaged = zip.slice();
      const eocd = damaged.length - 22;
      const offset = new DataView(damaged.buffer).getUint32(eocd + 16, true);
      damaged[offset] = 0;
      expectZipError(() => vfsFromZip(damaged), "ZIP_INVALID", /central directory record/);
    });

    it("refuses an entry whose local header is not where the directory says", () => {
      const zip = rawZip([{ name: "a", data: encode("x") }]);
      zip[0] = 0;
      expectZipError(() => vfsFromZip(zip), "ZIP_INVALID", /local header/);
    });

    it("refuses a count that the central directory cannot hold, and does not spin on it", () => {
      const zip = rawZip([{ name: "a", data: encode("x") }]);
      new DataView(zip.buffer).setUint16(zip.length - 22 + 10, 60000, true);
      expectZipError(() => vfsFromZip(zip), "ZIP_INVALID", /entry count/);
    });

    it("finds the end record before a comment, and ignores a signature inside the comment", () => {
      const fakeEnd = new Uint8Array(30);
      new DataView(fakeEnd.buffer).setUint32(0, 0x06054b50, true);
      const zip = rawZip([{ name: "a", data: encode("x") }], { comment: fakeEnd });
      expect(vfsFromZip(zip).toTree()).toEqual(["a"]);
    });

    it("reads an empty zip as an empty tree", () => {
      expect(vfsFromZip(rawZip([])).toTree()).toEqual([]);
      expect(vfsFromZip(vfsToZip(new MemoryVfs())).toTree()).toEqual([]);
    });
  });
});

// -------------------------------------------------------------------------------------------------------------------- writing

/** The entries of a zip as its central directory lists them, in order (an independent reading for the tests of the writer). */
function listZip(zip: Uint8Array): Array<{ name: string; method: number; flags: number; time: number; date: number; size: number; attributes: number }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const entries = [];
  for (let at = view.getUint32(end + 16, true), index = 0; index < view.getUint16(end + 10, true); index += 1) {
    const nameLength = view.getUint16(at + 28, true);
    entries.push({
      name: new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength)),
      method: view.getUint16(at + 10, true),
      flags: view.getUint16(at + 8, true),
      time: view.getUint16(at + 12, true),
      date: view.getUint16(at + 14, true),
      size: view.getUint32(at + 24, true),
      attributes: view.getUint32(at + 38, true),
    });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}

// HOST-251
describe("vfsToZip (HOST-251)", () => {
  const sample = (): MemoryVfs =>
    new MemoryVfs({
      "/Pkg/imports.mf": PACKAGE["imports.mf"]!,
      "/Pkg/ItemType/a.xml": PACKAGE["ItemType/a.xml"]!,
      "/Pkg/sub/dir/b.xml": PACKAGE["sub/dir/b.xml"]!,
      "/Pkg/sub/zero.bin": new Uint8Array(0),
      "/Pkg/empty/": new Uint8Array(0),
    });

  it("gives the same bytes for the same tree, whatever order it was made in and whenever it runs", () => {
    const forward = vfsToZip(sample());
    const backward = new MemoryVfs();
    for (const [file, bytes] of Array.from(sample().snapshot()).reverse()) backward.mount({ [`/${file}`]: bytes });
    backward.mount({ "/Pkg/empty/": new Uint8Array(0) });
    expect(Array.from(vfsToZip(backward))).toEqual(Array.from(forward));
    expect(Array.from(vfsToZip(sample()))).toEqual(Array.from(forward));
  });

  it("is in NTFS directory order, a folder's entry before what it holds, files and folders together", () => {
    const vfs = new MemoryVfs({ "/b": "1", "/B2": "1", "/a/z": "1", "/a/Y": "1", "/A1/": new Uint8Array(0), "/10": "1", "/2": "1", "/é": "1", "/_": "1" });
    expect(listZip(vfsToZip(vfs)).map((entry) => entry.name)).toEqual(["10", "2", "a/", "a/Y", "a/z", "A1/", "b", "B2", "_", "é"]);
  });

  it("keeps names that are whole numbers where the order puts them", () => {
    const vfs = new MemoryVfs({ "/b": "1", "/1": "1", "/0": "1" });
    expect(listZip(vfsToZip(vfs)).map((entry) => entry.name)).toEqual(["0", "1", "b"]);
  });

  it("writes the DOS epoch by default, whatever the time zone, and a given time in UTC to the 2 s", () => {
    const [first] = listZip(vfsToZip(sample()));
    expect([first!.time, first!.date]).toEqual([0, (0 << 9) | (1 << 5) | 1]);
    const [stamped] = listZip(vfsToZip(sample(), "/", { mtime: new Date(Date.UTC(2024, 2, 5, 10, 20, 31, 999)) }));
    expect(stamped!.time).toBe((10 << 11) | (20 << 5) | 15);
    expect(stamped!.date).toBe(((2024 - 1980) << 9) | (3 << 5) | 5);
    expect(() => vfsToZip(sample(), "/", { mtime: new Date(Date.UTC(1979, 11, 31)) })).toThrow(RangeError);
    expect(() => vfsToZip(sample(), "/", { mtime: new Date(Number.NaN) })).toThrow(RangeError);
  });

  it("flags UTF-8 names that need it and no others, and marks folders", () => {
    const vfs = new MemoryVfs({ "/café.xml": "a", "/日本語/名前.xml": "b", "/plain.xml": "c" });
    const entries = listZip(vfsToZip(vfs));
    expect(entries.map((entry) => [entry.name, entry.flags])).toEqual([
      ["café.xml", 0x800],
      ["plain.xml", 0],
      ["日本語/", 0x800],
      ["日本語/名前.xml", 0x800],
    ]);
    expect(entries.map((entry) => entry.attributes)).toEqual([0, 0, 0x10, 0]);
    expect(vfsFromZip(vfsToZip(vfs)).toTree()).toEqual(["café.xml", "plain.xml", "日本語/", "日本語/名前.xml"]);
  });

  it("deflates what shrinks, stores what does not, and stores everything at level 0", () => {
    const vfs = new MemoryVfs({ "/big.xml": "a".repeat(2000), "/tiny": "x", "/empty": new Uint8Array(0) });
    expect(listZip(vfsToZip(vfs)).map((entry) => [entry.name, entry.method])).toEqual([["big.xml", 8], ["empty", 0], ["tiny", 0]]);
    const stored = vfsToZip(vfs, "/", { level: 0 });
    expect(listZip(stored).map((entry) => entry.method)).toEqual([0, 0, 0]);
    expect(stored.length).toBeGreaterThan(2000);
    expect(() => vfsToZip(vfs, "/", { level: 9 as 6 })).toThrow(RangeError);
    expect(vfsFromZip(stored).snapshot().get("big.xml")).toEqual(encode("a".repeat(2000)));
  });

  it("writes the paths below a folder, relative to it, and fails on a folder that is not there", () => {
    const zip = vfsToZip(sample(), "/Pkg/sub");
    expect(listZip(zip).map((entry) => entry.name)).toEqual(["dir/", "dir/b.xml", "zero.bin"]);
    expect(() => vfsToZip(sample(), "/nope")).toThrow(/ENOENT/);
    expect(() => vfsToZip(sample(), "/Pkg/imports.mf")).toThrow(/ENOTDIR/);
  });

  it("is read by an independent reader (fflate's unzipSync) as the tree it was made from", () => {
    const read = unzipSync(vfsToZip(sample()));
    expect(Object.keys(read).sort()).toEqual(["Pkg/", "Pkg/ItemType/", "Pkg/ItemType/a.xml", "Pkg/empty/", "Pkg/imports.mf", "Pkg/sub/", "Pkg/sub/dir/", "Pkg/sub/dir/b.xml", "Pkg/sub/zero.bin"]);
    expect(text(read["Pkg/sub/dir/b.xml"])).toBe(PACKAGE["sub/dir/b.xml"]);
  });

  it("writes an archive of 65 535 entries or more with the ZIP64 end record, and reads it back", () => {
    const vfs = new MemoryVfs();
    const files: Record<string, string> = {};
    for (let index = 0; index < 70_000; index += 1) files[`/d${index % 50}/f${index}`] = "";
    vfs.mount(files);
    const zip = vfsToZip(vfs, "/", { level: 0 });
    const view = new DataView(zip.buffer);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(0xffff);
    expect(view.getUint32(zip.length - 22 - 20, true)).toBe(0x07064b50);
    const back = vfsFromZip(zip);
    expect(back.toTree()).toEqual(vfs.toTree());
  }, 60_000);

  it("refuses a name over 65 535 bytes", () => {
    const vfs = new MemoryVfs();
    vfs.mount({ [`/${"a".repeat(255)}/`]: new Uint8Array(0) });
    // a path this long cannot be made by one segment; a deep tree gets there
    const deep = Array.from({ length: 300 }, () => "d".repeat(255)).join("/");
    vfs.mount({ [`/${deep}/f`]: "x" });
    expectZipError(() => vfsToZip(vfs), "ZIP_INVALID", /longer than 65535/);
  });
});

// ---------------------------------------------------------------------------------------------------- round trips of the fixtures

const fixtureFolders = (pattern: "import" | "export"): string[] => {
  const folders: string[] = [];
  for (const engine of ["12.0", "14.0.7", "14.35"]) {
    const base = path.join(repoRoot, "fixtures", engine, pattern);
    let cases: string[];
    try {
      cases = readdirSync(base);
    } catch {
      continue;
    }
    for (const name of cases) {
      const folder = pattern === "import" ? (engine === "14.0.7" ? path.join(base, name, "step-1", "input") : undefined) : path.join(base, name, "output");
      if (folder !== undefined && (() => { try { return statSync(folder).isDirectory(); } catch { return false; } })()) folders.push(folder);
    }
  }
  return folders;
};

describe("round trips of the recorded trees (HOST-250, HOST-251)", () => {
  for (const kind of ["import", "export"] as const) {
    const folders = fixtureFolders(kind);

    it(`has the ${kind} trees to run on`, () => {
      expect(folders.length).toBeGreaterThan(kind === "import" ? 30 : 200);
    });

    it(`vfsToZip then vfsFromZip gives back each ${kind} tree by toTree() and by bytes, and the same zip twice`, () => {
      const failures: string[] = [];
      for (const folder of folders) {
        const original = loadFolder(folder);
        const zip = vfsToZip(original);
        const back = vfsFromZip(zip);
        const label = path.relative(repoRoot, folder);
        if (JSON.stringify(back.toTree()) !== JSON.stringify(original.toTree())) failures.push(`${label}: tree`);
        const want = original.snapshot();
        const got = back.snapshot();
        if (want.size !== got.size) failures.push(`${label}: file count`);
        for (const [file, bytes] of want) {
          const other = got.get(file);
          if (other === undefined || other.length !== bytes.length || other.some((byte, index) => byte !== bytes[index])) failures.push(`${label}: ${file}`);
        }
        const again = vfsToZip(loadFolder(folder));
        if (again.length !== zip.length || again.some((byte, index) => byte !== zip[index])) failures.push(`${label}: not deterministic`);
      }
      expect(failures).toEqual([]);
    }, 120_000);
  }

  it("writes folders that have no file, and the reader mounts them", () => {
    const vfs = new MemoryVfs({ "/a/b/c/": new Uint8Array(0), "/f.xml": "x" });
    const back = vfsFromZip(vfsToZip(vfs));
    expect(back.stat("/a/b/c").isDirectory).toBe(true);
  });
});
