import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeHostFs } from "./fs-conformance.js";
import { nodeFs } from "./node-fs.js";

/**
 * `nodeFs` against the `HostFs` contract (HOST-214), in a folder of its own under the OS temporary folder that is removed after each
 * case. This is what makes the suite a description of the real disk: the in-memory file system is held to a suite that
 * `node:fs` already passes. On a host whose disk cannot do what a case needs (case-sensitive names, links, a path of 4 095
 * characters) the suite skips that case, by trying it first.
 *
 * @spec HOST-210 HOST-214
 */
describeHostFs("nodeFs", () => {
  const root = mkdtempSync(join(tmpdir(), "libsjs-hostfs-"));
  return {
    fs: nodeFs,
    root,
    // a link needs a privilege on Windows, and the engine's code handles links only for the listing of a package on a POSIX disk
    ...(process.platform === "win32" ? {} : { symlink: (target: string, path: string): void => symlinkSync(target, path) }),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
});
