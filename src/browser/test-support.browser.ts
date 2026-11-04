import { commands } from "vitest/browser";

/**
 * What a test in a browser page needs to read the recorded fixtures (HOST-263). The page cannot read the disk; the Vitest server
 * does it through the commands of `tools/browser-vitest.ts`, restricted to `fixtures/`, and this module decodes what they return.
 * Paths are repository-relative with a `fixtures/` prefix, the same way the commands take them, e.g.
 * `fixtures/14.0.7/import/s0-mini-defaults`.
 *
 * @spec HOST-263
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
