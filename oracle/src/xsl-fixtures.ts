import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Engine } from "../../src/engines.js";
import type { ErrorInfo, HostCase, XslName } from "./xsl.js";

/** `fixtures/` in this checkout. */
export const FIXTURES_DIR = fileURLToPath(new URL("../../fixtures", import.meta.url));

/** What a step of the engine did with one input: the text it produced, or the exception it threw. */
export type XslOutcome = { ok: true; text: string } | { ok: false; error: ErrorInfo };

export interface XslFixtureCase {
  name: string;
  /** Where the input came from (a file of `oracle/xsl-cases/` or a recorded call). */
  source: string;
  /** The source document, exactly as the engine read it. */
  input: string;
  /** What `XslCompiledTransform` wrote into the engine's `StringWriter`, before the SOAP-ENV replace and the reload. */
  transform: XslOutcome;
  /** The document's outer XML after `CItemHelper.ApplyXsl` (transform, replace, `LoadXml`), or its exception. */
  applied: XslOutcome;
}

export interface XslFixture {
  dir: string;
  engine: Engine;
  xsl: XslName;
  /** The source document's PreserveWhitespace. */
  preserveWhitespace: boolean;
  /** The thread culture the transform ran under (build.xsl's `xsl:sort` depends on it). */
  culture: string;
  cases: XslFixtureCase[];
}

interface RunJson {
  engine: Engine;
  xsl: XslName;
  preserveWhitespace: boolean;
  culture: string;
  cases: (HostCase & { source: string })[];
}

function outcome(dir: string, file: string | undefined, error: ErrorInfo | undefined, label: string): XslOutcome {
  if (file !== undefined && error === undefined) return { ok: true, text: readFileSync(join(dir, file), "utf8") };
  if (error !== undefined && file === undefined) return { ok: false, error };
  throw new Error(`${dir}: ${label} must have either a file or an error`);
}

/**
 * Loads a recorded XSL fixture folder (`fixtures/<engine>/xsl/<set>/`, written by
 * `npm run oracle -- xsl`). Files are read as UTF-8 text, line endings intact.
 */
export function loadXslFixture(dir: string): XslFixture {
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as RunJson;
  return {
    dir,
    engine: run.engine,
    xsl: run.xsl,
    preserveWhitespace: run.preserveWhitespace,
    culture: run.culture,
    cases: run.cases.map((c) => {
      const caseDir = join(dir, "cases", c.name);
      return {
        name: c.name,
        source: c.source,
        input: readFileSync(join(caseDir, "input.xml"), "utf8"),
        transform: outcome(caseDir, c.transform, c.transformError, `${c.name} transform`),
        applied: outcome(caseDir, c.applied, c.appliedError, `${c.name} applied`),
      };
    }),
  };
}

/** Every recorded XSL fixture folder: `fixtures/<engine>/xsl/<set>/`. */
export function xslFixtureDirs(root = FIXTURES_DIR): string[] {
  const dirs: string[] = [];
  for (const engine of readdirSync(root)) {
    const xslRoot = join(root, engine, "xsl");
    if (!existsSync(xslRoot)) continue;
    for (const set of readdirSync(xslRoot).sort()) {
      if (existsSync(join(xslRoot, set, "run.json"))) dirs.push(join(xslRoot, set));
    }
  }
  return dirs;
}
