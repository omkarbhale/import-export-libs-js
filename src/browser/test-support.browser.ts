import { commands } from "vitest/browser";
import { expect } from "vitest";
import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { MemoryVfs, type MountFiles } from "../host/memory-fs.js";

/**
 * What a test in a browser page needs to read the recorded fixtures (HOST-263). The page cannot read the disk; the Vitest server
 * does it through the commands of `tools/browser-vitest.ts`, restricted to `fixtures/`, and this module decodes what they return.
 * Paths are repository-relative with a `fixtures/` prefix, the same way the commands take them, e.g.
 * `fixtures/14.0.7/import/s0-mini-defaults`.
 *
 * It also serves the browser twins of the unit tests that read fixtures (`engine-compat.browser.test.ts`, HOST-264).
 *
 * @spec HOST-263 HOST-264 HOST-266
 */
declare module "vitest/browser" {
  interface BrowserCommands {
    readFixtureTree(dir: string): Promise<Array<{ path: string; bytesBase64: string }>>;
    readFixtureBytes(path: string): Promise<string>;
    readFixtureText(path: string): Promise<string>;
  }
}

/** A file of a fixture folder: its path relative to the folder (POSIX form) and its exact bytes. */
export interface FixtureFile {
  path: string;
  bytes: Uint8Array;
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Every file under a fixture folder, in code-unit order of the paths. It is the browser's twin of the Node side's
 * `loadTreeIntoVfs(dir)` (ticket 12) in the one respect the page can have today, the files themselves, with the same folder
 * argument; the `MemoryVfs` that holds them is a call of the code under test, not of this module.
 */
export async function loadFixtureTree(dir: string): Promise<FixtureFile[]> {
  const files = await commands.readFixtureTree(dir);
  return files.map((file) => ({ path: file.path, bytes: fromBase64(file.bytesBase64) }));
}

/** One fixture file, as its exact bytes. */
export async function readFixtureBytes(path: string): Promise<Uint8Array> {
  return fromBase64(await commands.readFixtureBytes(path));
}

/** One fixture file, as UTF-8 text. */
export function readFixtureText(path: string): Promise<string> {
  return commands.readFixtureText(path);
}

/** Where in the tree of a case the folders it was recorded with are: the files of `<dir>/<folder>/…`, by their path below the folder. */
export function filesBelow(files: readonly FixtureFile[], folder: string): FixtureFile[] {
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  return files.filter((file) => file.path.startsWith(prefix)).map((file) => ({ path: file.path.slice(prefix.length), bytes: file.bytes }));
}

/** The text of one file of a case that was read whole, or undefined when the case has no such file. */
export function textOf(files: readonly FixtureFile[], path: string): string | undefined {
  const file = files.find((candidate) => candidate.path === path);
  return file === undefined ? undefined : new TextDecoder("utf-8", { ignoreBOM: true }).decode(file.bytes);
}

/**
 * Copies files into the virtual tree below `at` (an absolute POSIX path), each with its bytes. The browser's twin of `loadTreeIntoVfs`
 * of `test-support.ts`, which reads a folder of the disk; here the files were read through the fixture commands. `at` itself is made
 * even when there is no file.
 */
export function mountFixtureFiles(files: readonly FixtureFile[], vfs: MemoryVfs, at: string): void {
  const base = at.endsWith("/") ? at : `${at}/`;
  const mount: MountFiles = { [base]: "" };
  for (const file of files) mount[`${base}${file.path}`] = file.bytes;
  vfs.mount(mount);
}

/** The sorted list of files in the format of {@link MemoryVfs.toTree}: every file, and every folder that has a file below it with a trailing `/`. */
function treeOf(files: readonly FixtureFile[]): string[] {
  const listed = new Set<string>();
  for (const file of files) {
    listed.add(file.path);
    const parts = file.path.split("/");
    for (let end = 1; end < parts.length; end += 1) listed.add(`${parts.slice(0, end).join("/")}/`);
  }
  return [...listed].sort();
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, index) => byte === b[index]);

/**
 * Asserts that the tree below `root` of the virtual file system is the recorded folder `files`: the same list of files and folders and,
 * for each file, the same bytes. A difference names the file. The browser's twin of `assertTreesEqual` of `test-support.ts`.
 */
export function assertTreeMatchesFiles(vfs: MemoryVfs, root: string, files: readonly FixtureFile[], label: string): void {
  expect(vfs.toTree(root), `${label}: the folders and files`).toEqual(treeOf(files));
  const made = vfs.snapshot(root);
  for (const file of files) {
    const actual = made.get(file.path);
    expect(actual !== undefined && sameBytes(actual, file.bytes), `${label}: ${file.path} byte for byte`).toBe(true);
  }
}

/** The calls of a recorded `transcript.jsonl`, each with its `responseBlob` put back as `response` by `readBlob`. The twin of `readTranscript` of `oracle/src/transcript.ts`, which reads the disk. */
export function parseTranscript(text: string, readBlob: (sha256: string) => string): TranscriptCall[] {
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const call = JSON.parse(line) as TranscriptCall;
      if (call.responseBlob === undefined) return call;
      const { responseBlob, ...rest } = call;
      return { ...rest, response: readBlob(responseBlob) };
    });
}
