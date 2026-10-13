import { describe, expect, it } from "vitest";
import { exportItem, hostParams } from "./cli.js";
import { assertDevUrl, assertScratchPackages, launcherScript, manifestPackageNames, psLiteral } from "./record.js";

describe("launcher", () => {
  it("quotes values as PowerShell literals", () => {
    expect(psLiteral("it's")).toBe("'it''s'");
    expect(psLiteral(true)).toBe("$true");
    expect(psLiteral(600000)).toBe("600000");
    expect(psLiteral(["a", "b'c"])).toBe("@('a', 'b''c')");
  });

  it("splats every parameter into the engine host", () => {
    const script = launcherScript("C:\\h\\engine-14.0.7.ps1", { Command: "export", Merge: true });
    expect(script).toBe(
      "$ErrorActionPreference = 'Stop'\r\n$p = @{\r\n    Command = 'export'\r\n    Merge = $true\r\n}\r\n& 'C:\\h\\engine-14.0.7.ps1' @p\r\nexit $LASTEXITCODE\r\n",
    );
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
    expect(manifestPackageNames('<imports><package name="LIBSJS-SCRATCH-a" path="a\\Import" /></imports>')).toEqual([
      "LIBSJS-SCRATCH-a",
    ]);
  });
});

describe("CLI mapping", () => {
  it("maps flags to host parameters", () => {
    expect(
      hostParams({ level: "2", merge: true, languages: "en, de", timeout: "1000", "no-host-login": true, fast: false }),
    ).toEqual({ Level: "2", Merge: true, Languages: ["en", "de"], Timeout: 1000, HostLogin: false });
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
