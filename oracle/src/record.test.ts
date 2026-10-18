import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exportItem, hostParams, priorCreated } from "./cli.js";
import {
  assertDevUrl,
  assertScratchPackages,
  importedPackageNames,
  launcherScript,
  manifestPackageNames,
  psLiteral,
} from "./record.js";

describe("launcher", () => {
  it("quotes values as PowerShell literals", () => {
    expect(psLiteral("it's")).toBe("'it''s'");
    expect(psLiteral(true)).toBe("$true");
    expect(psLiteral(600000)).toBe("600000");
    expect(psLiteral(["a", "b'c"])).toBe("@('a', 'b''c')");
  });

  it("doubles the typographic quotes PowerShell also ends a literal on", () => {
    expect(psLiteral("\u2018a\u2019b\u201ac\u201b")).toBe("'\u2018\u2018a\u2019\u2019b\u201a\u201ac\u201b\u201b'");
    expect(psLiteral("Größe đ")).toBe("'Größe đ'");
  });

  it("splats every parameter into the engine host, in a script with a UTF-8 BOM", () => {
    const script = launcherScript("C:\\h\\engine-14.0.7.ps1", { Command: "export", Merge: true });
    expect(script).toBe(
      "\ufeff$ErrorActionPreference = 'Stop'\r\n$p = @{\r\n    Command = 'export'\r\n    Merge = $true\r\n}\r\n& 'C:\\h\\engine-14.0.7.ps1' @p\r\nexit $LASTEXITCODE\r\n",
    );
    expect([...Buffer.from(script, "utf8").subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe("host scripts", () => {
  // The Windows side cannot run here; this checks that every engine's host exposes the same step options.
  const scripts = ["12.0", "14.0.7", "14.35"].map((v) => [v, readFileSync(join(fileURLToPath(new URL("../host", import.meta.url)), `engine-${v}.ps1`), "utf8")] as const);

  it.each(scripts)("engine %s accepts the cleanup command and the import step options", (_version, text) => {
    expect(text).toMatch(/ValidateSet\('export','import',(?:'lpimport',)?'cleanup'(?:,'dbpatch')?\)/);
    for (const param of ["[int] $CancelAfterStatus", "[switch] $KeepCreated", "[string[]] $PriorCreated", "[switch] $LockUpgradeRows", "[string[]] $VersionBefore"]) {
      expect(text).toContain(param);
    }
  });
});

describe("the dbpatch host", () => {
  const read = (name: string) => readFileSync(join(fileURLToPath(new URL("../host", import.meta.url)), name), "utf8");

  it("exists in 14.35 only: its host takes the command and the DBUpdateConfig parameters, and compiles ApplyDBUpdateManifest only there", () => {
    const text = read("engine-14.35.ps1");
    expect(text).toContain("'dbpatch'");
    for (const param of ["$DbManifest", "$DbPatchesFolder", "$DbToolName", "$ExpectedDbManifestSha256", "$ExpectedDbPatchSha256", "$DbPatchCleanup"]) expect(text).toContain(param);
    for (const v of ["12.0", "14.0.7"]) expect(read(`engine-${v}.ps1`)).not.toContain("dbpatch");
    expect(read("common.ps1")).toMatch(/Engine -eq '14\.35'\) \{ \$source = "#define ENGINE_DBPATCH/);
    expect(read("OracleHost.cs")).toContain("#if ENGINE_DBPATCH");
  });
});

describe("guards", () => {
  it("allows the dev instance only", () => {
    expect(() => assertDevUrl("http://localhost/12sp9/")).not.toThrow();
    expect(() => assertDevUrl("http://172.19.0.1/12sp9")).not.toThrow();
    expect(() => assertDevUrl("https://olm.example/innovator")).toThrow(/dev instance only/);
  });

  it("imports only scratch packages", () => {
    expect(() => assertScratchPackages(["LIBSJS-SCRATCH-a"])).not.toThrow();
    expect(() => assertScratchPackages(["LIBSJS-SCRATCH-a", "com.aras.innovator.core"])).toThrow(/com.aras.innovator.core/);
    expect(() => assertScratchPackages([])).toThrow(/no package names/);
    expect(manifestPackageNames('<imports><package name="LIBSJS-SCRATCH-a" path="a\\Import" /></imports>')).toEqual([
      "LIBSJS-SCRATCH-a",
    ]);
    expect(manifestPackageNames("<imports><package path='c' name='com.aras.innovator.core'/></imports>")).toEqual([
      "com.aras.innovator.core",
    ]);
  });

  it("checks the packages each command hands the engine", () => {
    const folder = mkdtempSync(join(tmpdir(), "oracle-guard-"));
    writeFileSync(join(folder, "imports.mf"), '<imports><package name="LIBSJS-SCRATCH-a" path="a" /></imports>');
    expect(importedPackageNames({ command: "import", params: {}, inputDir: folder })).toEqual(["LIBSJS-SCRATCH-a"]);
    expect(importedPackageNames({ command: "import", params: { Packages: ["x"] }, inputDir: folder })).toEqual(["x"]);
    expect(() =>
      assertScratchPackages(importedPackageNames({ command: "lpimport", params: { LPPackage: "com.aras.innovator.core" }, inputDir: folder })),
    ).toThrow(/com.aras.innovator.core/);
    expect(() => assertScratchPackages(importedPackageNames({ command: "lpimport", params: {}, inputDir: folder }))).toThrow(
      /no package names/,
    );
    rmSync(folder, { recursive: true, force: true });
  });
});

describe("CLI mapping", () => {
  it("maps flags to host parameters", () => {
    expect(
      hostParams({ level: "2", merge: true, languages: "en, de", timeout: "1000", fast: false }),
    ).toEqual({ Level: "2", Merge: true, Languages: ["en", "de"], Timeout: 1000 });
  });

  it("maps the import step options: cancel, keep, lock, version", () => {
    expect(
      hostParams({ "cancel-after-status": "4", "keep-created": true, "lock-upgrade-rows": true, "version-before": "Method:ABC, Life Cycle State:DEF" }),
    ).toEqual({
      CancelAfterStatus: 4,
      KeepCreated: true,
      LockUpgradeRows: true,
      VersionBefore: ["Method\tABC", "Life Cycle State\tDEF"],
    });
    expect(() => hostParams({ "version-before": "nocolon" })).toThrow(/<type>:<id>/);
  });

  it("reads what an earlier run created for the cleanup command", () => {
    const folder = mkdtempSync(join(tmpdir(), "oracle-prior-"));
    const file = join(folder, "run.json");
    writeFileSync(
      file,
      JSON.stringify({ cleanup: { created: [{ type: "List", id: "AA" }, { type: "Value", id: "BB", unconfirmed: true }] } }),
    );
    expect(priorCreated(file)).toEqual(["List\tAA\t0", "Value\tBB\t1"]);
    writeFileSync(file, JSON.stringify({ cleanup: null }));
    expect(priorCreated(file)).toEqual([]);
    rmSync(folder, { recursive: true, force: true });
  });

  it("parses export items, keeping colons in the keyed name", () => {
    expect(exportItem("pkg", "List:1854A8A75F5940A78369146966674FA6:Report Format Types")).toBe(
      "pkg\tList\t1854A8A75F5940A78369146966674FA6\tReport Format Types",
    );
    expect(exportItem("pkg", "Method:0123456789ABCDEF0123456789ABCDEF:a:b")).toBe(
      "pkg\tMethod\t0123456789ABCDEF0123456789ABCDEF\ta:b",
    );
    expect(() => exportItem("pkg", "List:nope")).toThrow();
  });
});
