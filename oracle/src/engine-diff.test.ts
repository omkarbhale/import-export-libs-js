import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINES } from "../../src/engines.js";
import { SNAPSHOT_DIR, XSL_SETS, committedRoots, compareEngines, compareXslSets, diffFiles, normalizeLogLine, recordedCases, requestShape, type Snapshot, type XslSetDiff } from "./engine-diff.js";
import { readTranscript } from "./transcript.js";
import { FIXTURES_DIR, loadXslFixture } from "./xsl-fixtures.js";

const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(SNAPSHOT_DIR, name), "utf8")) as T;

describe("engine diff helpers", () => {
  it("compares files as bytes and counts the lines only one side has", () => {
    const left = new Map([
      ["same.xml", Buffer.from("a\nb\n")],
      ["changed.xml", Buffer.from("a\nb\nc\n")],
      ["gone.xml", Buffer.from("x\n")],
    ]);
    const right = new Map([
      ["same.xml", Buffer.from("a\nb\n")],
      ["changed.xml", Buffer.from("a\nc\nd\ne\n")],
      ["new.xml", Buffer.from("y\n")],
    ]);
    expect(diffFiles(left, right)).toEqual([
      { path: "changed.xml", kind: "changed", idsOnly: false, linesOnlyLeft: 1, linesOnlyRight: 2 },
      { path: "gone.xml", kind: "only-left", idsOnly: false, linesOnlyLeft: 1, linesOnlyRight: 0 },
      { path: "new.xml", kind: "only-right", idsOnly: false, linesOnlyLeft: 0, linesOnlyRight: 1 },
    ]);
  });

  it("calls two files equal in their ids when only the 32-digit ids differ", () => {
    const a = new Map([["i.xml", Buffer.from('<Item id="F65FABF87F8645E79C62AF3AA80A7C96"/>')]]);
    const b = new Map([["i.xml", Buffer.from('<Item id="D6B27508FF414B59A3648C6D83AAA3F7"/>')]]);
    expect(diffFiles(a, b)).toMatchObject([{ kind: "changed", idsOnly: true }]);
    expect(diffFiles(a, new Map([["i.xml", Buffer.from('<Item id="D6B27508FF414B59A3648C6D83AAA3F7" x="1"/>')]]))).toMatchObject([{ idsOnly: false }]);
  });

  it("reduces a request to its shape: no ids, no text values, no indentation between elements", () => {
    expect(requestShape("ApplyItem", '<Item type="User" action="get">\n  <id>1B88CFE00D91445E97FF345C3DF14BE4</id>\n  <name>ES Admin</name>\n</Item>')).toBe('ApplyItem <Item type="User" action="get"><id><ID></id><name></name></Item>');
  });

  it("blanks the times and run folders of a log line", () => {
    expect(normalizeLogLine("start of execution : 19-10-2026 03:19:59\r")).toBe("start of execution : <time>");
    expect(normalizeLogLine("end of execution : 10/19/2026 03:19:59")).toBe("end of execution : <time>");
    expect(normalizeLogLine("Log file: C:\\Users\\x\\runs\\1\\engine.log")).toBe("Log file: <path>");
  });
});

/** Why the output folders of two engines differ on a case (the rules are `spec/`'s). Differences in ids alone need no entry: a scratch item seeded again gets new ids from the server. */
const OUTPUT_DIFFERENCES: Record<string, Record<string, readonly string[]>> = {
  "12.0 against 14.0.7": {
    // The Change Controlled Relationship ItemType's three system Properties: edit + where (12.0), add + id (14.0.7).
    "e08-change-controlled-relationship": ["EXP-324"],
    // 12.0 does not fetch ac_PolicyAccessItemAttribute at levels 2, so it keeps the dr_Relationship as a reference; 14.0.7 embeds it.
    "s6-ac-attribute": ["EXP-021", "EXP-118"],
    // implementation_query and event_data are CDATA from 14.0.7 on; the family's filter_xml is re-wrapped in it.
    "s6-dr-family": ["EXP-360", "EXP-405"],
    // The second filter_xml of a MAC condition is wrapped in CDATA only from 14.0.7 on.
    "s6-mac-two-filters": ["EXP-405"],
  },
  "14.0.7 against 14.35": {
    // 14.35 removes the relationships that are package elements of any package.
    "e07-form-itemtype": ["EXP-170"],
    "e09-presentableitems": ["EXP-170"],
    "e34-preference": ["EXP-170"],
    "p1-order-admin-core-cui": ["EXP-170"],
    "p1-order-cui-core-admin": ["EXP-170"],
    "p1-order-six-forward": ["EXP-170"],
    "p1-order-six-reverse": ["EXP-170"],
  },
};

describe("the three engines on the same dev items (ticket 64), committed fixtures", () => {
  const roots = committedRoots();
  const cases = [...new Set(ENGINES.flatMap((e) => recordedCases(roots[e])))].filter((id) => ENGINES.every((e) => recordedCases(roots[e]).includes(id)));
  const snapshot = compareEngines(roots, cases);

  it("compares every case that all three engines recorded", () => {
    expect(cases.length).toBeGreaterThanOrEqual(89);
    for (const pair of snapshot.pairs) expect(pair.cases).toBe(cases.length);
  });

  it("matches the pinned comparison (npm run oracle:engine-diff -- --write after a re-record)", () => {
    expect(snapshot).toEqual(readJson<Snapshot>("export.json"));
  });

  it("explains every difference in the output folders", () => {
    for (const pair of snapshot.pairs) {
      const unexplained = Object.entries(pair.output).filter(([, files]) => files.some((f) => !f.idsOnly));
      expect(Object.fromEntries(unexplained.map(([id]) => [id, true])), `${pair.left} against ${pair.right}`).toEqual(
        Object.fromEntries(Object.keys(OUTPUT_DIFFERENCES[`${pair.left} against ${pair.right}`]!).map((id) => [id, true])),
      );
      // Only item files differ: the manifest of every case is the same on all three engines.
      for (const files of Object.values(pair.output)) expect(files.map((f) => f.path)).not.toContain("imports.mf");
      // The same files are on both sides, and only 14.35's removal of relationships ever takes lines away without adding any.
      for (const [id, files] of Object.entries(pair.output)) {
        for (const f of files) expect(f.kind, `${id}/${f.path}`).toBe("changed");
        if (OUTPUT_DIFFERENCES[`${pair.left} against ${pair.right}`]![id]?.includes("EXP-170") === true) {
          for (const f of files) expect(f.linesOnlyRight, `${id}/${f.path}`).toBe(0);
        }
      }
    }
  });

  it("finds the same host exit on every case", () => {
    for (const pair of snapshot.pairs) expect(pair.hostExit).toEqual({});
  });

  const text = (engine: string, id: string, path: string): string => readFileSync(join(roots[engine as (typeof ENGINES)[number]], id, "output", path), "utf8");

  it("shows the CDATA of implementation_query and event_data, and the second filter_xml, only from 14.0.7 on", () => {
    const dr = "LIBSJS-SCRATCH-SPECIAL/Import/dr_RelationshipFamily/LIBSJS-SCRATCH-DrFamily.xml";
    expect(text("12.0", "s6-dr-family", dr)).toContain("<implementation_query>&lt;Item");
    expect(text("12.0", "s6-dr-family", dr)).toContain("<event_data>{");
    expect(text("14.0.7", "s6-dr-family", dr)).toContain("<implementation_query><![CDATA[<Item");
    expect(text("14.0.7", "s6-dr-family", dr)).toContain("<event_data><![CDATA[{");
    expect(text("14.35", "s6-dr-family", dr)).toBe(text("14.0.7", "s6-dr-family", dr));
    const mac = "LIBSJS-SCRATCH-SPECIAL/Import/mp_MacPolicy/LIBSJS-SCRATCH-SPECIAL-MacPolicy_1.xml";
    expect(text("12.0", "s6-mac-two-filters", mac)).toContain("<filter_xml><condition><eq>");
    expect(text("14.0.7", "s6-mac-two-filters", mac)).not.toContain("<filter_xml><condition><eq>");
  });

  it("keeps the Change Controlled Relationship Properties as edits on 12.0 and as adds on 14.0.7 and 14.35", () => {
    const ccr = "PLM/Import/ItemType/Change Controlled Relationship.xml";
    const edits = (t: string) => t.match(/<Item type="Property" action="edit" where="source_id='[0-9A-F]{32}' and name='(?:related_id|sort_order|source_id)'">/g)?.length ?? 0;
    expect(edits(text("12.0", "e08-change-controlled-relationship", ccr))).toBe(3);
    expect(edits(text("14.0.7", "e08-change-controlled-relationship", ccr))).toBe(0);
    expect(text("14.35", "e08-change-controlled-relationship", ccr)).toBe(text("14.0.7", "e08-change-controlled-relationship", ccr));
  });

  it("finds no pwd_is_set_on in the dev User ItemType, so the User export cannot show it", () => {
    for (const engine of ENGINES) {
      expect(readFileSync(join(roots[engine], "e33-user", "transcript.jsonl"), "utf8")).not.toContain("pwd_is_set_on");
      expect(text(engine, "e33-user", "com/aras/innovator/es/User/ES Admin.xml")).not.toContain("pwd_is_set_on");
    }
  });

  it("receives no element marked is_null in a response that feeds an export, only in 14.35's data_source lookups", () => {
    for (const engine of ENGINES) {
      let lookups = 0;
      let others = 0;
      for (const id of cases) {
        for (const call of readTranscript(join(roots[engine], id, "transcript.jsonl"), join(roots[engine], "_blobs"))) {
          if (call.request.startsWith('<Item type="PackageDefinition"')) continue; // the 2.7 MB list every export begins with
          // An element marked is_null whose name does not start with xp- (EXP-380 keeps those).
          const n = [...(call.response ?? "").matchAll(/<(?!xp-)[A-Za-z_][\w.-]*[^>]*\bis_null="1"/g)].length;
          if (call.request.includes('select="data_source"')) lookups += n;
          else others += n;
        }
      }
      expect({ lookups, others }, engine).toEqual({ lookups: engine === "14.35" ? 94 : 0, others: 0 });
    }
  }, 60_000);

  it("finds no element marked is_null in any output but xp-* ones, so the is_null drop cannot show", () => {
    const marked = new Set<string>();
    for (const engine of ENGINES) {
      for (const id of cases) {
        const walk = (rel: string): void => {
          for (const entry of readdirSync(join(roots[engine], id, "output", rel), { withFileTypes: true })) {
            const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
            if (entry.isDirectory()) walk(path);
            else if (entry.name !== "imports.mf") for (const line of readFileSync(join(roots[engine], id, "output", path), "utf8").split("\n")) if (line.includes('is_null="1"')) marked.add(line.trim());
          }
        };
        walk("");
      }
    }
    // Only xp-* properties (which EXP-380 keeps) and the text inside a query definition's CDATA carry it.
    expect([...marked].filter((line) => !line.startsWith("<xp-") && !line.includes("offset_fetch_xml"))).toEqual([]);
  });
});

/** Which rule an XSL input that differs between two engines shows, judged from the input document. */
function xslRule(left: string, input: string, leftTransform: string, rightTransform: string): string {
  if (left === "12.0") {
    if (input.includes("pwd_is_set_on")) return "EXP-315";
    if (input.includes("implementation_query") || input.includes("event_data")) return "EXP-360";
    return "EXP-324";
  }
  expect(input).toContain('is_null="1"');
  expect(rightTransform.length).toBeLessThan(leftTransform.length);
  return "EXP-380";
}

describe("export.xsl of the three engines on the same inputs (ticket 64)", () => {
  const diffs = compareXslSets(FIXTURES_DIR, XSL_SETS);

  it("matches the pinned comparison", () => {
    expect(diffs).toEqual(readJson<XslSetDiff[]>("xsl.json"));
  });

  it("holds the same inputs on every engine, except the recorded call that only 14.0.7's set has", () => {
    for (const d of diffs) {
      const recorded = d.set === "export" ? ["recorded-11"] : [];
      expect(d.onlyLeft, `${d.left} against ${d.right} ${d.set}`).toEqual(d.left === "14.0.7" ? recorded : []);
      expect(d.onlyRight, `${d.left} against ${d.right} ${d.set}`).toEqual(d.right === "14.0.7" ? recorded : []);
    }
  });

  for (const [left, right] of [["12.0", "14.0.7"], ["14.0.7", "14.35"]] as const) {
    it(`finds every difference between ${left} and ${right} in one rule`, () => {
      const rules = new Map<string, number>();
      for (const d of diffs.filter((x) => x.left === left && x.right === right)) {
        const a = loadXslFixture(join(FIXTURES_DIR, left, "xsl", d.set));
        const b = loadXslFixture(join(FIXTURES_DIR, right, "xsl", d.set));
        for (const c of d.differing) {
          const x = a.cases.find((k) => k.name === c.name)!;
          const y = b.cases.find((k) => k.name === c.name)!;
          expect(x.transform.ok && y.transform.ok, `${d.set}/${c.name}`).toBe(true);
          if (x.transform.ok && y.transform.ok) {
            const rule = xslRule(left, x.input, x.transform.text, y.transform.text);
            rules.set(rule, (rules.get(rule) ?? 0) + 1);
          }
        }
      }
      expect(Object.fromEntries(rules)).toEqual(left === "12.0" ? { "EXP-315": 2, "EXP-324": 5, "EXP-360": 6 } : { "EXP-380": 90 });
    });
  }
});
