import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryVfs } from "../host/memory-fs.js";
import { directoryGetXmlFiles } from "../import/package-files.js";
import { planPackage } from "../import/plan.js";
import { FakeDirectoryHandle } from "./fake-directory-handle.js";
import {
  CommitError,
  commitToDirectory,
  isFileSystemAccessSupported,
  mountDirectory,
  type FsaProgress,
} from "./fsa.js";
import { STUB_THRESHOLD, defaultInclude, stubsOf } from "./mount-options.js";

const text = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);
const bytesOf = (size: number, fill = 7): Uint8Array => new Uint8Array(size).fill(fill);

/** Puts a stub in a tree, with the folders above it. */
function addStub(vfs: MemoryVfs, path: string): void {
  vfs.mount({ [path]: new Uint8Array(0) });
  vfs.markStub(path);
}

/** The file contents of a fake tree and of a `MemoryVfs`, side by side. */
const filesOf = (handle: FakeDirectoryHandle): Map<string, Uint8Array> =>
  new Map([...handle.contents()].filter((entry): entry is [string, Uint8Array] => entry[1] !== undefined));

/** A fake tree with the files of a folder of the repository, read from disk. */
function fakeFromDisk(root: string): FakeDirectoryHandle {
  const handle = new FakeDirectoryHandle("root");
  const visit = (relative: string): void => {
    const entries = readdirSync(join(root, relative), { withFileTypes: true });
    if (entries.length === 0 && relative !== "") handle.put(`${relative}/`);
    for (const entry of entries) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else handle.put(path, new Uint8Array(readFileSync(join(root, path))));
    }
  };
  visit("");
  return handle;
}

/** The paths of two maps of file contents that differ: a path only one has, or bytes that are not equal. Fast where `toEqual` is not. */
function differences(actual: ReadonlyMap<string, Uint8Array>, expected: ReadonlyMap<string, Uint8Array>): string[] {
  const different: string[] = [];
  for (const [path, bytes] of expected) {
    const other = actual.get(path);
    if (other === undefined || !Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).equals(other)) different.push(path);
  }
  for (const path of actual.keys()) if (!expected.has(path)) different.push(path);
  return different;
}

const sample = (): FakeDirectoryHandle =>
  new FakeDirectoryHandle("pick")
    .put("imports.mf", "<imports/>")
    .put("Import/ItemType/A.xml", "<AML/>")
    .put("Import/ItemType/notes.txt", "n")
    .put("Import/Empty/");

describe("mountDirectory (HOST-252)", () => {
  it("copies every folder and file, the empty folders too, into a new tree", async () => {
    const vfs = await mountDirectory(sample());
    expect(vfs).toBeInstanceOf(MemoryVfs);
    expect(vfs.toTree()).toEqual(["Import/", "Import/ItemType/", "Import/ItemType/A.xml", "Import/ItemType/notes.txt", "imports.mf"]);
    expect(vfs.stat("/Import/Empty").isDirectory).toBe(true);
    expect(text(vfs.readFile("/Import/ItemType/A.xml"))).toBe("<AML/>");
    expect(vfs.size).toBe("<imports/>".length + "<AML/>".length + 1);
  });

  it("puts the contents at `at` of a tree it was given, and keeps what the tree held", async () => {
    const vfs = new MemoryVfs({ "/keep.txt": "k" });
    expect(await mountDirectory(sample(), { into: vfs, at: "/package" })).toBe(vfs);
    expect(vfs.exists("/keep.txt")).toBe(true);
    expect(vfs.exists("/package/imports.mf")).toBe(true);
    expect(vfs.exists("/package/Import/Empty")).toBe(true);
    const relative = new MemoryVfs({}, { cwd: "/work" });
    await mountDirectory(sample(), { into: relative, at: "in" });
    expect(relative.exists("/work/in/imports.mf")).toBe(true);
  });

  it("copies the bytes: the tree and the handle share nothing", async () => {
    const handle = new FakeDirectoryHandle("h").put("a.xml", bytesOf(4, 1));
    const vfs = await mountDirectory(handle);
    vfs.writeFile("/a.xml", bytesOf(4, 9));
    expect(handle.contents().get("a.xml")).toEqual(bytesOf(4, 1));
  });

  describe("the default include", () => {
    it("is content for the package files whatever their size, and for small files; a stub for another large file", () => {
      expect(defaultInclude("Import/x", "directory", 0)).toBe("content");
      expect(defaultInclude("Import/Big.XML", "file", 50_000_000)).toBe("content");
      expect(defaultInclude("Import/Big.xmlbak", "file", 50_000_000)).toBe("content");
      expect(defaultInclude("imports.mf", "file", 50_000_000)).toBe("content");
      expect(defaultInclude("Import/a.bin", "file", STUB_THRESHOLD)).toBe("content");
      expect(defaultInclude("Import/a.bin", "file", STUB_THRESHOLD + 1)).toBe("stub");
    });

    it("makes a stub of a large other file: listed, never read, and EIO when the engine reads it", async () => {
      const handle = new FakeDirectoryHandle("h")
        .put("Big.xml", bytesOf(STUB_THRESHOLD + 10))
        .put("Files/video.bin", bytesOf(STUB_THRESHOLD + 10))
        .put("Files/small.bin", bytesOf(100));
      const vfs = await mountDirectory(handle);
      expect(vfs.toTree()).toEqual(["Big.xml", "Files/", "Files/small.bin", "Files/video.bin"]);
      expect(handle.state.reads.sort()).toEqual(["/Big.xml", "/Files/small.bin"]);
      expect(vfs.stat("/Files/video.bin").isFile).toBe(true);
      expect(stubsOf(vfs).has("/Files/video.bin")).toBe(true);
      expect(stubsOf(vfs).has("/Files/small.bin")).toBe(false);
      expect(vfs.size).toBe(STUB_THRESHOLD + 10 + 100);
      expect(() => vfs.readFile("/Files/video.bin")).toThrow(expect.objectContaining({ code: "EIO", message: "EIO: i/o error, read '/Files/video.bin'" }));
      expect(() => vfs.openAppend("/Files/video.bin")).toThrow(expect.objectContaining({ code: "EIO" }));
      expect(vfs.readdir("/Files").map((entry) => entry.name).sort()).toEqual(["small.bin", "video.bin"]);
      expect([...vfs.snapshot("/Files").keys()]).toEqual(["small.bin"]);
      vfs.writeFile("/Files/video.bin", bytesOf(3));
      expect(stubsOf(vfs).has("/Files/video.bin")).toBe(false);
      expect(vfs.readFile("/Files/video.bin")).toEqual(bytesOf(3));
    });
  });

  it("an include of its own decides content, stub or skip, by the path relative to the handle", async () => {
    const seen: Array<[string, string, number]> = [];
    const vfs = await mountDirectory(sample(), {
      include: (path, kind, size) => {
        seen.push([path, kind, size]);
        if (path === "Import/Empty") return "skip";
        if (path === "Import/ItemType/notes.txt") return "stub";
        return "content";
      },
    });
    expect(seen).toContainEqual(["Import/ItemType/A.xml", "file", 6]);
    expect(seen).toContainEqual(["Import/ItemType", "directory", 0]);
    expect(vfs.exists("/Import/Empty")).toBe(false);
    expect(stubsOf(vfs).has("/Import/ItemType/notes.txt")).toBe(true);
    const skipFolder = await mountDirectory(sample(), { include: (path) => (path === "Import" ? "skip" : "content") });
    expect(skipFolder.toTree()).toEqual(["imports.mf"]);
    const folderStub = await mountDirectory(sample(), { include: (_path, kind) => (kind === "directory" ? "stub" : "content") });
    expect(folderStub.toTree()).toContain("Import/ItemType/A.xml");
  });

  describe("maxBytes", () => {
    it("refuses a mount that passes it with ENOSPC, before the file is read, and leaves the tree as it was", async () => {
      const handle = new FakeDirectoryHandle("h").put("a.xml", bytesOf(60)).put("b.xml", bytesOf(60)).put("c.xml", bytesOf(60));
      const vfs = new MemoryVfs({ "/keep": "k" });
      await expect(mountDirectory(handle, { into: vfs, maxBytes: 100 })).rejects.toMatchObject({ code: "ENOSPC" });
      expect(vfs.toTree()).toEqual(["keep"]);
      expect(handle.state.reads).toEqual(["/a.xml"]);
    });

    it("counts only the content, so stubs and skipped files cost nothing, and the room the target tree has left", async () => {
      const handle = new FakeDirectoryHandle("h").put("a.xml", bytesOf(60)).put("big.bin", bytesOf(STUB_THRESHOLD + 1));
      await expect(mountDirectory(handle, { maxBytes: 60 })).resolves.toBeInstanceOf(MemoryVfs);
      const limited = new MemoryVfs({ "/x": bytesOf(50) }, { maxBytes: 100 });
      await expect(mountDirectory(handle, { into: limited })).rejects.toMatchObject({ code: "ENOSPC" });
      expect(limited.toTree()).toEqual(["x"]);
    });
  });

  describe("abort", () => {
    it("rejects with the reason of a signal that was aborted before", async () => {
      const vfs = new MemoryVfs();
      const controller = new AbortController();
      controller.abort(new Error("stop"));
      await expect(mountDirectory(sample(), { into: vfs, signal: controller.signal })).rejects.toThrow("stop");
      expect(vfs.toTree()).toEqual([]);
    });

    it("an abort in the middle leaves no partial state in the tree", async () => {
      const vfs = new MemoryVfs({ "/keep": "k" });
      const controller = new AbortController();
      const handle = sample();
      let seen = 0;
      await expect(
        mountDirectory(handle, {
          into: vfs,
          signal: controller.signal,
          onProgress: () => {
            seen += 1;
            if (seen === 3) controller.abort(new DOMException("aborted", "AbortError"));
          },
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(seen).toBe(3);
      expect(vfs.toTree()).toEqual(["keep"]);
      expect(vfs.size).toBe(1);
    });
  });

  it("tells the progress after each entry, the counts only growing", async () => {
    const handle = sample().put("big.bin", bytesOf(STUB_THRESHOLD + 1));
    const seen: FsaProgress[] = [];
    await mountDirectory(handle, { onProgress: (progress) => seen.push(progress) });
    expect(seen.length).toBe(7);
    const last = seen[seen.length - 1];
    expect(last).toMatchObject({ files: 3, directories: 3, stubs: 1, bytes: "<imports/>".length + "<AML/>".length + 1 });
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]!.files + seen[index]!.directories + seen[index]!.stubs).toBe(index + 1);
    }
  });

  it("fails like MemoryVfs.mount on a clash with what the target holds", async () => {
    const vfs = new MemoryVfs({ "/Import": "a file" });
    await expect(mountDirectory(sample(), { into: vfs })).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

describe("commitToDirectory (HOST-253)", () => {
  const tree = (): MemoryVfs =>
    new MemoryVfs({ "/out/a.xml": "A", "/out/sub/b.xml": "B", "/out/sub/deep/c.txt": "C", "/out/empty/": new Uint8Array(0) });

  it("writes every file and folder under `from`, the empty folder too, and says the counts", async () => {
    const handle = new FakeDirectoryHandle("target");
    const result = await commitToDirectory(tree(), handle, { from: "/out" });
    expect(result).toEqual({ files: 3, directories: 3, bytes: 3, stubs: 0 });
    expect([...handle.contents().keys()].sort()).toEqual(["a.xml", "empty/", "sub/", "sub/b.xml", "sub/deep/", "sub/deep/c.txt"]);
    expect(text(handle.contents().get("sub/deep/c.txt"))).toBe("C");
    const whole = new FakeDirectoryHandle("whole");
    await commitToDirectory(tree(), whole);
    expect(whole.contents().has("out/a.xml")).toBe(true);
  });

  it("keeps what the target holds unless clean is set, and replaces a file of the same name", async () => {
    const handle = new FakeDirectoryHandle("target").put("old.txt", "old").put("a.xml", "stale").put("oldfolder/x", "x");
    await commitToDirectory(tree(), handle, { from: "/out" });
    expect(text(handle.contents().get("a.xml"))).toBe("A");
    expect(handle.contents().has("old.txt")).toBe(true);
    expect(handle.state.removed).toEqual([]);
    await commitToDirectory(tree(), handle, { from: "/out", clean: true });
    expect([...handle.contents().keys()].sort()).toEqual(["a.xml", "empty/", "sub/", "sub/b.xml", "sub/deep/", "sub/deep/c.txt"]);
    // everything that was in the target, and nothing that was written after
    expect(handle.state.removed.sort()).toEqual(["/a.xml", "/empty", "/old.txt", "/oldfolder", "/sub"]);
  });

  it("does not write stubs, and counts them", async () => {
    const vfs = new MemoryVfs({ "/a.xml": "A" });
    addStub(vfs, "/big.bin");
    const handle = new FakeDirectoryHandle("target").put("big.bin", "the real one");
    const result = await commitToDirectory(vfs, handle);
    expect(result).toEqual({ files: 1, directories: 0, bytes: 1, stubs: 1 });
    expect(text(handle.contents().get("big.bin"))).toBe("the real one");
  });

  describe("clean with stubs", () => {
    it("refuses a tree mounted with a stub, naming the count, and leaves the target untouched", async () => {
      const picked = new FakeDirectoryHandle("picked")
        .put("a.xml", "A")
        .put("manual.pdf", bytesOf(STUB_THRESHOLD + 1))
        .put("deep/er/video.bin", bytesOf(STUB_THRESHOLD + 1));
      const vfs = await mountDirectory(picked);
      const before = filesOf(picked);
      await expect(commitToDirectory(vfs, picked, { clean: true })).rejects.toThrow(/2 stubs.*a mount never causes the loss of a user's only copy/);
      expect(picked.state.removed).toEqual([]);
      expect(picked.state.maxOpenWritables).toBe(0);
      // Compared with `Buffer.equals`: `toEqual` walks these megabytes element by element and takes seconds, past the timeout under load.
      const after = filesOf(picked);
      expect([...after.keys()]).toEqual([...before.keys()]);
      for (const [path, bytes] of before) expect(Buffer.from(after.get(path) ?? []).equals(bytes), path).toBe(true);
    });

    it("counts only the stubs under `from`", async () => {
      const vfs = new MemoryVfs({ "/out/a.xml": "A", "/other/b.xml": "B" });
      addStub(vfs, "/other/big.bin");
      const handle = new FakeDirectoryHandle("target").put("old.txt", "old");
      expect(await commitToDirectory(vfs, handle, { from: "/out", clean: true })).toEqual({ files: 1, directories: 0, bytes: 1, stubs: 0 });
      expect(handle.state.removed).toEqual(["/old.txt"]);
      addStub(vfs, "/out/sub/big.bin");
      await expect(commitToDirectory(vfs, handle, { from: "/out", clean: true })).rejects.toThrow(/1 stub\b/);
      expect(handle.state.removed).toEqual(["/old.txt"]);
    });

    it("does not count a sibling folder whose name starts the same, and resolves `from` against the tree's cwd", async () => {
      const vfs = new MemoryVfs({ "/work/out/a.xml": "A" }, { cwd: "/work" });
      addStub(vfs, "/work/outer/big.bin");
      const handle = new FakeDirectoryHandle("target");
      expect(await commitToDirectory(vfs, handle, { from: "out", clean: true })).toMatchObject({ files: 1, stubs: 0 });
      addStub(vfs, "/work/out/big.bin");
      await expect(commitToDirectory(vfs, handle, { from: "out", clean: true })).rejects.toThrow(/1 stub\b/);
    });
  });

  it("writes at most 8 files of a folder at once", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 40; index += 1) files[`/f${String(index).padStart(2, "0")}.xml`] = "x";
    const vfs = new MemoryVfs(files);
    const handle = new FakeDirectoryHandle("a");
    await commitToDirectory(vfs, handle);
    expect(handle.state.maxOpenWritables).toBe(8);
    expect(handle.contents().size).toBe(40);
  });

  it("writes the rest and reports the refused names together at the end", async () => {
    const vfs = new MemoryVfs({ "/ok.xml": "1", "/bad:name.xml": "2", "/dir/ok2.xml": "3", "/bad:dir/inner.xml": "4", "/dir/also:bad": "5" });
    const handle = new FakeDirectoryHandle("target", { refuse: (name) => name.includes(":") });
    const caught = await commitToDirectory(vfs, handle).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(CommitError);
    const error = caught as CommitError;
    expect(error.aborted).toBe(false);
    expect(error.written).toEqual({ files: 2, directories: 1, bytes: 2, stubs: 0 });
    expect(error.failures.map((failure) => failure.path).sort()).toEqual(["bad:dir", "bad:name.xml", "dir/also:bad"]);
    expect(error.failures[0]!.error).toBeInstanceOf(TypeError);
    expect(error.message).toContain("3 entries could not be written");
    expect([...handle.contents().keys()].sort()).toEqual(["dir/", "dir/ok2.xml", "ok.xml"]);
  });

  it("a write that fails is aborted and not counted", async () => {
    const vfs = new MemoryVfs({ "/a.xml": "A", "/b.xml": "B" });
    const handle = new FakeDirectoryHandle("target");
    const original = handle.getFileHandle.bind(handle);
    let aborted = 0;
    handle.getFileHandle = async (name, options) => {
      const file = await original(name, options);
      if (name !== "b.xml") return file;
      return {
        kind: "file",
        name,
        getFile: () => file.getFile(),
        createWritable: () =>
          Promise.resolve({
            write: () => Promise.reject(new Error("disk full")),
            close: () => Promise.resolve(),
            abort: () => {
              aborted += 1;
              return Promise.resolve();
            },
          }),
      };
    };
    const error = (await commitToDirectory(vfs, handle).catch((caught: unknown) => caught)) as CommitError;
    expect(error.failures).toHaveLength(1);
    expect(error.failures[0]).toMatchObject({ path: "b.xml" });
    expect(error.written.files).toBe(1);
    expect(aborted).toBe(1);
  });

  it("an abort starts nothing more, says what was written, and carries the reason", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 30; index += 1) files[`/f${String(index).padStart(2, "0")}.xml`] = "x";
    files["/sub/g.xml"] = "g";
    const vfs = new MemoryVfs(files);
    const handle = new FakeDirectoryHandle("target");
    const controller = new AbortController();
    const reason = new DOMException("stop", "AbortError");
    const error = (await commitToDirectory(vfs, handle, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.files === 5) controller.abort(reason);
      },
    }).catch((caught: unknown) => caught)) as CommitError;
    expect(error).toBeInstanceOf(CommitError);
    expect(error.aborted).toBe(true);
    expect(error.cause).toBe(reason);
    // the fifth file ends with at most seven others in flight, which finish; nothing starts after them
    expect(error.written.files).toBeGreaterThanOrEqual(5);
    expect(error.written.files).toBeLessThanOrEqual(12);
    expect(filesOf(handle).size).toBe(error.written.files);
    expect(handle.contents().has("sub/")).toBe(false);
    const before = new AbortController();
    before.abort();
    const none = new FakeDirectoryHandle("none");
    await expect(commitToDirectory(vfs, none, { signal: before.signal })).rejects.toMatchObject({ aborted: true, written: { files: 0 } });
    expect(none.contents().size).toBe(0);
  });

  it("tells the progress after each file and folder", async () => {
    const seen: FsaProgress[] = [];
    await commitToDirectory(tree(), new FakeDirectoryHandle("t"), { from: "/out", onProgress: (progress) => seen.push(progress) });
    expect(seen.length).toBe(6);
    expect(seen[seen.length - 1]).toMatchObject({ files: 3, directories: 3, bytes: 3 });
  });

  it("refuses a `from` that is not a folder of the tree", async () => {
    await expect(commitToDirectory(tree(), new FakeDirectoryHandle("t"), { from: "/nope" })).rejects.toMatchObject({ code: "ENOENT" });
    await expect(commitToDirectory(tree(), new FakeDirectoryHandle("t"), { from: "/out/a.xml" })).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

describe("isFileSystemAccessSupported (HOST-253)", () => {
  it("is whether the scope has a showDirectoryPicker function", () => {
    expect(isFileSystemAccessSupported({ showDirectoryPicker: () => undefined })).toBe(true);
    expect(isFileSystemAccessSupported({})).toBe(false);
    expect(isFileSystemAccessSupported({ showDirectoryPicker: 1 })).toBe(false);
    expect(isFileSystemAccessSupported()).toBe(false); // Node has none
  });
});

// Every package an import fixture holds and every folder an export fixture wrote goes through a handle and back unchanged.
describe("a round trip through a directory handle, over every fixture tree (HOST-252, HOST-253)", () => {
  const fixtures = join(import.meta.dirname, "..", "..", "fixtures");
  const folders: string[] = [];
  for (const engine of readdirSync(fixtures).filter((name) => /^\d/.test(name))) {
    for (const [kind, leaf] of [["import", "input"], ["export", "output"]] as const) {
      const base = join(fixtures, engine, kind);
      if (!existsSync(base)) continue;
      for (const id of readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== "_blobs")) {
        if (kind === "export") {
          if (existsSync(join(base, id.name, leaf))) folders.push(join(base, id.name, leaf));
        } else {
          for (const step of readdirSync(join(base, id.name)).filter((name) => name.startsWith("step-"))) {
            if (existsSync(join(base, id.name, step, leaf))) folders.push(join(base, id.name, step, leaf));
          }
        }
      }
    }
  }

  it("finds the fixture trees", () => {
    expect(folders.length).toBeGreaterThan(400);
  });

  it("mount then commit gives back the same tree and the same bytes", async () => {
    let files = 0;
    for (const folder of folders) {
      const original = fakeFromDisk(folder);
      const vfs = await mountDirectory(original, { include: () => "content" });
      const expected = filesOf(original);
      expect(differences(vfs.snapshot(), expected), folder).toEqual([]);
      const back = new FakeDirectoryHandle("back");
      await commitToDirectory(vfs, back);
      expect(differences(filesOf(back), expected), folder).toEqual([]);
      expect([...back.contents().keys()].filter((path) => path.endsWith("/")).sort(), folder).toEqual(
        [...original.contents().keys()].filter((path) => path.endsWith("/")).sort(),
      );
      files += expected.size;
    }
    expect(files).toBeGreaterThan(2000);
  }, 120_000);
});

// 8.3 short-name numbering reads every sibling name (IMP-004), so a stub must list as the file it stands for.
describe("a stub lists as the file it stands for (HOST-252, IMP-004)", () => {
  const environmentOf = (fs: MemoryVfs) => ({ platform: "linux", cwd: "/", fs });
  const listings = async (handle: FakeDirectoryHandle, folders: string[]) => {
    const withContent = await mountDirectory(handle, { include: () => "content" });
    const withStubs = await mountDirectory(handle, { include: () => "stub" });
    const byDefault = await mountDirectory(handle);
    return folders.map((folder) => ({
      content: directoryGetXmlFiles(folder, environmentOf(withContent)),
      stubs: directoryGetXmlFiles(folder, environmentOf(withStubs)),
      byDefault: directoryGetXmlFiles(folder, environmentOf(byDefault)),
      entries: [withContent, withStubs, byDefault].map((fs) => fs.readdir(folder).map((entry) => `${entry.name}:${entry.isFile}`).sort()),
    }));
  };

  it("gives the same XML listing, in the same order, with stubs as with content", async () => {
    const handle = new FakeDirectoryHandle("odd");
    for (const name of [
      "Report-Alpha-One.xmlbak", "Report-Alpha-Two.xmlbak", "Report-Beta.xmlbak", "report-alpha-three.XML", "a.xml", "B.xml", "zzzzzzzzzz1.xml",
      "Report-Alpha.txt", "Report-Alpha-1.bin", "image.png", "Data File.xmlx", "ünï.xml", "A B.xml", "~tilde.xml", "Z~1.XML",
    ]) {
      handle.put(`pkg/${name}`, `<AML>${name}</AML>`);
    }
    const [one] = await listings(handle, ["/pkg"]);
    expect(one!.content.length).toBeGreaterThan(8);
    expect(one!.stubs).toEqual(one!.content);
    expect(one!.byDefault).toEqual(one!.content);
    expect(one!.entries[1]).toEqual(one!.entries[0]);
  });

  it("gives the same import plan for a recorded package with its non-XML files as stubs", async () => {
    const root = join(import.meta.dirname, "..", "..", "fixtures", "14.0.7", "import", "fs-odd-files", "step-1", "input");
    const handle = fakeFromDisk(root);
    const content = await mountDirectory(handle, { include: () => "content" });
    const stubbed = await mountDirectory(handle, { include: (path, kind) => (kind === "file" && !/\.(xml|mf)/i.test(path) ? "stub" : "content") });
    expect(stubbed.toTree()).toEqual(content.toTree());
    expect(stubsOf(stubbed).has("/LIBSJS-SCRATCH-FS/Import/Variable/LIBSJS-SCRATCH-Fs_Notes.txt")).toBe(true);
    const plan = (fs: MemoryVfs) => planPackage("/LIBSJS-SCRATCH-FS/Import", { environment: environmentOf(fs) });
    const expected = plan(content);
    expect(expected.sequence.length).toBe(3);
    expect(expected.skipped.length).toBe(1);
    expect(plan(stubbed)).toEqual(expected);
  });
});
