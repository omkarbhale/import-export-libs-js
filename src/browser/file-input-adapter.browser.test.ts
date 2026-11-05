import { server } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { chooseFixtureInput, chooseManyFilesFolder } from "./adapter-commands.browser.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { FIXTURE_CASES } from "./fixture-set.js";
import { mountFileList } from "./file-list.js";
import { replayImportStep, stepsOfCase, virtualFs } from "./import-replay-support.browser.js";
import { assertTreeMatchesFiles, loadFixtureTree, readFixtureBytes } from "./test-support.browser.js";
import { vfsFromZip } from "./zip.js";

/**
 * The folder-input and drop adapters in Chromium, Firefox and WebKit (HOST-254, HOST-255): a folder is chosen in a real
 * `<input type="file" webkitdirectory>` as Playwright's `setInputFiles` does it (the commands of `tools/browser-vitest.ts`, HOST-267),
 * so `mountFileList` gets the `File`s of the disk with their `webkitRelativePath`; the tree it makes equals the recorded folder byte
 * for byte, a recorded import runs on it, and a `.zip` chosen the same way is unzipped. A page cannot make a `DataTransfer` that holds a
 * folder, so the files of a synthesized one, handed to a `drop` event, are mounted as a file list here; `mountDataTransfer` and the
 * batches of a directory reader are tested with a real drop in Chromium (`file-drop.browser.test.ts`) and in `file-list.test.ts`
 * with entries written by hand. The `showDirectoryPicker` path needs a user
 * gesture and a native dialog and is tested by hand (HOST-253).
 *
 * @spec HOST-254 HOST-255 HOST-267 HOST-266
 */

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const include = (): "content" => "content";

let counter = 0;
const inputs: HTMLInputElement[] = [];

/** A file input in the page, as the page's own UI would have it; removed after the test. */
function fileInput(options: { directory?: boolean; multiple?: boolean } = {}): { input: HTMLInputElement; selector: string } {
  counter += 1;
  const input = document.createElement("input");
  input.type = "file";
  input.id = `libsjs-input-${counter}`;
  if (options.directory === true) input.setAttribute("webkitdirectory", "");
  if (options.multiple === true) input.multiple = true;
  document.body.append(input);
  inputs.push(input);
  return { input, selector: `#${input.id}` };
}

afterEach(() => {
  for (const input of inputs.splice(0)) input.remove();
});

/** The files that a folder input holds, as an array. */
const chosen = (input: HTMLInputElement): File[] => Array.from(input.files as unknown as ArrayLike<File>);

/**
 * Chooses files in a new input, with the command that `choose` calls. WebKit's `setInputFiles` of a folder now and then does not return in time
 * (a second try on the same input did not return either in the runs seen), so an attempt that times out is made again on an input of
 * its own, up to three times; any other failure is the test's.
 */
async function chooseIn(options: { directory?: boolean; multiple?: boolean }, choose: (selector: string) => Promise<void>): Promise<HTMLInputElement> {
  for (let attempt = 1; ; attempt += 1) {
    const { input, selector } = fileInput(options);
    try {
      await choose(selector);
      return input;
    } catch (error) {
      input.remove();
      if (attempt === 3 || !/timeout/i.test(String(error))) throw error;
    }
  }
}

/** Chooses a fixture folder in a new folder input and returns the input's files. */
async function chooseFolder(dir: string): Promise<{ input: HTMLInputElement; files: File[] }> {
  const input = await chooseIn({ directory: true }, (selector) => chooseFixtureInput(selector, dir));
  return { input, files: chosen(input) };
}

// -------------------------------------------------------------------------------------------------------- a folder input

/** The recorded package folders chosen in an input: a case of each engine's, the odd files, the XML declarations and the encodings 12.0 reads. */
const FOLDERS = [
  ["12.0", "s0-mini-defaults"],
  ["12.0", "r15-latin1-file"],
  ["12.0", "r15-utf16-no-bom"],
  ["14.0.7", "s0-mini-defaults"],
  ["14.0.7", "fs-odd-files"],
  ["14.0.7", "fs-xml-declaration"],
  ["14.35", "s0-mini-defaults"],
  ["14.35", "cui-order"],
] as const;

describe("HOST-254: the folder that a user chose in a folder input is mounted by the relative paths of its files", () => {
  it.for(FOLDERS)("%s %s: the tree of the chosen folder is the recorded folder, byte for byte, with the folder's name taken off by root: auto", async ([engine, name]) => {
    const dir = `fixtures/${engine}/import/${name}/step-1/input`;
    const recorded = await loadFixtureTree(dir);
    const { files } = await chooseFolder(dir);
    expect(files.length, "the files the input holds").toBe(recorded.length);
    for (const file of files) expect(file.webkitRelativePath.startsWith("input/"), `${file.webkitRelativePath} is below the chosen folder`).toBe(true);
    assertTreeMatchesFiles(await mountFileList(files, { root: "auto", include }), "/", recorded, `${engine} ${name}`);
  });

  it("keeps the chosen folder's name as the first segment without root: auto, which the caller decides", async () => {
    const dir = "fixtures/14.0.7/import/s0-mini-defaults/step-1/input";
    const recorded = await loadFixtureTree(dir);
    const { files } = await chooseFolder(dir);
    const vfs = await mountFileList(files, { include });
    assertTreeMatchesFiles(vfs, "/input", recorded, "kept");
    expect(vfs.toTree("/").filter((path) => !path.startsWith("input/") && path !== "input/")).toEqual([]);
  });

  it("is the same tree whatever order the browser lists the files in, which differs between the browsers", async () => {
    const dir = "fixtures/14.0.7/import/s0-mini-defaults/step-1/input";
    const { files } = await chooseFolder(dir);
    const forward = await mountFileList(files, { root: "auto", include });
    const backward = await mountFileList([...files].reverse(), { root: "auto", include });
    expect(backward.toTree()).toEqual(forward.toTree());
    console.info(`FILE-ORDER ${JSON.stringify({ browser: server.browser, first: files[0]?.webkitRelativePath, last: files[files.length - 1]?.webkitRelativePath })}`);
  });

  it("judges each file by its real size and name, so that the caller's include makes a stub whose name stays in the listing", async () => {
    const dir = "fixtures/14.0.7/import/s0-mini-defaults/step-1/input";
    const recorded = await loadFixtureTree(dir);
    const { files } = await chooseFolder(dir);
    const sizes: Record<string, number> = {};
    const vfs = await mountFileList(files, {
      root: "auto",
      include: (path, kind, size) => {
        if (kind === "file") sizes[path] = size;
        return kind === "file" && path === "imports.mf" ? "stub" : "content";
      },
    });
    for (const file of recorded) expect(sizes[file.path], `${file.path}: the size the include is given`).toBe(file.bytes.length);
    expect(vfs.stubs()).toEqual(["/imports.mf"]);
    expect(vfs.toTree()).toContain("imports.mf");
    expect(() => vfs.readFile("/imports.mf")).toThrow(/EIO/);
  });

  it("lists a folder of 250 files, which is more than a directory reader gives in a batch, with every file in the tree", async () => {
    const input = await chooseIn({ directory: true }, (selector) => chooseManyFilesFolder(selector, 250));
    const vfs = await mountFileList(chosen(input), { root: "auto", include });
    const names = vfs.toTree().filter((path) => !path.endsWith("/"));
    expect(names.length).toBe(250);
    expect(names[0]).toBe("item-0000.xml");
    expect(names[249]).toBe("item-0249.xml");
    expect(decode(vfs.readFile("/item-0137.xml"))).toBe('<Item id="item-0137.xml"/>');
  });

  it("puts the files of a multiple-file input, which have no relative path, at the root of the tree under their own names", async () => {
    const dir = "fixtures/14.0.7/import/s0-mini-defaults/step-1/input";
    const input = await chooseIn({ multiple: true }, (selector) => chooseFixtureInput(selector, [`${dir}/imports.mf`]));
    const vfs = await mountFileList(chosen(input), { include });
    expect(vfs.toTree()).toEqual(["imports.mf"]);
    expect(decode(vfs.readFile("/imports.mf"))).toBe(decode(await readFixtureBytes(`${dir}/imports.mf`)));
  });
});

describe("HOST-254: a zip chosen in the input is routed to the zip reader", () => {
  it("unzips a .zip that a user chose, with the root and the limit the caller gave, and refuses it without a reader", async () => {
    const input = await chooseIn({ multiple: true }, (selector) => chooseFixtureInput(selector, ["fixtures/browser/zips/info-zip.zip"]));
    const vfs = await mountFileList(chosen(input), { unzip: vfsFromZip, root: "auto" });
    expect(vfs.toTree()).toEqual(["ItemType/", "ItemType/a.xml", "imports.mf", "readme.txt", "sub/", "sub/dir/", "sub/dir/b.xml", "sub/zero.bin"]);
    await expect(mountFileList(chosen(input), {})).rejects.toMatchObject({ code: "ERR_MOUNT_NO_UNZIP" });
    await expect(mountFileList(chosen(input), { unzip: vfsFromZip, maxBytes: 100 })).rejects.toMatchObject({ code: "ENOSPC" });
  });
});

// ------------------------------------------------------------------------------------------ a recorded import on a chosen folder

/** The recorded import cases whose steps run on the tree of a chosen folder. */
const CHOSEN_CASES = ["s0-mini-defaults", "fs-odd-files", "fs-xml-declaration", "s2-ref-dep-present"];

for (const engine of ["12.0", "14.0.7", "14.35"] as const) {
  const cases = FIXTURE_CASES.filter((fixture) => fixture.engine === engine && fixture.operation === "import" && CHOSEN_CASES.includes(fixture.name));
  describe(`HOST-254: the recorded ${engine} import runs on the tree of a folder that a user chose`, () => {
    it.for(cases.map((fixture) => [fixture.name, fixture] as const))("%s: every step runs as recorded on the mounted file list", async ([, fixture]) => {
      const vfs = virtualFs();
      for (const step of await stepsOfCase(fixture)) {
        await replayImportStep(fixture, step, {
          vfs,
          mountInput: async (tree, at) => {
            const { files } = await chooseFolder(`${step.dir}/input`);
            const mounted = await mountFileList(files, { root: "auto", include });
            const copy: Record<string, Uint8Array> = { [`${at}/`]: new Uint8Array(0) };
            for (const [path, bytes] of mounted.snapshot()) copy[`${at}/${path}`] = bytes;
            tree.mount(copy);
          },
        });
      }
    });
  });
}

// ------------------------------------------------------------------------------------------------------------------- a drop

/**
 * A `DataTransfer` made of files, as a page makes one. Its `files` are a `FileList` of the files as they are, with no relative path;
 * its items have no entries in a page of Chromium (`webkitGetAsEntry()` is null), and in WebKit it throws, so `mountDataTransfer` is
 * tested with real drops (`file-drop.browser.test.ts`, Chromium) and the file list of a transfer is what these tests mount.
 */
function dataTransferOf(files: ReadonlyArray<{ name: string; bytes: Uint8Array }>): DataTransfer {
  const transfer = new DataTransfer();
  for (const { name, bytes } of files) transfer.items.add(new File([bytes as BlobPart], name));
  return transfer;
}

/** Drops a transfer on a target the way a page handles it, and mounts the `files` of the event's `dataTransfer`. */
async function dropFiles(transfer: DataTransfer, options: Parameters<typeof mountFileList>[1] = {}): Promise<MemoryVfs> {
  const target = document.createElement("div");
  document.body.append(target);
  try {
    return await new Promise<MemoryVfs>((resolve, reject) => {
      target.addEventListener("drop", (event) => {
        event.preventDefault();
        mountFileList(Array.from((event as DragEvent).dataTransfer?.files as unknown as ArrayLike<File>), options).then(resolve, reject);
      });
      target.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
  } finally {
    target.remove();
  }
}

describe("HOST-254: the files of a DataTransfer that was dropped are mounted as a file list", () => {
  it("mounts the dropped files of a package folder's top level, by name, with their bytes, equal to the recorded files", async () => {
    const dir = "fixtures/14.0.7/import/s0-mini-defaults/step-1/input";
    const mf = await readFixtureBytes(`${dir}/imports.mf`);
    const vfs = await dropFiles(dataTransferOf([{ name: "imports.mf", bytes: mf }, { name: "a.xml", bytes: new TextEncoder().encode("<AML/>") }]), { include });
    expect(vfs.toTree()).toEqual(["a.xml", "imports.mf"]);
    expect(decode(vfs.readFile("/imports.mf"))).toBe(decode(mf));
    expect(decode(vfs.readFile("/a.xml"))).toBe("<AML/>");
  });

  it("routes a dropped .zip to the zip reader, with root: auto", async () => {
    const zip = await readFixtureBytes("fixtures/browser/zips/7zip-deflate.zip");
    const vfs = await dropFiles(dataTransferOf([{ name: "package.zip", bytes: zip }]), { unzip: vfsFromZip, root: "auto" });
    expect(vfs.toTree()).toEqual(["ItemType/", "ItemType/a.xml", "imports.mf", "readme.txt", "sub/", "sub/dir/", "sub/dir/b.xml", "sub/zero.bin"]);
  });
});

// ------------------------------------------------------------------------------------------------------------------- abort

describe("HOST-254 and HOST-255: an abort in the middle of a mount leaves nothing behind", () => {
  it("a file list: the mount rejects with the reason after some files and returns no tree", async () => {
    const { files } = await chooseFolder("fixtures/14.0.7/import/s0-mini-defaults/step-1/input");
    expect(files.length).toBeGreaterThan(4);
    const controller = new AbortController();
    const reason = new Error("stop the mount");
    let seen = 0;
    await expect(
      mountFileList(files, {
        include,
        signal: controller.signal,
        onProgress: () => {
          seen += 1;
          if (seen === 3) controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
    expect(seen, "the mount stopped at the file the abort came on").toBe(3);
    await expect(mountFileList(files, { signal: AbortSignal.abort(new Error("already")) })).rejects.toThrow("already");
  });

  it("a dropped transfer's files: the mount rejects with the reason", async () => {
    const transfer = dataTransferOf([1, 2, 3, 4, 5, 6].map((n) => ({ name: `f${n}.xml`, bytes: new TextEncoder().encode(`<n>${n}</n>`) })));
    const controller = new AbortController();
    const reason = new Error("stop the drop");
    let seen = 0;
    await expect(
      dropFiles(transfer, {
        include,
        signal: controller.signal,
        onProgress: () => {
          seen += 1;
          if (seen === 2) controller.abort(reason);
        },
      }),
    ).rejects.toBe(reason);
    expect(seen).toBe(2);
  });
});
