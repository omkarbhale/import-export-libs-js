import { MemoryVfs } from "../host/memory-fs.js";
import { VFS_WORK, fakeHostEnv } from "./test-support.js";

/**
 * What the replays on the in-memory file system share (HOST-218; the `vfs-replay.*.test.ts` files): the virtual host a run gets, the
 * text of its log, and the count of the cases a file ran and left out.
 *
 * @spec HOST-218
 */

/** A virtual file system with the working folder of a run in it, and the host that makes it `/work` on Linux. */
export function virtualHost(): { vfs: MemoryVfs; host: ReturnType<typeof fakeHostEnv> } {
  const vfs = new MemoryVfs();
  vfs.mount({ [`${VFS_WORK}/`]: "" });
  return { vfs, host: fakeHostEnv() };
}

/** The text of a file of the virtual tree, read as UTF-8. */
export const logText = (vfs: MemoryVfs, path: string): string => Buffer.from(vfs.readFile(path)).toString("utf8");

/** What each family of replays of a file ran and left out, for the counts at the end of the file. */
export class CaseCount {
  private readonly families = new Map<string, { ran: number; skipped: number }>();

  add(family: string, what: "ran" | "skipped"): void {
    const entry = this.families.get(family) ?? { ran: 0, skipped: 0 };
    entry[what] += 1;
    this.families.set(family, entry);
  }

  get(family: string): { ran: number; skipped: number } {
    return this.families.get(family) ?? { ran: 0, skipped: 0 };
  }

  toString(): string {
    return JSON.stringify(Object.fromEntries([...this.families].sort(([a], [b]) => a.localeCompare(b))));
  }
}
