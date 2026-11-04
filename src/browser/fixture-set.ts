import type { Engine } from "../engines.js";

/**
 * The recorded cases that the browser replays read (HOST-263): a curated part of `fixtures/`, not the 373 MB of it. A browser test
 * loads a case through the fixture commands (`test-support.browser.ts`), so only the folders listed here, and the recorded blobs
 * their transcripts name, are ever sent to a page. The list is data: the replay tests (the recorded export, import, language-pack
 * and DB-patch runs, and the adapters) take their cases from it, and `fixture-set.test.ts` holds it to the disk and to a size budget.
 *
 * Paths are repository-relative with the `fixtures/` prefix, the form the commands take.
 *
 * @spec HOST-263
 */
export type FixtureOperation = "export" | "import" | "language-pack" | "dbpatch";

export interface FixtureCase {
  engine: Engine;
  operation: FixtureOperation;
  /** The folder name under `fixtures/<engine>/<operation>/`. */
  name: string;
  /** What the case exercises, which is why it is in the set. */
  covers: string;
}

const ALL: readonly Engine[] = ["12.0", "14.0.7", "14.35"];

function each(engines: readonly Engine[], operation: FixtureOperation, name: string, covers: string): FixtureCase[] {
  return engines.map((engine) => ({ engine, operation, name, covers }));
}

export const FIXTURE_CASES: readonly FixtureCase[] = [
  // Export: item files, relationships, a package of items that a failing item stops short, unknown-reference removal; 14.35's language
  // resources and its parallel run. Most cases of an engine share the one 2.7 MB list of PackageDefinitions, which the set carries once;
  // a case that has a list of its own costs 2.7 MB more, so the set keeps those to the ones a replay needs (14.35's `fs-*` and `x-par-*` cases).
  ...each(ALL, "export", "e27-permission", "a package with item files"),
  ...each(ALL, "export", "e04-design-to-goal", "relationships between items"),
  ...each(ALL, "export", "e40-workflow-promotion-error-yes", "a failing item, answered to continue"),
  ...each(ALL, "export", "e06-scopecachedependency-removewithwarning", "references to unknown packages removed with a warning"),
  ...each(["14.35"], "export", "lang-export-de-instances", "language resources of instances (14.35)"),
  ...each(["14.35"], "export", "x-par-two-packages-run1", "two packages exported in parallel (14.35)"),
  // Import: the defaults, a cancel, merge, delayed resolution, a cycle in the manifest, and the files the loader reads oddly.
  ...each(["14.0.7", "14.35"], "import", "s0-mini-defaults", "the defaults of an import"),
  ...each(["14.0.7", "14.35"], "import", "s0-mini-cancel", "a cancelled import"),
  ...each(["14.0.7", "14.35"], "import", "s0-mini-merge", "merge over existing items"),
  ...each(["12.0", "14.0.7"], "import", "s2-ref-both", "the reference check, both directions"),
  ...each(ALL, "import", "s3-unres-delayed", "delayed resolution of references"),
  ...each(["12.0", "14.0.7"], "import", "man-cycle", "a cycle between the packages of a manifest"),
  ...each(ALL, "import", "fs-odd-files", "the files the loader skips or lists oddly"),
  ...each(ALL, "import", "fs-xml-declaration", "XML declarations and encodings"),
  ...each(["12.0"], "import", "r15-latin1-file", "a latin1 file (12.0)"),
  ...each(["12.0"], "import", "r15-utf16-no-bom", "a UTF-16 file with no byte-order mark (12.0)"),
  ...each(["14.35"], "import", "batch-relationships", "the AML batch mode (14.35)"),
  ...each(["14.35"], "import", "collect-two-errors-max2", "collected errors with a limit (14.35)"),
  ...each(["14.35"], "import", "lang-select-de", "the language selection and the scan of languages (14.35)"),
  ...each(["14.35"], "import", "cui-order", "the order of the cui_ groups (14.35)"),
  // Language packs (12.0 has none) and the DB patches (14.35 only).
  ...each(["14.0.7"], "language-pack", "lp01", "a language pack"),
  ...each(["14.35"], "language-pack", "lp01", "a language pack"),
  ...each(["14.35"], "language-pack", "lp06", "a language pack that selects a language"),
  ...each(["14.35"], "dbpatch", "apply", "a DB patch applied, and again"),
];

/** The repository-relative folder of a case. */
export function fixtureCasePath(fixture: Pick<FixtureCase, "engine" | "operation" | "name">): string {
  return `fixtures/${fixture.engine}/${fixture.operation}/${fixture.name}`;
}

/** The repository-relative file of a recorded blob: a response of 64 KB or more is stored once per engine and operation and named by its hash. */
export function fixtureBlobPath(fixture: Pick<FixtureCase, "engine" | "operation">, sha: string): string {
  return `fixtures/${fixture.engine}/${fixture.operation}/_blobs/${sha}.xml`;
}

/** The blobs a recorded transcript (`transcript.jsonl`) names, which a replay needs put back: the `responseBlob` of each line, once. */
export function transcriptBlobs(transcript: string): string[] {
  const shas = new Set<string>();
  for (const line of transcript.split("\n")) {
    if (line.trim() === "") continue;
    const blob = (JSON.parse(line) as { responseBlob?: unknown }).responseBlob;
    if (typeof blob === "string") shas.add(blob);
  }
  return [...shas];
}
