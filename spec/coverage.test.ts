import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCoverage, loadCoverageInput, type CoverageInput } from "./coverage.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const repo = loadCoverageInput(root);

const LOCK = {
  token: "0x060000ad",
  signatureSha256: "a".repeat(64),
  ilSha256: "b".repeat(64),
};

function build(methods: object[]) {
  return {
    engine: "14.0.7",
    assemblyVersion: "14.0.7.35492",
    sha256: "c".repeat(64),
    mvid: "81698344-c4fa-4ec3-a48f-0961032d17f1",
    methods,
  };
}

function mapped(overrides: object = {}) {
  return {
    fullName: "Aras.Tools.SolutionUpgrade.CItemHelper::applyAML",
    signature: "System.Boolean applyAML(System.String)",
    lock: LOCK,
    status: "mapped",
    rules: ["IMP-001"],
    symbols: ["src/import/apply.ts#applyAml"],
    ...overrides,
  };
}

const AREA_DOC = { path: "spec/import-run.md", text: "# Import run\n\n### IMP-001: Apply AML\n\n[14.0.7] Sends it.\n" };
const IMPL = { path: "src/import/apply.ts", text: "/** @spec IMP-001 */\nexport function applyAml(): void {}\n" };

function input(overrides: Partial<CoverageInput>): CoverageInput {
  return {
    sourceMap: { builds: [build([mapped()])] },
    schema: repo.schema,
    areaDocs: [AREA_DOC],
    bugs: { path: "spec/bugs.md", text: "# Bugs\n" },
    srcFiles: [IMPL],
    ...overrides,
  };
}

describe("spec coverage", () => {
  it("passes on the repository", () => {
    expect(checkCoverage(repo)).toEqual([]);
  });

  it("passes on a fully mapped build", () => {
    expect(checkCoverage(input({}))).toEqual([]);
  });

  it("fails on an unmapped reachable method", () => {
    const sourceMap = { builds: [build([mapped(), mapped({ fullName: "A.B::C", status: "unmapped", rules: [], symbols: [] })])] };
    expect(checkCoverage(input({ sourceMap }))).toEqual(["[14.0.7] A.B::C is reachable but unmapped"]);
  });

  it("fails on a mapped symbol whose file is missing", () => {
    expect(checkCoverage(input({ srcFiles: [] }))).toEqual([
      "[14.0.7] Aras.Tools.SolutionUpgrade.CItemHelper::applyAML maps to src/import/apply.ts#applyAml, but src/import/apply.ts does not exist",
    ]);
  });

  it("fails on a mapped symbol that is not exported", () => {
    const srcFiles = [{ path: IMPL.path, text: "/** @spec IMP-001 */\nfunction applyAml(): void {}\n" }];
    expect(checkCoverage(input({ srcFiles }))).toEqual([
      "[14.0.7] Aras.Tools.SolutionUpgrade.CItemHelper::applyAML maps to src/import/apply.ts#applyAml, but src/import/apply.ts does not export applyAml",
    ]);
  });

  it("resolves class members, object members and re-exports", () => {
    const srcFiles = [
      IMPL,
      { path: "src/a.ts", text: "export class Client { login() {} }\nexport const EXIT = { usage: 64 } as const;\n" },
      { path: "src/index.ts", text: 'export { Client } from "./a.js";\n' },
    ];
    const ok = mapped({ symbols: ["src/a.ts#Client.login", "src/a.ts#EXIT.usage", "src/index.ts#Client"] });
    expect(checkCoverage(input({ srcFiles, sourceMap: { builds: [build([ok])] } }))).toEqual([]);

    const bad = mapped({ symbols: ["src/a.ts#Client.logout"] });
    expect(checkCoverage(input({ srcFiles, sourceMap: { builds: [build([bad])] } }))).toEqual([
      "[14.0.7] Aras.Tools.SolutionUpgrade.CItemHelper::applyAML maps to src/a.ts#Client.logout, but Client in src/a.ts has no member logout",
    ]);
  });

  it("fails on a rule that is defined but cited nowhere", () => {
    const areaDocs = [{ path: AREA_DOC.path, text: `${AREA_DOC.text}\n### IMP-002: Unused\n\n[14.0.7] Never cited.\n` }];
    expect(checkCoverage(input({ areaDocs }))).toEqual([
      "IMP-002 (spec/import-run.md:7) is cited nowhere: no @spec tag and no source-map entry",
    ]);
  });

  it("counts an @spec tag alone as a citation, but not one in a test file", () => {
    const areaDocs = [{ path: AREA_DOC.path, text: `${AREA_DOC.text}\n### IMP-002: Tagged\n\n[14.0.7] Tagged only.\n` }];
    const tagged = [{ path: IMPL.path, text: "/**\n * @spec IMP-001, IMP-002\n */\nexport function applyAml(): void {}\n" }];
    expect(checkCoverage(input({ areaDocs, srcFiles: tagged }))).toEqual([]);

    const inTest = [IMPL, { path: "src/import/apply.test.ts", text: "// @spec IMP-002\n" }];
    expect(checkCoverage(input({ areaDocs, srcFiles: inTest }))).toHaveLength(1);
  });

  it("fails on a cited rule that is defined nowhere", () => {
    const srcFiles = [{ path: IMPL.path, text: "/** @spec IMP-001 IMP-009 */\nexport function applyAml(): void {}\n" }];
    expect(checkCoverage(input({ srcFiles }))).toEqual(["IMP-009 is cited in src/import/apply.ts but defined in no spec document"]);
  });

  it("fails on a bug registered for an undefined rule, ignoring fenced examples", () => {
    const bugs = { path: "spec/bugs.md", text: "# Bugs\n\n```markdown\n## EXP-000: example\n```\n\n## IMP-003: Cancel is success\n" };
    expect(checkCoverage(input({ bugs }))).toEqual([
      "IMP-003 is registered in spec/bugs.md:7 but defined in no spec document",
    ]);
  });

  it("fails on a rule defined twice, without a variant, or with an unknown engine", () => {
    const areaDocs = [
      AREA_DOC,
      { path: "spec/other.md", text: "### IMP-001: Again\n\n[14.0.7] x\n\n## IMP-004: Bare\n\n- [14.0] y\n" },
    ];
    const srcFiles = [{ path: IMPL.path, text: "/** @spec IMP-001 IMP-004 */\nexport function applyAml(): void {}\n" }];
    expect(checkCoverage(input({ areaDocs, srcFiles }))).toEqual([
      "IMP-001 is defined twice: spec/import-run.md:3 and spec/other.md:1",
      "IMP-004 (spec/other.md:5) has a variant for unknown engine [14.0]",
    ]);

    const noVariant = [{ path: AREA_DOC.path, text: "### IMP-001: Apply AML\n\nNo engine here.\n" }];
    expect(checkCoverage(input({ areaDocs: noVariant }))).toEqual([
      "IMP-001 (spec/import-run.md:1) has no engine variant such as [14.0.7]",
    ]);
  });

  it("fails on a source map that breaks the schema", () => {
    const sourceMap = { builds: [build([mapped({ status: "not-ported" })])] };
    const problems = checkCoverage(input({ sourceMap }));
    expect(problems.some((p) => p.includes("must have required property 'reason'"))).toBe(true);

    const noLock = { builds: [build([mapped({ lock: undefined })])] };
    expect(checkCoverage(input({ sourceMap: JSON.parse(JSON.stringify(noLock)) })).join("\n")).toContain("'lock'");
  });

  it("fails on duplicate builds and methods", () => {
    const sourceMap = { builds: [build([mapped(), mapped()]), build([mapped()])] };
    expect(checkCoverage(input({ sourceMap }))).toEqual([
      "[14.0.7] Aras.Tools.SolutionUpgrade.CItemHelper::applyAML (System.Boolean applyAML(System.String)) is listed twice",
      "source-map.json lists engine 14.0.7 twice",
    ]);
  });
});
