import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import type { AppendHandle, HostDirent, HostFs, HostStat } from "./types.js";

/**
 * The Node implementation of {@link HostFs}: each method is the `node:fs` call it is named after, so nothing a Node caller can
 * observe changes. A failure is Node's own error, rethrown as it is: its `code` is the real errno and its `path` the path Node
 * names (HOST-210, HOST-201). This module is Node only; the core reaches it through `default-host.ts` alone (HOST-203).
 *
 * @spec HOST-200 HOST-201 HOST-210
 */
export const nodeFs: HostFs = {
  stat(path: string): HostStat {
    const stats = statSync(path);
    return { isFile: stats.isFile(), isDirectory: stats.isDirectory() };
  },
  readdir(path: string): HostDirent[] {
    return readdirSync(path, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
  },
  readFile: (path: string): Uint8Array => readFileSync(path),
  writeFile: (path: string, data: Uint8Array): void => writeFileSync(path, data),
  mkdir: (path: string): void => {
    mkdirSync(path);
  },
  rm: (path: string, options: { recursive: boolean }): void => rmSync(path, { recursive: options.recursive, force: false }),
  exists: (path: string): boolean => existsSync(path),
  openAppend(path: string): AppendHandle {
    const descriptor = openSync(path, "a");
    return {
      write(bytes: Uint8Array): void {
        // `writeSync` may write less than it is given; the contract is all of it or an error
        let written = 0;
        while (written < bytes.length) written += writeSync(descriptor, bytes, written, bytes.length - written);
      },
      close: (): void => closeSync(descriptor),
    };
  },
};
