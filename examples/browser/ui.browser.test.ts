import { commands, userEvent } from "vitest/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryVfs, type WorkerExportResult, type WorkerOperationResult, vfsFromZip, vfsToZip } from "../../src/browser.js";
import { FakeDirectoryHandle } from "../../src/browser/fake-directory-handle.js";
import { fakeDrop } from "../../src/browser/api-test-support.js";
import { loadFixtureTree } from "../../src/browser/test-support.browser.js";
import { packageCaches } from "../../src/client/package-lookups.js";
import type { BuiltPageRun, StartedReplay, StoppedReplay } from "../../tools/browser-example/replay-types.js";
import { type App, type AppDeps, mountApp } from "./app.js";
import { type EngineClient, createWorkerEngine } from "./engine-client.js";

/**
 * The reference page, driven as a person drives it, in each browser (HOST-280, HOST-281). The page is mounted as `main.ts` mounts it
 * and talks to a recorded run served over HTTP by a server of the Vitest side, on another origin: the page's own `fetch` transport,
 * CORS and the browser API are all real. An export is downloaded as a zip and must be the recorded output byte for byte; an import
 * runs from a zip, from a folder input and from a drop, and the server must see every recorded request, each as recorded. The folder
 * picker is exercised through a directory handle written in memory, which stands in for the picker's dialog, the one thing a test
 * cannot drive, so the native picker itself is unproven live.
 *
 * @spec HOST-280 HOST-281
 */

declare module "vitest/browser" {
  interface BrowserCommands {
    startReplay(id: string): Promise<StartedReplay>;
    stopReplay(handle: string): Promise<StoppedReplay>;
    replayRequests(handle: string): Promise<string[]>;
    runBuiltPage(id: string): Promise<BuiltPageRun>;
    workerBundle(): Promise<string>;
  }
}

// the dependency cache outlives a session (EXP-619), and every recording was made by a process of its own; the page's own run is in a
// new Worker each time, which has none, and this clears the one of the test's page for the tests that run the engine there
beforeEach(() => packageCaches.dependsOn.clear());

// the page's engine is the Worker that ships: the text of `dist/browser-worker.js`, built by the Vitest server, started from a Blob URL
let workerUrl = "";
beforeAll(async () => {
  workerUrl = URL.createObjectURL(new Blob([await commands.workerBundle()], { type: "text/javascript" }));
});
afterAll(() => URL.revokeObjectURL(workerUrl));

// --------------------------------------------------------------------------------------------------------------- helpers

let app: App | undefined;
let host: HTMLElement | undefined;
let replay: { started: StartedReplay } | undefined;

afterEach(async () => {
  app?.destroy();
  host?.remove();
  app = host = undefined;
  if (replay !== undefined) await commands.stopReplay(String(replay.started.handle));
  replay = undefined;
});

function mount(deps: AppDeps = {}): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  app = mountApp(host, { engine: createWorkerEngine({ worker: () => workerUrl }), location: { protocol: "https:", hostname: "tools.example.com" }, ...deps });
  return host;
}

async function startReplay(id: string): Promise<StartedReplay> {
  const started = await commands.startReplay(id);
  replay = { started };
  return started;
}

/** What the server has seen so far; it goes on running. */
const requestsSoFar = (): Promise<string[]> => commands.replayRequests(String((replay as { started: StartedReplay }).started.handle));

/** What the server saw: stops it and answers with what the recording was used for. */
async function stopReplay(): Promise<StoppedReplay> {
  const handle = (replay as { started: StartedReplay }).started.handle;
  replay = undefined;
  return commands.stopReplay(String(handle));
}

function q<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = (host as HTMLElement).querySelector<T>(selector);
  if (element === null) throw new Error(`the page has no ${selector}`);
  return element;
}

const key = (name: string, panel?: string): HTMLInputElement => q<HTMLInputElement>(`${panel === undefined ? "" : `[data-panel="${panel}"] `}[data-key="${name}"]`);
const runButton = (): HTMLButtonElement => q<HTMLButtonElement>('[data-key="run"]');
const sourceStatus = (panel: string): HTMLElement => q(`[data-panel="${panel}"] .source .status`);

async function connectTo(url: string, options: { engine: string; user?: string } = { engine: "14.0.7" }): Promise<void> {
  await userEvent.fill(key("url"), url);
  await userEvent.fill(key("database"), "12sp9");
  await userEvent.fill(key("userName"), options.user ?? "admin");
  await userEvent.fill(key("password"), "pw-of-the-test-xyz");
  await userEvent.selectOptions(key("engine"), options.engine);
}

async function openTab(mode: string): Promise<void> {
  await userEvent.click(q(`[data-mode="${mode}"]`));
}

/** Clicks Run and waits for the run to end. */
async function run(): Promise<void> {
  await userEvent.click(runButton());
  await vi.waitFor(() => expect(runButton().disabled).toBe(false), { timeout: 60_000 });
}

const logText = (): string => q(".log").textContent ?? "";
const failureText = (): string => q('.run-view [role="alert"]').textContent ?? "";

async function treeOf(dir: string): Promise<MemoryVfs> {
  const vfs = new MemoryVfs();
  const files: Record<string, Uint8Array> = {};
  for (const file of await loadFixtureTree(dir)) files[`/${file.path}`] = file.bytes;
  vfs.mount(files);
  return vfs;
}

async function zipFileOf(dir: string, name = "package.zip"): Promise<File> {
  return new File([new Uint8Array(vfsToZip(await treeOf(dir), "/"))], name, { type: "application/zip" });
}

/** A folder as a folder input gives it: every file with its path from the folder's own name. */
async function folderInput(dir: string, folder: string): Promise<File[]> {
  return (await loadFixtureTree(dir)).map((file) => {
    const made = new File([new Uint8Array(file.bytes)], file.path.split("/").at(-1) as string);
    Object.defineProperty(made, "webkitRelativePath", { value: `${folder}/${file.path}` });
    return made;
  });
}

function fileList(files: File[]): FileList {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  return transfer.files;
}

/** The recorded package with an extra file of `size` bytes that do not compress, so that the zip is a valid package over the limit. */
async function largeZipFileOf(dir: string, size: number): Promise<File> {
  const vfs = await treeOf(dir);
  const filler = new Uint8Array(size);
  for (let at = 0; at < size; at += 65_536) crypto.getRandomValues(filler.subarray(at, at + 65_536));
  vfs.mount({ "/filler.bin": filler });
  return new File([new Uint8Array(vfsToZip(vfs, "/"))], "large.zip", { type: "application/zip" });
}

/** Puts a file in a file input, as choosing it does; a test driver's upload refuses more than 50 MB. */
function chooseFile(input: HTMLInputElement, file: File): void {
  input.files = fileList([file]);
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const IMPORT_CASE = "14.0.7/import/s0-mini-defaults";
const IMPORT_INPUT = "fixtures/14.0.7/import/s0-mini-defaults/step-1/input";
const EXPORT_CASE = "14.0.7/export/e27-permission";
const EXPORT_OUTPUT = "fixtures/14.0.7/export/e27-permission/output";

async function expectImportDone(): Promise<void> {
  expect(failureText()).toBe("");
  expect(q(".summary").textContent).toContain("success");
  const report = await stopReplay();
  expect(report.mismatches).toEqual([]);
  expect(report.consumed).toBe(report.total);
  expect(report.total).toBeGreaterThan(20);
}

// ------------------------------------------------------------------------------------------------------------------ export

describe("export, from the page to a zip", () => {
  it("downloads a zip that is the recorded output, byte for byte, and leaves no password behind", async () => {
    const saved: Array<{ name: string; bytes: Uint8Array }> = [];
    mount({ saveFile: (name, bytes) => saved.push({ name, bytes }) });
    const { url, recipe } = await startReplay(EXPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    await userEvent.fill(key("packages", "export"), (recipe.packages as string[]).join("\n"));
    if (recipe.level !== undefined) await userEvent.fill(key("level", "export"), recipe.level);
    await run();

    expect(failureText()).toBe("");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toMatch(/^export-\d{8}-\d{6}\.zip$/);
    const wanted = new Map((await loadFixtureTree(EXPORT_OUTPUT)).map((file) => [file.path, file.bytes] as const));
    const unzipped = vfsFromZip(saved[0]?.bytes as Uint8Array).snapshot("/");
    expect([...unzipped.keys()].sort()).toEqual([...wanted.keys()].sort());
    for (const [path, bytes] of wanted) expect(unzipped.get(path), path).toEqual(bytes);

    // what the person sees
    expect(q(".summary").textContent).toContain("success");
    expect(q(".progress").textContent).toContain(recipe.packages?.[0] as string);
    expect(logText()).toContain("Exporting package");
    // the server saw the recorded requests, every one as recorded
    const report = await stopReplay();
    expect(report.mismatches).toEqual([]);
    expect(report.consumed).toBe(report.total);
    expect(report.requests.some((line) => line.includes("Logoff"))).toBe(true);

    // HOST-281: the password is gone from the field, and was never stored or put in the URL
    expect(key("password").value).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(location.href).not.toContain("pw-of-the-test");
    expect(document.documentElement.outerHTML).not.toContain("pw-of-the-test");
  });

  it("writes the same files into a folder when the browser has the picker", async () => {
    const saved: unknown[] = [];
    const target = new FakeDirectoryHandle("chosen");
    mount({ canPickDirectory: true, pickDirectory: () => Promise.resolve(target), saveFile: (name) => saved.push(name) });
    const { url, recipe } = await startReplay(EXPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    await userEvent.fill(key("packages", "export"), (recipe.packages as string[]).join("\n"));
    if (recipe.level !== undefined) await userEvent.fill(key("level", "export"), recipe.level);
    await userEvent.click(key("sink-pick"));
    await vi.waitFor(() => expect(host?.querySelector(".sink")?.textContent).toContain("chosen"));
    await run();

    expect(failureText()).toBe("");
    expect(saved).toEqual([]);
    const wanted = await loadFixtureTree(EXPORT_OUTPUT);
    for (const file of wanted) {
      let folder: FakeDirectoryHandle = target;
      const parts = file.path.split("/");
      for (const part of parts.slice(0, -1)) folder = (await folder.getDirectoryHandle(part)) as FakeDirectoryHandle;
      const written = await (await folder.getFileHandle(parts.at(-1) as string)).getFile();
      expect(new Uint8Array(await written.arrayBuffer()), file.path).toEqual(file.bytes);
    }
    expect((await stopReplay()).mismatches).toEqual([]);
  });

  it("shows the library's refusal of a selection, with the type of the error", async () => {
    mount();
    const { url, recipe } = await startReplay(EXPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    // an option of 14.35 on the engine 14.0.7: the page does not check it, and the library refuses it before it sends a request
    await userEvent.fill(key("packages", "export"), "some.package");
    await userEvent.fill(key("parallelism", "export"), "4");
    await run();
    expect(failureText()).toMatch(/^OptionError: parallelism needs engine 14\.35/);
    expect((await stopReplay()).consumed).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------------------------ import

describe("import, from a zip, a folder and a drop", () => {
  it("imports a zip that was chosen, as recorded", async () => {
    mount();
    const { url, recipe } = await startReplay(IMPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    await openTab("import");
    await userEvent.upload(q('[data-panel="import"] [data-source="zip"]'), await zipFileOf(IMPORT_INPUT));
    await vi.waitFor(() => expect(sourceStatus("import").textContent).toContain("read when you press Run"));
    await userEvent.fill(key("osUser", "import"), recipe.osUser as string);
    await run();

    await expectImportDone();
    expect(logText()).toContain("LIBSJS-SCRATCH-MINI");
    expect(q(".progress").textContent).toContain("completed");
    expect(q('[data-key="download-log"]').hidden).toBe(false);
  });

  it("imports a folder that was chosen with a folder input, as recorded", async () => {
    mount();
    const { url, recipe } = await startReplay(IMPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    await openTab("import");
    const input = q<HTMLInputElement>('[data-panel="import"] [data-source="folder"]');
    input.files = fileList(await folderInput(IMPORT_INPUT, "my-package"));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(sourceStatus("import").textContent).toContain("my-package"));
    await userEvent.fill(key("osUser", "import"), recipe.osUser as string);
    await run();
    await expectImportDone();
  });

  it.for(["zip", "folder"] as const)("imports a %s that was dropped, as recorded", async (kind) => {
    mount();
    const { url, recipe } = await startReplay(IMPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    await openTab("import");
    // a browser makes the entries of a real drag; a script cannot, so the drop carries entries written as the browser's are
    const dropped =
      kind === "zip"
        ? fakeDrop([{ path: "dropped.zip", bytes: new Uint8Array(await (await zipFileOf(IMPORT_INPUT)).arrayBuffer()) }])
        : fakeDrop((await loadFixtureTree(IMPORT_INPUT)).map((file) => ({ path: `dropped-folder/${file.path}`, bytes: file.bytes })));
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { items: dropped } });
    q('[data-panel="import"] [data-source="drop"]').dispatchEvent(drop);
    expect(sourceStatus("import").textContent).toContain(kind === "zip" ? "dropped.zip" : "dropped-folder");
    await userEvent.fill(key("osUser", "import"), recipe.osUser as string);
    await run();
    await expectImportDone();
  });

  it("imports a folder behind a picked directory handle, as recorded", async (context) => {
      // a handle crosses to the Worker, which reads the folder there; only a real one can cross, so the origin private file system stands in for the picker's folder
      const tree = await loadFixtureTree(IMPORT_INPUT);
      let root: FileSystemDirectoryHandle | undefined;
      let handle: FileSystemDirectoryHandle;
      try {
        root = await navigator.storage.getDirectory();
        await root.removeEntry("ui-test-picked", { recursive: true }).catch(() => undefined);
        handle = await root.getDirectoryHandle("ui-test-picked", { create: true });
        for (const file of tree) {
          let folder = handle;
          const parts = file.path.split("/");
          for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create: true });
          const writable = await (await folder.getFileHandle(parts.at(-1) as string, { create: true })).createWritable();
          await writable.write(new Uint8Array(file.bytes));
          await writable.close();
        }
      } catch (error) {
        // WebKit outside a persistent profile refuses the origin private file system itself (UnknownError, HOST-268), and its page's thread cannot write one (a writable fails); the test has no folder to pick there
        await root?.removeEntry("ui-test-picked", { recursive: true }).catch(() => undefined);
        return context.skip(`this browser cannot make the folder the test would pick: ${String(error)}`);
      }
      mount({ canPickDirectory: true, pickDirectory: () => Promise.resolve(handle as never) });
      const { url, recipe } = await startReplay(IMPORT_CASE);
      await connectTo(url, { engine: recipe.engine });
      await openTab("import");
      await userEvent.click(q('[data-panel="import"] [data-source="picker"]'));
      await vi.waitFor(() => expect(sourceStatus("import").textContent).toContain("ui-test-picked"));
      await userEvent.fill(key("osUser", "import"), recipe.osUser as string);
      await run();
      await expectImportDone();
      await root.removeEntry("ui-test-picked", { recursive: true });
  });

  it("asks for the package before it connects", async () => {
    mount();
    const { url, recipe } = await startReplay(IMPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    await openTab("import");
    await userEvent.click(runButton());
    await vi.waitFor(() => expect(q(".actions ~ .error").hidden).toBe(false));
    expect(q(".actions ~ .error").textContent).toContain("load the package first");
    expect(runButton().disabled).toBe(false);
  });

  it("warns of a package over the limit before the login, keeps the password, and goes on at the second press, as recorded", async () => {
    mount();
    const { url, recipe } = await startReplay(IMPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    await openTab("import");
    chooseFile(q('[data-panel="import"] [data-source="zip"]'), await largeZipFileOf(IMPORT_INPUT, 60_000_000));
    await vi.waitFor(() => expect(sourceStatus("import").textContent).toContain("over the limit of about 50 MB"));
    expect(sourceStatus("import").textContent).toMatch(/a zip of 60\.\d MB/);
    await userEvent.fill(key("osUser", "import"), recipe.osUser as string);
    const notice = q('[data-key="size-notice"]');
    expect(notice.hidden).toBe(true);

    await run();
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toMatch(/60 MB/);
    expect(notice.textContent).toContain("aras-pkg import");
    expect(await requestsSoFar()).toEqual([]);
    expect(key("password").value).toBe("pw-of-the-test-xyz");

    await run();
    expect(notice.hidden).toBe(true);
    expect(key("password").value).toBe("");
    await expectImportDone();
  });

  it("drops the warning when an over-limit zip is swapped for a small one, and runs at once, as recorded", async () => {
    mount();
    const { url, recipe } = await startReplay(IMPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    await openTab("import");
    const zipInput = q<HTMLInputElement>('[data-panel="import"] [data-source="zip"]');
    chooseFile(zipInput, new File([new Uint8Array(60_000_000)], "large.zip", { type: "application/zip" }));
    await vi.waitFor(() => expect(sourceStatus("import").textContent).toContain("over the limit of about 50 MB"));
    await userEvent.fill(key("osUser", "import"), recipe.osUser as string);
    await run();
    const notice = q('[data-key="size-notice"]');
    expect(notice.hidden).toBe(false);
    expect(await requestsSoFar()).toEqual([]);

    chooseFile(zipInput, await zipFileOf(IMPORT_INPUT));
    await vi.waitFor(() => expect(sourceStatus("import").textContent).toContain("package.zip"));
    expect(sourceStatus("import").textContent).not.toContain("over the limit");
    expect(notice.hidden).toBe(true);

    await run();
    expect(notice.hidden).toBe(true);
    expect(key("password").value).toBe("");
    await expectImportDone();
  });

  it("warns of a dropped zip over the limit before the login, and keeps the password", async () => {
    let connects = 0;
    mount({
      engine: {
        connect: () => {
          connects += 1;
          return Promise.reject(new Error("no server in this test"));
        },
      },
    });
    await connectTo("https://aras.example.com/InnovatorServer");
    await openTab("import");
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { items: fakeDrop([{ path: "large.zip", bytes: new Uint8Array(60_000_000) }]) } });
    q('[data-panel="import"] [data-source="drop"]').dispatchEvent(drop);
    expect(sourceStatus("import").textContent).toContain("over the limit of about 50 MB");
    await userEvent.fill(key("osUser", "import"), "someone");

    await run();
    expect(q('[data-key="size-notice"]').textContent).toContain("60 MB");
    expect(connects).toBe(0);
    expect(key("password").value).toBe("pw-of-the-test-xyz");
  });

  it("says why a zip could not be read, when the run reads it", async () => {
    mount();
    const { url, recipe } = await startReplay(IMPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    await openTab("import");
    await userEvent.upload(q('[data-panel="import"] [data-source="zip"]'), new File([new Uint8Array([1, 2, 3, 4])], "broken.zip", { type: "application/zip" }));
    await run();
    expect(failureText()).toMatch(/^ZipError: /);
    expect(runButton().disabled).toBe(false);
  });
});

// ------------------------------------------------------------------------------------- language packs and DB patches

describe("language packs and DB patches, through their tabs", () => {
  async function expectAsRecorded(): Promise<void> {
    expect(failureText()).toBe("");
    expect(q(".summary").textContent).toContain("success");
    expect(key("password").value).toBe("");
    const report = await stopReplay();
    expect(report.mismatches).toEqual([]);
    expect(report.total).toBeGreaterThan(0);
    expect(report.consumed).toBe(report.total);
    expect(report.requests.some((line) => line.includes("Logoff"))).toBe(true);
  }

  it("imports a language pack, as recorded", async () => {
    mount();
    const { url, recipe } = await startReplay("14.0.7/language-pack/lp01");
    await connectTo(url, { engine: recipe.engine });
    await openTab("language-pack");
    await userEvent.upload(q('[data-panel="language-pack"] [data-source="zip"]'), await zipFileOf("fixtures/14.0.7/language-pack/lp01/lp"));
    await userEvent.fill(key("lpPackage", "language-pack"), recipe.lpPackage as string);
    await userEvent.fill(key("osUser", "language-pack"), recipe.osUser as string);
    await run();
    await expectAsRecorded();
  });

  it("applies a DB patch as root, as recorded", async () => {
    mount();
    const { url, recipe } = await startReplay("14.35/dbpatch/apply");
    await connectTo(url, { engine: recipe.engine, user: recipe.userName });
    await openTab("db-patches");
    await userEvent.upload(q('[data-panel="db-patches"] [data-source="zip"]'), await zipFileOf("fixtures/14.35/dbpatch/apply/step-1/input"));
    await userEvent.fill(key("manifestPath", "db-patches"), recipe.manifestPath as string);
    await userEvent.fill(key("osUser", "db-patches"), recipe.osUser as string);
    await run();
    await expectAsRecorded();
  });
});

// ------------------------------------------------------------------------------------------------------ abort and failure

/** An engine that stays in the operation until the signal is raised, then ends it as the library does. */
function waitingEngine(): EngineClient {
  const cancelled = (): WorkerOperationResult => ({
    log: "",
    messages: [],
    summary: { operation: "import", engine: "14.0.7", server: "14.0.9.1", result: "cancelled", returnCode: 0, aborted: true, messages: { info: 0, warnings: 0, errors: 0, packages: 0 }, packages: [] },
  });
  return {
    connect: () =>
      Promise.resolve({
        engine: "14.0.7",
        serverVersion: "14.0.9.1",
        exportPackages: () => Promise.reject(new Error("not used")),
        importLanguagePack: () => Promise.reject(new Error("not used")),
        applyDbPatches: () => Promise.reject(new Error("not used")),
        importPackages: (options) =>
          new Promise<WorkerOperationResult>((resolve) => {
            options.onProgress?.({ operation: "import", phase: "package", package: "P" });
            options.signal?.addEventListener("abort", () => resolve(cancelled()));
          }),
        close: () => Promise.resolve(),
      }),
  };
}

/** An engine whose export ends the way `end` says, after it has said something. */
function endingEngine(end: "cancelled" | "fails" | "empty", saved: { exported: number }): EngineClient {
  return {
    connect: () =>
      Promise.resolve({
        engine: "14.0.7",
        serverVersion: "14.0.9.1",
        importLanguagePack: () => Promise.reject(new Error("not used")),
        applyDbPatches: () => Promise.reject(new Error("not used")),
        exportPackages: (options) => {
          saved.exported += 1;
          options.onMessage?.({ source: "engine", channel: "status", level: "info", text: "Item 1 of 2: Permission - a" });
          if (end === "fails") return Promise.reject(new Error("the server refused the item"));
          if (end === "empty") {
            return Promise.resolve<WorkerExportResult>({
              files: new Map(),
              log: "",
              messages: [],
              summary: { operation: "export", engine: "14.0.7", server: "14.0.9.1", result: "success", returnCode: 0, aborted: false, messages: { info: 0, warnings: 0, errors: 0, packages: 0 }, packages: [] },
            });
          }
          return Promise.resolve<WorkerExportResult>({
            zip: new Uint8Array([80, 75]),
            files: new Map([["partial.xml", new Uint8Array([1])]]),
            log: "the engine's log",
            messages: [],
            summary: { operation: "export", engine: "14.0.7", server: "14.0.9.1", result: "cancelled", returnCode: 0, aborted: true, messages: { info: 0, warnings: 0, errors: 0, packages: 0 }, packages: [] },
          });
        },
        importPackages: () => Promise.reject(new Error("not used")),
        close: () => Promise.resolve(),
      }),
  };
}

describe("abort and failure", () => {
  it("does not deliver an export that was cancelled, and says so", async () => {
    const saved = { exported: 0 };
    const files: string[] = [];
    mount({ engine: endingEngine("cancelled", saved), saveFile: (name) => files.push(name) });
    await connectTo("http://unused.example/x");
    await userEvent.fill(key("packages", "export"), "some.package");
    await run();
    expect(saved.exported).toBe(1);
    expect(files).toEqual([]);
    expect(q(".run-view .status").textContent).toBe("The export was cancelled. Nothing was saved.");
    expect(q(".summary").textContent).toContain("cancelled");
  });

  it("saves nothing when an export produced no files, and says so", async () => {
    const files: string[] = [];
    mount({ engine: endingEngine("empty", { exported: 0 }), saveFile: (name) => files.push(name) });
    await connectTo("http://unused.example/x");
    await userEvent.fill(key("packages", "export"), "some.package");
    await run();
    expect(files).toEqual([]);
    expect(q(".run-view .status").textContent).toBe("The export produced no files. Nothing was saved.");
  });

  it("keeps the typed password and sends nothing when a required field is empty or nothing is selected", async () => {
    mount();
    const { url, recipe } = await startReplay(EXPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    // nothing selected: no package named
    await userEvent.click(runButton());
    await vi.waitFor(() => expect(q(".actions ~ .error").hidden).toBe(false));
    expect(q(".actions ~ .error").textContent).toContain("name at least one package");
    expect(key("password").value).toBe("pw-of-the-test-xyz");
    // a required field of the connection left empty
    await userEvent.fill(key("packages", "export"), "some.package");
    await userEvent.clear(key("database"));
    await userEvent.click(runButton());
    await vi.waitFor(() => expect(q(".actions ~ .error").textContent).toContain("the database is required"));
    expect(key("password").value).toBe("pw-of-the-test-xyz");
    expect(runButton().disabled).toBe(false);
    expect((await stopReplay()).requests).toEqual([]);
  });

  it("offers what the engine said in a run that failed, and keeps the password the person typed when the form was refused", async () => {
    const saved = { exported: 0 };
    const files: Array<{ name: string; text: string }> = [];
    mount({ engine: endingEngine("fails", saved), saveFile: (name, bytes) => files.push({ name, text: new TextDecoder().decode(bytes) }) });
    // a form that is refused before anything is sent: no package is named for the export of a manifest
    await connectTo("http://unused.example/x");
    await userEvent.selectOptions(key("selection", "export"), "from-manifest");
    await userEvent.click(runButton());
    await vi.waitFor(() => expect(q(".actions ~ .error").hidden).toBe(false));
    expect(key("password").value).toBe("pw-of-the-test-xyz");
    expect(saved.exported).toBe(0);
    // a run that fails: the log the engine wrote before it failed
    await userEvent.selectOptions(key("selection", "export"), "packages");
    await userEvent.fill(key("packages", "export"), "some.package");
    await run();
    expect(failureText()).toContain("the server refused the item");
    expect(key("password").value).toBe("");
    expect(q('[data-key="download-log"]').hidden).toBe(false);
    await userEvent.click(q('[data-key="download-log"]'));
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toMatch(/^messages-.*\.log$/);
    expect(files[0]?.text).toBe("Item 1 of 2: Permission - a");
  });

  it("raises the run's signal when Abort is pressed, and ends with a cancelled run", async () => {
    mount({ engine: waitingEngine() });
    await connectTo("http://unused.example/x");
    await openTab("import");
    await userEvent.upload(q('[data-panel="import"] [data-source="zip"]'), await zipFileOf(IMPORT_INPUT));
    await vi.waitFor(() => expect(sourceStatus("import").textContent).toContain("read when you press Run"));
    await userEvent.click(runButton());
    await vi.waitFor(() => expect(q<HTMLButtonElement>('[data-key="abort"]').disabled).toBe(false));
    expect(runButton().disabled).toBe(true);
    await vi.waitFor(() => expect(q(".progress").textContent).toContain("P"));
    await userEvent.click(q('[data-key="abort"]'));
    await vi.waitFor(() => expect(runButton().disabled).toBe(false));
    expect(q(".summary").textContent).toContain("cancelled");
    expect(q<HTMLButtonElement>('[data-key="abort"]').disabled).toBe(true);
  });

  it("says a run was cancelled, not failed, when Abort is pressed during the login", async () => {
    let finishLogin = (): void => undefined;
    const login = new Promise<void>((resolve) => {
      finishLogin = resolve;
    });
    const real = createWorkerEngine({ worker: () => workerUrl });
    const files: string[] = [];
    mount({
      engine: {
        connect: async (options) => {
          await login;
          return real.connect(options);
        },
      },
      saveFile: (name) => files.push(name),
    });
    const { url, recipe } = await startReplay(EXPORT_CASE);
    await connectTo(url, { engine: recipe.engine });
    await userEvent.fill(key("packages", "export"), (recipe.packages as string[]).join("\n"));
    await userEvent.click(runButton());
    await vi.waitFor(() => expect(q(".run-view .status").textContent).toBe("Connecting…"));
    await userEvent.click(q('[data-key="abort"]'));
    finishLogin();
    await vi.waitFor(() => expect(runButton().disabled).toBe(false), { timeout: 60_000 });
    expect(failureText()).toBe("");
    expect(q(".run-view .status").textContent).toBe("The run was cancelled. Nothing was saved.");
    expect(files).toEqual([]);
    expect((await stopReplay()).consumed).toBe(0);
  });

  it("shows a server that cannot be reached as the engine's own error, not as an unhandled rejection", async () => {
    mount();
    const { url, recipe } = await startReplay(IMPORT_CASE);
    await stopReplay(); // the port is closed now
    await connectTo(url, { engine: recipe.engine });
    await openTab("import");
    await userEvent.upload(q('[data-panel="import"] [data-source="zip"]'), await zipFileOf(IMPORT_INPUT));
    await vi.waitFor(() => expect(sourceStatus("import").textContent).toContain("read when you press Run"));
    await run();
    expect(failureText()).toMatch(/^CItemException: Failed login to Innovator/);
    expect(failureText()).toContain("HttpRequestException");
    expect(failureText()).toMatch(/allowedCorsOrigins.*12 SP9.*SOAP endpoint/);
    expect(key("password").value).toBe("");
    expect(runButton().disabled).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------- what the page offers

describe("what the page offers", () => {
  it("hides the folder picker where the browser has none, and shows it where it has one", () => {
    mount({ canPickDirectory: false });
    expect(host?.querySelector('[data-source="picker"]')).toBeNull();
    expect(host?.querySelector('[data-key="sink-pick"]')).toBeNull();
    app?.destroy();
    host?.remove();
    mount({ canPickDirectory: true });
    expect(host?.querySelectorAll('[data-source="picker"]')).toHaveLength(4);
    expect(host?.querySelector('[data-key="sink-pick"]')).not.toBeNull();
  });

  it("links its server help to the prerequisites in the README that the build copies beside it", () => {
    mount();
    expect(q('[data-key="server-prerequisites"]').getAttribute("href")).toBe("README.md#server-prerequisites");
  });

  it("warns on an http: page and on no other (HOST-281)", () => {
    mount({ location: { protocol: "http:", hostname: "tools.example.com" } });
    expect(q(".banner").textContent).toContain("served over http:");
    expect(q(".banner").textContent).toContain("Serve it over https:");
    app?.destroy();
    host?.remove();
    mount({ location: { protocol: "http:", hostname: "localhost" } });
    expect(q(".banner").textContent).toContain("localhost");
    app?.destroy();
    host?.remove();
    mount({ location: { protocol: "https:", hostname: "tools.example.com" } });
    expect(host?.querySelector(".banner")).toBeNull();
  });

  it("has the four operations as tabs, and a password field that is a password field", async () => {
    mount();
    const tabs = [...(host as HTMLElement).querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabs).toEqual(["Export", "Import", "Language pack", "DB patches"]);
    expect(key("password").type).toBe("password");
    await openTab("db-patches");
    expect(q('[data-panel="db-patches"]').hidden).toBe(false);
    expect(q('[data-panel="export"]').hidden).toBe(true);
    expect(q('[data-mode="db-patches"]').getAttribute("aria-selected")).toBe("true");
  });

  it("shows the CLI's flags as the help of its controls", () => {
    mount();
    expect(q('[data-panel="import"]').textContent).toContain("--merge");
    expect(q('[data-panel="export"]').textContent).toContain("--unknown-references");
    expect(q('[data-panel="language-pack"]').textContent).toContain("--lp-package");
    expect(q('[data-panel="db-patches"]').textContent).toContain("--patches-folder");
  });
});

// ------------------------------------------------------------------------------------------------------------ the built folder

describe("the built folder, as a static server serves it", () => {
  it("runs a recorded export through the default Worker, under the served security headers", async () => {
    const result = await commands.runBuiltPage(EXPORT_CASE);
    expect(result.errors).toEqual([]);
    expect(result.failure).toBe("");
    expect(result.summary).toContain("success");
    expect(result.download).toMatch(/^export-\d{8}-\d{6}\.zip$/);
    expect(result.report.mismatches).toEqual([]);
    expect(result.report.consumed).toBe(result.report.total);
  });
});
