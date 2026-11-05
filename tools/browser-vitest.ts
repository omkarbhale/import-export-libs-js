/**
 * What the browser test projects of `vitest.config.ts` are made of on the Node side (HOST-263): the module replacement that gives a
 * test the graph of the shipped bundle, and the commands through which a test in a page reads the recorded fixtures and chooses or drops files (HOST-267). Test-only
 * tooling: nothing under `src/` imports it.
 */
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Plugin } from "vitest/config";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";
import { build } from "esbuild";
import { MemoryVfs } from "../src/host/memory-fs.js";
import { vfsToZip } from "../src/browser/zip.js";
import { DEFAULT_HOST, DEFAULT_HOST_BROWSER, WORKER_ENTRY, browserBundleOptions, licenseBanner, repoRoot } from "./browser-bundle.js";

/** A file of a fixture folder, as it crosses from the Vitest server to the page. */
export interface FixtureFileDto {
  /** Relative to the folder that was read, in POSIX form. */
  path: string;
  bytesBase64: string;
}

/**
 * The browser project's counterpart of `replaceDefaultHost` (`tools/browser-bundle.ts`): a resolve hook that maps
 * `src/host/default-host.ts` to `default-host.browser.ts`, so that nothing a test loads reaches the Node host (HOST-200, HOST-263).
 * The importer's directory decides, so it is that one module and no other file of the same name that is replaced.
 */
export function replaceDefaultHostForVite(root: string = repoRoot): Plugin {
  const from = path.join(root, DEFAULT_HOST);
  const to = path.join(root, DEFAULT_HOST_BROWSER);
  return {
    name: "libsjs-replace-default-host",
    enforce: "pre",
    resolveId(source: string, importer: string | undefined) {
      if (importer === undefined || !/(^|\/)default-host\.js$/.test(source)) return null;
      const resolved = path.resolve(path.dirname(importer.split("?")[0] ?? importer), source.replace(/\.js$/, ".ts"));
      return resolved === from ? to : null;
    },
  };
}

/** Why a fixture path was refused. The text names the rule, so that a failing test says what to fix. */
export class FixturePathError extends Error {
  constructor(requested: unknown, reason: string) {
    super(`HOST-263: the fixture path ${JSON.stringify(requested)} is refused: ${reason}`);
    this.name = "FixturePathError";
  }
}

/**
 * The absolute path of a fixture path (HOST-263): `fixtures/` and the rest in POSIX form, with no `.`, `..` or empty segment, no
 * backslash and no NUL, and, when it exists, a real path (links followed) that is under `fixtures/`.
 */
export function resolveFixturePath(requested: unknown, root: string = repoRoot): string {
  if (typeof requested !== "string") throw new FixturePathError(requested, "it is not a string");
  if (requested.includes("\0")) throw new FixturePathError(requested, "it holds a NUL");
  if (requested.includes("\\")) throw new FixturePathError(requested, "it holds a backslash");
  const segments = requested.split("/");
  if (segments[0] !== "fixtures" || segments.length < 2) throw new FixturePathError(requested, "it does not start with fixtures/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new FixturePathError(requested, "it has an empty, `.` or `..` segment");
  }
  const full = path.join(root, ...segments);
  const base = realpathSync(path.join(root, "fixtures"));
  let real: string;
  try {
    real = realpathSync(full);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new FixturePathError(requested, "it does not exist");
    throw error;
  }
  if (real !== base && !real.startsWith(base + path.sep)) throw new FixturePathError(requested, "it resolves outside fixtures/");
  return full;
}

/** `readFixtureTree`: every file under a fixture folder, in code-unit order of their relative paths. Links are not followed. */
export function readFixtureTree(dir: unknown, root: string = repoRoot): FixtureFileDto[] {
  const top = resolveFixturePath(dir, root);
  if (!lstatSync(top).isDirectory()) throw new FixturePathError(dir, "it is not a folder");
  const files: FixtureFileDto[] = [];
  const walk = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(folder, entry.name), relative);
      else if (entry.isFile()) files.push({ path: relative, bytesBase64: readFileSync(path.join(folder, entry.name)).toString("base64") });
      else throw new FixturePathError(dir, `${relative} is a link or a special file`);
    }
  };
  walk(top, "");
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** `readFixtureBytes`: one fixture file, as base64. */
export function readFixtureBytes(file: unknown, root: string = repoRoot): string {
  const full = resolveFixturePath(file, root);
  if (!lstatSync(full).isFile()) throw new FixturePathError(file, "it is not a file");
  return readFileSync(full).toString("base64");
}

/** `readFixtureText`: one fixture file, as UTF-8 text (a byte-order mark is kept as U+FEFF). */
export function readFixtureText(file: unknown, root: string = repoRoot): string {
  const full = resolveFixturePath(file, root);
  if (!lstatSync(full).isFile()) throw new FixturePathError(file, "it is not a file");
  return readFileSync(full, "utf8");
}

/** The commands the browser project registers (`test.browser.commands`); the page calls them through `vitest/browser`. */
export const fixtureCommands: Record<string, BrowserCommand<[string]>> = {
  readFixtureTree: (_context, dir) => readFixtureTree(dir),
  readFixtureBytes: (_context, file) => readFixtureBytes(file),
  readFixtureText: (_context, file) => readFixtureText(file),
};

/**
 * The text of the Worker's bundle, built from `src/browser/worker.ts` with the options the shipped `dist/browser-worker.js` is built with
 * (HOST-276). A test in a page makes a Blob URL of it and starts a module Worker from that, so that the browsers run the bundle that
 * ships and not the source: the injected `Buffer`, the replaced host module and the inlined dependencies are all under test.
 */
export async function buildWorkerBundle(root: string = repoRoot): Promise<string> {
  const result = await build({ ...browserBundleOptions(root, WORKER_ENTRY), write: false, outfile: "browser-worker.js", banner: { js: licenseBanner(root) } });
  const [file] = result.outputFiles;
  if (file === undefined) throw new Error("the Worker bundle produced no output");
  return file.text;
}

/** The command through which a page asks for the Worker's bundle (`workerBundle`); it reads no file of the repository's data. */
export const workerCommands: Record<string, BrowserCommand<[]>> = {
  workerBundle: () => buildWorkerBundle(),
};

// ----------------------------------------------------------------------------------------------------------- file inputs

/** The absolute paths of what a page may put into a file input (HOST-267): a fixture folder alone, or fixture files. Each path is checked like a fixture path. */
export function resolveInputPaths(requested: unknown, root: string = repoRoot): string[] {
  const list = Array.isArray(requested) ? requested : [requested];
  if (list.length === 0) throw new FixturePathError(requested, "no path was given");
  const paths = list.map((entry) => resolveFixturePath(entry, root));
  const folders = paths.filter((full) => lstatSync(full).isDirectory());
  if (folders.length > 0 && paths.length > 1) throw new FixturePathError(requested, "a folder is chosen alone: a folder input takes one folder");
  return paths;
}

/** The files of a folder of the given size that {@link makeManyFilesFolder} writes: `n` is how many, the names sort by number. */
export function manyFilesNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `item-${String(index).padStart(4, "0")}.xml`);
}

/** Makes `<tmp>/<unique>/Many/item-0000.xml …`, a package-like folder of `count` small files (more than a reader's batch) and an empty folder, and returns the temporary root and the folder. */
export function makeManyFilesFolder(count: unknown): { root: string; folder: string } {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 5000) throw new FixturePathError(count, "the count is not an integer from 1 to 5000");
  const root = mkdtempSync(path.join(tmpdir(), "libsjs-many-files-"));
  const folder = path.join(root, "Many");
  mkdirSync(folder);
  mkdirSync(path.join(folder, "empty"));
  for (const name of manyFilesNames(count)) writeFileSync(path.join(folder, name), `<Item id="${name}"/>`);
  return { root, folder };
}

/** The folders {@link makeManyFilesFolder} made for this process; removed when it exits. */
const generatedRoots = new Set<string>();
process.on("exit", () => {
  for (const root of generatedRoots) rmSync(root, { recursive: true, force: true });
});

/**
 * The zip that the Node build of the library writes of a fixture folder (`vfsToZip` of `src/browser/zip.ts`, HOST-251), as base64: the
 * page writes the same zip in its own browser and compares the bytes, which proves the zip is the same in the three browsers and in Node.
 */
export function zipOfFixtureFolder(dir: unknown, level: unknown, root: string = repoRoot): string {
  if (level !== 0 && level !== 6) throw new FixturePathError(level, "the level is not 0 or 6");
  const vfs = new MemoryVfs();
  const mount: Record<string, Uint8Array> = { "/": new Uint8Array(0) };
  for (const file of readFixtureTree(dir, root)) mount[`/${file.path}`] = new Uint8Array(Buffer.from(file.bytesBase64, "base64"));
  vfs.mount(mount);
  return Buffer.from(vfsToZip(vfs, "/", { level })).toString("base64");
}

/** How long the choice of files may take: WebKit's `setInputFiles` of a folder now and then does not return, and the page makes another attempt on an input of its own (HOST-267). */
const CHOOSE_TIMEOUT_MS = 8_000;

/** Chooses `paths` in the input that `selector` names. */
async function chooseFiles(context: BrowserCommandContext, selector: string, paths: string[]): Promise<void> {
  if (typeof selector !== "string" || selector === "") throw new FixturePathError(selector, "the selector is not a string");
  await context.iframe.locator(selector).setInputFiles(paths, { timeout: CHOOSE_TIMEOUT_MS });
}

/**
 * Drops files of the disk on an element of the page as the operating system does: Chromium's `Input.dispatchDragEvent` carries a list
 * of paths, and the page gets a real `DataTransfer` whose items have entries, a folder's as a directory entry with a reader (HOST-255).
 * Only Chromium offers that; a page cannot make such a `DataTransfer` itself, and Firefox and WebKit have no protocol for it.
 */
async function dropFilesOn(context: BrowserCommandContext, selector: string, paths: string[]): Promise<void> {
  if (typeof selector !== "string" || selector === "") throw new FixturePathError(selector, "the selector is not a string");
  if ((context.provider as { browserName?: string }).browserName !== "chromium") throw new Error("a drop of files from the disk can be made in Chromium only");
  const box = await context.iframe.locator(selector).boundingBox();
  if (box === null) throw new Error(`${selector} is not on the page`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await context.context.newCDPSession(context.page);
  try {
    const data = { items: [], files: paths, dragOperationsMask: 1 };
    for (const type of ["dragEnter", "dragOver", "drop"] as const) await cdp.send("Input.dispatchDragEvent", { type, x, y, data });
  } finally {
    await cdp.detach();
  }
}

/**
 * The commands that choose files in an `<input type="file">` of the page, as a user does in the browser's dialog: Playwright's
 * `setInputFiles`, which is the only way a page gets a `File` of the disk with a `webkitRelativePath` (HOST-267). The page names the
 * input by a selector; what is chosen is a fixture folder, or fixture files, or a generated folder of many files, and nothing else.
 */
export const adapterCommands: Record<string, BrowserCommand<any[]>> = {
  chooseFixtureInput: async (context, selector: string, requested: string | string[]) => {
    await chooseFiles(context, selector, resolveInputPaths(requested));
  },
  zipFixtureFolder: (_context, dir: string, level: number) => zipOfFixtureFolder(dir, level),
  dropFixtureOn: async (context, selector: string, requested: string | string[]) => {
    await dropFilesOn(context, selector, resolveInputPaths(requested));
  },
  dropManyFilesFolderOn: async (context, selector: string, count: number) => {
    const { root, folder } = makeManyFilesFolder(count);
    generatedRoots.add(root);
    await dropFilesOn(context, selector, [folder]);
  },
  chooseManyFilesFolder: async (context, selector: string, count: number) => {
    const { root, folder } = makeManyFilesFolder(count);
    // the page reads the files when it likes, so the folder stays until the Vitest process ends
    generatedRoots.add(root);
    await chooseFiles(context, selector, [folder]);
  },
};
