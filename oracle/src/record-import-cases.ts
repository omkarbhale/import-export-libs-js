import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_CASE_ENGINE, ENGINE_BUILD, IMPORT_ENGINES, blobsDir, casesDir, isImportEngine, recorderCommand, type ImportEngine } from "./case-engine.js";
import { readPassword } from "./cli.js";
import { casesFor, expectedOutcome, hostOptions, type ImportCase, type ImportStep, type StepOutcome } from "./import-cases.js";
import { writePackages } from "./import-packages.js";
import { DEV_SERVER, record, type CleanupReport, type ItemRef } from "./record.js";
import { externalizeLargeResponses } from "./transcript.js";

const ENGINE: ImportEngine = DEFAULT_CASE_ENGINE;
/** Where the 14.0.7 cases are committed. */
export const CASES_DIR = casesDir(ENGINE, "import");
/** Shared large responses of the 14.0.7 cases (see transcript.ts). */
export const BLOBS_DIR = blobsDir(ENGINE, "import");

const USAGE = `Usage: npm run oracle:import-cases -- [--engine 14.0.7|12.0|14.35] [--only <id>,<id>...] [--force] [--list] [--readme-only]

Records the import fixture cases from import-cases.ts on dev into
fixtures/<engine>/import/<case>/step-<n>/ (default engine 14.0.7). Every case imports LIBSJS-SCRATCH-*
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
  engine: ImportEngine;
  catalogue: string[];
  title: string;
  exercises: string;
  note?: string;
  /** The spec rules this case pins; empty until a spec or build ticket cites it (mapcheck F11). */
  rules?: string[];
  /** The `Language` items dev had while the case ran, when the case depends on them. */
  devLanguages?: string[];
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

export function caseFile(c: ImportCase, results: readonly StepResult[], deleted: readonly ItemRef[], engine: ImportEngine = ENGINE): CaseFile {
  return {
    id: c.id,
    engine,
    catalogue: c.catalogue,
    title: c.title,
    exercises: c.exercisesOn?.[engine] ?? c.exercises,
    ...(c.note === undefined ? {} : { note: c.note }),
    ...(c.rules === undefined ? {} : { rules: c.rules }),
    ...(c.devLanguages === undefined ? {} : { devLanguages: [...c.devLanguages] }),
    steps: c.steps.map((s, i) => ({
      name: s.name,
      packages: s.packages.map((p) => p.name),
      ...(s.only === undefined ? {} : { only: s.only }),
      options: s.options ?? {},
      expect: expectedOutcome(s, engine),
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
    `${file.title}. Engine ${file.engine}, import, recorded on dev against \`LIBSJS-SCRATCH-*\` packages only. Catalogue: ${file.catalogue.join(", ")} (${file.engine === "14.35" ? "tickets 05 and 75" : "ticket 05"}).`,
    "",
    "## Exercises",
    "",
    file.exercises,
    "",
    ...(file.note === undefined ? [] : ["## Not covered here", "", file.note, ""]),
    ...(file.devLanguages === undefined
      ? []
      : ["## Dev state", "", `Dev had these \`Language\` items while the case ran: ${file.devLanguages.map((l) => `\`${l}\``).join(", ")}. The result depends on it.`, ""]),
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
      return `| ${i + 1} | ${cell(s.name)} | ${packages} | ${options.length === 0 ? "defaults" : cell(options.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", "))} | ${expectText(s.expect)} | ${returned} | ${s.result.calls ?? "?"} |`;
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
    file.rules === undefined || file.rules.length === 0
      ? "None yet. The spec or build ticket that pins this case adds its rule ids here (mapcheck F11)."
      : `${file.rules.join(", ")}. A spec or build ticket that pins this case adds more here (mapcheck F11).`,
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
    `Re-record: \`ARAS_PASSWORD=… ${recorderCommand("oracle:import-cases", file.engine, `--only ${file.id} --force`)}\`.`,
    "",
  ];
  return lines.join("\n");
}

/** What the 14.35 index adds to the common text: the cases only 14.35 has. */
const INDEX_14_35 = [
  "- **The shared catalogue.** The cases of ticket 05 that `fixtures/14.0.7/import/` holds run again on 14.35 with the same packages, so the engines compare case by case. Where 14.35 ends a case differently the README says so (`s0-mini-cancel`: the package fails with status 2 and the run returns 1).",
  "- **The 14.35 cases** (tickets 53, 55 and 73): `cui-order` (the `build.xsl` groups of `cui_Control` and `cui_WindowSection`), `delayed-*` (the de-duplicated delayed entry and the Property edit addressed by `where`), `lang-*` (the `Languages` selection: unset, one code, `*`, a code the server lacks, and the scan of every `*.xml` of a package), `batch-*` (the AML batch mode) and `collect-*` (the collected-errors mode), on ticket 05's S9 shape. The packages are in `oracle/src/import-packages-14.35.ts`.",
  "- **Dev languages.** A `lang-*` case whose README has a *Dev state* section ran with those `Language` items on dev: `en` only, or `en`, `de` and `fr` while the language-pack cases ran. Dev has `en` only again.",
  "- The server sometimes fails a request for reasons of its own (a deadlock victim, a foreign key race right after the previous case's cleanup). The recorder refuses a run whose outcome is not the case's, so such a run was repeated and only the repeat is committed.",
];

export function indexReadme(cases: readonly CaseFile[], engine: ImportEngine = ENGINE): string {
  return [
    `# ${engine} import fixtures`,
    "",
    `Recorded from engine ${ENGINE_BUILD[engine]} on the dev instance, from ticket 05's scratch packages (S1 to S5, S8, S9), its manifest and file-system cases and its import option matrix. Every import used \`LIBSJS-SCRATCH-*\` packages and items only, and deleted what it created; each case README lists the ids created and deleted.`,
    "",
    ...(engine === "14.35" ? INDEX_14_35 : []),
    "- A case is one or more runs (`step-<n>/`). A step keeps what it created for the next step; the last step, or the recorder if a step fails, deletes everything. Each case starts from and ends at a dev instance without scratch data.",
    "- The packages are built by `oracle/src/import-packages.ts`, so a case can be rebuilt byte for byte. Each step's `input/` holds what the engine read.",
    "- Names follow `LIBSJS-SCRATCH-*`; ItemType and SQL names, which Aras restricts to word characters, use `LIBSJS_SCRATCH_*`.",
    "- A response of 64 KB or more is stored once in `_blobs/` and named by `responseBlob` in the transcript. Every import begins with the list of all PackageDefinitions (about 2.7 MB), which differs between steps because the earlier steps' scratch packages are in it. `oracle/src/transcript.ts` puts the blobs back.",
    engine === "14.35"
      ? "- Not here: the 12.0 variants (ticket 48), and the merge of core Forum and Change Controlled Relationship (captain decision 2026-10-13, option (a): rules R13 and R14 are pinned by unit tests on synthetic input and are not exercisable on dev). The language-pack imports are in `fixtures/14.35/language-pack/`."
      : engine === ENGINE
      ? "- Not here: the language-pack import (ticket 45), the 14.35 batch and collected-errors modes (ticket 57), the 12.0 variants (ticket 48), the scratch-seeded export cases (S6, S7 and the export side of S2 and S8; ticket 67, `npm run oracle:export-scratch-cases`), whose seed imports are not kept as import fixtures, and the merge of core Forum and Change Controlled Relationship (captain decision 2026-10-13, option (a): rules R13 and R14 are pinned by unit tests on synthetic input and are not exercisable on dev)."
      : `- Not here: a language-pack import (12.0 has no \`LanguagePackPreprocessor\`; \`import-language-pack\` refuses on it), the scratch-seeded export cases (S6, S7 and the export side of S2 and S8; ticket 48, \`${recorderCommand("oracle:export-scratch-cases", engine)}\`), whose seed imports are not kept as import fixtures, and the merge of core Forum and Change Controlled Relationship (captain decision 2026-10-13, option (a): rules R13 and R14 are pinned by unit tests on synthetic input and are not exercisable on dev). Cases named \`r*\` exist only here: each pins one of 12.0's variant rules.`,
    "- The dev state a case ran against can change. `run.json` carries the time of each run.",
    `- Re-record with \`ARAS_PASSWORD=… ${recorderCommand("oracle:import-cases", engine)}\` (see \`${recorderCommand("oracle:import-cases", engine, "--help")}\`).`,
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

export function recordedCases(engine: ImportEngine = ENGINE): CaseFile[] {
  return casesFor(engine).flatMap((c) => {
    const file = join(casesDir(engine, "import"), c.id, "case.json");
    return existsSync(file) ? [JSON.parse(readFileSync(file, "utf8")) as CaseFile] : [];
  });
}

/** Deletes the blobs no recorded transcript names any more (a re-recorded step leaves its old ones behind). */
export function pruneBlobs(cases: readonly CaseFile[], engine: ImportEngine = ENGINE): string[] {
  const dir = casesDir(engine, "import");
  const blobs = blobsDir(engine, "import");
  if (!existsSync(blobs)) return [];
  const used = new Set<string>();
  for (const c of cases) {
    for (const i of c.steps.keys()) {
      const text = readFileSync(join(dir, c.id, `step-${i + 1}`, "transcript.jsonl"), "utf8");
      for (const line of text.split("\n").filter((l) => l !== "")) {
        const blob = (JSON.parse(line) as { responseBlob?: string }).responseBlob;
        if (blob !== undefined) used.add(blob);
      }
    }
  }
  const removed = readdirSync(blobs).filter((f) => !used.has(f.replace(/\.xml$/, "")));
  for (const f of removed) rmSync(join(blobs, f));
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
  // The constructor threw: the host ended with its exception (exit 2) and no return value.
  if (expect === "refused") return result.hostExit === 2 && result.returned === null && result.error !== null;
  if (result.hostExit !== 0 || result.error !== null) return false;
  return result.returned === expectedReturn(expect);
}

/** The value `ImportSolutions` returns for an outcome that returns one. */
export function expectedReturn(expect: Exclude<StepOutcome, "refused">): number {
  return expect === "success" ? 0 : expect === "engine-failure" ? 1 : Number(expect.slice("returned:".length));
}

/** How a README names an expected outcome. */
export function expectText(expect: StepOutcome): string {
  if (expect === "refused") return "constructor refused (exception)";
  return expect === "success" ? "success (0)" : expect === "engine-failure" ? "engine failure (1)" : `${expect.slice("returned:".length)} errors collected (${expect.slice("returned:".length)})`;
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
async function runCase(engine: ImportEngine, c: ImportCase, password: string, work: string): Promise<Recorded | null> {
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
        engine,
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
      if (!outcomeMatches(expectedOutcome(s, engine), step)) {
        problem = `step ${i + 1} (${s.name}): expected ${expectedOutcome(s, engine)}, got host exit ${step.hostExit}, returned ${step.returned}, error ${step.error?.split("\n")[0] ?? "none"}`;
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
          engine,
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

function install(engine: ImportEngine, c: ImportCase, work: string, recorded: Recorded): void {
  const to = join(casesDir(engine, "import"), c.id);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const i of c.steps.keys()) {
    const from = join(work, c.id, `step-${i + 1}`);
    externalizeLargeResponses(join(from, "transcript.jsonl"), blobsDir(engine, "import"));
    cpSync(from, join(to, `step-${i + 1}`), { recursive: true });
  }
  const file = caseFile(c, recorded.results, recorded.deleted, engine);
  writeFileSync(join(to, "case.json"), `${JSON.stringify(file, null, 2)}\n`);
  writeFileSync(join(to, "README.md"), caseReadme(file));
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
  const engine = values.engine ?? ENGINE;
  if (!isImportEngine(engine)) {
    process.stderr.write(`unknown engine: ${engine} (${IMPORT_ENGINES.join(", ")})\n`);
    return 64;
  }
  const dir = casesDir(engine, "import");
  const cases = casesFor(engine);
  const only = values.only === undefined ? null : new Set(values.only.split(",").map((s) => s.trim()));
  if (only !== null) {
    const unknown = [...only].filter((id) => !cases.some((c) => c.id === id));
    if (unknown.length > 0) {
      process.stderr.write(`unknown case: ${unknown.join(", ")}\n`);
      return 64;
    }
  }
  const chosen = cases.filter((c) => only === null || only.has(c.id));
  if (values.list === true) {
    for (const c of chosen) process.stdout.write(`${c.id}${existsSync(join(dir, c.id, "case.json")) ? "" : "  (not recorded)"}\n`);
    return 0;
  }

  if (values["readme-only"] === true) {
    for (const c of chosen) {
      const caseDir = join(dir, c.id);
      if (!existsSync(join(caseDir, "case.json"))) continue;
      const old = JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as CaseFile;
      const file = caseFile(c, old.steps.map((s) => s.result), old.deleted, engine);
      writeFileSync(join(caseDir, "case.json"), `${JSON.stringify(file, null, 2)}\n`);
      writeFileSync(join(caseDir, "README.md"), caseReadme(file));
    }
    writeFileSync(join(dir, "README.md"), indexReadme(recordedCases(engine), engine));
    return 0;
  }

  const password = readPassword();
  const work = mkdtempSync(join(tmpdir(), "libsjs-import-cases-"));
  const failures: string[] = [];
  try {
    for (const c of chosen) {
      if (values.force !== true && existsSync(join(dir, c.id, "case.json"))) {
        process.stdout.write(`${c.id}: already recorded\n`);
        continue;
      }
      process.stdout.write(`${c.id}: recording ${c.steps.length} step${c.steps.length === 1 ? "" : "s"}\n`);
      const recorded = await runCase(engine, c, password, work);
      if (recorded === null) {
        failures.push(c.id);
        continue;
      }
      install(engine, c, work, recorded);
      process.stdout.write(`${c.id}: ${recorded.results.map((r) => r.calls ?? "?").join("+")} calls, ${recorded.deleted.length} deleted\n`);
    }
  } finally {
    // Keep the work folder when a case did not install, for a look.
    if (failures.length === 0) rmSync(work, { recursive: true, force: true });
    else process.stderr.write(`work folder kept at ${resolve(work)}\n`);
  }
  mkdirSync(dir, { recursive: true });
  const everything = recordedCases(engine);
  const pruned = pruneBlobs(everything, engine);
  if (pruned.length > 0) process.stdout.write(`removed ${pruned.length} unused blob${pruned.length === 1 ? "" : "s"}\n`);
  writeFileSync(join(dir, "README.md"), indexReadme(everything, engine));
  if (failures.length > 0) {
    process.stderr.write(`not as expected: ${failures.join(", ")}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
