import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR, loadXslFixture } from "../../oracle/src/xsl-fixtures.js";
import { CItemException } from "../client/fault.js";
import { ArgumentException, loadXml } from "../xml/index.js";
import { applyExportTransform, transformExport } from "./transform.js";

/**
 * The differential test: the transform against the runs of the real `export.xsl` recorded by `npm run oracle -- xsl`
 * (`fixtures/14.0.7/xsl/`). Each case's output is compared byte for byte, the text the transform writes and the failure of
 * one that throws.
 */
const SETS = ["export", "export-items", "export-fix"];

describe.each(SETS)("14.0.7 export.xsl recordings, set %s", (set) => {
  const fixture = loadXslFixture(join(FIXTURES_DIR, "14.0.7", "xsl", set));

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (name, recorded) => {
    const doc = loadXml(recorded.input, { preserveWhitespace: fixture.preserveWhitespace });
    if (recorded.transform.ok) {
      const text = transformExport(doc);
      expect(text).toBe(recorded.transform.text);
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
    const thrown = failure(() => transformExport(doc));
    expect(thrown).toBeInstanceOf(ArgumentException);
    expect(thrown.message).toBe(recorded.transform.error.message);
    // the same failure, as ApplyXsl reports it
    const applied = failure(() => applyExportTransform(doc));
    expect(applied).toBeInstanceOf(CItemException);
    expect(applied.message).toBe(recorded.applied.ok ? "" : recorded.applied.error.message);
    expect(applied.cause).toBeInstanceOf(ArgumentException);
    expect((applied.cause as Error).message).toBe(thrown.message);
  });
});
