/**
 * What the browser test project of `vitest.config.ts` is made of on the Node side (HOST-263): the module replacement that gives a
 * test the graph of the shipped bundle, and the commands through which a test in a page reads the recorded fixtures. Test-only
 * tooling: nothing under `src/` imports it.
 */
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vitest/config";
import type { BrowserCommand } from "vitest/node";
import { build } from "esbuild";
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
