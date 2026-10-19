import { describe, expect, it } from "vitest";
import { EXIT, run } from "./cli-run.js";
import { testIo } from "./cli/test-io.js";

describe("cli", () => {
  it("prints help with exit 0", async () => {
    const t = testIo();
    expect(await run(["--help"], t.io)).toBe(EXIT.ok);
    expect(t.stdout()).toContain("Usage: aras-pkg");
    expect(t.stdout()).toContain("import-language-pack");
  });

  it("treats no command as a usage error", async () => {
    const t = testIo();
    expect(await run([], t.io)).toBe(EXIT.usage);
    expect(t.stdout()).toContain("Usage: aras-pkg");
  });

  it("rejects an unknown command with exit 64", async () => {
    const t = testIo();
    expect(await run(["frobnicate"], t.io)).toBe(EXIT.usage);
    expect(t.stderr()).toContain("unknown command 'frobnicate'");
  });

  it("does not take a name of Object.prototype for a command", async () => {
    const t = testIo();
    expect(await run(["constructor"], t.io)).toBe(EXIT.usage);
    expect(t.stderr()).toContain("unknown command 'constructor'");
  });

  it("prints the package version", async () => {
    const t = testIo();
    expect(await run(["--version"], t.io)).toBe(EXIT.ok);
    expect(t.stdout()).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it.for([["import"], ["plan"], ["import-language-pack"]])("shows the help of %s with exit 0", async ([command]) => {
    const t = testIo();
    expect(await run([command as string, "--help"], t.io)).toBe(EXIT.ok);
    expect(t.stdout()).toContain(`Usage: aras-pkg ${command}`);
  });
});
