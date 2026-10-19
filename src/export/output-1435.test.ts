import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR, loadXslFixture } from "../../oracle/src/xsl-fixtures.js";
import { CItemException } from "../client/fault.js";
import { pathCombine } from "../io/win-path.js";
import { ArgumentException, encodeItemFile, loadXml } from "../xml/index.js";
import type { XmlDocument } from "../xml/index.js";
import { outputDirPath } from "./output-folder.js";
import { packageElementIdsByElementType } from "./package-elements.js";
import { applyXsl, removeNamespaceNodes } from "./post-xsl.js";
import { removeSeparatelyExportedRelationships } from "./rewrites.js";
import { applyExportTransform, transformExport } from "./transform.js";

/**
 * The 14.35 output steps against the real engine's recordings: the recorded runs of its `export.xsl` (`fixtures/14.35/xsl/export/`,
 * ticket 68), and the offline probe of its own methods (`fixtures/export-output/probe-14.35.txt`): the transform with `RemoveNamespaceNodes`
 * (`AX`, `AXF`, `RNN`), `RemoveSeparatelyExportedRelationships` (`RS`), the package-element map (`GP`), `Path.Combine` (`PC`) and
 * `CreateOutputDir` (`COD`).
 */
/** The probe's `Esc`: it writes CR, LF, tab, a quote and anything outside printable ASCII as an escape, and leaves a backslash alone. */
const unescapeProbe = (text: string): string =>
  text.replace(/\\(u[0-9A-Fa-f]{4}|[rnt"])/g, (_, escape: string) => {
    if (escape.length === 5) return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return escape === "r" ? "\r" : escape === "n" ? "\n" : escape === "t" ? "\t" : '"';
  });

/** The same for a path, where `\\n` and `\\r` are more likely a backslash and a letter than a line end. */
const unescapePath = (text: string): string =>
  text.replace(/\\(u[0-9A-Fa-f]{4}|")/g, (_, escape: string) => (escape.length === 5 ? String.fromCharCode(Number.parseInt(escape.slice(1), 16)) : '"'));

const PROBE = readFileSync(new URL("../../fixtures/export-output/probe-14.35.txt", import.meta.url), "utf8").split(/\r?\n/);

interface ProbeCase {
  id: string;
  input: string;
  /** The bytes after the byte-order mark, or the printed result. */
  output?: string;
  exception?: { type: string; message: string };
}

const cases = (prefix: string): ProbeCase[] => {
  const found = new Map<string, ProbeCase>();
  for (const line of PROBE) {
    const input = new RegExp(`^(${prefix}\\d+) in : (.*)$`).exec(line);
    if (input) found.set(input[1] as string, { id: input[1] as string, input: unescapeProbe(input[2] as string) });
    const output = new RegExp(`^(${prefix}\\d+) out: (?:\\[BOM\\]"(.*)"|(.*))$`).exec(line);
    if (output) (found.get(output[1] as string) as ProbeCase).output = unescapeProbe((output[2] ?? output[3]) as string);
    const exception = new RegExp(`^(${prefix}\\d+) EXC: ([\\w.]+): (.*)$`).exec(line);
    const failing = exception && found.get(exception[1] as string);
    if (exception && failing) failing.exception = { type: exception[2] as string, message: unescapeProbe(exception[3] as string) };
  }
  return [...found.values()].filter((probe) => probe.output !== undefined || probe.exception !== undefined);
};

const fileText = (doc: XmlDocument): string => encodeItemFile(doc).subarray(3).toString("utf8");

describe("14.35 export.xsl recordings (ticket 68), set export", () => {
  const fixture = loadXslFixture(join(FIXTURES_DIR, "14.35", "xsl", "export"));

  it("has the recorded cases", () => {
    expect(fixture.engine).toBe("14.35");
    expect(fixture.cases.length).toBeGreaterThan(10);
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_, recorded) => {
    const doc = loadXml(recorded.input, { preserveWhitespace: fixture.preserveWhitespace });
    if (recorded.transform.ok) {
      expect(transformExport(doc, "14.35")).toBe(recorded.transform.text);
      return;
    }
    const failure = (run: () => unknown): Error => {
      try {
        run();
      } catch (error) {
        return error as Error;
      }
      throw new Error("expected the transform to fail");
    };
    const thrown = failure(() => transformExport(doc, "14.35"));
    expect(thrown).toBeInstanceOf(ArgumentException);
    expect(thrown.message).toBe(recorded.transform.error.message);
    const applied = failure(() => applyExportTransform(doc, "14.35"));
    expect(applied).toBeInstanceOf(CItemException);
    expect(applied.message).toBe(recorded.applied.ok ? "" : recorded.applied.error.message);
  });
});

describe("ApplyXsl then RemoveNamespaceNodes (EXP-380, EXP-381, EXP-410, probes AX and AXF)", () => {
  const probes = cases("AXF?");

  it("has the probe's cases", () => {
    expect(probes.map((probe) => probe.id)).toEqual(expect.arrayContaining(["AX1", "AX17", "AXF1", "AXF8"]));
  });

  // `AXF*` runs the transform without the namespace strip (`$false`), the others with it
  it.each(probes.map((probe) => [probe.id, probe] as const))("%s", (id, probe) => {
    const doc = loadXml(probe.input, { preserveWhitespace: true });
    const applied = applyXsl(doc, "14.35");
    if (!id.startsWith("AXF")) removeNamespaceNodes(applied, "14.35");
    expect(fileText(applied)).toBe(probe.output);
  });
});

describe("RemoveNamespaceNodes keeps xmlns:i18n (EXP-410, EXP-411, probe RNN)", () => {
  it.each(cases("RNN").map((probe) => [probe.id, probe] as const))("%s", (_, probe) => {
    const doc = loadXml(probe.input, { preserveWhitespace: true });
    removeNamespaceNodes(doc, "14.35");
    expect(fileText(doc)).toBe(probe.output);
  });
});

describe("RemoveSeparatelyExportedRelationships (EXP-170, probe RSER)", () => {
  /** The pairs of each case, as the probe passed them to its `Map` (`RS` lines in `probe.ps1`). */
  const PAIRS: Record<string, Array<[string, string]>> = {
    RS1: [["B", "2"]],
    RS2: [["B", "2"], ["B", "3"]],
    RS3: [["B", "2"]],
    RS4: [["C", "9"]],
    RS5: [["C", "9"]],
    RS6: [["A", "1"]],
    RS7: [["B", "2"]],
    RS8: [["B", "2"]],
    RS9: [["B", ""]],
    RS10: [["", ""]],
    RS11: [["B", "2"]],
    RS12: [["B", "2"]],
    RS13: [["B", "2"]],
    RS14: [["B", "2"]],
    RS15: [],
  };

  it.each(cases("RS").filter((probe) => probe.id in PAIRS).map((probe) => [probe.id, probe] as const))("%s", (id, probe) => {
    const map = new Map<string, Set<string | null>>();
    for (const [type, elementId] of PAIRS[id] ?? []) map.set(type, (map.get(type) ?? new Set()).add(elementId));
    const doc = loadXml(probe.input, { preserveWhitespace: true });
    removeSeparatelyExportedRelationships(doc, map);
    expect(fileText(doc)).toBe(probe.output);
  });
});

describe("the package-element map (EXP-550, probe GPE)", () => {
  /** `Show` of the probe: the keys sorted, each with its ids sorted, a null id as nothing. */
  const show = (map: Map<string, Set<string | null>>): string =>
    [...map.keys()]
      .sort()
      .map((key) => `[${key}]=${[...(map.get(key) ?? [])].map((id) => id ?? "").sort().join(",")}`)
      .join(" ");

  it.each(cases("GP").map((probe) => [probe.id, probe] as const))("%s", (_, probe) => {
    const doc = loadXml(probe.input, { preserveWhitespace: true });
    if (probe.exception) {
      expect(() => packageElementIdsByElementType(doc)).toThrow(probe.exception.message);
      return;
    }
    expect(show(packageElementIdsByElementType(doc))).toBe(probe.output);
  });

  it("refuses a null document for 'dom'", () => {
    expect(() => packageElementIdsByElementType(null)).toThrow("Value cannot be null.\r\nParameter name: dom");
  });
});

describe("Path.Combine (EXP-460, probe PC)", () => {
  const lines = PROBE.filter((line) => line.startsWith("PC ("));
  const arg = (text: string): string | null => (text === "<null>" ? null : unescapePath(text));

  it("has the probe's cases", () => {
    expect(lines.length).toBeGreaterThan(30);
  });

  it.each(lines.map((line) => [line] as const))("%s", (line) => {
    const parsed = /^PC \((.*?), (.*)\) (?:= (.*)|EXC ([\w.]+): (.*))$/.exec(line);
    expect(parsed, line).not.toBeNull();
    const [, a = "", b = "", result, , message] = parsed ?? [];
    if (message !== undefined) {
      expect(() => pathCombine(arg(a), arg(b))).toThrow(unescapeProbe(message));
      return;
    }
    expect(pathCombine(arg(a), arg(b))).toBe(unescapePath(result ?? ""));
  });
});

describe("CreateOutputDir builds the folder with Combine (EXP-414, EXP-460, probe COD)", () => {
  const work = "W:\\work";
  const lines = PROBE.filter((line) => line.startsWith("COD "));
  const WORKING_DIRECTORIES: Record<string, string | null> = {
    wd: `${work}\\cod1`,
    "wd\\": `${work}\\cod1\\`,
    "wd/": `${work}\\cod1/`,
    relative: "rel_out",
    empty: "",
    null: null,
    "invalid-char-in-wd": `${work}\\w|d`,
  };

  it.each(lines.map((line) => [line] as const))("%s", (line) => {
    const parsed = /^COD (\S+) pkg=(.*?)(?: -> (.*)| EXC ([\w.]+): (.*))$/.exec(line);
    expect(parsed, line).not.toBeNull();
    const [, label = "", pkg = "", result, , message] = parsed ?? [];
    const workingDirectory = WORKING_DIRECTORIES[label];
    expect(workingDirectory, label).not.toBeUndefined();
    const run = () => outputDirPath(workingDirectory ?? null, unescapePath(pkg), "14.35");
    if (message !== undefined) {
      expect(run).toThrow(unescapeProbe(message));
      return;
    }
    expect(run()).toBe(unescapePath(result ?? "").replace("<WD>", work));
  });
});
