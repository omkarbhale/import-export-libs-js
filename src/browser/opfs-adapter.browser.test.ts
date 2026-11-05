import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { MemoryVfs } from "../host/memory-fs.js";
import { type FixtureCase, FIXTURE_CASES } from "./fixture-set.js";
import { loadExportCase, replayExportCase } from "./export-replay-support.browser.js";
import { replayImportStep, stepsOfCase, virtualFs } from "./import-replay-support.browser.js";
import {
  CommitError,
  type FsaDirectoryHandle,
  commitToDirectory,
  isFileSystemAccessSupported,
  mountDirectory,
} from "./fsa.js";
import { stubsOf } from "./mount-options.js";
import { PERSISTENT_PROFILE, PREFIX, type Root, folder, getRoot, listing, made, opfsProblem, sweep } from "./opfs-support.browser.js";
import { assertFilesEqual } from "./tree-compare.js";
import { type FixtureFile, assertTreeMatchesFiles, filesBelow, loadFixtureTree, mountFixtureFiles } from "./test-support.browser.js";

/**
 * The directory adapter against the real origin private file system (HOST-252, HOST-253): `navigator.storage.getDirectory()` is a real
 * `FileSystemDirectoryHandle` in Chromium, Firefox and WebKit, so a recorded package is written into it with `commitToDirectory`,
 * mounted back with `mountDirectory`, run through a recorded import, and the tree the run left is committed to a second folder and
 * mounted again; the output of a recorded export takes the same way out. Every folder a test makes is removed with
 * `removeEntry(name, { recursive: true })` when it is done, and a folder a crashed run left is removed before the first test.
 *
 * WebKit, as Playwright drives it, has no origin private file system in an ordinary context (`getDirectory()` rejects with an
 * `UnknownError`, as in a private window of Safari); the project `browser-webkit-opfs` of `vitest.config.ts` runs this file in a
 * persistent profile where WebKit has one (HOST-268). In the ordinary WebKit context the file records the rejection and nothing else.
 * Every browser has `createWritable` on a file of its origin private file system, so the adapter has no `createSyncAccessHandle` fallback.
 *
 * @spec HOST-252 HOST-253 HOST-266 HOST-268
 */

const bytesOf = (tree: MemoryVfs): Map<string, Uint8Array> => tree.snapshot("/");
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

/** The trees hold the same folders and files, each with the same bytes. */
function expectSameTree(actual: MemoryVfs, wanted: MemoryVfs, label: string): void {
  expect(actual.toTree("/"), `${label}: the folders and files`).toEqual(wanted.toTree("/"));
  const got = bytesOf(actual);
  for (const [path, bytes] of bytesOf(wanted)) expect(same(got.get(path) as Uint8Array, bytes), `${label}: ${path} byte for byte`).toBe(true);
}

/** A handle that refuses the names it is told to, as a picked folder on a disk with rules of its own does, and passes the rest to the real folder (HOST-253). */
function refusing(real: Root, refused: ReadonlySet<string>): FsaDirectoryHandle {
  const fail = (name: string): never => {
    throw new TypeError(`Name is not allowed: ${name}`);
  };
  return {
    kind: "directory",
    name: real.name,
    values: () => real.values(),
    getFileHandle: async (name, options) => (refused.has(name) ? fail(name) : real.getFileHandle(name, options)),
    getDirectoryHandle: async (name, options) => (refused.has(name) ? fail(name) : refusing(await real.getDirectoryHandle(name, options), refused)),
    removeEntry: (name, options) => real.removeEntry(name, options),
  };
}

/** The package of a recorded step in a tree of its own, at its root. */
function packageTree(files: readonly FixtureFile[]): MemoryVfs {
  const tree = new MemoryVfs();
  mountFixtureFiles(files, tree, "/");
  return tree;
}

const problem = await opfsProblem();

const include = (): "content" => "content";
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

if (problem !== null && server.browser === "webkit" && !PERSISTENT_PROFILE) {
  describe("HOST-253: WebKit without a persistent profile has no origin private file system", () => {
    it("records the rejection of getDirectory(); the adapter is run against WebKit in the project browser-webkit-opfs", () => {
      console.info(`OPFS-UNAVAILABLE ${JSON.stringify({ browser: server.browser, userAgent: navigator.userAgent, problem })}`);
      expect(problem).toMatch(/UnknownError|SecurityError|NotAllowedError/);
    });
  });
} else if (problem !== null) {
  describe("HOST-253: the origin private file system is available", () => {
    it("is", () => {
      expect(problem).toBeNull();
    });
  });
} else {
  beforeAll(sweep);
  afterAll(async () => {
    const root = await getRoot();
    for (const name of made) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
    const left: string[] = [];
    for await (const entry of root.values()) if (entry.name.startsWith(PREFIX)) left.push(entry.name);
    expect(left, "the folders the tests made are removed").toEqual([]);
  });

  describe("HOST-253: the origin private file system of this browser", () => {
    it("has createWritable on a file, so that commitToDirectory needs no createSyncAccessHandle fallback; the browser is recorded", async () => {
      const handle = await folder("capabilities");
      const file = await handle.getFileHandle("probe.bin", { create: true });
      expect(typeof file.createWritable, "FileSystemFileHandle.createWritable").toBe("function");
      const writable = await file.createWritable();
      await writable.write(new Uint8Array([1, 2, 3]));
      await writable.close();
      expect((await file.getFile()).size).toBe(3);
      console.info(
        `OPFS-CAPABILITIES ${JSON.stringify({ browser: server.browser, userAgent: navigator.userAgent, persistentProfile: PERSISTENT_PROFILE, createWritable: typeof file.createWritable, createSyncAccessHandle: typeof (file as { createSyncAccessHandle?: unknown }).createSyncAccessHandle })}`,
      );
    });

    it("has no folder picker but in Chromium, which isFileSystemAccessSupported tells", () => {
      expect(isFileSystemAccessSupported()).toBe(server.browser === "chromium");
    });
  });

  // ------------------------------------------------------------------------------------ a recorded package, through the folder

  const IMPORTED = ["s0-mini-defaults", "fs-odd-files", "fs-xml-declaration", "s2-ref-dep-present"];
  for (const engine of ["12.0", "14.0.7", "14.35"] as const) {
    const cases = FIXTURE_CASES.filter((fixture) => fixture.engine === engine && fixture.operation === "import" && IMPORTED.includes(fixture.name));
    describe(`HOST-252 and HOST-253: the recorded ${engine} import runs on a package that was written into the origin private file system and mounted from it`, () => {
      it.for(cases.map((fixture) => [fixture.name, fixture] as const))("%s: written, mounted, run as recorded, and the tree the run left is committed to a second folder and mounted again", async ([, fixture]) => {
        const steps = await stepsOfCase(fixture);
        const vfs = virtualFs();
        for (const step of steps) {
          const recorded = filesBelow(await loadFixtureTree(step.dir), "input");
          const source = await folder("package");
          const result = await commitToDirectory(packageTree(recorded), source);
          expect(result.files, `${step.name}: the files written`).toBe(recorded.length);
          expect(result.bytes, `${step.name}: the bytes written`).toBe(recorded.reduce((sum, file) => sum + file.bytes.length, 0));
          assertTreeMatchesFiles(await mountDirectory(source, { include }), "/", recorded, `${step.name}: the package mounted back`);

          await replayImportStep(fixture, step, {
            vfs,
            mountInput: async (tree, at) => void (await mountDirectory(source, { into: tree, at, include })),
          });

          const target = await folder("run");
          const committed = await commitToDirectory(vfs, target);
          expect(committed.files, `${step.name}: every file of the tree`).toBe([...bytesOf(vfs).keys()].length);
          expectSameTree(await mountDirectory(target, { include }), vfs, `${step.name}: the tree the run left, through the second folder`);
        }
      });
    });
  }

  describe("HOST-253: the output of a recorded export is committed to the origin private file system and mounted from it", () => {
    for (const [engine, name] of [["12.0", "e27-permission"], ["14.0.7", "e27-permission"], ["14.0.7", "e04-design-to-goal"], ["14.35", "e27-permission"], ["14.35", "x-par-two-packages-run1"]] as const) {
      it(`${engine} ${name}: the folder the export wrote reads back from the handle byte for byte as the recorded one`, async () => {
        const fixture = FIXTURE_CASES.find((candidate) => candidate.engine === engine && candidate.operation === "export" && candidate.name === name) as FixtureCase;
        const loaded = await loadExportCase(fixture);
        let back: MemoryVfs | undefined;
        await replayExportCase(loaded, {
          afterRun: async ({ vfs, output }) => {
            const target = await folder("export");
            const written = await commitToDirectory(vfs, target, { from: output });
            expect(written.files, "the files the export wrote").toBe(loaded.expectedOutput.size);
            back = await mountDirectory(target, { include });
          },
        });
        assertFilesEqual(back as MemoryVfs, "/", loaded.expectedOutput, `${engine} ${name} (through the origin private file system)`);
      });
    }
  });

  // -------------------------------------------------------------------------------------------------------- what a mount takes

  describe("HOST-252: files that the engine does not read are stubs, by their real size", () => {
    it("takes a binary of 1.5 MB as a stub whose name is in the listing, and its content when the caller says so", async () => {
      const source = await folder("stubs");
      const tree = new MemoryVfs({ "/imports.mf": "<imports/>", "/Pkg/a.xml": "<AML/>", "/Pkg/vault/blob.bin": new Uint8Array(1_500_000).fill(7), "/Pkg/small.bin": new Uint8Array([1, 2]) });
      await commitToDirectory(tree, source);
      const mounted = await mountDirectory(source);
      expect([...stubsOf(mounted)], "the stubs").toEqual(["/Pkg/vault/blob.bin"]);
      expect(mounted.toTree(), "every name is there").toEqual(tree.toTree());
      expect(() => mounted.readFile("/Pkg/vault/blob.bin"), "a stub is not read as empty").toThrow(/EIO/);
      expect(mounted.size, "a stub counts nothing").toBe(10 + 6 + 2);
      const whole = await mountDirectory(source, { include });
      expect(whole.readFile("/Pkg/vault/blob.bin").length).toBe(1_500_000);
      expect([...stubsOf(whole)]).toEqual([]);
    });

    it("refuses what is over maxBytes with ENOSPC, and leaves the tree it was to be mounted into as it was", async () => {
      const source = await folder("limit");
      await commitToDirectory(new MemoryVfs({ "/a.xml": new Uint8Array(600), "/b.xml": new Uint8Array(600) }), source);
      const into = new MemoryVfs({ "/keep.txt": "kept" });
      await expect(mountDirectory(source, { into, maxBytes: 1000 })).rejects.toMatchObject({ code: "ENOSPC" });
      expect(into.toTree()).toEqual(["keep.txt"]);
    });
  });

  // ----------------------------------------------------------------------------------------------- what a commit does to a folder

  describe("HOST-253: a commit removes nothing unless it is told to, and says what it could not write", () => {
    it("keeps what the target holds, replaces a file of the same name, and with clean: true empties the target first", async () => {
      const target = await folder("clean");
      await commitToDirectory(new MemoryVfs({ "/old/x.xml": "old", "/same.xml": "old", "/extra.txt": "extra" }), target);
      await commitToDirectory(new MemoryVfs({ "/same.xml": "new", "/fresh/y.xml": "y" }), target);
      expect(await listing(target)).toEqual(["extra.txt", "fresh/", "fresh/y.xml", "old/", "old/x.xml", "same.xml"]);
      expect(new TextDecoder().decode(await (await (await target.getFileHandle("same.xml")).getFile()).arrayBuffer())).toBe("new");
      await commitToDirectory(new MemoryVfs({ "/only.xml": "o" }), target, { clean: true });
      expect(await listing(target)).toEqual(["only.xml"]);
    });

    it("refuses clean over a tree with stubs before it touches the target", async () => {
      const source = await folder("stubbed-source");
      await commitToDirectory(new MemoryVfs({ "/a.xml": "a", "/big.bin": new Uint8Array(1_200_000) }), source);
      const mounted = await mountDirectory(source);
      const before = await listing(source);
      await expect(commitToDirectory(mounted, source, { clean: true })).rejects.toThrow(/clean refused/);
      expect(await listing(source), "nothing was touched").toEqual(before);
    });

    it("writes the rest and then rejects with the refused names, when the handle refuses some", async () => {
      const real = await folder("refusing");
      const tree = new MemoryVfs({ "/ok/one.xml": "1", "/ok/two.xml": "2", "/bad.xml": "x", "/ok/bad.xml": "y", "/sub/three.xml": "3" });
      const failure = (await commitToDirectory(tree, refusing(real, new Set(["bad.xml"]))).catch((error: unknown) => error)) as CommitError;
      expect(failure).toBeInstanceOf(CommitError);
      expect(failure.aborted).toBe(false);
      expect(failure.failures.map((entry) => entry.path).sort()).toEqual(["bad.xml", "ok/bad.xml"]);
      expect(failure.written.files).toBe(3);
      expect(await listing(real)).toEqual(["ok/", "ok/one.xml", "ok/two.xml", "sub/", "sub/three.xml"]);
    });

    it("writes a name that the browser may refuse (a backslash), or reports exactly that name, and has written the rest either way", async () => {
      const real = await folder("odd-name");
      const tree = new MemoryVfs({ "/a.xml": "a", "/odd\\name.xml": "odd", "/b/c.xml": "c" });
      const outcome = await commitToDirectory(tree, real).catch((error: unknown) => error);
      if (outcome instanceof CommitError) {
        expect(outcome.failures.map((entry) => entry.path)).toEqual(["odd\\name.xml"]);
        expect(await listing(real)).toEqual(["a.xml", "b/", "b/c.xml"]);
      } else {
        expect(await listing(real)).toEqual(["a.xml", "b/", "b/c.xml", "odd\\name.xml"]);
        expectSameTree(await mountDirectory(real, { include }), tree, "the tree with the odd name");
      }
      console.info(`OPFS-BACKSLASH-NAME ${JSON.stringify({ browser: server.browser, refused: outcome instanceof CommitError })}`);
    });

    it("writes 250 files of one folder (more than the 8 it writes at once, and more than a directory reader lists in one batch) and mounts them back", async () => {
      const real = await folder("many");
      const tree = new MemoryVfs();
      for (let index = 0; index < 250; index += 1) tree.mount({ [`/Many/item-${String(index).padStart(4, "0")}.xml`]: utf8(`<Item n="${index}"/>`) });
      const written = await commitToDirectory(tree, real);
      expect(written).toEqual({ files: 250, directories: 1, bytes: tree.size, stubs: 0 });
      expectSameTree(await mountDirectory(real, { include }), tree, "250 files");
    });
  });

  // --------------------------------------------------------------------------------------------------------------------- abort

  describe("HOST-252 and HOST-253: an abort leaves no partial tree on a mount and says what a commit wrote", () => {
    it("mount: an abort in the middle of the walk rejects with the reason, and the tree it was to be mounted into is as it was", async () => {
      const source = await folder("abort-mount");
      const tree = new MemoryVfs();
      for (let index = 0; index < 40; index += 1) tree.mount({ [`/d${index % 4}/f${index}.xml`]: utf8(`<n>${index}</n>`) });
      await commitToDirectory(tree, source);
      const into = new MemoryVfs({ "/keep/me.txt": "kept" });
      const before = into.toTree();
      const controller = new AbortController();
      const reason = new Error("stop the mount");
      let seen = 0;
      await expect(
        mountDirectory(source, {
          into,
          include,
          signal: controller.signal,
          onProgress: () => {
            seen += 1;
            if (seen === 10) controller.abort(reason);
          },
        }),
      ).rejects.toBe(reason);
      expect(seen, "the walk had gone on, and stopped").toBeGreaterThanOrEqual(10);
      expect(seen, "and did not go to the end").toBeLessThan(40);
      expect(into.toTree(), "no partial state in the tree").toEqual(before);
      expect(into.snapshot("/").size).toBe(1);
    });

    it("mount: a signal that was aborted before the call is refused before anything is read", async () => {
      const source = await folder("abort-before");
      await commitToDirectory(new MemoryVfs({ "/a.xml": "a" }), source);
      const into = new MemoryVfs();
      await expect(mountDirectory(source, { into, signal: AbortSignal.abort(new Error("already")) })).rejects.toThrow("already");
      expect(into.toTree()).toEqual([]);
    });

    it("commit: an abort in the middle rejects with a CommitError that is aborted, whose count is the files that are in the target", async () => {
      const target = await folder("abort-commit");
      const tree = new MemoryVfs();
      for (let index = 0; index < 60; index += 1) tree.mount({ [`/d${index % 3}/f${String(index).padStart(2, "0")}.xml`]: utf8(`<n>${index}</n>`) });
      const controller = new AbortController();
      const reason = new Error("stop the commit");
      const failure = (await commitToDirectory(tree, target, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.files === 12) controller.abort(reason);
        },
      }).catch((error: unknown) => error)) as CommitError;
      expect(failure).toBeInstanceOf(CommitError);
      expect(failure.aborted).toBe(true);
      expect(failure.cause).toBe(reason);
      const inTarget = (await listing(target)).filter((path) => !path.endsWith("/"));
      expect(failure.written.files, "the count it reports is the files in the target").toBe(inTarget.length);
      expect(failure.written.files).toBeGreaterThanOrEqual(12);
      expect(failure.written.files).toBeLessThan(60);
      // what is there was written whole
      const back = await mountDirectory(target, { include });
      for (const [path, bytes] of bytesOf(back)) expect(same(bytes, tree.readFile(`/${path}`)), `${path} was written whole`).toBe(true);
    });
  });
}
