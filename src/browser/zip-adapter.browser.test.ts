import { unzipSync } from "fflate";
import { server } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { MemoryVfs } from "../host/memory-fs.js";
import { directoryGetXmlFiles } from "../import/package-files.js";
import { zipFixtureFolder } from "./adapter-commands.browser.js";
import { type FixtureCase, FIXTURE_CASES, fixtureCasePath } from "./fixture-set.js";
import { INPUT, replayImportStep, stepsOfCase, virtualFs } from "./import-replay-support.browser.js";
import { type FixtureFile, assertTreeMatchesFiles, filesBelow, loadFixtureTree, mountFixtureFiles, readFixtureBytes } from "./test-support.browser.js";
import { ZipError, vfsFromZip, vfsToZip } from "./zip.js";

/**
 * The zip adapter in Chromium, Firefox and WebKit (HOST-250, HOST-251): `vfsFromZip` and `vfsToZip` run on the page's own `Uint8Array`,
 * `TextDecoder` and `Buffer` shim, and give what Node gives. The zips made by other tools (`fixtures/browser/zips/`) mount as
 * `zip.test.ts` says under Node; a recorded import runs on a package that a zip carried (the macOS Finder's junk in it included), and the
 * package is zipped again after the run; the zip the page writes of a recorded tree is the zip that Node writes, byte for byte; and a
 * package of 38 MB is zipped and mounted inside a time alarm. Every file comes through the restricted fixture commands (HOST-263).
 *
 * @spec HOST-250 HOST-251 HOST-263 HOST-266
 */

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The zip that the Node build writes of a fixture folder (`zipFixtureFolder`, `tools/browser-vitest.ts`). */
async function nodeZip(dir: string, level: 0 | 6 = 6): Promise<Uint8Array> {
  return fromBase64(await zipFixtureFolder(dir, level));
}

const zipFixture = (name: string): Promise<Uint8Array> => readFixtureBytes(`fixtures/browser/zips/${name}`);

// ------------------------------------------------------------------------------------------- zips made by other tools

/** The package that the fixture zips hold, by path under `Pkg/` (`fixtures/browser/zips/README.md`). */
const PACKAGE: Record<string, string> = {
  "imports.mf": "<imports>\r\n</imports>\r\n",
  "ItemType/a.xml": '<?xml version="1.0"?>\n<AML><Item type="ItemType" id="1"/></AML>\n',
  "sub/dir/b.xml": `<AML>${"x".repeat(3000)}</AML>\n`,
  "readme.txt": "plain\n",
  "sub/zero.bin": "",
};
const PACKAGE_TREE = ["ItemType/", "ItemType/a.xml", "imports.mf", "readme.txt", "sub/", "sub/dir/", "sub/dir/b.xml", "sub/zero.bin"];

function expectPackage(vfs: MemoryVfs, root: string): void {
  expect(vfs.toTree(root)).toEqual(PACKAGE_TREE);
  for (const [file, content] of Object.entries(PACKAGE)) expect(decode(vfs.readFile(`${root === "/" ? "" : root}/${file}`)), file).toBe(content);
}

describe("HOST-250: zips made by other tools mount in the browser as they do under Node", () => {
  const TOOLS: Array<[string, string]> = [
    ["info-zip.zip", "Info-ZIP zip 3.0, deflate"],
    ["info-zip-zip64.zip", "Info-ZIP zip 3.0 with ZIP64 fields"],
    ["info-zip-streamed.zip", "Info-ZIP zip 3.0 to a pipe: data descriptors"],
    ["7zip-deflate.zip", "7-Zip 26, deflate"],
    ["7zip-store.zip", "7-Zip 26, store"],
  ];

  it.for(TOOLS)("%s (%s) mounts as written, and with the one top-level folder taken off by root: auto", async ([file]) => {
    const bytes = await zipFixture(file);
    const kept = vfsFromZip(bytes);
    expectPackage(kept, "/Pkg");
    expect(kept.stat("/Pkg/empty").isDirectory, "the folder with no file").toBe(true);
    const auto = vfsFromZip(bytes, { root: "auto" });
    expectPackage(auto, "/");
    expect(auto.stat("/empty").isDirectory).toBe(true);
  });

  it("reads a zip with Windows backslashes as names, folders included", async () => {
    const vfs = vfsFromZip(await zipFixture("windows-backslash.zip"), { root: "auto" });
    expect(vfs.toTree()).toEqual(["ItemType/", "ItemType/a.xml", "imports.mf", "sub/", "sub/dir/", "sub/dir/b.xml"]);
    expect(decode(vfs.readFile("/sub/dir/b.xml"))).toBe(PACKAGE["sub/dir/b.xml"]);
  });

  it("skips __MACOSX, AppleDouble files, .DS_Store and Thumbs.db, so that the import's listing of a folder has no junk in it", async () => {
    const vfs = vfsFromZip(await zipFixture("macos-style.zip"), { root: "auto" });
    expectPackage(vfs, "/");
    expect(vfs.toTree()).not.toContainEqual(expect.stringMatching(/__MACOSX|\._|DS_Store|Thumbs/));
    expect(directoryGetXmlFiles("/ItemType", { fs: vfs, platform: "linux", cwd: "/" })).toEqual(["/ItemType/a.xml"]);
  });

  describe("names outside ASCII, which the browser's TextDecoder reads", () => {
    const names = async (file: string): Promise<string[]> => vfsFromZip(await zipFixture(file)).toTree().filter((entry) => !entry.endsWith("/"));

    it("with the UTF-8 flag (7-Zip and Python: é, CJK)", async () => {
      expect(await names("names-7zip-utf8.zip")).toEqual(["Pkg/café.xml", "Pkg/日本語/名前.xml"]);
      expect(await names("names-python-utf8.zip")).toEqual(["Pkg/café.xml", "Pkg/日本語/名前.xml"]);
    });

    it("without the flag, in code page 437 (Windows Explorer: é, ü, ß)", async () => {
      expect(await names("names-cp437.zip")).toEqual(["Pkg/café.xml", "Pkg/straß.xml", "Pkg/über.xml"]);
    });

    it("without the flag, in UTF-8 (Info-ZIP on Linux: é, CJK), as the bytes are valid UTF-8", async () => {
      expect(await names("names-info-zip.zip")).toEqual(["Pkg/café.xml", "Pkg/日本語/名前.xml"]);
    });
  });
});

// --------------------------------------------------------------------------------- a recorded import on a package a zip carried

/** The recorded import cases whose steps run on a package that a zip carried: the defaults, the odd files, the XML declarations and a case of two steps on one tree. */
const ZIPPED_CASES = ["s0-mini-defaults", "fs-odd-files", "fs-xml-declaration", "s2-ref-dep-present"];

/** The files a Finder "Compress" adds to a zipped folder: a `__MACOSX` shadow tree, AppleDouble files beside the real ones, `.DS_Store` and `Thumbs.db`. */
function withFinderJunk(files: readonly FixtureFile[]): FixtureFile[] {
  const junk = new TextEncoder().encode("junk");
  const added: FixtureFile[] = [];
  const folders = new Set<string>();
  for (const file of files) {
    const slash = file.path.lastIndexOf("/");
    const folder = slash < 0 ? "" : file.path.slice(0, slash);
    const name = file.path.slice(slash + 1);
    added.push({ path: `${folder === "" ? "" : `${folder}/`}._${name}`, bytes: junk });
    added.push({ path: `__MACOSX/input/${folder === "" ? "" : `${folder}/`}._${name}`, bytes: junk });
    folders.add(folder);
  }
  for (const folder of folders) {
    added.push({ path: `${folder === "" ? "" : `${folder}/`}.DS_Store`, bytes: junk });
    added.push({ path: `${folder === "" ? "" : `${folder}/`}Thumbs.db`, bytes: junk });
  }
  return [...files, ...added];
}

/** A tree with the package at `/input`, as a zip of the folder above it holds it. */
function stagedPackage(files: readonly FixtureFile[], at = INPUT): MemoryVfs {
  const staging = new MemoryVfs();
  mountFixtureFiles(files, staging, at);
  return staging;
}

for (const engine of ["12.0", "14.0.7", "14.35"] as const) {
  const cases = FIXTURE_CASES.filter((fixture) => fixture.engine === engine && fixture.operation === "import" && ZIPPED_CASES.includes(fixture.name));
  describe(`HOST-250 and HOST-251: the recorded ${engine} import runs on a package that a zip carried, in the browser`, () => {
    it.for(cases.map((fixture) => [fixture.name, fixture] as const))("%s: each step is mounted from a zip, runs as recorded, and is zipped again to the same bytes", async ([, fixture]) => {
      const steps = await stepsOfCase(fixture);
      const vfs = virtualFs();
      for (const step of steps) {
        const recorded = filesBelow(await loadFixtureTree(step.dir), "input");
        const zip = vfsToZip(stagedPackage(recorded));
        let mounted: MemoryVfs | undefined;
        await replayImportStep(fixture, step, {
          vfs,
          mountInput: (tree) => {
            mounted = vfsFromZip(zip, { into: tree });
          },
        });
        expect(mounted, `${step.name}: the zip was the way the package got into the tree`).toBe(vfs);
        // what an import leaves of the package is what it found: zipped again, it is the zip it came from
        expect(sameBytes(vfsToZip(vfs, INPUT), vfsToZip(stagedPackage(recorded, "/"))), `${step.name}: the zip of the package after the run`).toBe(true);
        assertTreeMatchesFiles(vfsFromZip(vfsToZip(vfs, INPUT)), "/", recorded, `${step.name}: the package after the run, unzipped again`);
      }
    });
  });
}

describe("HOST-250: the junk of a zip that the Finder made never reaches a recorded import", () => {
  it("runs the 14.0.7 defaults on a zip with AppleDouble files beside every item file, and the run lists and imports the same files as the recording", async () => {
    const fixture = FIXTURE_CASES.find((candidate) => candidate.engine === "14.0.7" && candidate.operation === "import" && candidate.name === "s0-mini-defaults") as FixtureCase;
    const [step] = await stepsOfCase(fixture);
    const recorded = filesBelow(await loadFixtureTree((step as { dir: string }).dir), "input");
    const dirty = withFinderJunk(recorded);
    expect(dirty.length, "the zip holds a lot of junk").toBeGreaterThan(recorded.length * 2);
    const entries = dirty.map((file) => (file.path.startsWith("__MACOSX/") ? file : { ...file, path: `input/${file.path}` }));
    // the Finder puts the folder, `input/`, in the zip next to `__MACOSX/`
    const zip = vfsToZip(stagedPackage(entries, "/"));
    // the control: what the zip holds, which the reader must leave out
    expect(Object.keys(unzipSync(zip)), "the zip holds the Finder's files").toEqual(expect.arrayContaining(["__MACOSX/input/._imports.mf", "input/._imports.mf", "input/.DS_Store", "input/Thumbs.db"]));
    const vfs = virtualFs();
    await replayImportStep(fixture, step as never, { vfs, mountInput: (tree) => void vfsFromZip(zip, { into: tree, root: "keep" }) });
    // the run compares the package folder with the recording after the run: with one junk file listed, it would not equal it
    expect(vfs.toTree("/")).not.toContainEqual(expect.stringMatching(/__MACOSX|\._|DS_Store|Thumbs/));
  });
});

// ------------------------------------------------------------------- the zip the page writes is the zip that Node writes

/** The recorded trees the zip is written of: the output of every curated export case and the package of the first step of every curated import case. */
function recordedFolders(): string[] {
  const folders: string[] = [];
  for (const fixture of FIXTURE_CASES) {
    const folder = fixtureCasePath(fixture);
    if (fixture.operation === "export") folders.push(`${folder}/output`);
    if (fixture.operation === "import") folders.push(`${folder}/step-1/input`);
  }
  return folders;
}

describe("HOST-251: the zip of a recorded tree is the same bytes in this browser as under Node, and reads back to the tree", () => {
  const folders = recordedFolders();

  it("has the trees to run on", () => {
    expect(folders.length).toBeGreaterThan(50);
  });

  it(`writes ${folders.length} recorded trees, each equal to Node's zip, each read back by toTree() and by bytes`, async () => {
    const failures: string[] = [];
    let written = 0;
    for (const folder of folders) {
      const files = await loadFixtureTree(folder);
      const tree = stagedPackage(files, "/");
      const zip = vfsToZip(tree);
      if (!sameBytes(zip, await nodeZip(folder))) failures.push(`${folder}: not the zip of Node`);
      if (!sameBytes(zip, vfsToZip(stagedPackage(files, "/")))) failures.push(`${folder}: not deterministic`);
      const back = vfsFromZip(zip);
      if (JSON.stringify(back.toTree()) !== JSON.stringify(tree.toTree())) failures.push(`${folder}: the tree`);
      for (const [path, bytes] of tree.snapshot()) {
        const other = back.snapshot().get(path);
        if (other === undefined || !sameBytes(other, bytes)) failures.push(`${folder}: ${path}`);
      }
      written += 1;
    }
    expect(failures).toEqual([]);
    expect(written).toBe(folders.length);
  });

  it("stores or deflates as the level says, and level 0 reads back too", async () => {
    const folder = "fixtures/14.0.7/import/s0-mini-defaults/step-1/input";
    const files = await loadFixtureTree(folder);
    const tree = stagedPackage(files, "/");
    const stored = vfsToZip(tree, "/", { level: 0 });
    expect(sameBytes(stored, await nodeZip(folder, 0)), "level 0 is Node's too").toBe(true);
    assertTreeMatchesFiles(vfsFromZip(stored), "/", files, "stored");
    expect(stored.length, "stored entries are larger than deflated ones").toBeGreaterThan(vfsToZip(tree).length);
  });
});

// ---------------------------------------------------------------------------------------------------------- a large package

/** A step of the zip of a large package that takes longer than this fails: a regression alarm, not a budget (the budget is ticket 31's). */
const LARGE_ALARM_MS = 60_000;

describe("HOST-250 and HOST-251: a package of 38 MB (the 14.0.7 import folder) is zipped and mounted in the browser", () => {
  it("is the zip that Node wrote, mounts within the alarm to the tree it was written from, and is refused above its limit before anything is inflated", async () => {
    const folder = "fixtures/14.0.7/import";
    const nodeStart = performance.now();
    const fromNode = await nodeZip(folder);
    const nodeMs = performance.now() - nodeStart;
    let files: FixtureFile[] | undefined = await loadFixtureTree(folder);
    const total = files.reduce((sum, file) => sum + file.bytes.length, 0);
    expect(total, "the folder is the one of about 38 MB").toBeGreaterThan(35_000_000);

    const stageStart = performance.now();
    const tree = stagedPackage(files, "/");
    const stageMs = performance.now() - stageStart;
    const writeStart = performance.now();
    const written = vfsToZip(tree);
    const writeMs = performance.now() - writeStart;
    expect(sameBytes(written, fromNode), "the zip of 38 MB is Node's, byte for byte").toBe(true);

    const mountStart = performance.now();
    const mounted = vfsFromZip(fromNode);
    const mountMs = performance.now() - mountStart;
    expect(mounted.size, "the bytes of the mounted tree").toBe(tree.size);
    expect(mounted.toTree(), "the mounted tree").toEqual(tree.toTree());
    const paths = tree.toTree().filter((path) => !path.endsWith("/"));
    for (const path of paths) expect(sameBytes(mounted.readFile(`/${path}`), tree.readFile(`/${path}`)), `${path} byte for byte`).toBe(true);
    files = undefined;

    for (const [step, ms] of [["write", writeMs], ["mount", mountMs]] as const) {
      expect(ms, `${step} of the zip of 38 MB in ms (the alarm is ${LARGE_ALARM_MS})`).toBeLessThanOrEqual(LARGE_ALARM_MS);
    }
    const refused = (() => {
      try {
        vfsFromZip(fromNode, { maxBytes: 10_000_000 });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(refused).toBeInstanceOf(ZipError);
    expect((refused as ZipError).code).toBe("ZIP_TOO_LARGE");
    console.info(
      `ZIP-LARGE ${JSON.stringify({ browser: server.browser, files: paths.length, bytes: total, zipBytes: fromNode.length, nodeZipMs: Math.round(nodeMs), stageMs: Math.round(stageMs), writeMs: Math.round(writeMs), mountMs: Math.round(mountMs) })}`,
    );
  });
});
