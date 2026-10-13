import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import ts from "typescript";

/**
 * Enforces spec/README.md: every reachable method mapped, every mapped symbol
 * real, and every rule both defined once and cited somewhere.
 */

const RULE_ID = String.raw`(?:EXP|IMP|MAN|WIRE|LP|DBP)-\d{3}(?![\w-])`;
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
}

interface SourceMapMethod {
  fullName: string;
  signature: string;
  status: "mapped" | "not-ported" | "unmapped";
  rules?: string[];
  symbols?: string[];
}

interface SourceMap {
  builds: { engine: string; methods: SourceMapMethod[] }[];
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

    const seenMethods = new Set<string>();
    for (const method of build.methods) {
      const key = `${method.fullName} ${method.signature}`;
      const label = `[${build.engine}] ${method.fullName}`;
      if (seenMethods.has(key)) problems.push(`${label} (${method.signature}) is listed twice`);
      seenMethods.add(key);

      if (method.status === "unmapped") problems.push(`${label} is reachable but unmapped`);
      for (const id of method.rules ?? []) cite(id, `source-map.json ${label}`);
      if (method.status === "mapped") {
        for (const symbol of method.symbols ?? []) {
          const missing = checkSymbol(symbol, input.srcFiles);
          if (missing) problems.push(`${label} maps to ${symbol}, but ${missing}`);
        }
      }
    }
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

  return {
    sourceMap: JSON.parse(read("spec/source-map.json").text),
    schema: JSON.parse(read("spec/source-map.schema.json").text) as object,
    areaDocs: specDocs.filter((name) => name !== "README.md" && name !== "bugs.md").map((name) => read(`spec/${name}`)),
    bugs: read("spec/bugs.md"),
    srcFiles: listTs(root, join(root, "src")).map(read),
  };
}

function listTs(root: string, dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listTs(root, full);
    return entry.name.endsWith(".ts") ? [relative(root, full).split(sep).join("/")] : [];
  });
}
