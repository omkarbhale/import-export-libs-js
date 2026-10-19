import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES_DIR, loadXslFixture } from "../../oracle/src/xsl-fixtures.js";
import { CItemException } from "../client/fault.js";
import type { Engine } from "../engines.js";
import { ArgumentException, loadXml } from "../xml/index.js";
import { applyExportTransform, transformExport } from "./transform.js";

/**
 * The differential test: the transform against the runs of the real `export.xsl` recorded by `npm run oracle -- xsl`
 * (`fixtures/14.0.7/xsl/`). Each case's output is compared byte for byte, the text the transform writes and the failure of
 * one that throws.
 */
const SETS = ["export", "export-items", "export-fix"];
/** 12.0 was recorded for the `export` set only; its three differences from 14.0.7 are pinned by the unit tests of the variants. */
const RECORDED: ReadonlyArray<readonly [Engine, string]> = [...SETS.map((set) => ["14.0.7", set] as const), ["12.0", "export"]];

describe.each(RECORDED)("%s export.xsl recordings, set %s", (engine, set) => {
  const fixture = loadXslFixture(join(FIXTURES_DIR, engine, "xsl", set));

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (name, recorded) => {
    const doc = loadXml(recorded.input, { preserveWhitespace: fixture.preserveWhitespace });
    if (recorded.transform.ok) {
      const text = transformExport(doc, engine);
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
    const thrown = failure(() => transformExport(doc, engine));
    expect(thrown).toBeInstanceOf(ArgumentException);
    expect(thrown.message).toBe(recorded.transform.error.message);
    // the same failure, as ApplyXsl reports it
    const applied = failure(() => applyExportTransform(doc, engine));
    expect(applied).toBeInstanceOf(CItemException);
    expect(applied.message).toBe(recorded.applied.ok ? "" : recorded.applied.error.message);
    expect(applied.cause).toBeInstanceOf(ArgumentException);
    expect((applied.cause as Error).message).toBe(thrown.message);
  });
});
