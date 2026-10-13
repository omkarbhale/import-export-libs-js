import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT, run } from "./cli-run.js";

describe("cli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints help with exit 0", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(run(["--help"])).toBe(EXIT.ok);
    expect(String(out.mock.calls[0]?.[0])).toContain("Usage: aras-pkg");
  });

  it("treats no command as a usage error", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(run([])).toBe(EXIT.usage);
  });

  it("rejects an unknown command with exit 64", () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(run(["frobnicate"])).toBe(EXIT.usage);
    expect(String(err.mock.calls[0]?.[0])).toContain("unknown command 'frobnicate'");
  });

  it("prints the package version", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(run(["--version"])).toBe(EXIT.ok);
    expect(String(out.mock.calls[0]?.[0])).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
