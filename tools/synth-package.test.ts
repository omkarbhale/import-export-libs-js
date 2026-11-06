import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { vfsFromZip } from "../src/browser/zip.js";
import { SYNTH_PACKAGE, synthManifestBytes } from "../src/browser/synth-package.js";
import { SYNTH_SIZES_MB, synthZipName, writeSynthPackage } from "./synth-package.js";

/**
 * The writer of the synthetic packages (HOST-277): a zip that is the same bytes on every run, that the zip adapter mounts as the package it
 * describes, and that is not made again once it is there.
 *
 * @spec HOST-277
 */
const dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "libsjs-synth-"));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("HOST-277: a package is written as a zip", () => {
  it("names the sizes of the budget, up to the limit of 50 MB", () => {
    expect(SYNTH_SIZES_MB).toEqual([10, 50]);
    expect(synthZipName(50, 1)).toBe("synth-50mb-s1-v1.zip");
  });

  it("is the same bytes on every run, and holds the items it counts", () => {
    const a = temp();
    const b = temp();
    const first = writeSynthPackage(1, 3, a);
    const second = writeSynthPackage(1, 3, b);
    expect(first).toEqual(second);
    const zipA = readFileSync(path.join(a, first.zip));
    expect(zipA.equals(readFileSync(path.join(b, second.zip)))).toBe(true);
    expect(first.bytes).toBeGreaterThanOrEqual(1_000_000);
    expect(first.zipBytes).toBe(zipA.byteLength);
    expect(JSON.parse(readFileSync(path.join(a, first.zip.replace(/\.zip$/, ".json")), "utf8"))).toEqual(first);

    const vfs = vfsFromZip(new Uint8Array(zipA), { root: "auto" });
    expect(Buffer.from(vfs.readFile("/imports.mf")).toString("utf8")).toBe(Buffer.from(synthManifestBytes()).toString("utf8"));
    const kinds = vfs.readdir(`/${SYNTH_PACKAGE}/Import`).map((entry) => entry.name);
    let files = 0;
    for (const kind of kinds) files += vfs.readdir(`/${SYNTH_PACKAGE}/Import/${kind}`).length;
    expect(files).toBe(first.count);
  });

  it("is not made again when it is there, and another seed is another package", () => {
    const dir = temp();
    const first = writeSynthPackage(0.2, 1, dir);
    const again = writeSynthPackage(0.2, 1, dir);
    expect(again).toEqual(first);
    const other = writeSynthPackage(0.2, 2, dir);
    expect(other.zip).not.toBe(first.zip);
    expect(readFileSync(path.join(dir, other.zip)).equals(readFileSync(path.join(dir, first.zip)))).toBe(false);
  });

  it("refuses a size that is not a positive number", () => {
    expect(() => writeSynthPackage(0, 1, temp())).toThrow(/positive number/);
    expect(() => writeSynthPackage(Number.NaN, 1, temp())).toThrow(/positive number/);
  });
});
