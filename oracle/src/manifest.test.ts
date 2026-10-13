import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINES, ENGINE_ASSEMBLY_VERSIONS } from "../../src/engines.js";
import { NATIVE_DIR, readManifest, toolsetDigest, verifyToolset } from "./manifest.js";
import { readModuleMvid } from "./pe.js";

const manifest = readManifest();

describe("vendored toolsets", () => {
  it.each(ENGINES)("%s matches manifest.json byte for byte", (engine) => {
    expect(verifyToolset(join(NATIVE_DIR, engine), manifest.engines[engine])).toEqual([]);
  });

  it.each(ENGINES)("%s pins the engine's Libs build", (engine) => {
    expect(manifest.engines[engine].libs.version).toBe(ENGINE_ASSEMBLY_VERSIONS[engine]);
  });

  it("names staging folders by content", () => {
    const entry = manifest.engines["14.0.7"];
    expect(toolsetDigest(entry)).toMatch(/^[0-9a-f]{12}$/);
    const changed = { ...entry, files: entry.files.map((f, i) => (i === 0 ? { ...f, sha256: "0".repeat(64) } : f)) };
    expect(toolsetDigest(changed)).not.toBe(toolsetDigest(entry));
  });

  it("reports a tampered or unexpected file", () => {
    const entry = manifest.engines["12.0"];
    const tampered = {
      ...entry,
      libs: { ...entry.libs, mvid: "00000000-0000-0000-0000-000000000000" },
      files: entry.files.filter((f) => f.path !== "import.exe"),
    };
    const problems = verifyToolset(join(NATIVE_DIR, "12.0"), tampered);
    expect(problems).toContain("import.exe: not in the manifest");
    expect(problems.some((p) => p.startsWith("Libs.dll: MVID"))).toBe(true);
  });
});

describe("readModuleMvid", () => {
  it("reads the MVID REA reports for aras-harness native/Libs.dll", () => {
    // evidence/rea-facts.md: 14.0.7 Libs MVID 81698344-c4fa-4ec3-a48f-0961032d17f1.
    expect(readModuleMvid(readFileSync(join(NATIVE_DIR, "14.0.7", "Libs.dll")))).toBe(
      "81698344-c4fa-4ec3-a48f-0961032d17f1",
    );
  });

  it("returns null for a non-PE file and for a native PE", () => {
    expect(readModuleMvid(Buffer.from("not a PE file"))).toBeNull();
    expect(readModuleMvid(readFileSync(join(NATIVE_DIR, "14.35", "runtimes/win-x64/native/WebView2Loader.dll")))).toBeNull();
  });
});
