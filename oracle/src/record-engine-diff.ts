import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ENGINES } from "../../src/engines.js";
import { readPassword } from "./cli.js";
import { casesDir } from "./case-engine.js";
import { SNAPSHOT_DIR, XSL_SETS, committedRoots, compareEngines, compareRoots, compareXslSets, formatReport, recordedCases, type ExportRoots } from "./engine-diff.js";
import { EXPORT_CASES, hostItems, hostOptions } from "./export-cases.js";
import { DEV_SERVER, record } from "./record.js";
import { FIXTURES_DIR } from "./xsl-fixtures.js";

const USAGE = `Usage: npm run oracle:engine-diff -- [--live <folder> [--only <id>,<id>...]] [--report <file>] [--write]

Compares the export fixtures of the three engines (ticket 64): the output folders
(imports.mf and the item files), then the messages, the engine log and the requests
the engines sent. Prints the report. Without --live it reads the committed fixtures
(fixtures/<engine>/export/), which needs no server.

  --live <folder>   first record the shared catalogue (ticket 05's cases, which every
                    engine has) with all three engines on dev, read-only, into
                    <folder>/<engine>/<case>/, one case after the other so every engine
                    sees the same dev state; then compare those recordings. The password
                    comes from ARAS_PASSWORD or stdin. A case that is already in
                    <folder> is skipped, so an interrupted run resumes.
  --only <ids>      with --live, record only these cases
  --report <file>   write the report there too
  --write           write fixtures/engine-diffs/export.json and xsl.json, the snapshots that
                    oracle/src/engine-diff.test.ts pins (committed fixtures only)
`;

/** The cases every engine has, in the catalogue's order: ticket 05's, which 14.35 repeats by id. */
export const SHARED_CASES = EXPORT_CASES.map((c) => c.id);

async function recordLive(folder: string, only: ReadonlySet<string> | null): Promise<ExportRoots> {
  const password = readPassword();
  const roots = Object.fromEntries(ENGINES.map((e) => [e, join(folder, e)])) as ExportRoots;
  for (const c of EXPORT_CASES) {
    if (only !== null && !only.has(c.id)) continue;
    for (const engine of ENGINES) {
      const out = join(roots[engine], c.id);
      if (existsSync(join(out, "transcript.jsonl"))) continue;
      rmSync(out, { recursive: true, force: true });
      mkdirSync(roots[engine], { recursive: true });
      // A host that dies before the engine runs (WSL hiccups) leaves nothing to compare: try again, twice at most.
      for (let attempt = 1; ; attempt++) {
        process.stdout.write(`${c.id} ${engine}: recording${attempt > 1 ? ` (attempt ${attempt})` : ""}\n`);
        const result = await record({
          engine,
          command: "export",
          url: DEV_SERVER.url,
          database: DEV_SERVER.database,
          user: process.env.ARAS_USER ?? "root",
          password,
          out,
          params: { Items: hostItems(c.packages), ...hostOptions(c.options) },
          log: () => {},
        });
        if (result.remainingSecrets.length > 0) throw new Error(`${c.id} ${engine}: credential-shaped text survived scrubbing`);
        process.stdout.write(`${c.id} ${engine}: host exit ${result.hostExit}, ${result.calls ?? "?"} calls${result.error === null ? "" : `, error: ${result.error.split("\n")[0]}`}\n`);
        if (existsSync(join(out, "transcript.jsonl"))) break;
        if (attempt === 3) throw new Error(`${c.id} ${engine}: the host left no transcript three times`);
        rmSync(out, { recursive: true, force: true });
      }
    }
  }
  return roots;
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { live: { type: "string" }, only: { type: "string" }, report: { type: "string" }, write: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    strict: true,
  });
  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }
  const only = values.only === undefined ? null : new Set(values.only.split(",").map((s) => s.trim()));
  if (only !== null) {
    const unknown = [...only].filter((id) => !SHARED_CASES.includes(id));
    if (unknown.length > 0) {
      process.stderr.write(`unknown case: ${unknown.join(", ")}\n`);
      return 64;
    }
  }
  const roots = values.live === undefined ? committedRoots() : await recordLive(resolve(values.live), only);
  // Live: ticket 05's catalogue. Committed: every case all three engines have, the scratch-seeded ones too.
  const wanted = values.live === undefined ? [...new Set(ENGINES.flatMap((e) => recordedCases(roots[e])))].sort() : SHARED_CASES;
  const cases = wanted.filter((id) => ENGINES.every((e) => recordedCases(roots[e]).includes(id)) && (only === null || only.has(id)));
  const snapshot = compareEngines(roots, cases);
  let report = formatReport(snapshot);
  if (values.live !== undefined) {
    // Dev can change between two recordings: say how far each engine's live output is from its committed fixtures.
    const drift = ENGINES.map((e) => compareRoots(`${e} live`, roots[e], `${e} committed`, casesDir(e, "export"), cases));
    report += `# Live recordings against the committed fixtures (output folders)\n\n${drift
      .map((d) => `- ${d.left}: ${d.identical.length} of ${d.cases} cases byte-identical${Object.keys(d.output).length === 0 ? "" : `; differing: ${Object.entries(d.output).map(([id, f]) => `${id} (${f.map((x) => x.path).join(", ")})`).join("; ")}`}`)
      .join("\n")}\n`;
  }
  const xsl = compareXslSets(FIXTURES_DIR, XSL_SETS);
  report += `\n# export.xsl on the same inputs (fixtures/<engine>/xsl/)\n\n${xsl.map((x) => `- ${x.left} against ${x.right}, ${x.set}: ${x.cases} inputs, ${x.differing.length} differ${x.differing.length === 0 ? "" : `: ${x.differing.map((d) => d.name).join(", ")}`}`).join("\n")}\n`;
  process.stdout.write(report);
  if (values.report !== undefined) writeFileSync(resolve(values.report), report);
  if (values.write === true) {
    if (values.live !== undefined) {
      process.stderr.write("--write pins the committed fixtures; run it without --live\n");
      return 64;
    }
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    writeFileSync(join(SNAPSHOT_DIR, "export.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
    writeFileSync(join(SNAPSHOT_DIR, "xsl.json"), `${JSON.stringify(xsl, null, 2)}\n`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
