import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readPassword } from "./cli.js";
import { outcomeMatches, returnedValue, expectText, type StepResult } from "./record-import-cases.js";
import { LP_CASES, LP_PACKAGE, writePack, type LpCase } from "./language-pack-cases.js";
import { DEV_SERVER, record, type ItemRef } from "./record.js";
import { externalizeLargeResponses } from "./transcript.js";

const ENGINE = "14.35";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** Where the cases are committed. */
export const LP_DIR = join(ROOT, "fixtures", ENGINE, "language-pack");
export const LP_BLOBS_DIR = join(LP_DIR, "_blobs");

const USAGE = `Usage: npm run oracle:lp-cases -- [--only <id>,<id>...] [--force] [--list] [--readme-only]

Records the ${ENGINE} language-pack import cases of language-pack-cases.ts on dev into
fixtures/${ENGINE}/language-pack/<case>/. Dev needs the Languages de and fr and the two scratch
Forums of fixtures/14.0.7/language-pack/setup.aml (applied by hand, removed by teardown.aml).
Each run imports the package ${LP_PACKAGE} only and deletes what it created. The password comes
from ARAS_PASSWORD or stdin.
`;

/** `case.json`: the case's input and what was recorded. */
export interface LpCaseFile {
  case: string;
  engine: typeof ENGINE;
  command: "lpimport";
  title: string;
  lpPackage: string;
  pack: { config: string; rows: string[]; languagesList: string };
  languages?: string[];
  lpDebug: boolean;
  expect: LpCase["expect"];
  exercises: string;
  rules: string[];
  result: StepResult;
  /** What the cleanup deleted, newest first. */
  deleted: ItemRef[];
}

export function lpCaseFile(c: LpCase, result: StepResult, deleted: readonly ItemRef[]): LpCaseFile {
  return {
    case: c.id,
    engine: ENGINE,
    command: "lpimport",
    title: c.title,
    lpPackage: c.lpPackage ?? LP_PACKAGE,
    pack: { config: "lp/ImportConfig.xml", rows: ["lp/xml/Forum.xml"], languagesList: c.languagesList },
    ...(c.languages === undefined ? {} : { languages: c.languages }),
    lpDebug: c.lpDebug === true,
    expect: c.expect,
    exercises: c.exercises,
    rules: c.rules,
    result,
    deleted: [...deleted],
  };
}

export function lpCaseReadme(file: LpCaseFile): string {
  const returned = file.result.returned === null ? "exception" : String(file.result.returned);
  return [
    `# ${file.case}`,
    "",
    `${file.title}. Engine ${file.engine}, \`lpimport\` (ConsoleUpgrade's sequence: \`LanguagePackPreprocessor\`, then \`Action = Import\` on its temp manifest), recorded on dev against the scratch Forums of \`setup.aml\`.`,
    "",
    `- Pack: \`lp/ImportConfig.xml\` (\`languages list="${file.pack.languagesList}"\`, \`Forum\` properties list \`label\`) and \`lp/xml/Forum.xml\` (two scratch \`Forum\` items, \`en\`/\`de\`/\`fr\` labels).`,
    `- Engine call: package \`${file.lpPackage}\`${file.languages === undefined ? ", `Languages` unset" : `, \`Languages\` = ${file.languages.map((l) => `\`${l}\``).join(", ")}`}${file.lpDebug ? ", `LPDebug`" : ""}.`,
    `- Expected: ${expectText(file.expect)}. Recorded: host exit ${file.result.hostExit}, returned ${returned}, ${file.result.calls ?? "?"} calls.`,
    ...(file.result.error === null ? [] : [`- The host ended with an exception: \`${file.result.error.split("\n")[0]}\``]),
    `- ${file.exercises}`,
    `- Rules: ${file.rules.join(", ")}.`,
    "",
    "## Ids created and deleted",
    "",
    file.result.created.length === 0
      ? "Created nothing."
      : `Created ${file.result.created.length}, all deleted by the cleanup (newest first): ${file.deleted.map((d) => `${d.type} ${d.id}`).join(", ")}.`,
    "",
    `Re-record: \`ARAS_PASSWORD=… npm run oracle:lp-cases -- --only ${file.case} --force\`.`,
    "",
  ].join("\n");
}

export function lpIndexReadme(cases: readonly LpCaseFile[]): string {
  return [
    "# 14.35 language-pack import fixtures",
    "",
    `Recorded runs of engine 14.35.0.43890's \`lpimport\` against the dev instance, from \`npm run oracle:lp-cases\`. Cases lp01 to lp05 are ticket 45's 14.0.7 runs (\`fixtures/14.0.7/language-pack/\`) repeated on 14.35 with the same packs; lp06 to lp08 are the 14.35 language selection (\`Languages\`) and the package name with a dot. They back \`spec/language-pack.md\` (\`LP-\` rules) and \`spec/import-languages.md\` (\`IMP-640\`). Each case folder holds the oracle's usual record (\`run.json\`, \`transcript.jsonl\`, \`messages.jsonl\`, \`engine.log\`, \`host.log\`) plus \`lp/\` (the language pack the engine read), \`input/\` (the empty package folder the host is given), \`case.json\` and a README.`,
    "",
    "| Case | What | Calls |",
    "|---|---|---|",
    ...cases.map((c) => `| [${c.case}](${c.case}/README.md) | ${c.title.replace(/\|/g, "\\|")} | ${c.result.calls ?? "?"} |`),
    "",
    "## What was on dev",
    "",
    "- **Languages.** Dev has only `en`. The recording added `de` and `fr` (`fixtures/14.0.7/language-pack/setup.aml`) and deleted both afterwards, so dev has `en` only again (adding a Language makes the server add a `LABEL_<code>` column to every table with a multilingual property).",
    "- **Items.** The packs translate the `label` of the two scratch `Forum` items of `setup.aml`; they were purged, with their Teams, after the last run (`teardown.aml`).",
    "- **Import bookkeeping.** Each run added a `DatabaseUpgrade` and a `PackageDefinition` named `LIBSJS-SCRATCH-LP` and the host deleted both (ids in `run.json` `cleanup`). Nothing of this ticket is left on dev.",
    "- **Not covered.** The `Property` branch of 14.35's preprocessor (`LP-040` to `LP-044`): it needs a pack row whose keyed_name is a Property, which the scratch guard would refuse. The packs are hand-written in the format of `spec/language-pack.md`, as in ticket 45; no stock language pack exists on the captain's machine.",
    "",
  ].join("\n");
}

function recordedCases(): LpCaseFile[] {
  return LP_CASES.flatMap((c) => {
    const file = join(LP_DIR, c.id, "case.json");
    return existsSync(file) ? [JSON.parse(readFileSync(file, "utf8")) as LpCaseFile] : [];
  });
}

/** Deletes the blobs no recorded transcript names any more. */
export function pruneLpBlobs(cases: readonly LpCaseFile[]): string[] {
  if (!existsSync(LP_BLOBS_DIR)) return [];
  const used = new Set<string>();
  for (const c of cases) {
    const text = readFileSync(join(LP_DIR, c.case, "transcript.jsonl"), "utf8");
    for (const line of text.split("\n").filter((l) => l !== "")) {
      const blob = (JSON.parse(line) as { responseBlob?: string }).responseBlob;
      if (blob !== undefined) used.add(blob);
    }
  }
  const removed = readdirSync(LP_BLOBS_DIR).filter((f) => !used.has(f.replace(/\.xml$/, "")));
  for (const f of removed) rmSync(join(LP_BLOBS_DIR, f));
  return removed;
}

async function runCase(c: LpCase, password: string, work: string): Promise<{ file: LpCaseFile; out: string } | null> {
  const pack = join(work, c.id, "lp");
  writePack(pack, c);
  const input = join(work, c.id, "package");
  mkdirSync(input, { recursive: true });
  const out = join(work, c.id, "run");
  const result = await record({
    engine: ENGINE,
    command: "lpimport",
    url: DEV_SERVER.url,
    database: DEV_SERVER.database,
    user: process.env.ARAS_USER ?? "root",
    password,
    out,
    inputDir: input,
    lpDir: pack,
    params: {
      LPPackage: c.lpPackage ?? LP_PACKAGE,
      ...(c.lpDebug === true ? { LPDebug: true } : {}),
      ...(c.languages === undefined ? {} : { Languages: [...c.languages] }),
    },
    log: () => {},
  });
  const run = JSON.parse(readFileSync(join(out, "run.json"), "utf8")) as { host: { result?: string | null } | null };
  const step: StepResult = { hostExit: result.hostExit, calls: result.calls, returned: returnedValue(run.host?.result), error: result.error, created: result.cleanup?.created ?? [] };
  let problem: string | null = null;
  if (result.remainingSecrets.length > 0) problem = `credential-shaped text survived scrubbing: ${result.remainingSecrets.join(", ")}`;
  else if (!outcomeMatches(c.expect, step)) problem = `expected ${c.expect}, got host exit ${step.hostExit}, returned ${step.returned}, error ${step.error?.split("\n")[0] ?? "none"}`;
  else if (result.cleanup === null || result.cleanup.kept.length > 0 || result.cleanup.unverified.length > 0) {
    problem = `the cleanup left items behind: kept ${result.cleanup?.kept.length ?? "?"}, unverified ${result.cleanup?.unverified.length ?? "?"}`;
  }
  if (problem !== null) {
    process.stderr.write(`${c.id}: ${problem}\n`);
    return null;
  }
  return { file: lpCaseFile(c, step, result.cleanup!.deleted), out };
}

function install(c: LpCase, work: string, recorded: { file: LpCaseFile; out: string }): void {
  const to = join(LP_DIR, c.id);
  rmSync(to, { recursive: true, force: true });
  externalizeLargeResponses(join(recorded.out, "transcript.jsonl"), LP_BLOBS_DIR);
  cpSync(recorded.out, to, { recursive: true });
  writeFileSync(join(to, "case.json"), `${JSON.stringify(recorded.file, null, 2)}\n`);
  writeFileSync(join(to, "README.md"), lpCaseReadme(recorded.file));
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
    const unknown = [...only].filter((id) => !LP_CASES.some((c) => c.id === id));
    if (unknown.length > 0) {
      process.stderr.write(`unknown case: ${unknown.join(", ")}\n`);
      return 64;
    }
  }
  const chosen = LP_CASES.filter((c) => only === null || only.has(c.id));
  if (values.list === true) {
    for (const c of chosen) process.stdout.write(`${c.id}${existsSync(join(LP_DIR, c.id, "case.json")) ? "" : "  (not recorded)"}\n`);
    return 0;
  }
  if (values["readme-only"] === true) {
    for (const c of chosen) {
      const dir = join(LP_DIR, c.id);
      if (!existsSync(join(dir, "case.json"))) continue;
      const old = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as LpCaseFile;
      const file = lpCaseFile(c, old.result, old.deleted);
      writeFileSync(join(dir, "case.json"), `${JSON.stringify(file, null, 2)}\n`);
      writeFileSync(join(dir, "README.md"), lpCaseReadme(file));
    }
    writeFileSync(join(LP_DIR, "README.md"), lpIndexReadme(recordedCases()));
    return 0;
  }

  const password = readPassword();
  const work = mkdtempSync(join(tmpdir(), "libsjs-lp-cases-"));
  const failures: string[] = [];
  try {
    for (const c of chosen) {
      if (values.force !== true && existsSync(join(LP_DIR, c.id, "case.json"))) {
        process.stdout.write(`${c.id}: already recorded\n`);
        continue;
      }
      process.stdout.write(`${c.id}: recording\n`);
      const recorded = await runCase(c, password, work);
      if (recorded === null) {
        failures.push(c.id);
        continue;
      }
      install(c, work, recorded);
      process.stdout.write(`${c.id}: ${recorded.file.result.calls ?? "?"} calls, ${recorded.file.deleted.length} deleted\n`);
    }
  } finally {
    if (failures.length === 0) rmSync(work, { recursive: true, force: true });
    else process.stderr.write(`work folder kept at ${resolve(work)}\n`);
  }
  mkdirSync(LP_DIR, { recursive: true });
  const everything = recordedCases();
  const pruned = pruneLpBlobs(everything);
  if (pruned.length > 0) process.stdout.write(`removed ${pruned.length} unused blob${pruned.length === 1 ? "" : "s"}\n`);
  writeFileSync(join(LP_DIR, "README.md"), lpIndexReadme(everything));
  if (failures.length > 0) {
    process.stderr.write(`not as expected: ${failures.join(", ")}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
