import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_ENGINE, ENGINES, isEngine, type Engine } from "../../src/engines.js";
import { NATIVE_DIR, ORACLE_DIR, readManifest, verifyToolset } from "./manifest.js";
import { DEV_SERVER, record, type HostValue } from "./record.js";
import { TOOLSET_SOURCES, vendorToolset } from "./vendor.js";
import { XSL_NAMES, inputsFromPath, inputsFromTranscript, isXslName, recordXsl, type XslInput } from "./xsl.js";
import { toWslPath, windowsLocalAppData } from "./windows.js";

const USAGE = `Usage: npm run oracle -- [--engine 12.0|14.0.7|14.35] <command> [options]

Drives the real engine (Libs.dll) on Windows from WSL and records a scrubbed
fixture folder: run.json, transcript.jsonl, messages.jsonl, engine.log,
host.log, and output/ (export) or input/ (import).

Commands:
  export <type>:<id>:<keyed name>...   --package <name> (required)
  import <package folder>              [--manifest imports.mf] [--packages a,b]
  lpimport <package folder>            --lp-dir <folder> [--lp-config ImportConfig.xml] --lp-package <name>
  xsl <input.xml|folder>...            --xsl export.xsl|build.xsl (required); no server, no password
                                       [--transcript <fixture folder> --seq <n>,<n>...] [--culture <name>]
  verify                               check every vendored toolset against manifest.json
  vendor [--from <wsl folder>]         re-copy the toolset and rewrite its manifest entry

Connection (dev only): --url (${DEV_SERVER.url}), --database (${DEV_SERVER.database}),
  --user (env ARAS_USER, default root). The password comes from env ARAS_PASSWORD,
  or stdin when it is not a terminal; never from a flag or file. import and lpimport take
  LIBSJS-SCRATCH-* packages and items only, and delete what they created when done.
Output: --out <folder> (default oracle/out/<engine>-<command>-<time>).

xsl runs the engine's own embedded stylesheet (read from the staged Libs.dll, never extracted) through
CItemHelper on each input document and records, per case, the input, the transform's text (transform.xml)
and the document after ApplyXsl (applied.xml); an error is recorded instead. A folder's *.xml files are
cases named after the files; --transcript takes the responses of those calls (seq) of a recorded export
as cases named recorded-<seq>. Source whitespace is kept for export.xsl and dropped for build.xsl, as the
engine loads each; override with the two switches. --culture sets the thread culture (xsl:sort uses it).

Engine options (passed to the engine's host; an option the engine lacks is an error):
  --verbose, --manifest-file <path>, --level <n>, --export-referenced-items,
  --ref-to-unknown-packs RemoveSilently|RemoveWithWarning|DoNotRemove, --use-import,
  --merge, --fast, --release <r>, --description <d>, --vault, --lp-debug,
  14.35: --languages a,b, --engine-action <Export|ExportLanguageResourcesOnly|ExportMetadataWithLanguageResources>,
         --aml-batch-mode, --aml-batch-max-size <n>, --collect-import-errors, --collect-import-errors-max-count <n>
Host: --timeout <ms> (600000), --error-question-answer yes|no|none (no)
`;

/** CLI flag -> host parameter, for flags passed straight through. */
const STRING_OPTIONS: Record<string, string> = {
  "manifest-file": "ManifestFile",
  level: "Level",
  "ref-to-unknown-packs": "RefToUnknownPacks",
  release: "Release",
  description: "Description",
  "engine-action": "EngineAction",
  "lp-package": "LPPackage",
  "error-question-answer": "ErrorQuestionAnswer",
};
const NUMBER_OPTIONS: Record<string, string> = {
  timeout: "Timeout",
  "aml-batch-max-size": "AmlBatchMaxSize",
  "collect-import-errors-max-count": "CollectImportErrorsMaxCount",
};
const SWITCH_OPTIONS: Record<string, string> = {
  verbose: "ContextVerbose",
  "export-referenced-items": "ExportReferencedItems",
  "use-import": "UseImport",
  merge: "Merge",
  fast: "Fast",
  vault: "Vault",
  "lp-debug": "LPDebug",
  "aml-batch-mode": "AmlBatchMode",
  "collect-import-errors": "CollectImportErrors",
};
const LIST_OPTIONS: Record<string, string> = { languages: "Languages", packages: "Packages" };

const OPTIONS = {
  engine: { type: "string" },
  url: { type: "string" },
  database: { type: "string" },
  user: { type: "string" },
  out: { type: "string" },
  package: { type: "string" },
  manifest: { type: "string" },
  "lp-dir": { type: "string" },
  "lp-config": { type: "string" },
  from: { type: "string" },
  xsl: { type: "string" },
  transcript: { type: "string" },
  seq: { type: "string" },
  culture: { type: "string" },
  help: { type: "boolean", short: "h" },
  ...Object.fromEntries(
    [...Object.keys(STRING_OPTIONS), ...Object.keys(NUMBER_OPTIONS), ...Object.keys(LIST_OPTIONS)].map((k) => [
      k,
      { type: "string" },
    ]),
  ),
  ...Object.fromEntries(Object.keys(SWITCH_OPTIONS).map((k) => [k, { type: "boolean" }])),
} as const;

type Values = Record<string, string | boolean | undefined>;

/** Turns parsed CLI values into per-engine host parameters. */
export function hostParams(values: Values): Record<string, HostValue> {
  const params: Record<string, HostValue> = {};
  for (const [flag, name] of Object.entries(STRING_OPTIONS)) {
    if (typeof values[flag] === "string") params[name] = values[flag];
  }
  for (const [flag, name] of Object.entries(NUMBER_OPTIONS)) {
    const v = values[flag];
    if (typeof v !== "string") continue;
    if (!/^-?\d+$/.test(v)) throw new UsageError(`--${flag} needs an integer`);
    params[name] = Number(v);
  }
  for (const [flag, name] of Object.entries(SWITCH_OPTIONS)) {
    if (values[flag] === true) params[name] = true;
  }
  for (const [flag, name] of Object.entries(LIST_OPTIONS)) {
    const v = values[flag];
    if (typeof v === "string") params[name] = v.split(",").map((s) => s.trim()).filter((s) => s !== "");
  }
  return params;
}

/** `<type>:<id>:<keyed name>` → the host's tab-separated item spec. The keyed name may contain colons. */
export function exportItem(pkg: string, spec: string): string {
  const match = /^([^:]+):([0-9A-Fa-f]{32}):(.+)$/.exec(spec);
  if (!match) throw new UsageError(`export item '${spec}' is not <type>:<32-hex id>:<keyed name>`);
  return [pkg, match[1], match[2], match[3]].join("\t");
}

class UsageError extends Error {}

export function readPassword(): string {
  const fromEnv = process.env.ARAS_PASSWORD;
  if (fromEnv) return fromEnv;
  if (process.stdin.isTTY) throw new UsageError("set ARAS_PASSWORD or pipe the password on stdin");
  const text = readFileSync(0, "utf8").replace(/\r?\n$/, "");
  if (text === "") throw new UsageError("no password on stdin");
  return text;
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    process.stderr.write(`oracle: ${(error as Error).message}\n\n${USAGE}`);
    return 64;
  }
  const values = parsed.values as Values;
  const [command, ...rest] = parsed.positionals;
  if (values.help === true || command === undefined) {
    process.stdout.write(USAGE);
    return command === undefined && values.help !== true ? 64 : 0;
  }
  const engineValue = (values.engine as string | undefined) ?? DEFAULT_ENGINE;
  if (!isEngine(engineValue)) {
    process.stderr.write(`oracle: unknown engine '${engineValue}' (${ENGINES.join(", ")})\n`);
    return 64;
  }
  const engine: Engine = engineValue;

  try {
    switch (command) {
      case "verify": {
        const manifest = readManifest();
        let failed = false;
        for (const e of values.engine === undefined ? ENGINES : [engine]) {
          const problems = verifyToolset(join(NATIVE_DIR, e), manifest.engines[e]);
          process.stdout.write(problems.length === 0 ? `${e}: ok\n` : `${e}: FAILED\n  ${problems.join("\n  ")}\n`);
          failed ||= problems.length > 0;
        }
        return failed ? 1 : 0;
      }
      case "vendor": {
        const from =
          (values.from as string | undefined) ??
          toWslPath(`${windowsLocalAppData().replace(/\\AppData\\Local$/i, "")}\\Desktop\\${TOOLSET_SOURCES[engine]}`);
        const entry = vendorToolset(engine, from);
        process.stdout.write(`${engine}: vendored ${entry.files.length} files from ${from}\n`);
        return 0;
      }
      case "xsl": {
        const xsl = values.xsl;
        if (typeof xsl !== "string" || !isXslName(xsl)) throw new UsageError(`xsl needs --xsl ${XSL_NAMES.join("|")}`);
        const inputs: XslInput[] = rest.flatMap((path) => inputsFromPath(resolve(path)));
        if (typeof values.transcript === "string") {
          if (typeof values.seq !== "string") throw new UsageError("--transcript needs --seq <n>,<n>...");
          const seqs = values.seq.split(",").map((v) => {
            if (!/^\d+$/.test(v.trim())) throw new UsageError(`--seq '${v}' is not a call number`);
            return Number(v);
          });
          inputs.push(...inputsFromTranscript(resolve(values.transcript), seqs));
        } else if (values.seq !== undefined) {
          throw new UsageError("--seq needs --transcript");
        }
        if (inputs.length === 0) throw new UsageError("xsl needs input documents (files, folders or --transcript)");
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
        const out = resolve((values.out as string | undefined) ?? join(ORACLE_DIR, "out", `${engine}-xsl-${stamp}`));
        const result = await recordXsl({
          engine,
          xsl,
          inputs,
          out,
          ...(typeof values.culture === "string" ? { culture: values.culture } : {}),
        });
        process.stdout.write(`${out}\n${result.cases} cases\n`);
        if (result.remainingSecrets.length > 0) {
          process.stderr.write(`credential-shaped text survived scrubbing:\n  ${result.remainingSecrets.join("\n  ")}\n`);
          return 1;
        }
        return 0;
      }
      case "export":
      case "import":
      case "lpimport": {
        const params = hostParams(values);
        if (command === "export") {
          const pkg = values.package;
          if (typeof pkg !== "string") throw new UsageError("export needs --package <name>");
          if (rest.length === 0) throw new UsageError("export needs at least one <type>:<id>:<keyed name>");
          params.Items = rest.map((spec) => exportItem(pkg, spec));
        } else if (rest.length !== 1) {
          throw new UsageError(`${command} needs one package folder`);
        }
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
        const out = resolve((values.out as string | undefined) ?? join(ORACLE_DIR, "out", `${engine}-${command}-${stamp}`));
        const result = await record({
          engine,
          command,
          url: (values.url as string | undefined) ?? DEV_SERVER.url,
          database: (values.database as string | undefined) ?? DEV_SERVER.database,
          user: (values.user as string | undefined) ?? process.env.ARAS_USER ?? "root",
          password: readPassword(),
          out,
          params,
          ...(command === "export" ? {} : { inputDir: resolve(rest[0]!) }),
          ...(typeof values.manifest === "string" ? { manifestName: values.manifest } : {}),
          ...(typeof values["lp-dir"] === "string" ? { lpDir: resolve(values["lp-dir"]) } : {}),
          ...(typeof values["lp-config"] === "string" ? { lpConfig: values["lp-config"] } : {}),
        });
        process.stdout.write(
          `${out}\nhost exit ${result.hostExit}, ${result.calls ?? "?"} calls${result.error ? `\nengine error: ${result.error.split("\n")[0]}` : ""}\n`,
        );
        let leftBehind = false;
        if (command !== "export") {
          const { cleanup } = result;
          if (cleanup === null) {
            process.stderr.write("the host reported no cleanup; anything this import created is still on the server\n");
            leftBehind = true;
          } else {
            process.stdout.write(
              [
                `cleanup: created ${cleanup.created.length}, deleted ${cleanup.deleted.length}, kept ${cleanup.kept.length}, unverified ${cleanup.unverified.length}`,
                ...cleanup.created.map((c) => `  created ${c.type} ${c.id}${c.unconfirmed ? " (unconfirmed: its call failed in transport)" : ""}`),
                ...cleanup.deleted.map((d) => `  deleted ${d.type} ${d.id}`),
                ...cleanup.kept.map((k) => `  kept ${k.type} ${k.id}: ${k.reason}`),
                ...cleanup.unverified.map((u) => `  unverified ${u.type} ${u.id}`),
              ].join("\n") + "\n",
            );
            if (cleanup.unverified.length > 0) {
              process.stderr.write(
                "unverified items were not found after their call failed in transport; the server may still commit them, so re-check those ids later\n",
              );
            }
            leftBehind = cleanup.kept.length > 0 || cleanup.unverified.length > 0;
          }
        }
        if (result.remainingSecrets.length > 0) {
          process.stderr.write(`credential-shaped text survived scrubbing:\n  ${result.remainingSecrets.join("\n  ")}\n`);
          return 1;
        }
        if (leftBehind) return 1;
        return result.hostExit === 0 ? 0 : result.hostExit === 2 ? 2 : 1;
      }
      default:
        throw new UsageError(`unknown command '${command}'`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`oracle: ${error.message}\n\n${USAGE}`);
      return 64;
    }
    process.stderr.write(`oracle: ${(error as Error).message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
