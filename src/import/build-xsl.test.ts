import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CItemException } from "../client/fault.js";
import { documentElementOf } from "../xml/dom.js";
import type { XmlDocument, XmlElement } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { outerXml } from "../xml/writer-legacy.js";
import type { Engine } from "../engines.js";
import { applyBuildXsl, renderBuildOutput } from "./build-output.js";
import { planBuildOrder, plainChildren, xpathNumber } from "./build-order.js";
import { TypeNameOutsideRepertoireError } from "./nls-word-sort.js";

/**
 * Replays the recorded runs of the engine's own build.xsl (fixtures/import-load/build-xsl*.out*.txt, and ticket 68's
 * fixtures/14.0.7/xsl/build) against the ordering rules of IMP-020 to IMP-032 and the writer of IMP-014.
 */

const LOAD_DIR = fileURLToPath(new URL("../../fixtures/import-load/", import.meta.url));
const XSL_DIR = fileURLToPath(new URL("../../fixtures/14.0.7/xsl/build/", import.meta.url));
const XSL_DIR_12_0 = fileURLToPath(new URL("../../fixtures/12.0/xsl/build/", import.meta.url));
const XSL_DIR_14_35 = fileURLToPath(new URL("../../fixtures/14.35/xsl/build/", import.meta.url));

interface ProbeCase {
  name: string;
  parts: string[];
  raw?: boolean;
}

/** Splits a probe output into its `=== name` sections, in order (two cases share a name). */
function sections(text: string): string[][] {
  const result: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("=== ")) result.push([]);
    else if (line !== "" && result.length > 0) (result[result.length - 1] as string[]).push(line);
  }
  return result;
}

const escapeLineEnds = (text: string): string => text.replace(/\r/g, "\\r").replace(/\n/g, "\\n");

/** What probe.ps1 does for one case: stamps the first item of each part, joins the parts, runs the transform. */
function runCase(testCase: ProbeCase, engine: Engine): string[] {
  const lines: string[] = [];
  try {
    const joined: string[] = [];
    testCase.parts.forEach((part, at) => {
      const doc = loadXml(part, { preserveWhitespace: false });
      const root = documentElementOf(doc);
      const item = root && root.nodeName === "AML" ? plainChildren(root, "Item")[0] : undefined;
      if (!item) {
        lines.push(`skip part ${at + 1}`);
        return;
      }
      item.setAttribute("tempKeyName", `k${at + 1}`);
      item.setAttribute("tempFullName", `f${at + 1}`);
      joined.push(outerXml(doc));
    });
    const wrapper = loadXml(`<AML>${joined.join("")}</AML>`, { preserveWhitespace: false });
    const applied = applyBuildXsl(wrapper, engine);
    if (testCase.raw) lines.push(`RAW: ${escapeLineEnds(applied.text)}`);
    const root = documentElementOf(applied.document) as XmlElement;
    for (const item of plainChildren(root, "Item")) {
      lines.push(["type", "action", "id", "tempKeyName"].map((name) => item.getAttribute(name)).join("|"));
    }
  } catch (error) {
    lines.push(`EXC: ${(error as Error).message}`);
  }
  return lines;
}

/** The expected lines with the .NET wrapper of a `LoadXml` failure removed from the message. */
function expectedLines(lines: string[]): string[] {
  return lines.map((line) => {
    const wrapped = /^EXC: .*Exception calling "LoadXml" with "1" argument\(s\): "(.*)"$/.exec(line);
    return wrapped ? `EXC: ${wrapped[1]}` : line;
  });
}

function replay(casesFile: string, outFile: string, engine: Engine = "14.0.7"): void {
  const cases = JSON.parse(readFileSync(LOAD_DIR + casesFile, "utf8")) as ProbeCase[];
  const expected = sections(readFileSync(LOAD_DIR + outFile, "utf8"));
  it("has one recorded section per case", () => expect(expected.length).toBe(cases.length));
  cases.forEach((testCase, index) => {
    it(`${testCase.name} (case ${index + 1})`, () => {
      expect(runCase(testCase, engine)).toEqual(expectedLines(expected[index] ?? []));
    });
  });
}

describe("IMP-020 to IMP-032: build.xsl ordering replays the engine's own stylesheet (14.0.7)", () => {
  replay("build-xsl.cases.json", "build-xsl.out.txt");
});

describe("IMP-021 to IMP-029: the two 14.35 types are placed by the unlisted-types sort in 14.0.7", () => {
  replay("build-xsl-cui.cases.json", "build-xsl-cui.out.14.0.7.txt");
});

describe("IMP-020 to IMP-033: build.xsl ordering replays the 14.35 stylesheet (G12a and G12b)", () => {
  replay("build-xsl.cases.json", "build-xsl.out.14.35.txt", "14.35");
  replay("build-xsl-cui.cases.json", "build-xsl-cui.out.14.35.txt", "14.35");
});

describe("IMP-020 to IMP-029: build.xsl ordering replays the 12.0 stylesheet (fifty-one groups, no G45, no G48)", () => {
  replay("build-xsl.cases.json", "build-xsl.12.0.out.txt", "12.0");
  replay("build-xsl.12.0-extra.cases.json", "build-xsl.12.0-extra.out.txt", "12.0");
});

function recordedRuns(engine: Engine, dir: string): void {
  describe(`IMP-014: ticket 68's recorded build.xsl runs (${engine})`, () => {
    const OUTSIDE_REPERTOIRE_CASE = "sort-type-names";
    interface RunCase {
      name: string;
      transform?: string;
      applied?: string;
      transformError?: { message: string };
      appliedError?: { message: string; type: string };
    }
    const run = JSON.parse(readFileSync(dir + "run.json", "utf8")) as { cases: RunCase[] };

    for (const recorded of run.cases) {
      it(recorded.name, () => {
        const input = readFileSync(`${dir}cases/${recorded.name}/input.xml`, "utf8");
        const wrapper = loadXml(input, { preserveWhitespace: false });
        if (recorded.appliedError) {
          const error = (() => {
            try {
              applyBuildXsl(wrapper, engine);
            } catch (caught) {
              return caught as CItemException;
            }
            return undefined;
          })();
          expect(error).toBeInstanceOf(CItemException);
          expect(error?.message).toBe(recorded.appliedError.message);
          expect(error?.faultcode).toBe(-1);
          expect(() => renderBuildOutput(planBuildOrder(wrapper, engine))).toThrow(recorded.transformError?.message ?? "");
          return;
        }
        const transform = readFileSync(`${dir}cases/${recorded.name}/${recorded.transform}`, "utf8");
        const applied = readFileSync(`${dir}cases/${recorded.name}/${recorded.applied}`, "utf8");
        if (recorded.name === OUTSIDE_REPERTOIRE_CASE) {
          // The recording sorts U+0131 and U+0130, which the weight table of IMP-030 does not hold: planning refuses (IMP-030).
          expect(() => planBuildOrder(wrapper, engine)).toThrow(TypeNameOutsideRepertoireError);
          // Without those two items the order of the rest is the recorded order of the rest.
          const without = (text: string): string => text.replace(/<Item type="[ıİ]"[^>]*\/>/g, "");
          const remaining = loadXml(without(input), { preserveWhitespace: false });
          const orderOf = (xml: string): string[] => [...xml.matchAll(/ n="(\d+)"/g)].map((match) => match[1] as string);
          expect(orderOf(renderBuildOutput(planBuildOrder(remaining, engine)).text)).toEqual(orderOf(without(transform)));
          return;
        }
        const rendered = renderBuildOutput(planBuildOrder(wrapper, engine));
        expect(rendered.text).toBe(transform);
        // `applied` is the document after ApplyXsl reloaded the text, so it is written again by OuterXml.
        expect(outerXml(applyBuildXsl(wrapper, engine).document)).toBe(applied);
      });
    }

    it("covers every recorded case directory", () => {
      const directories = readdirSync(dir + "cases").sort();
      expect(directories).toEqual(run.cases.map((c) => c.name).sort());
      for (const name of directories) expect(existsSync(`${dir}cases/${name}/input.xml`)).toBe(true);
    });
  });
}

recordedRuns("12.0", XSL_DIR_12_0);
recordedRuns("14.0.7", XSL_DIR);
recordedRuns("14.35", XSL_DIR_14_35);

describe("IMP-025: XPath number() of dependencyLevel", () => {
  it.each([
    [" 5 ", 5],
    ["5.", 5],
    [".5", 0.5],
    ["-.5", -0.5],
    ["00012", 12],
    ["\t3\n", 3],
  ])("reads %j as %d", (text, value) => expect(xpathNumber(text)).toBe(value));

  it.each(["+5", "1e3", "1,5", "Infinity", "NaN", "0x10", "1 2", "- 3", "--3", "3-", "1.2.3", " 3", "3 ", "٣", "", " "])(
    "reads %j as NaN",
    (text) => expect(xpathNumber(text)).toBeNaN(),
  );

  it("reads an absent attribute as NaN", () => expect(xpathNumber(null)).toBeNaN());
});

describe("IMP-026 and IMP-029: the plan", () => {
  function planOf(...parts: string[]) {
    const wrapper: XmlDocument = loadXml(`<AML>${parts.join("")}</AML>`, { preserveWhitespace: false });
    return planBuildOrder(wrapper, "14.0.7");
  }
  const describeEntry = (entry: ReturnType<typeof planOf>["entries"][number]) =>
    `${entry.position}:${entry.item.element.getAttribute("id")}:${entry.group}`;

  it("numbers the sequence, names each group and points each copy to its add", () => {
    const plan = planOf(
      "<AML><Item type='ItemType' action='add' id='A'/><Item type='ItemType' action='add' id='B'/><Item type='ItemType' action='edit' id='E'/><Item type='List' action='add' id='L'/></AML>",
    );
    expect(plan.entries.map(describeEntry)).toEqual(["1:L:G01", "2:A:G32", "3:E:copy of 2", "4:B:G32", "5:E:copy of 4"]);
    expect(plan.entries.filter((entry) => entry.copyOf !== undefined).map((entry) => entry.copyOf)).toEqual([2, 4]);
    expect(plan.dropped).toEqual([]);
  });

  it("lists a dropped item with the check it failed", () => {
    const plan = planOf(
      "<AML><Item type='ItemType' action='delete' id='D'/><Item type='List' action='delete' id='LD'/><Item type='Method' id='MN'/><Item type='Zeta' action='delete' id='Z'/></AML>",
    );
    expect(plan.entries.map(describeEntry)).toEqual(["1:Z:G53"]);
    expect(plan.dropped.map((drop) => [drop.item.element.getAttribute("id"), drop.reason])).toEqual([
      ["D", "ItemType has no action or the action is not edit or add"],
      ["LD", "action not selected for this type"],
      ["MN", "action not selected for this type"],
    ]);
  });

  it("keeps the file and position of each item", () => {
    const plan = planOf(
      "<AML><Item type='List' action='add' id='a'/><Item type='List' action='add' id='b'/></AML>",
      "<AML><Item type='List' action='add' id='c'/></AML>",
    );
    expect(plan.entries.map((entry) => [entry.item.fileIndex, entry.item.itemIndex])).toEqual([
      [0, 1],
      [0, 2],
      [1, 1],
    ]);
  });

  it("plans every engine's stylesheet", () => {
    const wrapper = loadXml("<AML/>", { preserveWhitespace: false });
    for (const engine of ["12.0", "14.0.7", "14.35"] as const) expect(planBuildOrder(wrapper, engine).engine).toBe(engine);
  });

  it("drops a promote item and lists the unlisted ac_PolicyAccessItemAttribute in 12.0 (IMP-022, IMP-029)", () => {
    const wrapper = loadXml(
      "<AML><AML><Item type='mp_MacPolicy' action='mp_PromoteItem' id='P'/><Item type='ac_PolicyAccessItemAttribute' action='delete' id='D'/></AML></AML>",
      { preserveWhitespace: false },
    );
    const plan = planBuildOrder(wrapper, "12.0");
    expect(plan.entries.map((entry) => [entry.item.element.getAttribute("id"), entry.group])).toEqual([["D", "G53"]]);
    expect(plan.dropped.map((drop) => [drop.item.element.getAttribute("id"), drop.reason])).toEqual([["P", "action not selected for this type"]]);
  });
});
