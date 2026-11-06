import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import ts from "typescript";
import { COMPLETE_ENGINES, ENGINE_ASSEMBLY_VERSIONS, isEngine } from "../src/engines.js";

/**
 * Enforces spec/README.md: every reachable method mapped, every mapped symbol
 * real, and every rule both defined once and cited somewhere. A build's
 * methods and identity must match its generated reachable set
 * (spec/reachable/<engine>.json) and, once vendored, its oracle DLL.
 */

const RULE_ID = String.raw`(?:EXP|IMP|MAN|WIRE|LP|DBP|HOST)-\d{3}(?![\w-])`;
const RULE_HEADING = new RegExp(String.raw`^(#{2,4})\s+(${RULE_ID})\b`);
const ANY_HEADING = /^(#{1,6})\s/;
const VARIANT = /^\s*(?:[-*]\s+)?\[(\d+(?:\.\d+)+)\]/;
const SPEC_TAG = new RegExp(String.raw`@spec((?:[\s,*]+${RULE_ID})+)`, "g");
const RULE_ID_GLOBAL = new RegExp(RULE_ID, "g");
const ENGINES = new Set(["12.0", "14.0.7", "14.35"]);

export interface TextFile {
  /** Repo-relative, forward slashes. */
  path: string;
  text: string;
}

export interface CoverageInput {
  sourceMap: unknown;
  schema: object;
  /** Spec area documents: spec/*.md other than README.md and bugs.md. */
  areaDocs: TextFile[];
  bugs: TextFile;
  /** Every .ts file under src/. */
  srcFiles: TextFile[];
  /** The generated reachable sets, spec/reachable/<engine>.json. */
  reachable: { path: string; data: unknown }[];
  reachableSchema: object;
  /** sha256 of oracle/native/<engine>/Libs.dll, for each engine vendored so far. */
  oracleDigests: Record<string, string>;
  /** COMPLETE_ENGINES from src/engines.ts: engines whose builds may not be in progress. */
  completeEngines: readonly string[];
}

interface SourceMapMethod {
  fullName: string;
  signature: string;
  lock: object;
  status: "mapped" | "not-ported" | "unmapped";
  rules?: string[];
  symbols?: string[];
}

interface Identity {
  engine: string;
  assemblyVersion: string;
  sha256: string;
  mvid: string;
}

interface SourceMapBuild extends Identity {
  inProgress?: boolean;
  methods: SourceMapMethod[];
}

interface SourceMap {
  builds: SourceMapBuild[];
}

interface ReachableSet extends Identity {
  entries?: string[];
  methods: { fullName: string; signature: string; lock: object }[];
}

interface RuleDefinition {
  id: string;
  path: string;
  line: number;
  variants: string[];
}

export function checkCoverage(input: CoverageInput): string[] {
  const problems: string[] = [];

  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(input.schema);
  if (!validate(input.sourceMap)) {
    for (const error of validate.errors ?? []) {
      problems.push(`source-map.json${error.instancePath || ""}: ${error.message ?? "invalid"}`);
    }
    return problems;
  }
  const sourceMap = input.sourceMap as SourceMap;

  // The source-map schema compiled above resolves the reachable schema's $refs.
  const validateReachable = ajv.compile(input.reachableSchema);
  const reachableSets = new Map<string, ReachableSet>();
  for (const file of input.reachable) {
    if (!validateReachable(file.data)) {
      for (const error of validateReachable.errors ?? []) {
        problems.push(`${file.path}${error.instancePath || ""}: ${error.message ?? "invalid"}`);
      }
      continue;
    }
    const set = file.data as ReachableSet;
    if (file.path !== `spec/reachable/${set.engine}.json`) problems.push(`${file.path} holds engine ${set.engine}`);
    reachableSets.set(set.engine, set);
    for (const entry of set.entries ?? []) {
      const member = `::${entry.split("::")[1]}`;
      if (!set.methods.some((m) => m.fullName.endsWith(member))) problems.push(`${file.path}: entry ${entry} reaches no method`);
    }
  }

  const definitions = input.areaDocs.flatMap(parseRules);
  const defined = new Map<string, RuleDefinition>();
  for (const rule of definitions) {
    const first = defined.get(rule.id);
    if (first) {
      problems.push(`${rule.id} is defined twice: ${first.path}:${first.line} and ${rule.path}:${rule.line}`);
      continue;
    }
    defined.set(rule.id, rule);
    if (rule.variants.length === 0) {
      problems.push(`${rule.id} (${rule.path}:${rule.line}) has no engine variant such as [14.0.7]`);
    }
    for (const variant of rule.variants) {
      if (!ENGINES.has(variant)) {
        problems.push(`${rule.id} (${rule.path}:${rule.line}) has a variant for unknown engine [${variant}]`);
      }
    }
  }

  const cited = new Map<string, string>();
  const cite = (id: string, where: string) => {
    if (!cited.has(id)) cited.set(id, where);
  };

  const seenEngines = new Set<string>();
  for (const build of sourceMap.builds) {
    if (seenEngines.has(build.engine)) problems.push(`source-map.json lists engine ${build.engine} twice`);
    seenEngines.add(build.engine);

    problems.push(...checkIdentity(build, reachableSets.get(build.engine), input.oracleDigests[build.engine]));
    const complete = input.completeEngines.includes(build.engine);
    if (build.inProgress && complete) {
      problems.push(`source-map.json build ${build.engine} is inProgress, but src/engines.ts declares engine ${build.engine} complete`);
    }
    const reachableLocks = new Map(
      (reachableSets.get(build.engine)?.methods ?? []).map((m) => [`${m.fullName} ${m.signature}`, m.lock]),
    );

    const seenMethods = new Set<string>();
    for (const method of build.methods) {
      const key = `${method.fullName} ${method.signature}`;
      const label = `[${build.engine}] ${method.fullName}`;
      if (seenMethods.has(key)) problems.push(`${label} (${method.signature}) is listed twice`);
      seenMethods.add(key);

      const lock = reachableLocks.get(key);
      if (reachableSets.has(build.engine) && !lock) {
        problems.push(`${label} (${method.signature}) is not in spec/reachable/${build.engine}.json`);
      } else if (lock && JSON.stringify(sortKeys(lock)) !== JSON.stringify(sortKeys(method.lock))) {
        problems.push(`${label} (${method.signature}) has a lock that differs from spec/reachable/${build.engine}.json`);
      }

      if (method.status === "unmapped" && (!build.inProgress || complete)) problems.push(`${label} is reachable but unmapped`);
      for (const id of method.rules ?? []) cite(id, `source-map.json ${label}`);
      if (method.status === "mapped") {
        for (const symbol of method.symbols ?? []) {
          const missing = checkSymbol(symbol, input.srcFiles);
          if (missing) problems.push(`${label} maps to ${symbol}, but ${missing}`);
        }
      }
    }
    for (const key of reachableLocks.keys()) {
      if (!seenMethods.has(key)) problems.push(`[${build.engine}] ${key} is reachable but missing from source-map.json`);
    }
  }
  for (const engine of reachableSets.keys()) {
    if (!seenEngines.has(engine)) problems.push(`spec/reachable/${engine}.json has no build in source-map.json`);
  }

  for (const file of input.srcFiles) {
    if (isTestFile(file.path)) continue;
    for (const match of file.text.matchAll(SPEC_TAG)) {
      for (const id of match[1]?.match(RULE_ID_GLOBAL) ?? []) cite(id, file.path);
    }
  }

  for (const rule of defined.values()) {
    if (!cited.has(rule.id)) {
      problems.push(`${rule.id} (${rule.path}:${rule.line}) is cited nowhere: no @spec tag and no source-map entry`);
    }
  }
  for (const [id, where] of cited) {
    if (!defined.has(id)) problems.push(`${id} is cited in ${where} but defined in no spec document`);
  }
  for (const rule of parseRules(input.bugs)) {
    if (!defined.has(rule.id)) {
      problems.push(`${rule.id} is registered in ${input.bugs.path}:${rule.line} but defined in no spec document`);
    }
  }

  return problems;
}

/** Unmapped methods of in-progress builds: what is left to map, by engine. */
export function pendingMethods(sourceMap: unknown): string[] {
  const builds = (sourceMap as Partial<SourceMap>).builds ?? [];
  return builds.flatMap((build) =>
    build.inProgress
      ? build.methods.filter((m) => m.status === "unmapped").map((m) => `[${build.engine}] ${m.fullName} ${m.signature}`)
      : [],
  );
}

function checkIdentity(build: Identity, set: Identity | undefined, oracleSha256: string | undefined): string[] {
  const problems: string[] = [];
  const label = `source-map.json build ${build.engine}`;
  const expected = isEngine(build.engine) ? ENGINE_ASSEMBLY_VERSIONS[build.engine] : undefined;
  if (build.assemblyVersion !== expected) {
    problems.push(`${label} has assemblyVersion ${build.assemblyVersion}, but engine ${build.engine} is ${expected}`);
  }
  if (!set) {
    problems.push(`${label} has no generated spec/reachable/${build.engine}.json (run tools/rea-map)`);
  } else {
    for (const field of ["assemblyVersion", "sha256", "mvid"] as const) {
      if (build[field] !== set[field]) {
        problems.push(`${label} has ${field} ${build[field]}, but spec/reachable/${build.engine}.json has ${set[field]}`);
      }
    }
  }
  if (oracleSha256 !== undefined && oracleSha256 !== build.sha256) {
    problems.push(`${label} has sha256 ${build.sha256}, but oracle/native/${build.engine}/Libs.dll is ${oracleSha256}`);
  }
  return problems;
}

function sortKeys(value: object): object {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Rule headings of a Markdown document, ignoring fenced code blocks. */
export function parseRules(doc: TextFile): RuleDefinition[] {
  const rules: RuleDefinition[] = [];
  let current: (RuleDefinition & { level: number }) | undefined;
  let fenced = false;

  doc.text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;

    const heading = ANY_HEADING.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 0;
      if (current && level <= current.level) current = undefined;
      const rule = RULE_HEADING.exec(line);
      if (rule?.[1] && rule[2]) {
        current = { id: rule[2], path: doc.path, line: index + 1, variants: [], level: rule[1].length };
        rules.push(current);
      }
      return;
    }

    const variant = VARIANT.exec(line);
    if (current && variant?.[1] && !current.variants.includes(variant[1])) current.variants.push(variant[1]);
  });

  return rules.map(({ id, path, line, variants }) => ({ id, path, line, variants }));
}

/** Returns why `symbol` does not resolve, or undefined when it does. */
function checkSymbol(symbol: string, srcFiles: TextFile[]): string | undefined {
  const [path = "", name = ""] = symbol.split("#");
  const [exportName = "", member] = name.split(".");
  if (isTestFile(path)) return `${path} is a test file`;
  const file = srcFiles.find((f) => f.path === path);
  if (!file) return `${path} does not exist`;

  const exports = collectExports(file);
  if (!exports.has(exportName)) return `${path} does not export ${exportName}`;
  if (member !== undefined && !memberNames(exports.get(exportName)).has(member)) {
    return `${exportName} in ${path} has no member ${member}`;
  }
  return undefined;
}

type Declaration = ts.Node | undefined;

function collectExports(file: TextFile): Map<string, Declaration> {
  const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const exports = new Map<string, Declaration>();
  const isExported = (node: ts.Node) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exports.set(declaration.name.text, declaration);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name &&
      isExported(statement)
    ) {
      exports.set(statement.name.text, statement);
    } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exports.set(element.name.text, undefined);
    }
  }
  return exports;
}

function memberNames(declaration: Declaration): Set<string> {
  const names = new Set<string>();
  const add = (members: ts.NodeArray<ts.ClassElement | ts.ObjectLiteralElementLike | ts.EnumMember>) => {
    for (const member of members) {
      if (member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) names.add(member.name.text);
    }
  };
  if (!declaration) return names;
  if (ts.isClassDeclaration(declaration)) add(declaration.members);
  if (ts.isEnumDeclaration(declaration)) add(declaration.members);
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    let init: ts.Expression = declaration.initializer;
    while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) {
      init = init.expression;
    }
    if (ts.isObjectLiteralExpression(init)) add(init.properties);
  }
  return names;
}

function isTestFile(path: string): boolean {
  return /\.test\.ts$/.test(path);
}

/** Reads the coverage input from a checkout. */
export function loadCoverageInput(root: string): CoverageInput {
  const read = (path: string): TextFile => ({ path, text: readFileSync(join(root, path), "utf8") });
  const specDocs = readdirSync(join(root, "spec")).filter((name) => name.endsWith(".md"));
  const reachableDir = join(root, "spec", "reachable");
  const reachableFiles = existsSync(reachableDir) ? readdirSync(reachableDir).filter((name) => name.endsWith(".json")) : [];
  const oracleDigests: Record<string, string> = {};
  for (const engine of Object.keys(ENGINE_ASSEMBLY_VERSIONS)) {
    const dll = join(root, "oracle", "native", engine, "Libs.dll");
    if (existsSync(dll)) oracleDigests[engine] = createHash("sha256").update(readFileSync(dll)).digest("hex");
  }

  return {
    sourceMap: JSON.parse(read("spec/source-map.json").text),
    schema: JSON.parse(read("spec/source-map.schema.json").text) as object,
    areaDocs: specDocs.filter((name) => name !== "README.md" && name !== "bugs.md").map((name) => read(`spec/${name}`)),
    bugs: read("spec/bugs.md"),
    // `examples/` is code of the library's own that cites rules too (HOST-280)
    srcFiles: [...listTs(root, join(root, "src")), ...listTs(root, join(root, "examples"))].map(read),
    reachable: reachableFiles.map((name) => {
      const path = `spec/reachable/${name}`;
      return { path, data: JSON.parse(read(path).text) as unknown };
    }),
    reachableSchema: JSON.parse(read("spec/reachable.schema.json").text) as object,
    oracleDigests,
    completeEngines: COMPLETE_ENGINES,
  };
}

function listTs(root: string, dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listTs(root, full);
    return entry.name.endsWith(".ts") ? [relative(root, full).split(sep).join("/")] : [];
  });
}
