/**
 * The browser typecheck ratchet in its final form (map D7, HOST-260): the whole closure of `src/browser.ts` compiles without Node's
 * types.
 *
 * `tsconfig.browser.json` compiles `src/browser.ts` with `types: []`, so `process`, `NodeJS.*`, `setImmediate` and every `node:*`
 * import are compile errors there, and with `moduleSuffixes` of `.browser` first, so that `src/host/default-host.ts` resolves to
 * `default-host.browser.ts`, as the bundle's plugin does (`tools/browser-bundle.ts`). The ratchet began as an explicit list of the
 * files that were clean and grew with each seam ticket until it was the one entry. This tool is what remains of it: it names the
 * files of the closure that touch Node, directly (`imports:node:fs`, `uses:process`) or through a file they import
 * (`imports:<file>`), so that a regression says where it is, not only that `tsc` failed.
 *
 * Test-only tooling: nothing under `src/` imports it, and it is not part of any bundle.
 *
 *   npx tsx tools/browser-closure.ts           print the summary
 */
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The entry point whose closure is analysed (HOST-260). */
export const ENTRY = "src/browser.ts";
/** The hand-written ambient declaration that gives the browser project the `Buffer` of the `buffer` package (HOST-262). */
export const GLOBALS = "src/browser/globals.d.ts";
export const BROWSER_TSCONFIG = "tsconfig.browser.json";

export interface ClosureAnalysis {
  /** Every source file of the closure of `ENTRY` under the browser options, as repo-relative POSIX paths, sorted. */
  closure: string[];
  /** The files of the closure that compile without Node's types, sorted. */
  clean: string[];
  /** Every other file of the closure, with the reason it is not clean; empty while the ratchet holds. */
  dirty: Record<string, string>;
}

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function relative(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function parseOptions(configFile: string): ts.CompilerOptions {
  const read = ts.readConfigFile(path.join(repoRoot, configFile), ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  // The `files` list is what this tool computes, so its "no inputs" and "missing file" diagnostics are beside the point.
  return ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot, undefined, path.join(repoRoot, configFile)).options;
}

function isRepoSource(file: string): boolean {
  return !file.includes("/node_modules/") && file.startsWith(repoRoot + path.sep) && /\.tsx?$/.test(file) && !file.endsWith(".d.ts");
}

/** The closure of `ENTRY`: every repo source file reachable by import (type-only imports included, as `tsc` follows them too). */
function closureOf(entries: readonly string[], options: ts.CompilerOptions): string[] {
  const program = ts.createProgram({ rootNames: entries.map((entry) => path.join(repoRoot, entry)), options });
  return program
    .getSourceFiles()
    .map((file) => file.fileName)
    .filter(isRepoSource)
    .map(relative)
    .sort();
}

/** The repo files each file imports, by module resolution under the browser options. */
function importGraph(files: string[], options: ts.CompilerOptions): Map<string, string[]> {
  const known = new Set(files);
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const absolute = path.join(repoRoot, file);
    const text = readFileSync(absolute, "utf8");
    const targets = new Set<string>();
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
      const resolved = ts.resolveModuleName(imported.fileName, absolute, options, ts.sys).resolvedModule;
      if (!resolved) continue;
      const target = relative(resolved.resolvedFileName);
      if (known.has(target) && target !== file) targets.add(target);
    }
    graph.set(file, [...targets].sort());
  }
  return graph;
}

/** The Node builtins a file imports by name. */
function builtinImports(file: string): string[] {
  const text = readFileSync(path.join(repoRoot, file), "utf8");
  const names = new Set<string>();
  for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
    if (builtins.has(imported.fileName)) names.add(imported.fileName.startsWith("node:") ? imported.fileName : `node:${imported.fileName}`);
  }
  return [...names].sort();
}

/** Why a file does not compile under the browser options by itself: the Node builtins it imports, else the names it uses. */
function directReason(file: string, program: ts.Program): string | undefined {
  const sourceFile = program.getSourceFile(path.join(repoRoot, file));
  if (!sourceFile) throw new Error(`${file} is not in the browser program`);
  const diagnostics = [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)];
  const imports = builtinImports(file);
  if (imports.length > 0) return `imports:${imports.join(",")}`;
  if (diagnostics.length === 0) return undefined;
  const names = new Set<string>();
  const others = new Set<string>();
  for (const diagnostic of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    const name = /^Cannot find name '([^']+)'/.exec(message)?.[1] ?? /^Cannot find namespace '([^']+)'/.exec(message)?.[1];
    if (name) names.add(name);
    else others.add(`TS${diagnostic.code}`);
  }
  return names.size > 0 ? `uses:${[...names].sort().join(",")}` : `error:${[...others].sort().join(",")}`;
}

export function analyze(): ClosureAnalysis {
  const options = parseOptions(BROWSER_TSCONFIG);
  const closure = closureOf([ENTRY], options);
  const rootNames = [GLOBALS, ...closure].map((file) => path.join(repoRoot, file));
  const program = ts.createProgram({ rootNames, options });
  const graph = importGraph(closure, options);

  const dirty: Record<string, string> = {};
  for (const file of closure) {
    const reason = directReason(file, program);
    if (reason) dirty[file] = reason;
  }
  // A file that imports a dirty file pulls it into the program, so it is dirty too: propagate to a fixed point.
  for (let changed = true; changed; ) {
    changed = false;
    for (const file of closure) {
      if (dirty[file]) continue;
      const via = graph.get(file)?.find((target) => dirty[target]);
      if (via) {
        dirty[file] = `imports:${via}`;
        changed = true;
      }
    }
  }
  return { closure, clean: closure.filter((file) => !dirty[file]), dirty };
}

export function readBrowserFiles(): string[] {
  const config = ts.readConfigFile(path.join(repoRoot, BROWSER_TSCONFIG), ts.sys.readFile).config as { files?: string[] };
  return (config.files ?? []).map((file) => file.replace(/^\.\//, ""));
}

export function summary(analysis: ClosureAnalysis): string {
  const lines = [`${analysis.clean.length} of ${analysis.closure.length} files of the closure of ${ENTRY} are clean; ${Object.keys(analysis.dirty).length} remain:`];
  for (const [file, reason] of Object.entries(analysis.dirty)) lines.push(`  ${file}  ${reason}`);
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(summary(analyze()));
}
