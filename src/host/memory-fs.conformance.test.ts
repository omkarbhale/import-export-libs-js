import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeFs } from "./node-fs.js";
import { MemoryVfs } from "./memory-fs.js";
import { conformanceCases, describeHostFs, planCases, probeCapabilities, type HostFsFactory } from "./fs-conformance.js";

/**
 * `MemoryVfs` against the `HostFs` contract (HOST-214, HOST-215): the suite that `nodeFs` passes on a disk, run on the in-memory
 * tree. A tree that declares no links (HOST-215) is the only difference between the two runs.
 *
 * @spec HOST-214 HOST-215
 */
const makeMemory: HostFsFactory = () => {
  const fs = new MemoryVfs();
  fs.mkdir("/work");
  return { fs, root: "/work" };
};

describeHostFs("MemoryVfs", makeMemory);

const makeDisk: HostFsFactory = () => {
  const root = mkdtempSync(join(tmpdir(), "libsjs-memfs-probe-"));
  return {
    fs: nodeFs,
    root,
    ...(process.platform === "win32" ? {} : { symlink: (target: string, path: string): void => symlinkSync(target, path) }),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
};

describe("MemoryVfs and nodeFs run the same cases of the suite (HOST-214, HOST-215)", () => {
  const memory = planCases(probeCapabilities(makeMemory));
  const diskCapabilities = probeCapabilities(makeDisk);
  const disk = planCases(diskCapabilities);
  const linkCases = conformanceCases()
    .filter((c) => c.optional === "symlink")
    .map((c) => `${c.group}: ${c.name}`);

  it("the tree declares links as its only missing capability", () => {
    expect(probeCapabilities(makeMemory)).toEqual({
      symlink: false,
      enotdir: true,
      caseSensitive: true,
      normalization: true,
      trailing: true,
      longName: true,
      longPath: true,
    });
    expect(linkCases.length).toBeGreaterThan(0);
    expect(memory.skipped).toEqual(linkCases);
  });

  it("the cases it runs are the disk's, minus the cases that need a link", () => {
    const diskWithoutLinks = disk.ran.filter((name) => !linkCases.includes(name));
    // a laptop's disk may be unable to do more than links (case-insensitive, no long path): there the tree runs more, never less
    for (const name of diskWithoutLinks) expect(memory.ran).toContain(name);
    const { symlink: _links, ...others } = diskCapabilities;
    if (Object.values(others).every(Boolean)) expect(memory.ran).toEqual(diskWithoutLinks);
    expect(memory.ran.length + memory.skipped.length).toBe(conformanceCases().length);
  });
});
