import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CASE_ENGINES, DEFAULT_CASE_ENGINE, ENGINE_BUILD, blobsDir, casesDir, recorderCommand, isCaseEngine, type CaseEngine } from "./case-engine.js";
import { readPassword } from "./cli.js";
import { EXPORT_CASES, hostItems, hostOptions, type ExportCase } from "./export-cases.js";
import { SCRATCH_EXPORT_CASES, type ResolvedCase, type SeedRecord } from "./export-scratch-cases.js";
import { DEV_SERVER, record, type ItemRef } from "./record.js";
import { externalizeLargeResponses } from "./transcript.js";

const ENGINE: CaseEngine = DEFAULT_CASE_ENGINE;
/** Where the 14.0.7 cases are committed. */
export const CASES_DIR = casesDir(ENGINE, "export");
/** Shared large responses of the 14.0.7 cases (see transcript.ts). */
export const BLOBS_DIR = blobsDir(ENGINE, "export");

const USAGE = `Usage: npm run oracle:export-cases -- [--engine 14.0.7|12.0] [--only <id>,<id>...] [--force] [--list] [--readme-only]

Records the export fixture cases from export-cases.ts on dev (read-only) into
fixtures/<engine>/export/<case>/ (default engine 14.0.7). A case that is already
recorded is skipped unless --force. The password comes from ARAS_PASSWORD or
stdin. --readme-only rewrites each case's case.json and README.md and the index
from export-cases.ts without running the engine.
`;

/** `case.json`: the case's input and what was recorded. */
export interface CaseFile {
  id: string;
  engine: CaseEngine;
  catalogue: string[];
  title: string;
  exercises: string;
  /** The packages and their items in `Hashtable` insertion order. */
  packages: ExportCase["packages"];
  options: NonNullable<ExportCase["options"]>;
  expectsError: boolean;
  note?: string;
  /** What the recording reported. */
  result: { hostExit: number; calls: number | null; error: string | null };
  /** Cases that need scratch state on dev (ticket 67): the seed the case ran against, and what was deleted afterwards. */
  seed?: SeedRecord;
}

export function caseFile(c: ResolvedCase & Partial<Pick<ExportCase, "expectsError">>, result: CaseFile["result"], seed?: SeedRecord, engine: CaseEngine = ENGINE): CaseFile {
  return {
    id: c.id,
    engine,
    catalogue: c.catalogue,
    title: c.title,
    exercises: c.exercises,
    packages: c.packages,
    options: c.options ?? {},
    expectsError: c.expectsError === true,
    ...(c.note === undefined ? {} : { note: c.note }),
    result,
    ...(seed === undefined ? {} : { seed }),
  };
}

/** A markdown table cell. */
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\t/g, " ");

const idList = (items: readonly ItemRef[]): string[] =>
  items.length === 0 ? ["None."] : ["| # | Type | Id |", "|---|---|---|", ...items.map((i, n) => `| ${n + 1} | ${cell(i.type)} | ${i.id}${i.unconfirmed === true ? " (unconfirmed)" : ""} |`)];

/** The seed section of a scratch-seeded case: which packages were imported, and the ids created and deleted. */
function seedSection(seed: SeedRecord): string[] {
  return [
    "## Seed",
    "",
    `The case exports items that did not exist on dev. The run (seed group \`${seed.group}\`, recipe in \`oracle/src/export-scratch-cases.ts\`) imported scratch packages with the oracle, exported (this case and any others of the group), then deleted everything it had created. The packages are built by \`oracle/src/seed-packages.ts\` and \`oracle/src/import-packages.ts\`, so the seed can be rebuilt byte for byte.`,
    "",
    ...seed.steps.flatMap((s, i) => [
      `### Seed step ${i + 1}: ${s.name} (${s.packages.map((p) => `\`${p}\``).join(", ")}; ${Object.keys(s.options).length === 0 ? "default options" : cell(Object.entries(s.options).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", "))})`,
      "",
      `Created ${s.created.length}, in the order the engine made them:`,
      "",
      ...idList(s.created),
      "",
    ]),
    `### Deleted by the cleanup: ${seed.deleted.length}`,
    "",
    "Newest first; a nested item that went with its parent is not listed. Nothing was kept and nothing is left on the server.",
    "",
    ...idList(seed.deleted),
    "",
  ];
}

export function caseReadme(file: CaseFile): string {
  const options = Object.entries(file.options);
  const items = file.packages.flatMap((p) => p.items.map((i) => ({ package: p.name, ...i })));
  const lines = [
    `# ${file.id}`,
    "",
    file.seed === undefined
      ? `${file.title}. Engine ${file.engine}, export, recorded on dev (read-only). Catalogue: ${file.catalogue.join(", ")} (ticket 05).`
      : `${file.title}. Engine ${file.engine}, export, recorded on dev against scratch state that the run seeded and deleted again (ticket ${file.engine === ENGINE ? "67" : "48"}). Catalogue: ${file.catalogue.join(", ")} (ticket 05).`,
    "",
    "## Exercises",
    "",
    file.exercises,
    "",
    ...(file.note === undefined ? [] : ["## Not covered here", "", file.note, ""]),
    "## Input",
    "",
    "The engine's `selItemsTable` is a `Hashtable` from package to a `Hashtable` of items. The host fills it in this order: a package on its first item, then each item under its id. `run.json` holds the same list as `params.Items`.",
    "",
    "| # | Package | Type | Id | Keyed name |",
    "|---|---|---|---|---|",
    ...items.map((i, n) => `| ${n + 1} | ${cell(i.package)} | ${cell(i.type)} | ${i.id} | ${cell(i.keyedName) || "(empty)"} |`),
    "",
    options.length === 0
      ? "Engine options: none; every one keeps the engine's default."
      : `Engine options: ${options.map(([k, v]) => `\`${k}\` = \`${JSON.stringify(v)}\``).join(", ")}.`,
    "",
    "## Result",
    "",
    file.expectsError
      ? `The run ends in an engine error, which the case pins: host exit ${file.result.hostExit}, ${file.result.calls ?? "?"} calls.`
      : `The export completes: host exit ${file.result.hostExit}, ${file.result.calls ?? "?"} calls.`,
    ...(file.result.error === null ? [] : ["", "```", file.result.error.split("\n")[0]!, "```"]),
    "",
    ...(file.seed === undefined ? [] : seedSection(file.seed)),
    "## Spec rules",
    "",
    "None yet. The spec or build ticket that pins this case adds its rule ids here (mapcheck F11).",
    "",
    "## Files",
    "",
    "| File | What |",
    "|---|---|",
    "| `case.json` | this case's input and result, machine-readable |",
    "| `run.json` | the oracle's run record: toolset identity, parameters, host info |",
    "| `transcript.jsonl` | every call the engine made, in order. A response of 64 KB or more is in `../_blobs/<sha256>.xml`, named by `responseBlob`; `oracle/src/transcript.ts` reads it back |",
    "| `messages.jsonl` | the engine's messages, by channel |",
    "| `engine.log` | the engine's own log |",
    "| `host.log` | the host's console output |",
    "| `output/` | the export folder, byte for byte |",
    "",
    file.seed === undefined
      ? `Re-record: \`ARAS_PASSWORD=… ${recorderCommand("oracle:export-cases", file.engine, `--only ${file.id} --force`)}\`.`
      : `Re-record: \`ARAS_PASSWORD=… ${recorderCommand("oracle:export-scratch-cases", file.engine, `--only ${file.id} --force`)}\` (it seeds, exports and cleans up again).`,
    "",
  ];
  return lines.join("\n");
}

export function indexReadme(cases: readonly CaseFile[], engine: CaseEngine = ENGINE): string {
  return [
    `# ${engine} export fixtures`,
    "",
    `Recorded from engine ${ENGINE_BUILD[engine]} on the dev instance, read-only, from ticket 05's catalogue and option matrix. One folder per case; each README says what the case exercises, its input (the \`Hashtable\` insertion order included) and the spec rules that pin it.`,
    "",
    "- Cases are small: one item, or one small package, per branch, plus multi-package cases for ordering (`p1-*`).",
    "- A response of 64 KB or more is stored once in `_blobs/` and named by `responseBlob` in the transcript; every case begins with the same 2.7 MB list of PackageDefinitions. `oracle/src/transcript.ts` puts them back.",
    `- Cases that need scratch state on dev (cmf_ContentType, cmf_TabularView, dac_DomainDefinition, ac_PolicyAccessItemAttribute, xp-* values, dr \`event_data\`, several \`filter_xml\`, referenced elements, the last-segment collision) are recorded by \`${recorderCommand("oracle:export-scratch-cases", engine)}\` (ticket ${engine === ENGINE ? "67" : "48"}). Each imports \`LIBSJS-SCRATCH-*\` packages, exports, and deletes what it created; its README lists the ids created and deleted.`,
    "- The dev state a case ran against can change. `run.json` carries the time of the run.",
    `- Re-record with \`ARAS_PASSWORD=… ${recorderCommand("oracle:export-cases", engine)}\` (see \`${recorderCommand("oracle:export-cases", engine, "--help")}\`).`,
    "",
    "| Case | Catalogue | What | Calls |",
    "|---|---|---|---|",
    ...cases.map(
      (c) => `| [${c.id}](${c.id}/README.md) | ${c.catalogue.join(", ")} | ${cell(c.title)} | ${c.result.calls ?? "?"} |`,
    ),
    "",
  ].join("\n");
}

export function recordedCases(engine: CaseEngine = ENGINE): CaseFile[] {
  return [...EXPORT_CASES, ...SCRATCH_EXPORT_CASES].flatMap((c) => {
    const file = join(casesDir(engine, "export"), c.id, "case.json");
    return existsSync(file) ? [JSON.parse(readFileSync(file, "utf8")) as CaseFile] : [];
  });
}

/** Deletes the blobs no recorded transcript names any more (a re-recorded case leaves its old ones behind). */
export function pruneBlobs(cases: readonly CaseFile[], engine: CaseEngine = ENGINE): string[] {
  const dir = casesDir(engine, "export");
  const blobs = blobsDir(engine, "export");
  if (!existsSync(blobs)) return [];
  const used = new Set<string>();
  for (const c of cases) {
    for (const line of readFileSync(join(dir, c.id, "transcript.jsonl"), "utf8").split("\n")) {
      if (line === "") continue;
      const blob = (JSON.parse(line) as { responseBlob?: string }).responseBlob;
      if (blob !== undefined) used.add(blob);
    }
  }
  const removed = readdirSync(blobs).filter((f) => !used.has(f.replace(/\.xml$/, "")));
  for (const f of removed) rmSync(join(blobs, f));
  return removed;
}

function install(engine: CaseEngine, c: ExportCase, from: string, result: CaseFile["result"]): void {
  externalizeLargeResponses(join(from, "transcript.jsonl"), blobsDir(engine, "export"));
  const file = caseFile(c, result, undefined, engine);
  writeFileSync(join(from, "case.json"), `${JSON.stringify(file, null, 2)}\n`);
  writeFileSync(join(from, "README.md"), caseReadme(file));
  const to = join(casesDir(engine, "export"), c.id);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(casesDir(engine, "export"), { recursive: true });
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true });
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
  if (!isCaseEngine(engine)) {
    process.stderr.write(`unknown engine: ${engine} (${CASE_ENGINES.join(", ")})\n`);
    return 64;
  }
  const dir = casesDir(engine, "export");
  const only = values.only === undefined ? null : new Set(values.only.split(",").map((s) => s.trim()));
  if (only !== null) {
    const unknown = [...only].filter((id) => !EXPORT_CASES.some((c) => c.id === id));
    if (unknown.length > 0) {
      process.stderr.write(`unknown case: ${unknown.join(", ")}\n`);
      return 64;
    }
  }
  const chosen = EXPORT_CASES.filter((c) => only === null || only.has(c.id));
  if (values.list === true) {
    for (const c of chosen) process.stdout.write(`${c.id}${existsSync(join(dir, c.id, "case.json")) ? "" : "  (not recorded)"}\n`);
    return 0;
  }

  if (values["readme-only"] === true) {
    for (const c of chosen) {
      const caseDir = join(dir, c.id);
      if (!existsSync(join(caseDir, "case.json"))) continue;
      const file = caseFile(c, (JSON.parse(readFileSync(join(caseDir, "case.json"), "utf8")) as CaseFile).result, undefined, engine);
      writeFileSync(join(caseDir, "case.json"), `${JSON.stringify(file, null, 2)}\n`);
      writeFileSync(join(caseDir, "README.md"), caseReadme(file));
    }
    writeFileSync(join(dir, "README.md"), indexReadme(recordedCases(engine), engine));
    return 0;
  }

  const password = readPassword();
  const work = mkdtempSync(join(tmpdir(), "libsjs-export-cases-"));
  const failures: string[] = [];
  try {
    for (const c of chosen) {
      if (values.force !== true && existsSync(join(dir, c.id, "case.json"))) {
        process.stdout.write(`${c.id}: already recorded\n`);
        continue;
      }
      process.stdout.write(`${c.id}: recording\n`);
      const out = resolve(work, c.id);
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
      if (result.remainingSecrets.length > 0) {
        process.stderr.write(`${c.id}: credential-shaped text survived scrubbing:\n  ${result.remainingSecrets.join("\n  ")}\n`);
        return 1;
      }
      const failed = c.expectsError === true ? result.error === null : result.hostExit !== 0 || result.error !== null;
      if (failed) {
        failures.push(c.id);
        process.stderr.write(`${c.id}: not as expected (host exit ${result.hostExit}, error ${result.error?.split("\n")[0] ?? "none"}); not installed, kept at ${out}\n`);
        continue;
      }
      install(engine, c, out, { hostExit: result.hostExit, calls: result.calls, error: result.error });
      process.stdout.write(`${c.id}: ${result.calls ?? "?"} calls\n`);
    }
  } finally {
    // Keep the folders of cases that did not install, for a look.
    if (failures.length === 0) rmSync(work, { recursive: true, force: true });
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
