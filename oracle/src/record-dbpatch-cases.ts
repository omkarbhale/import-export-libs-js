import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readPassword } from "./cli.js";
import { DBPATCH_DIR, MANIFEST_FILE, PATCH_NUMBER, PATCH_RELEASE, TOOL_NAME } from "./dbpatch.js";
import { DEV_SERVER, record, type CleanupReport, type ItemRef } from "./record.js";

const ENGINE = "14.35";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** Where the cases are committed. */
export const CASES_DIR = join(ROOT, "fixtures", ENGINE, "dbpatch");

/** One oracle `dbpatch` run. Every step but the last keeps what it made, for the next step to find. */
export interface DbPatchStep {
  name: string;
  /** The login: the engine accepts `root` only (DBP-010). */
  user: string;
  /**
   * How the run must end. `refused`: an exception escapes with this text and nothing is created.
   * `patch-failed`: no exception, but the patch's `ApplyUpdate` was refused, which is one `error` message.
   */
  expect: { kind: "applied" } | { kind: "refused"; message: string } | { kind: "patch-failed" };
}

export interface DbPatchCase {
  id: string;
  title: string;
  exercises: string;
  rules: string[];
  steps: DbPatchStep[];
}

export const DBPATCH_CASES: readonly DbPatchCase[] = [
  {
    id: "non-root",
    title: "The login is not root",
    exercises:
      "The `admin` login (a different user from the profile's `root`, with the same password) is refused by the engine's own name check before any DB request: the log header, the start lines, the `error` message and the end lines, and no `ValidateUser`, `GetItem`, `ApplyItem` or `ApplyUpdate` call after the engine's own login. Nothing is created.",
    rules: ["DBP-003", "DBP-005", "DBP-010", "DBP-050"],
    steps: [
      {
        name: "admin login",
        user: "admin",
        expect: { kind: "refused", message: "Login name is not root. It is 'admin'. Check your config file." },
      },
    ],
  },
  {
    id: "apply",
    title: "The no-op test patch, applied and applied again",
    exercises:
      "The success path of `ApplyDBUpdateManifest` with the committed no-op patch (DBP-070) as `root`: `ValidateRootUser`'s four requests, the new `DatabaseUpgrade` row, `ApplyUpdate`, the `DatabaseUpgradePatch` link and the row's status edit. Step 2 runs the same patch again before the cleanup: the row now exists (the edit path of DBP-030) and the server refuses `ApplyUpdate` with a fault, because the number was already applied (DBP-042). That is an `error` message and a failed run, not an exception, and the row ends with status 2 (DBP-044).",
    rules: ["DBP-002", "DBP-011", "DBP-012", "DBP-020", "DBP-021", "DBP-022", "DBP-030", "DBP-040", "DBP-041", "DBP-042", "DBP-043", "DBP-044", "DBP-060", "DBP-061"],
    steps: [
      { name: "first run", user: "root", expect: { kind: "applied" } },
      { name: "second run, same patch", user: "root", expect: { kind: "patch-failed" } },
    ],
  },
];

const USAGE = `Usage: npm run oracle:dbpatch-cases -- [--only <id>,<id>...] [--force] [--list] [--readme-only]

Records the 14.35 DB patch fixture cases into fixtures/${ENGINE}/dbpatch/<case>/step-<n>/ on dev. Every case applies
only the committed no-op test patch (oracle/dbpatch/), and deletes the three items it creates (a failed case is cleaned
up too). A case that is already recorded is skipped unless --force. The password comes from ARAS_PASSWORD or stdin
and is tried for each step's login. --readme-only rewrites each case's README.md and the index from the recorded run
records, without running the engine.
`;

interface RunRecord {
  hostExit: number;
  host: { calls?: number; result?: string | null; error?: string | null; errorMessages?: number } | null;
  cleanup: CleanupReport | null;
}

/** What one recorded step reported (from its run.json). */
export interface StepResult {
  hostExit: number;
  calls: number | null;
  error: string | null;
  errorMessages: number;
  created: ItemRef[];
}

/** `case.json`: the case's input and what was recorded. */
export interface CaseFile {
  id: string;
  engine: typeof ENGINE;
  title: string;
  exercises: string;
  rules: string[];
  steps: { name: string; user: string; expect: DbPatchStep["expect"]; result: StepResult }[];
  /** What the last step's cleanup deleted, newest first: everything the case created. */
  deleted: ItemRef[];
}

export function caseFile(c: DbPatchCase, results: readonly StepResult[], deleted: readonly ItemRef[]): CaseFile {
  return {
    id: c.id,
    engine: ENGINE,
    title: c.title,
    exercises: c.exercises,
    rules: c.rules,
    steps: c.steps.map((s, i) => ({ name: s.name, user: s.user, expect: s.expect, result: results[i]! })),
    deleted: [...deleted],
  };
}

/** Whether a step ended the way its case says it must. */
export function outcomeMatches(expect: DbPatchStep["expect"], r: StepResult): boolean {
  if (expect.kind === "refused") return r.hostExit === 2 && r.error !== null && r.error.includes(expect.message) && r.created.length === 0;
  if (expect.kind === "patch-failed") return r.hostExit === 1 && r.error === null && r.errorMessages === 1 && r.created.length === 0;
  return r.hostExit === 0 && r.error === null && r.errorMessages === 0;
}

const cell = (text: string) => text.replace(/\|/g, "\\|");
const idTable = (items: readonly ItemRef[]): string[] =>
  items.length === 0 ? ["None."] : ["| # | Type | Id |", "|---|---|---|", ...items.map((i, n) => `| ${n + 1} | ${cell(i.type)} | ${i.id}${i.unconfirmed === true ? " (unconfirmed)" : ""} |`)];

export function caseReadme(file: CaseFile): string {
  const many = file.steps.length > 1;
  return [
    `# ${file.id}`,
    "",
    `${file.title}. Engine ${file.engine}, \`ApplyDBUpdateManifest\` on the dev instance with the committed no-op test patch (\`oracle/dbpatch/\`, DBP-070): manifest entry \`${PATCH_NUMBER}\`, release \`${PATCH_RELEASE}\`, tool name \`${TOOL_NAME}\`.`,
    "",
    "## Exercises",
    "",
    file.exercises,
    "",
    "## Steps",
    "",
    many
      ? "Each step is one oracle `dbpatch` run, in order. A step keeps what it created so the next one finds it on the server; the last step deletes everything the case created."
      : "One oracle `dbpatch` run. It deletes what it created when it is done.",
    "",
    "| Step | Name | Login | Expected | Host exit | Calls | `error` messages |",
    "|---|---|---|---|---|---|---|",
    ...file.steps.map(
      (s, i) =>
        `| ${i + 1} | ${cell(s.name)} | \`${s.user}\` | ${s.expect.kind === "refused" ? `refused: ${cell(s.expect.message)}` : s.expect.kind} | ${s.result.hostExit} | ${s.result.calls ?? "?"} | ${s.result.errorMessages} |`,
    ),
    "",
    "## Ids created and deleted",
    "",
    "Created, per step, in the order the run made them: the `DatabaseUpgrade` row (an `add` the recorder saw), the \"Applied Updates\" item (the item `ApplyUpdate` answered with) and the `DatabaseUpgradePatch` link. A second run creates nothing: its `ApplyUpdate` is refused.",
    "",
    ...file.steps.flatMap((s, i) => [`### Step ${i + 1}: created ${s.result.created.length}`, "", ...idTable(s.result.created), ""]),
    `### Deleted by the cleanup: ${file.deleted.length}`,
    "",
    "Newest first. A delete needs the item to match the test patch (the row: name, release and type; the update: `up_number`; a link: its update's `up_number`), and a read-back then found no item of release `99.99` or number `LIBSJS-SCRATCH-001`. Nothing was kept, and nothing is left on the server.",
    "",
    ...idTable(file.deleted),
    "",
    "## Spec rules",
    "",
    `${file.rules.join(", ")} (\`spec/db-patches.md\`).`,
    "",
    "## Files",
    "",
    "Each `step-<n>/` folder:",
    "",
    "| File | What |",
    "|---|---|",
    "| `run.json` | the oracle's run record: toolset identity, parameters, host info (`errorMessages` counts the texts on the `error` channel) and the cleanup report (created, deleted, kept) |",
    "| `transcript.jsonl` | every call below `CallAction`: the engine's login, `ValidateUser`, `GetItem`, `ApplyItem`, `ApplyUpdate`. Quote marks are those of the DOM IOM serialises, not of the engine's source literals |",
    "| `messages.jsonl` | the engine's messages, by channel |",
    "| `engine.log` | the engine's own log |",
    "| `host.log` | the host's console output |",
    "| `input/` | the manifest and the patch file the engine read |",
    "",
    "Times, the run folder's path and the host's `os_user` are those of the recording machine.",
    "",
    `Re-record: \`ARAS_PASSWORD=… npm run oracle:dbpatch-cases -- --only ${file.id} --force\`.`,
    "",
  ].join("\n");
}

export function indexReadme(cases: readonly CaseFile[]): string {
  return [
    "# 14.35 DB patch fixtures",
    "",
    `Recorded from engine 14.35.0.43890 on the dev instance (Aras 12 SP9), by the oracle's \`dbpatch\` command. Every run applies the one committed no-op patch (\`oracle/dbpatch/\`, DBP-070) and deletes the three items it creates: a \`DatabaseUpgrade\` row for release \`${PATCH_RELEASE}\`, an "Applied Updates" item numbered \`${PATCH_NUMBER}\`, and the \`DatabaseUpgradePatch\` link. Each case README lists the ids created and deleted.`,
    "",
    "- The oracle runs no other patch (DBP-071): it checks both files against their committed digests, refuses another tool name, and needs release `99.99` and the number to be absent first.",
    "- The engine accepts the login `root` only; the `non-root` case logs in as `admin`.",
    "- Not here: a patch with an XML declaration (DBP-092), a failing patch or a malformed manifest. They would need a second, uncommitted patch, which the guard refuses; they stay rules inferred from the code.",
    "- The dev state a case ran against can change. `run.json` carries the time of each run.",
    "- Re-record with `ARAS_PASSWORD=… npm run oracle:dbpatch-cases` (see `--help`).",
    "",
    "| Case | What | Steps | Calls | Created |",
    "|---|---|---|---|---|",
    ...cases.map(
      (c) =>
        `| [${c.id}](${c.id}/README.md) | ${cell(c.title)} | ${c.steps.length} | ${c.steps.reduce((n, s) => n + (s.result.calls ?? 0), 0)} | ${c.steps.reduce((n, s) => n + s.result.created.length, 0)} |`,
    ),
    "",
  ].join("\n");
}

function recordedCases(): CaseFile[] {
  return DBPATCH_CASES.flatMap((c) => {
    const file = join(CASES_DIR, c.id, "case.json");
    return existsSync(file) ? [JSON.parse(readFileSync(file, "utf8")) as CaseFile] : [];
  });
}

const priorLines = (created: readonly ItemRef[]): string[] => created.map((c) => [c.type, c.id, c.unconfirmed === true ? "1" : "0"].join("\t"));

interface Recorded {
  results: StepResult[];
  deleted: ItemRef[];
}

/** Runs a case's steps into `work/<id>/step-<n>/`. Returns null (and cleans up what the steps created) when a step does not end as its case says. */
async function runCase(c: DbPatchCase, password: string, work: string): Promise<Recorded | null> {
  const results: StepResult[] = [];
  const created: ItemRef[] = [];
  let finished = false;
  let problem: string | null = null;
  try {
    for (const [i, s] of c.steps.entries()) {
      const last = i === c.steps.length - 1;
      const out = join(work, c.id, `step-${i + 1}`);
      const result = await record({
        engine: ENGINE,
        command: "dbpatch",
        url: DEV_SERVER.url,
        database: DEV_SERVER.database,
        user: s.user,
        password,
        out,
        dbpatch: { manifest: join(DBPATCH_DIR, MANIFEST_FILE), folder: DBPATCH_DIR, toolName: TOOL_NAME },
        params: {
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
        error: result.error,
        errorMessages: run.host?.errorMessages ?? 0,
        created: stepCreated,
      };
      results.push(step);
      if (result.remainingSecrets.length > 0) {
        problem = `credential-shaped text survived scrubbing: ${result.remainingSecrets.join(", ")}`;
        break;
      }
      if (!outcomeMatches(s.expect, step)) {
        problem = `step ${i + 1} (${s.name}): expected ${s.expect.kind}, got host exit ${step.hostExit}, ${step.errorMessages} error messages, error ${step.error?.split("\n")[0] ?? "none"}`;
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
          user: "root",
          password,
          out,
          params: { PriorCreated: priorLines(created), DbPatchCleanup: true },
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

function install(c: DbPatchCase, work: string, recorded: Recorded): void {
  const to = join(CASES_DIR, c.id);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const i of c.steps.keys()) cpSync(join(work, c.id, `step-${i + 1}`), join(to, `step-${i + 1}`), { recursive: true });
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
    const unknown = [...only].filter((id) => !DBPATCH_CASES.some((c) => c.id === id));
    if (unknown.length > 0) {
      process.stderr.write(`unknown case: ${unknown.join(", ")}\n`);
      return 64;
    }
  }
  const chosen = DBPATCH_CASES.filter((c) => only === null || only.has(c.id));
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
  const work = mkdtempSync(join(tmpdir(), "libsjs-dbpatch-cases-"));
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
  writeFileSync(join(CASES_DIR, "README.md"), indexReadme(recordedCases()));
  if (failures.length > 0) {
    process.stderr.write(`not as expected: ${failures.join(", ")}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
