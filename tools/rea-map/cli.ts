import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ENGINE_ASSEMBLY_VERSIONS, isEngine } from "../../src/engines.js";
import { buildInventory, hostRoots, type ReaMembers } from "./inventory.js";
import { readAssembly, readPortablePdb } from "./metadata.js";
import { embeddedSources, methodLines } from "./pdb.js";
import { reachable } from "./reachability.js";
import { ILSPY_OPTIONS, ILSPY_VERSION, REA_VERSION, checkVersions, decompile, rea } from "./run.js";
import { sliceMethod, slicePropertyDeclaration } from "./slices.js";
import { byName, mergeBuild, type ReachableMethod, type ReachableSet, type SourceMap } from "./sourcemap.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_MAP = join(ROOT, "spec", "source-map.json");

const USAGE = `Usage:
  npm run rea-map -- build <engine> --dll <Libs.dll> --host <exe> [--host <exe>...] [--ref <dir>]
  npm run rea-map -- diff <old Libs.dll> <new Libs.dll>

build  decompiles the DLL into .decomp/<engine>/, walks the methods its hosts
       can reach, locks each with REA, writes spec/reachable/<engine>.json and
       merges the build into spec/source-map.json (new methods as unmapped).
diff   compares two builds with REA and lists the rule ids whose locks break.`;

const sha256File = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const lines = (text: string) => text.replace(/^﻿/, "").split(/\r?\n/);

function build(engine: string, dllArg: string, hostArgs: string[], refArg: string | undefined): void {
  if (!isEngine(engine)) throw new Error(`unknown engine ${engine}; expected 12.0, 14.0.7 or 14.35`);
  if (hostArgs.length === 0) throw new Error("at least one --host executable is required to seed the walk");
  const dll = resolve(dllArg);
  const work = join(ROOT, ".decomp", ".work", engine);
  const project = join(ROOT, ".decomp", engine);

  checkVersions();
  rmSync(project, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  console.error(`decompiling ${dll} into .decomp/${engine}/`);
  decompile(dll, resolve(refArg ?? dirname(dll)), project, work);

  console.error("reading the member inventory with REA");
  const members = rea("inspect-managed-members", dll);
  writeJson(join(work, "members.json"), members);
  const md = readAssembly(readFileSync(dll));
  const inventory = buildInventory(members.data.normalized_result as ReaMembers, md);
  if (inventory.assemblyName !== "Libs") throw new Error(`${dll} is ${inventory.assemblyName}, not Libs`);
  if (inventory.assemblyVersion !== ENGINE_ASSEMBLY_VERSIONS[engine]) {
    throw new Error(`${dll} is Libs ${inventory.assemblyVersion}; engine ${engine} is ${ENGINE_ASSEMBLY_VERSIONS[engine]}`);
  }

  const roots = hostArgs.flatMap((host) => hostRoots(readAssembly(readFileSync(resolve(host))), inventory));
  const seen = reachable(inventory.graph, roots);
  const methods = inventory.methods.filter((m) => seen.has(m.token) && m.hasBody);
  const missingIl = methods.filter((m) => !m.ilSha256 || !m.bodySha256);
  if (missingIl.length > 0) throw new Error(`REA has no normalized IL for ${missingIl.map((m) => m.fullName).join(", ")}`);

  // ILSpy's PDB embeds each document with one header line above the project file's text.
  const pdb = readPortablePdb(readFileSync(join(work, basename(dll).replace(/\.dll$/i, ".pdb"))));
  const files = new Map<string, string[]>();
  for (const [path, text] of embeddedSources(pdb)) {
    const projectLines = lines(readFileSync(join(project, path), "utf8"));
    const pdbLines = lines(text).slice(1);
    if (projectLines.join("\n") !== pdbLines.join("\n")) {
      throw new Error(`ILSpy's PDB text for ${path} differs from .decomp/${engine}/${path}; line numbers would not match`);
    }
    files.set(path, projectLines);
  }
  const spans = new Map(methodLines(pdb).map((span) => [`0x06${span.rid.toString(16).padStart(6, "0")}`, span]));

  const decomp = new Map<string, NonNullable<ReachableMethod["decomp"]> & { text: string }>();
  for (const method of methods) {
    const span = spans.get(method.token);
    const fileLines = span && files.get(span.document);
    if (!span || !fileLines) continue;
    const slice = sliceMethod(fileLines, span.startLine - 1, span.endLine - 1);
    decomp.set(method.token, { path: span.document, startLine: slice.startLine, endLine: slice.endLine, text: slice.text });
  }
  const typeDocuments = new Map<string, string>();
  for (const method of methods) {
    const span = spans.get(method.token);
    if (span && !typeDocuments.has(method.declaringType)) typeDocuments.set(method.declaringType, span.document);
  }
  for (const method of methods) {
    if (decomp.has(method.token)) continue;
    const path = typeDocuments.get(method.declaringType) ?? `${method.declaringType.replace(/\.([^.]+)$/, "/$1")}.cs`;
    const fileLines = files.get(path);
    const slice = fileLines && slicePropertyDeclaration(fileLines, method.name);
    if (slice) decomp.set(method.token, { path, startLine: slice.startLine, endLine: slice.endLine, text: slice.text });
  }

  console.error(`locking ${decomp.size} of ${methods.length} reachable methods to their C# with REA`);
  const input = {
    static_members: members.data,
    decompiler: { name: "ilspycmd", version: ILSPY_VERSION, family: "ilspy", options: ILSPY_OPTIONS },
    methods: methods.flatMap((m) => {
      const slice = decomp.get(m.token);
      if (!slice) return [];
      return [{
        token: m.token,
        signature_sha256: m.signatureSha256,
        normalized_il_sha256: m.ilSha256,
        reconstruction: {
          kind: "decompiled-csharp",
          language: "csharp",
          text: slice.text,
          source_path: slice.path,
          start_line: slice.startLine,
          end_line: slice.endLine,
        },
      }];
    }),
    notes: [`Slices of ilspycmd ${ILSPY_VERSION} -p output, located through its -genpdb sequence points.`],
  };
  const inputPath = join(work, "reconstruction-input.json");
  writeJson(inputPath, input);
  const imported = rea("import-managed-reconstruction", inputPath).data.normalized_result as {
    methods: { token: string; signature_sha256: string; normalized_il_sha256: string; body_sha256: string; reconstruction: { text_sha256: string } }[];
  };
  const locked = new Map(imported.methods.map((m) => [m.token, m]));

  const set: ReachableSet = {
    $schema: "../reachable.schema.json",
    engine,
    assemblyVersion: inventory.assemblyVersion,
    sha256: inventory.sha256,
    mvid: inventory.mvid,
    generator: { rea: REA_VERSION, ilspycmd: ILSPY_VERSION },
    hosts: hostArgs.map((host) => ({ file: basename(host), sha256: sha256File(resolve(host)) })),
    methods: methods
      .map((m): ReachableMethod => {
        const lock = locked.get(m.token);
        const slice = decomp.get(m.token);
        return {
          fullName: m.fullName,
          signature: m.signature,
          lock: {
            token: m.token,
            signatureSha256: lock?.signature_sha256 ?? m.signatureSha256,
            ilSha256: lock?.normalized_il_sha256 ?? (m.ilSha256 as string),
            bodySha256: lock?.body_sha256 ?? (m.bodySha256 as string),
            ...(lock ? { textSha256: lock.reconstruction.text_sha256 } : {}),
          },
          ...(slice ? { decomp: { path: slice.path, startLine: slice.startLine, endLine: slice.endLine } } : {}),
        };
      })
      .sort(byName),
  };
  mkdirSync(join(ROOT, "spec", "reachable"), { recursive: true });
  writeJson(join(ROOT, "spec", "reachable", `${engine}.json`), set);

  const map = JSON.parse(readFileSync(SOURCE_MAP, "utf8")) as SourceMap;
  const report = mergeBuild(map, set);
  writeJson(SOURCE_MAP, map);

  console.log(`${engine}: ${set.methods.length} reachable methods (${decomp.size} bound to C#) from ${roots.length} host references`);
  console.log(`source-map.json: ${report.added.length} added as unmapped, ${report.removed.length} removed, ${report.relocked.length} relocked`);
  for (const name of report.relocked) console.log(`  relocked (back to unmapped): ${name}`);
  for (const name of report.removed) console.log(`  removed: ${name}`);
}

interface CompareItem {
  status: string;
  left: { token: string; declaring_type: string | null; name: string } | null;
  right: { token: string; declaring_type: string | null; name: string } | null;
}

function diff(oldArg: string, newArg: string): void {
  const comparison = rea("compare-managed-members", resolve(oldArg), resolve(newArg)).data.normalized_result as {
    left: { artifact_sha256: string };
    summary: Record<string, number>;
    methods: CompareItem[];
  };
  const map = JSON.parse(readFileSync(SOURCE_MAP, "utf8")) as SourceMap;
  const build = map.builds.find((b) => b.sha256 === comparison.left.artifact_sha256);
  if (!build) throw new Error(`no build in source-map.json has sha256 ${comparison.left.artifact_sha256}`);

  const byToken = new Map(build.methods.map((m) => [m.lock.token, m]));
  const rules = new Set<string>();
  const broken: string[] = [];
  for (const item of comparison.methods) {
    if (item.status === "unchanged" || item.status === "added" || !item.left) continue;
    const method = byToken.get(item.left.token);
    if (!method) continue;
    for (const rule of method.rules ?? []) rules.add(rule);
    broken.push(`${item.status.padEnd(9)} ${method.fullName} ${method.signature}${method.rules?.length ? `  [${method.rules.join(", ")}]` : ""}`);
  }

  console.log(`REA: ${Object.entries(comparison.summary).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  console.log(`Locks broken among the ${build.methods.length} methods of build ${build.engine}: ${broken.length}`);
  for (const line of broken.sort()) console.log(`  ${line}`);
  console.log(`Rule ids to re-verify: ${rules.size === 0 ? "none" : [...rules].sort().join(", ")}`);
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dll: { type: "string" },
      host: { type: "string", multiple: true },
      ref: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 64;
  }
  if (command === "build" && rest.length === 1 && values.dll) {
    build(rest[0] as string, values.dll, values.host ?? [], values.ref);
    return 0;
  }
  if (command === "diff" && rest.length === 2) {
    diff(rest[0] as string, rest[1] as string);
    return 0;
  }
  console.error(USAGE);
  return 64;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`rea-map: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
