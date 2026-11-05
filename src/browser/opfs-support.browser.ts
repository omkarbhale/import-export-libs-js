import type { FsaDirectoryHandle } from "./fsa.js";

/**
 * What the tests against the real origin private file system share (HOST-252, HOST-253, HOST-268): the page's own root handle, the
 * rejection of `getDirectory()` that WebKit gives outside a persistent profile, folders that are removed when the test file is done, and a
 * listing of what a handle holds.
 *
 * @spec HOST-252 HOST-253 HOST-268
 */

export type Root = FsaDirectoryHandle;

/** The origin private file system: the page's own handle, seen through the adapter's structural type (`fsa-dom.check.ts` holds that it is one). */
export const getRoot = async (): Promise<Root> => (await navigator.storage.getDirectory()) as unknown as Root;

/** The rejection of `getDirectory()`, or null when this page has an origin private file system. */
export async function opfsProblem(): Promise<string | null> {
  try {
    await getRoot();
    return null;
  } catch (error) {
    return `${(error as Error).name}: ${(error as Error).message}`;
  }
}

/** True in the project that runs WebKit in a persistent profile (`vitest.config.ts`). */
export const PERSISTENT_PROFILE = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.LIBSJS_PERSISTENT_PROFILE === "1";

/** The folders of the origin private file system that tests make start with this, so that a crashed run's are found and removed. */
export const PREFIX = "libsjs-test-";
let serial = 0;
export const made: string[] = [];

export async function sweep(): Promise<void> {
  const root = await getRoot();
  const names: string[] = [];
  for await (const entry of root.values()) if (entry.name.startsWith(PREFIX)) names.push(entry.name);
  for (const name of names) await root.removeEntry(name, { recursive: true });
}

/** A new empty folder of the origin private file system. */
export async function folder(label: string): Promise<Root> {
  const root = await getRoot();
  serial += 1;
  const name = `${PREFIX}${label}-${Date.now().toString(36)}-${serial}`;
  made.push(name);
  return root.getDirectoryHandle(name, { create: true });
}

/** Every file below a folder, by path with `/`, and every folder (with a trailing `/`), as the origin private file system holds them now. */
export async function listing(handle: Root, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "directory") {
      out.push(`${prefix}${entry.name}/`, ...(await listing(entry as Root, `${prefix}${entry.name}/`)));
    } else out.push(`${prefix}${entry.name}`);
  }
  return out.sort();
}
