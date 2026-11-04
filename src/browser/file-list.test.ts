import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryVfs } from "../host/memory-fs.js";
import { mountDataTransfer, mountFileList } from "./file-list.js";
import type { DataTransferItemLike, DataTransferItemsLike, DirectoryReaderLike, EntryLike } from "./file-list.js";
import type { MountOptions } from "./mount-options.js";

/** @spec HOST-254 HOST-255 */

// ------------------------------------------------------------------------------------------------------------- helpers

const part = (bytes: Uint8Array | string): string | Uint8Array<ArrayBuffer> => (typeof bytes === "string" ? bytes : new Uint8Array(bytes));

/** A `File` as `<input webkitdirectory>` makes it: `webkitRelativePath` is read-only on a real one and set by the browser. */
function pickedFile(relativePath: string, bytes: Uint8Array | string): File {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const file = new File([part(bytes)], name);
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath, enumerable: true });
  return file;
}

interface DiskTree {
  files: Map<string, Uint8Array>;
  folders: string[];
}

/** Every file under a folder on disk with its bytes, and every folder: what a user's folder holds. */
function readDisk(root: string): DiskTree {
  const files = new Map<string, Uint8Array>();
  const folders: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const path = relative(root, full).split("\\").join("/");
      if (statSync(full).isDirectory()) {
        folders.push(path);
        visit(full);
      } else files.set(path, new Uint8Array(readFileSync(full)));
    }
  };
  visit(root);
  return { files, folders };
}

/** The `File`s a folder input gives for a folder named `name`. */
function pickedFolder(name: string, tree: DiskTree): File[] {
  return [...tree.files].map(([path, bytes]) => pickedFile(`${name}/${path}`, bytes));
}

/** A fake `FileSystemEntry` tree for a folder, with the reader batching of Chromium (`batch` entries per `readEntries`). */
function fileEntry(name: string, bytes: Uint8Array | string): EntryLike {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (success) => queueMicrotask(() => success(new File([part(bytes)], name))),
  };
}

function dirEntry(name: string, children: EntryLike[], batch = 100, calls?: { count: number }): EntryLike {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader(): DirectoryReaderLike {
      let next = 0;
      return {
        readEntries(success): void {
          if (calls !== undefined) calls.count += 1;
          const out = children.slice(next, next + batch);
          next += out.length;
          queueMicrotask(() => success(out));
        },
      };
    },
  };
}

/** The entry tree of a disk folder. */
function entryTree(name: string, tree: DiskTree, batch = 100): EntryLike {
  const build = (prefix: string, dirName: string): EntryLike => {
    const children: EntryLike[] = [];
    const names = new Set<string>();
    for (const path of [...tree.files.keys(), ...tree.folders]) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest === "" || names.has(rest.split("/")[0]!)) continue;
      const head = rest.split("/")[0]!;
      names.add(head);
      children.push(tree.files.has(prefix + head) ? fileEntry(head, tree.files.get(prefix + head)!) : build(`${prefix}${head}/`, head));
    }
    return dirEntry(dirName, children, batch);
  };
  return build("", name);
}

/** A fake item list that is emptied when the drop handler returns, as a browser's is (`done()`). */
function drop(entries: EntryLike[]): { items: DataTransferItemsLike; done: () => void } {
  const list: Array<DataTransferItemLike | undefined> = entries.map((entry) => ({ kind: "file", webkitGetAsEntry: () => entry }));
  const items: { length: number; [index: number]: DataTransferItemLike | undefined } = { length: list.length };
  list.forEach((item, index) => {
    items[index] = item;
  });
  return {
    items,
    done: () => {
      for (let index = 0; index < items.length; index++) delete items[index];
      items.length = 0;
    },
  };
}

function bytesOf(vfs: MemoryVfs, root = "/"): Array<[string, number[]]> {
  return [...vfs.snapshot(root)].map(([path, bytes]) => [path, [...bytes]]);
}

const textOf = (vfs: MemoryVfs, path: string): string => new TextDecoder().decode(vfs.readFile(path));

// -------------------------------------------------------------------------------------------------- every import fixture

/** The folders the import replays feed the engine: `fixtures/<engine>/import/<case>/step-N/input`. */
function importInputFolders(): string[] {
  const out: string[] = [];
  for (const engine of ["12.0", "14.0.7", "14.35"]) {
    const base = join(import.meta.dirname, "..", "..", "fixtures", engine, "import");
    for (const name of readdirSync(base).sort()) {
      const caseDir = join(base, name);
      if (!statSync(caseDir).isDirectory()) continue;
      for (const step of readdirSync(caseDir).sort()) {
        const input = join(caseDir, step, "input");
        if (step.startsWith("step-") && statSync(input, { throwIfNoEntry: false })?.isDirectory() === true) out.push(input);
      }
    }
  }
  return out;
}

describe("the import fixture folders, mounted from a file list and from a drop", () => {
  const inputs = importInputFolders();

  it("has import folders to mount", () => {
    expect(inputs.length).toBeGreaterThan(100);
  });

  it("mounts each folder, picked, as the folder is on disk (bytes and names)", async () => {
    for (const input of inputs) {
      const tree = readDisk(input);
      const expected = new MemoryVfs(Object.fromEntries(tree.files));
      const picked = await mountFileList(pickedFolder("input", tree), { root: "auto" });
      expect(picked.toTree(), input).toEqual(expected.toTree());
      expect(bytesOf(picked), input).toEqual(bytesOf(expected));
    }
  });

  it("mounts each folder, dropped, as the folder is on disk, empty folders too", async () => {
    for (const input of inputs) {
      const tree = readDisk(input);
      const expected = new MemoryVfs({ ...Object.fromEntries(tree.files), ...Object.fromEntries(tree.folders.map((path) => [`${path}/`, ""])) });
      const { items, done } = drop([entryTree("input", tree)]);
      const pending = mountDataTransfer(items, { root: "auto" });
      done();
      const dropped = await pending;
      expect(bytesOf(dropped), input).toEqual(bytesOf(expected));
      for (const folder of tree.folders) expect(dropped.stat(`/${folder}`).isDirectory, `${input} ${folder}`).toBe(true);
    }
  });
});

// ------------------------------------------------------------------------------------------------------- a file list

describe("mountFileList (HOST-254)", () => {
  const files = (): File[] => [
    pickedFile("Pkg/imports.mf", "<imports/>"),
    pickedFile("Pkg/ItemType/a.xml", "<AML/>"),
    pickedFile("Pkg/ItemType/sub/b.xml", "<AML>b</AML>"),
  ];

  it("keeps the folder's name by default and strips it for root auto", async () => {
    expect((await mountFileList(files())).toTree()).toEqual(["Pkg/", "Pkg/ItemType/", "Pkg/ItemType/a.xml", "Pkg/ItemType/sub/", "Pkg/ItemType/sub/b.xml", "Pkg/imports.mf"]);
    const stripped = await mountFileList(files(), { root: "auto" });
    expect(stripped.toTree()).toEqual(["ItemType/", "ItemType/a.xml", "ItemType/sub/", "ItemType/sub/b.xml", "imports.mf"]);
    expect(textOf(stripped, "/ItemType/sub/b.xml")).toBe("<AML>b</AML>");
  });

  it("does not strip a first segment that is not shared, or a file at the top", async () => {
    const mixed = await mountFileList([pickedFile("A/x.xml", "1"), pickedFile("B/y.xml", "2")], { root: "auto" });
    expect(mixed.toTree()).toEqual(["A/", "A/x.xml", "B/", "B/y.xml"]);
    const flat = await mountFileList([pickedFile("x.xml", "1")], { root: "auto" });
    expect(flat.toTree()).toEqual(["x.xml"]);
  });

  it("puts a file that has no relative path at the root of the tree under its name", async () => {
    const plain = new File(["<AML/>"], "a.xml");
    expect((await mountFileList([plain])).toTree()).toEqual(["a.xml"]);
  });

  it("accepts any iterable, null and an empty list", async () => {
    const set = new Set(files());
    expect((await mountFileList(set)).snapshot().size).toBe(3);
    expect((await mountFileList(null)).toTree()).toEqual([]);
    expect((await mountFileList([])).toTree()).toEqual([]);
  });

  it("does not list a folder with no file in it, which a file list cannot show (HOST-254)", async () => {
    // a package folder `Pkg` with an empty sub-folder `Pkg/Empty`: the input yields the files only
    const result = await mountFileList([pickedFile("Pkg/imports.mf", "<imports/>")], { root: "auto" });
    expect(result.toTree()).toEqual(["imports.mf"]);
    expect(result.exists("/Empty")).toBe(false);
  });

  it("refuses a path that leaves the tree", async () => {
    await expect(mountFileList([pickedFile("Pkg/../../x.xml", "x")])).rejects.toMatchObject({ code: "ERR_MOUNT_UNSAFE_PATH" });
  });

  it("reads every file, a large binary too, with its bytes", async () => {
    const big = new Uint8Array(2 * 1_048_576).fill(7);
    const result = await mountFileList([pickedFile("P/a.xml", "a"), pickedFile("P/big.bin", big)], { root: "auto" });
    expect(result.toTree()).toEqual(["a.xml", "big.bin"]);
    expect(result.readFile("/big.bin")).toEqual(big);
  });

  it("reports progress per file, in order", async () => {
    const seen: string[] = [];
    await mountFileList(files(), { root: "auto", onProgress: (p) => seen.push(`${p.path}:${p.files}:${p.bytes}`) });
    expect(seen).toEqual(["/imports.mf:1:10", "/ItemType/a.xml:2:16", "/ItemType/sub/b.xml:3:28"]);
  });

  it("refuses a source over maxBytes before reading anything", async () => {
    let reads = 0;
    const counted = files().map((file) => ({
      name: file.name,
      size: file.size,
      webkitRelativePath: file.webkitRelativePath,
      arrayBuffer: () => {
        reads += 1;
        return file.arrayBuffer();
      },
    }));
    await expect(mountFileList(counted, { maxBytes: 20 })).rejects.toMatchObject({ code: "ENOSPC" });
    expect(reads).toBe(0);
    expect((await mountFileList(counted, { maxBytes: 28 })).size).toBe(28);
    await expect(mountFileList([pickedFile("P/x.bin", new Uint8Array(2))], { maxBytes: 1 })).rejects.toMatchObject({ code: "ENOSPC" });
  });

  it("stops at the signal", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const result = mountFileList(files(), { signal: controller.signal, onProgress: () => controller.abort(reason) });
    await expect(result).rejects.toBe(reason);
  });

  it("rejects when the signal was aborted before the call", async () => {
    await expect(mountFileList(files(), { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
  });
});

// ------------------------------------------------------------------------------------------------------------ a zip

describe("a chosen or dropped zip (HOST-254)", () => {
  const zipBytes = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]);
  const unzip: NonNullable<MountOptions["unzip"]> = (bytes, options) => {
    expect([...bytes]).toEqual([...zipBytes]);
    return new MemoryVfs({ "/Pkg/imports.mf": "<imports/>", "/Pkg/a.xml": options.root === "auto" ? "auto" : "keep" });
  };

  it("hands a single .zip file to the zip reader, with the root and the limit", async () => {
    const seen: unknown[] = [];
    const result = await mountFileList([new File([zipBytes], "Package.ZIP")], {
      root: "auto",
      maxBytes: 100,
      unzip: (bytes, options) => {
        seen.push(options);
        return unzip(bytes, options);
      },
    });
    expect(seen).toEqual([{ root: "auto", maxBytes: 100 }]);
    expect(result.toTree()).toEqual(["Pkg/", "Pkg/a.xml", "Pkg/imports.mf"]);
  });

  it("returns the unzipped tree as it is, with its empty folders", async () => {
    const unzipped = new MemoryVfs({ "/Pkg/imports.mf": "<imports/>", "/Pkg/Empty/": "" });
    const result = await mountFileList([new File([zipBytes], "p.zip")], { unzip: () => unzipped });
    expect(result).toBe(unzipped);
    expect(result.stat("/Pkg/Empty").isDirectory).toBe(true);
  });

  it("reports each file of the unzipped tree, cumulatively", async () => {
    const seen: string[] = [];
    const onProgress: MountOptions["onProgress"] = (p) => seen.push(`${p.path}:${p.files}:${p.bytes}`);
    const expected = ["/Pkg/a.xml:1:4", "/Pkg/imports.mf:2:14"];
    await mountFileList([new File([zipBytes], "p.zip")], { unzip, onProgress });
    expect(seen).toEqual(expected);
    seen.length = 0;
    const entry: EntryLike = { isFile: true, isDirectory: false, name: "p.zip", file: (success) => success(new File([zipBytes], "p.zip")) };
    await mountDataTransfer(drop([entry]).items, { unzip, onProgress });
    expect(seen).toEqual(expected);
  });

  it("reports a zip's files by sorted path, without copying the whole tree", async () => {
    class NoSnapshot extends MemoryVfs {
      override snapshot(): Map<string, Uint8Array> {
        throw new Error("the reports must not copy the whole tree");
      }
    }
    const unzipped = new NoSnapshot({ "/a/x": "1", "/a-b/x": "22", "/b": "333" });
    const seen: string[] = [];
    await mountFileList([new File([zipBytes], "p.zip")], { unzip: () => unzipped, onProgress: (p) => seen.push(`${p.path}:${p.files}:${p.bytes}`) });
    expect(seen).toEqual(["/a-b/x:1:2", "/a/x:2:3", "/b:3:6"]);
  });

  it("does not unzip when the signal was aborted during the read", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const file = {
      name: "p.zip",
      size: zipBytes.length,
      arrayBuffer: async () => {
        controller.abort(reason);
        return zipBytes.slice().buffer;
      },
    };
    let unzipped = 0;
    const result = mountFileList([file], {
      signal: controller.signal,
      unzip: (bytes, options) => {
        unzipped += 1;
        return unzip(bytes, options);
      },
    });
    await expect(result).rejects.toBe(reason);
    expect(unzipped).toBe(0);
  });

  it("stops the zip's reports at the signal", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const result = mountFileList([new File([zipBytes], "p.zip")], { unzip, signal: controller.signal, onProgress: () => controller.abort(reason) });
    await expect(result).rejects.toBe(reason);
  });

  it("refuses a .zip that is not a zip, and a zip when there is no reader", async () => {
    await expect(mountFileList([new File(["not a zip"], "p.zip")], { unzip })).rejects.toMatchObject({ code: "ERR_MOUNT_NOT_ZIP" });
    await expect(mountFileList([new File([zipBytes], "p.zip")])).rejects.toMatchObject({ code: "ERR_MOUNT_NO_UNZIP" });
  });

  it("refuses a zip over maxBytes without reading it", async () => {
    await expect(mountFileList([new File([zipBytes], "p.zip")], { unzip, maxBytes: 3 })).rejects.toMatchObject({ code: "ENOSPC" });
  });

  it("does not treat a zip inside a picked folder, or among other files, as an archive", async () => {
    const inFolder = await mountFileList([pickedFile("Pkg/p.zip", zipBytes)], { root: "auto" });
    expect(inFolder.toTree()).toEqual(["p.zip"]);
    const among = await mountFileList([new File([zipBytes], "p.zip"), new File(["x"], "a.xml")]);
    expect(among.toTree()).toEqual(["a.xml", "p.zip"]);
  });

  it("routes a dropped .zip file the same way", async () => {
    const zip = new File([zipBytes], "p.zip");
    const { items, done } = drop([{ isFile: true, isDirectory: false, name: "p.zip", file: (success) => success(zip) }]);
    const pending = mountDataTransfer(items, { unzip });
    done();
    expect((await pending).toTree()).toEqual(["Pkg/", "Pkg/a.xml", "Pkg/imports.mf"]);
  });
});

// ----------------------------------------------------------------------------------------------------------- a drop

describe("mountDataTransfer (HOST-255)", () => {
  const names = (count: number): EntryLike[] => Array.from({ length: count }, (_, index) => fileEntry(`f${String(index).padStart(3, "0")}.xml`, `<AML>${index}</AML>`));

  it("reads a folder of 250 entries in batches of 100 until the reader answers empty", async () => {
    const calls = { count: 0 };
    const folder = dirEntry("Big", names(250), 100, calls);
    const { items, done } = drop([dirEntry("Pkg", [folder, fileEntry("imports.mf", "<imports/>")])]);
    const pending = mountDataTransfer(items, { root: "auto" });
    done();
    const result = await pending;
    expect(result.readdir("/Big")).toHaveLength(250);
    expect(textOf(result, "/Big/f249.xml")).toBe("<AML>249</AML>");
    expect(textOf(result, "/Big/f100.xml")).toBe("<AML>100</AML>");
    // three batches (100, 100, 50) and the empty one, for the folder; one empty answer for the top folder's reader is not extra
    expect(calls.count).toBe(4);
  });

  it("reads a folder whose size is an exact multiple of the batch", async () => {
    const { items } = drop([dirEntry("Pkg", names(200))]);
    const result = await mountDataTransfer(items, { root: "auto" });
    expect(result.readdir("/")).toHaveLength(200);
  });

  it("keeps an empty folder, and a folder with only empty folders", async () => {
    const { items } = drop([dirEntry("Pkg", [dirEntry("Empty", []), dirEntry("Nest", [dirEntry("Deeper", [])]), fileEntry("imports.mf", "<imports/>")])]);
    const result = await mountDataTransfer(items, { root: "auto" });
    expect(result.stat("/Empty").isDirectory).toBe(true);
    expect(result.stat("/Nest/Deeper").isDirectory).toBe(true);
    expect(result.readdir("/Empty")).toEqual([]);
  });

  it("takes the entries before the handler returns", async () => {
    const { items, done } = drop([dirEntry("Pkg", [fileEntry("imports.mf", "<imports/>")])]);
    const pending = mountDataTransfer(items, { root: "auto" });
    done(); // the browser empties the list when the handler returns
    expect((await pending).toTree()).toEqual(["imports.mf"]);
  });

  it("keeps the names of several dropped items, and files dropped alone", async () => {
    const { items } = drop([dirEntry("A", [fileEntry("x.xml", "1")]), fileEntry("loose.xml", "2")]);
    const result = await mountDataTransfer(items, { root: "auto" });
    expect(result.toTree()).toEqual(["A/", "A/x.xml", "loose.xml"]);
  });

  it("ignores an item with no entry and an item that is not a file", async () => {
    const items: DataTransferItemsLike = {
      length: 3,
      0: { kind: "string", webkitGetAsEntry: () => fileEntry("text.xml", "t") },
      1: { kind: "file", webkitGetAsEntry: () => fileEntry("a.xml", "<AML/>") },
      2: { kind: "file", webkitGetAsEntry: () => null },
    };
    expect((await mountDataTransfer(items)).toTree()).toEqual(["a.xml"]);
  });

  it("applies the same options as a file list: maxBytes, signal and progress", async () => {
    const build = (): EntryLike => dirEntry("Pkg", [fileEntry("imports.mf", "<imports/>"), fileEntry("a.xml", "<AML/>")]);
    const seen: string[] = [];
    await mountDataTransfer(drop([build()]).items, { root: "auto", onProgress: (p) => seen.push(p.path) });
    expect(seen).toEqual(["/imports.mf", "/a.xml"]);

    await expect(mountDataTransfer(drop([build()]).items, { maxBytes: 5 })).rejects.toMatchObject({ code: "ENOSPC" });
    await expect(mountDataTransfer(drop([build()]).items, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects with the error of a reader or a file", async () => {
    const broken: EntryLike = { isFile: false, isDirectory: true, name: "Pkg", createReader: () => ({ readEntries: (_, failure) => failure(new Error("denied")) }) };
    await expect(mountDataTransfer(drop([broken]).items)).rejects.toThrow("denied");
    const unreadable: EntryLike = { isFile: true, isDirectory: false, name: "a.xml", file: (_, failure) => failure(new Error("gone")) };
    await expect(mountDataTransfer(drop([dirEntry("Pkg", [unreadable])]).items)).rejects.toThrow("gone");
  });

  it("rejects when taking the entries throws", async () => {
    const items: DataTransferItemsLike = {
      length: 1,
      0: {
        kind: "file",
        webkitGetAsEntry: () => {
          throw new Error("list is gone");
        },
      },
    };
    await expect(mountDataTransfer(items)).rejects.toThrow("list is gone");
  });
});
