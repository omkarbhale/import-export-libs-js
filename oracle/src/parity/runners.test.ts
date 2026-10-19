import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inputDirLikeOracle } from "./runners.js";

vi.mock("../stage.js", () => ({ oracleWindowsRoot: () => "C:\\Users\\u\\AppData\\Local\\libsjs\\oracle" }));

describe("inputDirLikeOracle", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns the root it made, so removing it leaves the base folder intact even when no padding fits", () => {
    const outer = mkdtempSync(join(tmpdir(), "libsjs-runners-"));
    made.push(outer);
    const base = join(outer, ...Array.from({ length: 4 }, () => "b".repeat(100)));
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "sibling.txt"), "keep");

    const { input, root } = inputDirLikeOracle("12.0", "import", base);
    expect(dirname(root)).toBe(base);
    expect(input).toBe(join(root, "input"));
    expect(existsSync(input)).toBe(true);

    rmSync(root, { recursive: true, force: true });
    expect(readdirSync(base)).toEqual(["sibling.txt"]);
  });

  it("pads the input folder to the oracle's input path length below the root", () => {
    const base = mkdtempSync(join(tmpdir(), "libsjs-runners-"));
    made.push(base);
    const { input, root } = inputDirLikeOracle("12.0", "import", base);
    expect(input.startsWith(root + "/")).toBe(true);
    expect(dirname(dirname(input))).toBe(root);
  });
});
