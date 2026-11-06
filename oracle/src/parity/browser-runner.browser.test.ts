import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startWireServer, type WireServer } from "../../../src/browser/test-server.js";
import { BROWSERS } from "./browser-runner.js";
import { dryRunExport, dryRunImport, dryRunLanguagePack, isClean, type DryRunReport } from "./browser-dry-run.js";
import { describeDifferences } from "./diff.js";
import { readTree } from "./outcome.js";
import { writePortRun } from "./runners.js";
import { secretForms } from "../scrub.js";

/**
 * The parity script's browser runtime, end to end with no lease (HOST-277): a recorded export case is served over HTTP by the browser
 * tests' server and run by the Node port and by the page's Worker in Chromium, Firefox and WebKit, through the proxy and straight, and
 * the three outcomes and the wire go through the normalisation and the diff that a live run uses. It is the "dry run" of the ticket:
 * it needs the browsers (`npx playwright install chromium firefox webkit`) and no server of Aras.
 */

let server: WireServer;
beforeAll(async () => {
  server = await startWireServer();
});
afterAll(async () => {
  await server.close();
});

const shown = (report: DryRunReport): string =>
  [report.nodeAgainstOracle, report.browserAgainstOracle, report.browserAgainstNode, report.wire].map((part) => describeDifferences(part).join("\n")).join("\n");

describe.each(BROWSERS)("a dry run of one recorded export case in %s", (browser) => {
  it.each([
    ["12.0", "e24-grid"],
    ["14.0.7", "e24-grid"],
    ["14.35", "e24-grid"],
  ] as const)("through the proxy, the %s case %s: no differences", async (engine, caseName) => {
    const report = await dryRunExport({ engine, caseName, browser, cors: "proxy", server });
    expect(shown(report).trim(), "the differences").toBe("");
    expect(isClean(report)).toBe(true);
    // the three sides made the same calls
    expect(report.calls.browser).toBe(report.calls.oracle);
    expect(report.calls.node).toBe(report.calls.oracle);
    console.info(`DRY-RUN ${browser} (${report.browser}) ${engine} ${caseName}: ${report.calls.browser} calls, no differences`);
  });

  it.each(["12.0", "14.0.7", "14.35"] as const)("an import step of %s, s0-mini-defaults: no differences", async (engine) => {
    const report = await dryRunImport({ engine, caseName: "s0-mini-defaults", browser, server });
    expect(shown(report).trim(), "the differences").toBe("");
    expect(isClean(report)).toBe(true);
    expect(report.calls.browser).toBe(report.calls.oracle);
  });

  it.each(["14.0.7", "14.35"] as const)("a language-pack import of %s, lp01: no differences", async (engine) => {
    const report = await dryRunLanguagePack({ engine, caseName: "lp01", browser, server });
    expect(shown(report).trim(), "the differences").toBe("");
    expect(isClean(report)).toBe(true);
  });

  it("straight to the server, which answers CORS itself: no differences", async () => {
    const report = await dryRunExport({ engine: "14.0.7", caseName: "e24-grid", browser, cors: "server", server });
    expect(shown(report).trim(), "the differences").toBe("");
    expect(isClean(report)).toBe(true);
  });
});

describe("the dry run keeps no copy of the password", () => {
  const PASSWORD = "LIBSJS-known-test-password";

  it.each(BROWSERS)("in %s: not in the outcome, the differences, the kept folders or the page", async (browser) => {
    const report = await dryRunExport({ engine: "14.0.7", caseName: "e24-grid", browser, cors: "proxy", server, password: PASSWORD });
    const folder = mkdtempSync(join(tmpdir(), "libsjs-kept-"));
    try {
      writePortRun(folder, report.outcome);
      const kept = [...readTree(folder)].flatMap(([path, bytes]) => [path, bytes.toString("latin1")]);
      const { outcome, ...parts } = report;
      const everything = [JSON.stringify(parts), JSON.stringify(outcome.calls), outcome.log, ...kept].join("\n");
      for (const secret of [PASSWORD, ...secretForms(PASSWORD)]) expect(everything).not.toContain(secret);
      expect(report.kept).toContain("/__parity/index.html");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("the dry run finds a difference when there is one", () => {
  it("reports the page and the Node port as different from a recording of another case", async () => {
    const report = await dryRunExport({ engine: "14.0.7", caseName: "e24-grid", serve: "e14-list", browser: "chromium", cors: "proxy", server });
    expect(isClean(report)).toBe(false);
    expect(report.browserAgainstOracle.length).toBeGreaterThan(0);
    expect(report.nodeAgainstOracle.length).toBeGreaterThan(0);
  });
});
