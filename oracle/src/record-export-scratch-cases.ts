import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_CASE_ENGINE, EXPORT_ENGINES, blobsDir, casesDir, isExportEngine, type ExportEngine } from "./case-engine.js";
import { readPassword } from "./cli.js";
import { hostItems, hostOptions } from "./export-cases.js";
import { SCRATCH_EXPORT_CASES, SCRATCH_EXPORT_CASES_1435, SEED_GROUPS, SEED_GROUPS_1435, resolveCase, type ResolvedCase, type SeedGroup, type SeedRecord } from "./export-scratch-cases.js";
import { hostOptions as importHostOptions } from "./import-cases.js";
import { writePackages } from "./import-packages.js";
import { caseFile, caseReadme, indexReadme, pruneBlobs, recordedCases } from "./record-export-cases.js";
import { outcomeMatches, returnedValue } from "./record-import-cases.js";
import { DEV_SERVER, record, type CleanupReport, type ItemRef } from "./record.js";
import { externalizeLargeResponses } from "./transcript.js";


const USAGE = `Usage: npm run oracle:export-scratch-cases -- [--engine 14.0.7|12.0|14.35] [--only <case or group>,...] [--force] [--list] [--readme-only]

Records the export cases that need scratch state on dev (tickets 67, 48 and 57) into
fixtures/<engine>/export/<case>/ (default engine 14.0.7). For each seed group: import its LIBSJS-SCRATCH-*
packages, export each case (read-only), then delete everything the import
created, even when a step failed. A case that is already recorded is skipped
unless --force. The password comes from ARAS_PASSWORD or stdin. --readme-only
rewrites each case's case.json and README.md and the index from the case list
without running the engine.
`;

const priorLines = (created: readonly ItemRef[]): string[] => created.map((c) => [c.type, c.id, c.unconfirmed === true ? "1" : "0"].join("\t"));

const common = (engine: ExportEngine, password: string) => ({
  engine,
  url: DEV_SERVER.url,
  database: DEV_SERVER.database,
  user: process.env.ARAS_USER ?? "root",
  password,
  log: () => {},
}) as const;

interface RunRecord {
  hostExit: number;
  host: { result?: string | null } | null;
}

interface GroupRecorded {
  seed: SeedRecord;
  /** The cases that recorded as expected, resolved, with their folders and results. */
  cases: { resolved: ResolvedCase; dir: string; result: { hostExit: number; calls: number | null; error: string | null } }[];
}

/** Runs one group into `work`. Null when something did not go as expected; the created items are deleted either way. */
async function runGroup(engine: ExportEngine, group: SeedGroup, chosen: ReadonlySet<string>, password: string, work: string): Promise<GroupRecorded | null> {
  const created: ItemRef[] = [];
  const steps: SeedRecord["steps"] = [];
  const cases: GroupRecorded["cases"] = [];
  let problem: string | null = null;
  let deleted: ItemRef[] | null = null;
  try {
    // 1. Import: every step keeps what it created.
    for (const [i, s] of group.steps.entries()) {
      const input = join(work, group.id, `input-${i + 1}`);
      writePackages(input, s.packages);
      const out = join(work, group.id, `seed-${i + 1}`);
      const result = await record({
        ...common(engine, password),
        command: "import",
        out,
        inputDir: input,
        params: {
          ...importHostOptions(s.options, s.only),
          KeepCreated: true,
          ...(created.length === 0 ? {} : { PriorCreated: priorLines(created) }),
        },
      });
      const run = JSON.parse(readFileSync(join(out, "run.json"), "utf8")) as RunRecord;
      const stepCreated = result.cleanup?.created ?? [];
      created.push(...stepCreated);
      steps.push({ name: s.name, packages: s.packages.map((p) => p.name), options: s.options ?? {}, created: stepCreated });
      const returned = returnedValue(run.host?.result);
      if (result.remainingSecrets.length > 0) {
        problem = `credential-shaped text survived scrubbing: ${result.remainingSecrets.join(", ")}`;
        break;
      }
      if (!outcomeMatches(s.expect, { hostExit: result.hostExit, returned, error: result.error })) {
        problem = `seed step ${i + 1} (${s.name}): expected ${s.expect}, got host exit ${result.hostExit}, returned ${returned}, error ${result.error?.split("\n")[0] ?? "none"}`;
        break;
      }
    }

    // 2. Export each chosen case of the group.
    if (problem === null) {
      for (const c of group.cases.filter((x) => chosen.has(x.id))) {
        const resolved = resolveCase(c, created);
        const out = join(work, group.id, c.id);
        const result = await record({
          ...common(engine, password),
          command: "export",
          out,
          params: { Items: hostItems(resolved.packages), ...hostOptions(resolved.options) },
        });
        if (result.remainingSecrets.length > 0) {
          problem = `${c.id}: credential-shaped text survived scrubbing: ${result.remainingSecrets.join(", ")}`;
          break;
        }
        if (c.expectsError === true ? result.error === null : result.hostExit !== 0 || result.error !== null) {
          problem = `${c.id}: the export failed (host exit ${result.hostExit}, error ${result.error?.split("\n")[0] ?? "none"})`;
          break;
        }
        cases.push({ resolved, dir: out, result: { hostExit: result.hostExit, calls: result.calls, error: result.error } });
      }
    }
  } catch (error) {
    problem = (error as Error).message;
  } finally {
    // 3. Clean up, whatever happened above.
    if (created.length > 0) {
      const out = join(work, `${group.id}-cleanup`);
      try {
        const cleanup = await record({ ...common(engine, password), command: "cleanup", out, params: { PriorCreated: priorLines(created) } });
        const report: CleanupReport | null = cleanup.cleanup;
        const left = (report?.kept.length ?? 0) + (report?.unverified.length ?? 0);
        process.stdout.write(`${group.id}: cleanup deleted ${report?.deleted.length ?? 0}${left > 0 ? `, LEFT ${left} (see ${out})` : ""}\n`);
        if (report === null || left > 0) problem ??= `the cleanup left items behind: kept ${report?.kept.length ?? "?"}, unverified ${report?.unverified.length ?? "?"}`;
        else deleted = report.deleted;
      } catch (error) {
        process.stderr.write(`${group.id}: cleanup FAILED: ${(error as Error).message}; created ids: ${created.map((x) => `${x.type}:${x.id}`).join(" ")}\n`);
        problem ??= "the cleanup failed";
      }
    }
  }
  if (problem !== null || deleted === null) {
    process.stderr.write(`${group.id}: ${problem ?? "no cleanup report"}\n`);
    return null;
  }
  return { seed: { group: group.id, steps, deleted }, cases };
}

function install(engine: ExportEngine, recorded: GroupRecorded): void {
  const dir = casesDir(engine, "export");
  mkdirSync(dir, { recursive: true });
  for (const c of recorded.cases) {
    externalizeLargeResponses(join(c.dir, "transcript.jsonl"), blobsDir(engine, "export"));
    const file = caseFile(c.resolved, c.result, recorded.seed, engine);
    writeFileSync(join(c.dir, "case.json"), `${JSON.stringify(file, null, 2)}\n`);
    writeFileSync(join(c.dir, "README.md"), caseReadme(file));
    const to = join(dir, c.resolved.id);
    rmSync(to, { recursive: true, force: true });
    cpSync(c.dir, to, { recursive: true });
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { engine: { type: "string" }, only: { type: "string" }, force: { type: "boolean" }, list: { type: "boolean" }, "readme-only": { type: "boolean" }, help: { type: "boolean", short: "h" } },
    strict: true,
  });
  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }
  const engine = values.engine ?? DEFAULT_CASE_ENGINE;
  if (!isExportEngine(engine)) {
    process.stderr.write(`unknown engine: ${engine} (${EXPORT_ENGINES.join(", ")})\n`);
    return 64;
  }
  const groups = engine === "14.35" ? SEED_GROUPS_1435 : SEED_GROUPS;
  const allCases = engine === "14.35" ? SCRATCH_EXPORT_CASES_1435 : SCRATCH_EXPORT_CASES;
  const dir = casesDir(engine, "export");
  const only = values.only === undefined ? null : new Set(values.only.split(",").map((s) => s.trim()));
  if (only !== null) {
    const known = new Set([...groups.map((g) => g.id), ...allCases.map((c) => c.id)]);
    const unknown = [...only].filter((id) => !known.has(id));
    if (unknown.length > 0) {
      process.stderr.write(`unknown case or group: ${unknown.join(", ")}\n`);
      return 64;
    }
  }
  const selected = (groupId: string, caseId: string) => only === null || only.has(groupId) || only.has(caseId);
  const recordedFile = (id: string) => join(dir, id, "case.json");

  if (values.list === true) {
    for (const g of groups) {
      for (const c of g.cases.filter((x) => selected(g.id, x.id))) process.stdout.write(`${g.id}/${c.id}${existsSync(recordedFile(c.id)) ? "" : "  (not recorded)"}\n`);
    }
    return 0;
  }

  if (values["readme-only"] === true) {
    for (const g of groups) {
      for (const c of g.cases.filter((x) => selected(g.id, x.id))) {
        if (!existsSync(recordedFile(c.id))) continue;
        const old = JSON.parse(readFileSync(recordedFile(c.id), "utf8")) as ReturnType<typeof caseFile>;
        // The resolved ids are what was recorded; the rest comes from the case list.
        const resolved: ResolvedCase = { ...resolveCase({ ...c, packages: [] }, []), packages: old.packages };
        const file = caseFile(resolved, old.result, old.seed, engine);
        writeFileSync(recordedFile(c.id), `${JSON.stringify(file, null, 2)}\n`);
        writeFileSync(join(dir, c.id, "README.md"), caseReadme(file));
      }
    }
    writeFileSync(join(dir, "README.md"), indexReadme(recordedCases(engine), engine));
    return 0;
  }

  const password = readPassword();
  const work = mkdtempSync(join(tmpdir(), "libsjs-export-scratch-"));
  const failures: string[] = [];
  try {
    for (const g of groups) {
      const todo = g.cases.filter((c) => selected(g.id, c.id) && (values.force === true || !existsSync(recordedFile(c.id))));
      if (todo.length === 0) {
        process.stdout.write(`${g.id}: already recorded\n`);
        continue;
      }
      process.stdout.write(`${g.id}: seeding ${g.steps.length} step${g.steps.length === 1 ? "" : "s"}, exporting ${todo.map((c) => c.id).join(", ")}\n`);
      const recorded = await runGroup(engine, g, new Set(todo.map((c) => c.id)), password, work);
      if (recorded === null) {
        failures.push(g.id);
        continue;
      }
      install(engine, recorded);
      process.stdout.write(`${g.id}: ${recorded.cases.map((c) => `${c.resolved.id} ${c.result.calls ?? "?"} calls`).join(", ")}; ${recorded.seed.deleted.length} deleted\n`);
    }
  } finally {
    // Keep the work folder when a group did not install, for a look.
    if (failures.length === 0) rmSync(work, { recursive: true, force: true });
    else process.stderr.write(`work folder kept at ${resolve(work)}\n`);
  }
  mkdirSync(dir, { recursive: true });
  const pruned = pruneBlobs(recordedCases(engine), engine);
  if (pruned.length > 0) process.stdout.write(`removed ${pruned.length} unused blob${pruned.length === 1 ? "" : "s"}\n`);
  writeFileSync(join(dir, "README.md"), indexReadme(recordedCases(engine), engine));
  if (failures.length > 0) {
    process.stderr.write(`not as expected: ${failures.join(", ")}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
