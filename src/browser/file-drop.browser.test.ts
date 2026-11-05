import { server } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { dropFixtureOn, dropManyFilesFolderOn } from "./adapter-commands.browser.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { mountDataTransfer } from "./file-list.js";
import { assertTreeMatchesFiles, loadFixtureTree } from "./test-support.browser.js";
import { vfsFromZip } from "./zip.js";

/**
 * A real drop of files from the disk, in Chromium (HOST-255): the operating system's drop is made with the DevTools protocol
 * (`dropFixtureOn`, `dropManyFilesFolderOn`, `tools/browser-vitest.ts`, HOST-267), so the page gets a `DataTransfer` whose items have
 * entries, a folder's with a directory reader that lists 100 entries at a time. `mountDataTransfer` is called in the `drop` handler
 * before any `await`, as its documentation says, and walks the entries. Firefox and WebKit have no way of making such a drop in a
 * test, and a `DataTransfer` that a page makes has no folder in it (it has no entries in Chromium, and WebKit throws on one), so
 * these tests run in Chromium alone; the walk itself is tested on every engine of Node with entries written by hand
 * (`file-list.test.ts`), and a folder chosen in an input in the three browsers (`file-input-adapter.browser.test.ts`).
 *
 * @spec HOST-255 HOST-267
 */

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const include = (): "content" => "content";

const targets: HTMLElement[] = [];
afterEach(() => {
  for (const target of targets.splice(0)) target.remove();
});

/**
 * A drop target in the page, and what a page's handler does on a drop: `mountDataTransfer(event.dataTransfer.items)` in the handler, no `await`
 * before it. `drop()` makes the drop and resolves with what the handler's promise resolves with, or rejects with its reason.
 */
function dropTarget(options: Parameters<typeof mountDataTransfer>[1] = {}): { selector: string; mounted: Promise<MemoryVfs> } {
  const target = document.createElement("div");
  target.id = `libsjs-drop-${targets.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
  target.style.cssText = "width:200px;height:100px;background:#ccc";
  document.body.append(target);
  targets.push(target);
  const mounted = new Promise<MemoryVfs>((resolve, reject) => {
    target.addEventListener("dragover", (event) => event.preventDefault());
    target.addEventListener("drop", (event) => {
      event.preventDefault();
      mountDataTransfer((event as DragEvent).dataTransfer?.items as DataTransferItemList, options).then(resolve, reject);
    });
  });
  return { selector: `#${target.id}`, mounted };
}

describe.skipIf(server.browser !== "chromium")("HOST-255: a folder dropped from the disk is walked through its entries (Chromium)", () => {
  it("mounts a dropped recorded package folder to the recorded tree, byte for byte, with the folder's name as the first segment or taken off by root: auto", async () => {
    const dir = "fixtures/14.0.7/import/fs-odd-files/step-1/input";
    const recorded = await loadFixtureTree(dir);
    const kept = dropTarget({ include });
    await dropFixtureOn(kept.selector, dir);
    assertTreeMatchesFiles(await kept.mounted, "/input", recorded, "kept");
    const auto = dropTarget({ include, root: "auto" });
    await dropFixtureOn(auto.selector, dir);
    assertTreeMatchesFiles(await auto.mounted, "/", recorded, "auto");
  });

  it("lists a dropped folder of 250 files in batches until the reader is empty, with its empty folder", async () => {
    const drop = dropTarget({ include, root: "auto" });
    await dropManyFilesFolderOn(drop.selector, 250);
    const vfs = await drop.mounted;
    const files = vfs.toTree().filter((path) => !path.endsWith("/"));
    expect(files.length, "every entry of the folder, though a reader lists 100 at a time").toBe(250);
    expect(files[0]).toBe("item-0000.xml");
    expect(files[249]).toBe("item-0249.xml");
    expect(decode(vfs.readFile("/item-0199.xml"))).toBe('<Item id="item-0199.xml"/>');
    expect(vfs.stat("/empty").isDirectory, "an empty folder is in the tree of a drop (HOST-255), which a file list cannot show").toBe(true);
  });

  it("routes a dropped zip to the zip reader", async () => {
    const drop = dropTarget({ unzip: vfsFromZip, root: "auto" });
    await dropFixtureOn(drop.selector, "fixtures/browser/zips/info-zip.zip");
    expect((await drop.mounted).toTree()).toEqual(["ItemType/", "ItemType/a.xml", "imports.mf", "readme.txt", "sub/", "sub/dir/", "sub/dir/b.xml", "sub/zero.bin"]);
  });

  it("stops in the middle of a dropped folder when it is aborted, and rejects with the reason", async () => {
    const controller = new AbortController();
    const reason = new Error("stop the drop");
    let seen = 0;
    const drop = dropTarget({
      include,
      signal: controller.signal,
      onProgress: () => {
        seen += 1;
        if (seen === 40) controller.abort(reason);
      },
    });
    await dropManyFilesFolderOn(drop.selector, 250);
    await expect(drop.mounted).rejects.toBe(reason);
    expect(seen).toBe(40);
  });
});

describe.skipIf(server.browser === "chromium")("HOST-255: the browsers that cannot be given a folder drop in a test", () => {
  it("records that the real drop is made in Chromium only", () => {
    console.info(`DROP-NOT-AUTOMATED ${JSON.stringify({ browser: server.browser })}`);
    expect(server.browser).not.toBe("chromium");
  });
});
