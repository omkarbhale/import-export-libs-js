import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ENGINES } from "../../src/engines.js";
import { readManifest } from "./manifest.js";
import { XSL_NAMES, assertCaseName, defaultPreserveWhitespace, inputsFromPath, inputsFromTranscript } from "./xsl.js";
import { FIXTURES_DIR, loadXslFixture, xslFixtureDirs, type XslFixture, type XslOutcome } from "./xsl-fixtures.js";

const CASES_DIR = fileURLToPath(new URL("../xsl-cases", import.meta.url));

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xsl-test-"));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("xsl inputs", () => {
  it("names a case after its file and keeps the bytes", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "b.xml"), "<b/>\r\n");
    writeFileSync(join(dir, "a.xml"), "<a/>");
    writeFileSync(join(dir, "notes.txt"), "skipped");
    const inputs = inputsFromPath(dir);
    expect(inputs.map((i) => i.name)).toEqual(["a", "b"]);
    expect(inputs[1]!.bytes.toString()).toBe("<b/>\r\n");
    expect(inputsFromPath(join(dir, "a.xml")).map((i) => i.name)).toEqual(["a"]);
  });

  it("refuses a name that is not a portable folder name", () => {
    expect(() => assertCaseName("ok-1.a_b")).not.toThrow();
    for (const bad of ["", ".hidden", "a/b", "a b", "-x"]) expect(() => assertCaseName(bad)).toThrow();
  });

  it("takes recorded responses by call seq", () => {
    const dir = tempDir();
    const call = (seq: number, response: string) => JSON.stringify({ event: 1, seq, action: "ApplyItem", request: "<Item/>", response });
    writeFileSync(join(dir, "transcript.jsonl"), [call(1, "<one/>"), call(2, "<two>é</two>")].join("\n") + "\n");
    const inputs = inputsFromTranscript(dir, [2]);
    expect(inputs.map((i) => i.name)).toEqual(["recorded-2"]);
    expect(inputs[0]!.bytes.toString("utf8")).toBe("<two>é</two>");
    expect(() => inputsFromTranscript(dir, [3])).toThrow(/seq 3/);
  });

  it("keeps whitespace for export.xsl and drops it for build.xsl, as the engine loads each", () => {
    expect(defaultPreserveWhitespace("export.xsl")).toBe(true);
    expect(defaultPreserveWhitespace("build.xsl")).toBe(false);
  });
});

describe("recorded XSL fixtures", () => {
  const dirs = xslFixtureDirs();
  const manifest = readManifest();

  it("holds a fixture for every engine and both stylesheets", () => {
    const have = dirs.map((d) => relative(FIXTURES_DIR, d).replaceAll("\\", "/"));
    for (const engine of ENGINES) for (const xsl of ["export", "build"]) expect(have).toContain(`${engine}/xsl/${xsl}`);
  });

  describe.each(dirs.map((d) => [relative(FIXTURES_DIR, d).replaceAll("\\", "/"), d] as const))("%s", (_name, dir) => {
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as {
      engine: string;
      xsl: string;
      toolset: { libs: { mvid: string; version: string } };
      stylesheet: { resource: string };
      cases: { name: string; inputSha256: string; source: string }[];
    };

    it("belongs to its engine's vendored Libs.dll", () => {
      expect(dir).toContain(`${join(FIXTURES_DIR, run.engine)}`);
      const libs = manifest.engines[run.engine as keyof typeof manifest.engines].libs;
      expect(run.toolset.libs).toEqual(libs);
      expect(XSL_NAMES).toContain(run.xsl);
      expect(run.stylesheet.resource).toBe(run.xsl);
    });

    it("records each input byte for byte, with exactly one result per step", () => {
      expect(readdirSync(join(dir, "cases")).sort()).toEqual(run.cases.map((c) => c.name).sort());
      for (const c of run.cases) {
        const input = readFileSync(join(dir, "cases", c.name, "input.xml"));
        expect(createHash("sha256").update(input).digest("hex")).toBe(c.inputSha256);
      }
      const fixture = loadXslFixture(dir);
      expect(fixture.cases).toHaveLength(run.cases.length);
    });

    it("matches the committed case inputs it was recorded from", () => {
      const set = run.xsl.replace(/\.xsl$/, "");
      for (const c of run.cases.filter((c) => !c.source.includes("transcript"))) {
        expect(readFileSync(join(dir, "cases", c.name, "input.xml"))).toEqual(readFileSync(join(CASES_DIR, set, basename(c.source))));
      }
    });

    it("does not contain the stylesheet (AGENTS.md rule 5)", () => {
      for (const c of run.cases) {
        for (const file of readdirSync(join(dir, "cases", c.name))) {
          expect(readFileSync(join(dir, "cases", c.name, file), "utf8")).not.toMatch(/<xsl:(stylesheet|template|transform)\b/);
        }
      }
    });
  });

  // How a differential test reads a recording; these are also the facts the spec rests on (ticket 06 X1, X3, X7).
  const byPath = (path: string): XslFixture => loadXslFixture(join(FIXTURES_DIR, path));
  const text = (o: XslOutcome): string => {
    if (!o.ok) throw new Error(`expected a result, got ${o.error.type}`);
    return o.text;
  };

  it("records the raw text the transform writes, with the copied SOAP-ENV declaration", () => {
    const c = byPath("14.0.7/xsl/export").cases.find((c) => c.name === "method-cdata-split")!;
    expect(text(c.transform)).toBe(
      '<AML><Item type="Method" id="M1" action="add" xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><name>m</name>' +
        "<method_code><![CDATA[a]]]]><![CDATA[>b <x> &\r\nline2]]></method_code><comments /><label /></Item></AML>",
    );
    expect(text(c.applied)).not.toContain("xmlns:SOAP-ENV");
  });

  it("records an exception of either step", () => {
    const c = byPath("14.0.7/xsl/export").cases.find((c) => c.name === "invalid-char-ref")!;
    expect(c.transform).toMatchObject({ ok: false, error: { type: "System.ArgumentException" } });
    expect(c.applied).toMatchObject({ ok: false, error: { type: "Aras.Tools.SolutionUpgrade.CItemException", cause: { type: "System.ArgumentException" } } });
    const reload = byPath("14.0.7/xsl/export").cases.find((c) => c.name === "file-selector-cdata-end")!;
    expect(reload.transform.ok).toBe(true);
    expect(reload.applied).toMatchObject({ ok: false, error: { type: "System.Xml.XmlException" } });
  });

  it("tells the builds apart where their stylesheets differ (14.35 drops an is_null method)", () => {
    const get = (engine: string) => text(byPath(`${engine}/xsl/export`).cases.find((c) => c.name === "report-is-null-method")!.transform);
    expect(get("14.0.7")).toContain("<method ");
    expect(get("14.35")).not.toContain("<method");
  });

  it("records the culture build.xsl sorted under", () => {
    const order = (path: string) => [...text(byPath(path).cases.find((c) => c.name === "sort-type-names")!.transform).matchAll(/type="(x[^"]*)"/g)].map((m) => m[1]);
    expect(order("14.0.7/xsl/build-sv-SE")).toEqual(["xz", "xä"]);
    expect(byPath("14.0.7/xsl/build-sv-SE").culture).toBe("sv-SE");
    expect(order("14.0.7/xsl/build")).toEqual(["xä", "xz"]);
  });
});
