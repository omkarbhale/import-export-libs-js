import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readPassword } from "./cli.js";
import { IMPORT_CASES, hostOptions, type ImportCase, type ImportStep, type StepOutcome } from "./import-cases.js";
import { writePackages } from "./import-packages.js";
import { DEV_SERVER, record, type CleanupReport, type ItemRef } from "./record.js";
import { externalizeLargeResponses } from "./transcript.js";

const ENGINE = "14.0.7";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** Where the cases are committed. */
export const CASES_DIR = join(ROOT, "fixtures", ENGINE, "import");
/** Shared large responses (see transcript.ts). */
export const BLOBS_DIR = join(CASES_DIR, "_blobs");

const USAGE = `Usage: npm run oracle:import-cases -- [--only <id>,<id>...] [--force] [--list] [--readme-only]

Records the 14.0.7 import fixture cases from import-cases.ts on dev into
fixtures/${ENGINE}/import/<case>/step-<n>/. Every case imports LIBSJS-SCRATCH-*
packages only and deletes what it created (a failed case is cleaned up too).
A case that is already recorded is skipped unless --force. The password comes
from ARAS_PASSWORD or stdin. --readme-only rewrites each case's case.json and
README.md and the index from import-cases.ts and the recorded run records,
without running the engine.
`;

/** What one recorded step reported (from its run.json). */
export interface StepResult {
  hostExit: number;
  calls: number | null;
  /** The value `ImportSolutions` returned, or null when the host stopped on an exception. */
  returned: number | null;
  error: string | null;
  /** The ids this step created (its cleanup report's `created`). */
  created: ItemRef[];
}

/** `case.json`: the case's input and what was recorded. */
export interface CaseFile {
  id: string;
  engine: typeof ENGINE;
  catalogue: string[];
  title: string;
  exercises: string;
  note?: string;
  steps: {
    name: string;
    packages: string[];
    only?: string[];
    options: NonNullable<ImportStep["options"]>;
    expect: StepOutcome;
    result: StepResult;
  }[];
  /** What the last step's cleanup deleted: everything the case created, newest first. */
  deleted: ItemRef[];
}

export function caseFile(c: ImportCase, results: readonly StepResult[], deleted: readonly ItemRef[]): CaseFile {
  return {
    id: c.id,
    engine: ENGINE,
    catalogue: c.catalogue,
    title: c.title,
    exercises: c.exercises,
    ...(c.note === undefined ? {} : { note: c.note }),
    steps: c.steps.map((s, i) => ({
      name: s.name,
      packages: s.packages.map((p) => p.name),
      ...(s.only === undefined ? {} : { only: s.only }),
      options: s.options ?? {},
      expect: s.expect,
      result: results[i]!,
    })),
    deleted: [...deleted],
  };
}

/** A markdown table cell. */
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\t/g, " ");

const idTable = (items: readonly ItemRef[]): string[] =>
  items.length === 0
    ? ["None."]
    : ["| # | Type | Id |", "|---|---|---|", ...items.map((i, n) => `| ${n + 1} | ${cell(i.type)} | ${i.id}${i.unconfirmed === true ? " (unconfirmed)" : ""} |`)];

export function caseReadme(file: CaseFile): string {
  const many = file.steps.length > 1;
  const lines = [
    `# ${file.id}`,
    "",
    `${file.title}. Engine ${file.engine}, import, recorded on dev against \`LIBSJS-SCRATCH-*\` packages only. Catalogue: ${file.catalogue.join(", ")} (ticket 05).`,
    "",
    "## Exercises",
    "",
    file.exercises,
    "",
    ...(file.note === undefined ? [] : ["## Not covered here", "", file.note, ""]),
    "## Steps",
    "",
    many
      ? "Each step is one oracle `import` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created."
      : "One oracle `import` run. It deletes what it created when it is done.",
    "",
    "| Step | Name | Packages | Options | Expected | Engine returned | Calls |",
    "|---|---|---|---|---|---|---|",
    ...file.steps.map((s, i) => {
      const options = Object.entries(s.options);
      const packages = (s.only ?? s.packages).map((p) => `\`${p}\``).join(", ");
      const returned = s.result.returned === null ? "exception" : String(s.result.returned);
      return `| ${i + 1} | ${cell(s.name)} | ${packages} | ${options.length === 0 ? "defaults" : cell(options.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", "))} | ${s.expect === "success" ? "success (0)" : "engine failure (1)"} | ${returned} | ${s.result.calls ?? "?"} |`;
    }),
    "",
    ...file.steps.flatMap((s, i) =>
      s.result.error === null ? [] : [`Step ${i + 1} ended the host with an exception:`, "", "```", s.result.error.split("\n")[0]!, "```", ""],
    ),
    "## Ids created and deleted",
    "",
    "Created, per step, in the order the engine made them (each is a top-level `add` the recorder saw, with the ids of the engine's own PackageDefinition, PackageGroup, PackageElement and DatabaseUpgrade rows taken from the responses; items nested in an added item go with it):",
    "",
    ...file.steps.flatMap((s, i) => [`### Step ${i + 1}: created ${s.result.created.length}`, "", ...idTable(s.result.created), ""]),
    `### Deleted by the cleanup: ${file.deleted.length}`,
    "",
    "Newest first; a nested item that went with its parent is not listed. Nothing was kept, and nothing is left on the server.",
    "",
    ...idTable(file.deleted),
    "",
    "## Spec rules",
    "",
    "None yet. The spec or build ticket that pins this case adds its rule ids here (mapcheck F11).",
    "",
    "## Files",
    "",
    "Each `step-<n>/` folder:",
    "",
    "| File | What |",
    "|---|---|",
    "| `run.json` | the oracle's run record: toolset identity, parameters, host info, and the cleanup report (created, deleted, kept) |",
    "| `transcript.jsonl` | every call the engine made, in order. A response of 64 KB or more is in `../../_blobs/<sha256>.xml`, named by `responseBlob`; `oracle/src/transcript.ts` reads it back |",
    "| `messages.jsonl` | the engine's messages, by channel |",
    "| `engine.log` | the engine's own log |",
    "| `host.log` | the host's console output |",
    "| `input/` | the package folder the engine read: `imports.mf` and the item files |",
    "",
    "The return code is `run.json` `host.result` (`ImportSolutions returned N`); `hostExit` is the host process's own exit code.",
    "",
    `Re-record: \`ARAS_PASSWORD=… npm run oracle:import-cases -- --only ${file.id} --force\`.`,
    "",
  ];
  return lines.join("\n");
}

export function indexReadme(cases: readonly CaseFile[]): string {
  return [
    "# 14.0.7 import fixtures",
    "",
    "Recorded from engine 14.0.7.35492 on the dev instance, from ticket 05's scratch packages (S1 to S5, S8, S9), its manifest and file-system cases and its import option matrix. Every import used `LIBSJS-SCRATCH-*` packages and items only, and deleted what it created; each case README lists the ids created and deleted.",
    "",
    "- A case is one or more runs (`step-<n>/`). A step keeps what it created for the next step; the last step, or the recorder if a step fails, deletes everything. Each case starts from and ends at a dev instance without scratch data.",
    "- The packages are built by `oracle/src/import-packages.ts`, so a case can be rebuilt byte for byte. Each step's `input/` holds what the engine read.",
    "- Names follow `LIBSJS-SCRATCH-*`; ItemType and SQL names, which Aras restricts to word characters, use `LIBSJS_SCRATCH_*`.",
    "- A response of 64 KB or more is stored once in `_blobs/` and named by `responseBlob` in the transcript. Every import begins with the list of all PackageDefinitions (about 2.7 MB), which differs between steps because the earlier steps' scratch packages are in it. `oracle/src/transcript.ts` puts the blobs back.",
    "- Not here: the language-pack import (ticket 45), the 14.35 batch and collected-errors modes (ticket 57), the 12.0 variants (ticket 48), the scratch-seeded export cases (S6, S7 and the export side of S2 and S8; ticket 67, `npm run oracle:export-scratch-cases`), whose seed imports are not kept as import fixtures, and the merge of core Forum and Change Controlled Relationship (captain decision 2026-10-13, option (a): rules R13 and R14 are pinned by unit tests on synthetic input and are not exercisable on dev).",
    "- The dev state a case ran against can change. `run.json` carries the time of each run.",
    "- Re-record with `ARAS_PASSWORD=… npm run oracle:import-cases` (see `npm run oracle:import-cases -- --help`).",
    "",
    "| Case | Catalogue | What | Steps | Calls | Created |",
    "|---|---|---|---|---|---|",
    ...cases.map(
      (c) =>
        `| [${c.id}](${c.id}/README.md) | ${c.catalogue.join(", ")} | ${cell(c.title)} | ${c.steps.length} | ${c.steps.reduce((n, s) => n + (s.result.calls ?? 0), 0)} | ${c.steps.reduce((n, s) => n + s.result.created.length, 0)} |`,
    ),
    "",
  ].join("\n");
}

function recordedCases(): CaseFile[] {
  return IMPORT_CASES.flatMap((c) => {
    const file = join(CASES_DIR, c.id, "case.json");
    return existsSync(file) ? [JSON.parse(readFileSync(file, "utf8")) as CaseFile] : [];
  });
}

/** Deletes the blobs no recorded transcript names any more (a re-recorded step leaves its old ones behind). */
export function pruneBlobs(cases: readonly CaseFile[]): string[] {
  if (!existsSync(BLOBS_DIR)) return [];
  const used = new Set<string>();
  for (const c of cases) {
    for (const i of c.steps.keys()) {
      const text = readFileSync(join(CASES_DIR, c.id, `step-${i + 1}`, "transcript.jsonl"), "utf8");
      for (const line of text.split("\n").filter((l) => l !== "")) {
        const blob = (JSON.parse(line) as { responseBlob?: string }).responseBlob;
        if (blob !== undefined) used.add(blob);
      }
    }
  }
  const removed = readdirSync(BLOBS_DIR).filter((f) => !used.has(f.replace(/\.xml$/, "")));
  for (const f of removed) rmSync(join(BLOBS_DIR, f));
  return removed;
}

interface RunRecord {
  hostExit: number;
  host: { calls?: number; result?: string | null; error?: string | null } | null;
  cleanup: CleanupReport | null;
}

/** The value `ImportSolutions` returned, from the host's `result` text; null when the host stopped on an exception first. */
export function returnedValue(result: string | null | undefined): number | null {
  const match = /^ImportSolutions returned (-?\d+)$/.exec(result ?? "");
  return match === null ? null : Number(match[1]);
}

/** Whether a step ended the way its case says it must. */
export function outcomeMatches(expect: StepOutcome, result: Pick<StepResult, "hostExit" | "returned" | "error">): boolean {
  if (result.hostExit !== 0 || result.error !== null) return false;
  return result.returned === (expect === "success" ? 0 : 1);
}

const priorLines = (created: readonly ItemRef[]): string[] => created.map((c) => [c.type, c.id, c.unconfirmed === true ? "1" : "0"].join("\t"));

interface Recorded {
  results: StepResult[];
  deleted: ItemRef[];
}

/**
 * Runs a case's steps into `work/<id>/step-<n>/`. Returns null (and cleans up
 * what the steps created) when a step does not end as its case says.
 */
async function runCase(c: ImportCase, password: string, work: string): Promise<Recorded | null> {
  const results: StepResult[] = [];
  const created: ItemRef[] = [];
  let finished = false;
  let problem: string | null = null;
  try {
    for (const [i, s] of c.steps.entries()) {
      const last = i === c.steps.length - 1;
      const input = join(work, c.id, `input-${i + 1}`);
      writePackages(input, s.packages);
      const out = join(work, c.id, `step-${i + 1}`);
      const result = await record({
        engine: ENGINE,
        command: "import",
        url: DEV_SERVER.url,
        database: DEV_SERVER.database,
        user: process.env.ARAS_USER ?? "root",
        password,
        out,
        inputDir: input,
        params: {
          ...hostOptions(s.options, s.only),
          ...(last ? {} : { KeepCreated: true }),
          ...(created.length === 0 ? {} : { PriorCreated: priorLines(created) }),
        },
        log: () => {},
      });
      const run = JSON.parse(readFileSync(join(out, "run.json"), "utf8")) as RunRecord;
      const stepCreated = result.cleanup?.created ?? [];
      created.push(...stepCreated);
      const step: StepResult = {
        hostExit: result.hostExit,
        calls: result.calls,
        returned: returnedValue(run.host?.result),
        error: result.error,
        created: stepCreated,
      };
      results.push(step);
      if (result.remainingSecrets.length > 0) {
        problem = `credential-shaped text survived scrubbing: ${result.remainingSecrets.join(", ")}`;
        break;
      }
      if (!outcomeMatches(s.expect, step)) {
        problem = `step ${i + 1} (${s.name}): expected ${s.expect}, got host exit ${step.hostExit}, returned ${step.returned}, error ${step.error?.split("\n")[0] ?? "none"}`;
        break;
      }
      if (last) {
        const report = result.cleanup;
        if (report === null || report.kept.length > 0 || report.unverified.length > 0) {
          problem = `the cleanup left items behind: kept ${report?.kept.length ?? "?"}, unverified ${report?.unverified.length ?? "?"}`;
          break;
        }
        finished = true;
        return { results, deleted: report.deleted };
      }
    }
  } catch (error) {
    problem = (error as Error).message;
  } finally {
    if (!finished && created.length > 0) {
      // A step failed or did not end as expected: delete everything the earlier steps (and this one) created.
      const out = join(work, `${c.id}-cleanup`);
      try {
        const cleanup = await record({
          engine: ENGINE,
          command: "cleanup",
          url: DEV_SERVER.url,
          database: DEV_SERVER.database,
          user: process.env.ARAS_USER ?? "root",
          password,
          out,
          params: { PriorCreated: priorLines(created) },
          log: () => {},
        });
        const left = (cleanup.cleanup?.kept.length ?? 0) + (cleanup.cleanup?.unverified.length ?? 0);
        process.stderr.write(`${c.id}: cleanup after failure: deleted ${cleanup.cleanup?.deleted.length ?? 0}${left > 0 ? `, LEFT ${left} (see ${out})` : ""}\n`);
      } catch (error) {
        process.stderr.write(`${c.id}: cleanup after failure FAILED: ${(error as Error).message}; created ids: ${created.map((x) => `${x.type}:${x.id}`).join(" ")}\n`);
      }
    }
  }
  if (problem !== null) process.stderr.write(`${c.id}: ${problem}\n`);
  return null;
}

function install(c: ImportCase, work: string, recorded: Recorded): void {
  const to = join(CASES_DIR, c.id);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const i of c.steps.keys()) {
    const from = join(work, c.id, `step-${i + 1}`);
    externalizeLargeResponses(join(from, "transcript.jsonl"), BLOBS_DIR);
    cpSync(from, join(to, `step-${i + 1}`), { recursive: true });
  }
  const file = caseFile(c, recorded.results, recorded.deleted);
  writeFileSync(join(to, "case.json"), `${JSON.stringify(file, null, 2)}\n`);
  writeFileSync(join(to, "README.md"), caseReadme(file));
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { only: { type: "string" }, force: { type: "boolean" }, list: { type: "boolean" }, "readme-only": { type: "boolean" }, help: { type: "boolean", short: "h" } },
    strict: true,
  });
  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }
  const only = values.only === undefined ? null : new Set(values.only.split(",").map((s) => s.trim()));
  if (only !== null) {
    const unknown = [...only].filter((id) => !IMPORT_CASES.some((c) => c.id === id));
    if (unknown.length > 0) {
      process.stderr.write(`unknown case: ${unknown.join(", ")}\n`);
      return 64;
    }
  }
  const chosen = IMPORT_CASES.filter((c) => only === null || only.has(c.id));
  if (values.list === true) {
    for (const c of chosen) process.stdout.write(`${c.id}${existsSync(join(CASES_DIR, c.id, "case.json")) ? "" : "  (not recorded)"}\n`);
    return 0;
  }

  if (values["readme-only"] === true) {
    for (const c of chosen) {
      const dir = join(CASES_DIR, c.id);
      if (!existsSync(join(dir, "case.json"))) continue;
      const old = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as CaseFile;
      const file = caseFile(c, old.steps.map((s) => s.result), old.deleted);
      writeFileSync(join(dir, "case.json"), `${JSON.stringify(file, null, 2)}\n`);
      writeFileSync(join(dir, "README.md"), caseReadme(file));
    }
    writeFileSync(join(CASES_DIR, "README.md"), indexReadme(recordedCases()));
    return 0;
  }

  const password = readPassword();
  const work = mkdtempSync(join(tmpdir(), "libsjs-import-cases-"));
  const failures: string[] = [];
  try {
    for (const c of chosen) {
      if (values.force !== true && existsSync(join(CASES_DIR, c.id, "case.json"))) {
        process.stdout.write(`${c.id}: already recorded\n`);
        continue;
      }
      process.stdout.write(`${c.id}: recording ${c.steps.length} step${c.steps.length === 1 ? "" : "s"}\n`);
      const recorded = await runCase(c, password, work);
      if (recorded === null) {
        failures.push(c.id);
        continue;
      }
      install(c, work, recorded);
      process.stdout.write(`${c.id}: ${recorded.results.map((r) => r.calls ?? "?").join("+")} calls, ${recorded.deleted.length} deleted\n`);
    }
  } finally {
    // Keep the work folder when a case did not install, for a look.
    if (failures.length === 0) rmSync(work, { recursive: true, force: true });
    else process.stderr.write(`work folder kept at ${resolve(work)}\n`);
  }
  mkdirSync(CASES_DIR, { recursive: true });
  const everything = recordedCases();
  const pruned = pruneBlobs(everything);
  if (pruned.length > 0) process.stdout.write(`removed ${pruned.length} unused blob${pruned.length === 1 ? "" : "s"}\n`);
  writeFileSync(join(CASES_DIR, "README.md"), indexReadme(everything));
  if (failures.length > 0) {
    process.stderr.write(`not as expected: ${failures.join(", ")}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
