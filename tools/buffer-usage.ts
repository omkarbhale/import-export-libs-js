/**
 * Which `Buffer` members the library's source calls (roadmap/browser-host.md, D5).
 *
 * The browser bundle replaces Node's `Buffer` with the `buffer` package, and `src/browser/buffer-shim.test.ts` proves the two equal
 * for the calls it lists. This tool finds the calls the source really makes, so that `buffer-usage.test.ts` can fail when the
 * source calls something the suite does not compare. It reads the program with the TypeScript checker, not with a pattern, so a
 * call on a value that merely *has* the type `Buffer` (`readListedFile(path).toString("hex")`) is found as well as `Buffer.from(...)`,
 * and `(16).toString(16)` on a number is not.
 *
 * A usage key is the call, with the encoding where the call takes one:
 *   `Buffer.from(string):utf8`   `Buffer.from(bytes)`   `Buffer.concat`   `#toString:latin1`   `#swap16`
 * `#` is an instance method; `default` stands for an omitted encoding and `dynamic` for one that is not a string literal.
 *
 * Test-only tooling: nothing under `src/` imports it.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface BufferUsage {
  key: string;
  file: string;
  line: number;
}

function isBufferType(type: ts.Type): boolean {
  return type.getSymbol()?.getName() === "Buffer";
}

function encodingOf(argument: ts.Expression | undefined): string {
  if (argument === undefined) return "default";
  if (ts.isStringLiteralLike(argument)) return argument.text;
  return "dynamic";
}

function fromKind(checker: ts.TypeChecker, argument: ts.Expression | undefined): string {
  if (argument === undefined) return "Buffer.from(missing)";
  const type = checker.getTypeAtLocation(argument);
  if (type.flags & ts.TypeFlags.StringLike) return "Buffer.from(string)";
  const name = type.getSymbol()?.getName();
  if (name === "ArrayBuffer" || name === "SharedArrayBuffer") return "Buffer.from(arraybuffer)";
  return "Buffer.from(bytes)";
}

/** Every `Buffer` call in the given source files of `program`. */
export function findBufferUsage(program: ts.Program, files: readonly ts.SourceFile[]): BufferUsage[] {
  const checker = program.getTypeChecker();
  const usages: BufferUsage[] = [];

  for (const sourceFile of files) {
    const add = (node: ts.Node, key: string): void => {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      usages.push({ key, file: path.relative(repoRoot, sourceFile.fileName).split(path.sep).join("/"), line: line + 1 });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const call = ts.isCallExpression(node.parent) && node.parent.expression === node ? node.parent : undefined;
        const member = node.name.text;
        if (ts.isIdentifier(node.expression) && node.expression.text === "Buffer") {
          // A static: `Buffer.from(...)`, `Buffer.concat(...)`.
          const symbol = checker.getSymbolAtLocation(node.expression);
          const isGlobal = symbol === undefined || (symbol.declarations ?? []).every((declaration) => declaration.getSourceFile().isDeclarationFile);
          if (isGlobal) {
            if (member === "from") {
              const kind = fromKind(checker, call?.arguments[0]);
              add(node, kind === "Buffer.from(string)" ? `${kind}:${encodingOf(call?.arguments[1])}` : kind);
            }
            else if (member === "byteLength") add(node, `Buffer.byteLength:${encodingOf(call?.arguments[1])}`);
            else add(node, `Buffer.${member}`);
          }
        } else if (isBufferType(checker.getTypeAtLocation(node.expression))) {
          // An instance member: `buffer.toString("latin1")`, `buffer.swap16()`, `buffer.length`.
          add(node, member === "toString" ? `#toString:${encodingOf(call?.arguments[0])}` : `#${member}`);
        }
      } else if (ts.isIdentifier(node) && node.text === "Buffer") {
        // `Buffer` as a value other than the receiver of a static (`x instanceof Buffer`, `new Buffer(...)`, `const B = Buffer`): the types are not usage.
        const parent = node.parent;
        const isReceiver = ts.isPropertyAccessExpression(parent) && parent.expression === node;
        const isType = ts.isTypeReferenceNode(parent) || ts.isExpressionWithTypeArguments(parent) || ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent);
        const isName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node);
        if (!isReceiver && !isType && !isName && !ts.isTypeNode(parent)) add(node, "Buffer (as a value)");
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return usages;
}

/** A program over `files` with the base compiler options of the repository (Node's types, so `Buffer` is Node's). */
export function programOf(files: readonly string[], overrides?: ts.CompilerHost): ts.Program {
  const read = ts.readConfigFile(path.join(repoRoot, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot, undefined, path.join(repoRoot, "tsconfig.json")).options;
  return ts.createProgram({ rootNames: [...files], options, ...(overrides ? { host: overrides } : {}) });
}

/** The usage of the repo source files (not declarations) of `program` that are in `files`, as repo-relative paths. */
export function usageOfFiles(files: readonly string[]): BufferUsage[] {
  const absolute = files.map((file) => path.join(repoRoot, file));
  const program = programOf(absolute);
  const wanted = new Set(absolute);
  return findBufferUsage(program, program.getSourceFiles().filter((file) => wanted.has(file.fileName)));
}

/** The usage of a snippet, for the scanner's own test: the snippet is compiled as a file of the repo, so Node's types apply. */
export function usageOfText(text: string): BufferUsage[] {
  const virtual = path.join(repoRoot, "src", "__buffer_usage_snippet__.ts");
  const host = ts.createCompilerHost(ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(repoRoot, "tsconfig.json"), ts.sys.readFile).config, ts.sys, repoRoot).options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) => (fileName === virtual ? ts.createSourceFile(fileName, text, languageVersion, true) : getSourceFile(fileName, languageVersion, ...rest));
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileName === virtual || fileExists(fileName);
  const program = programOf([virtual], host);
  return findBufferUsage(program, program.getSourceFiles().filter((file) => file.fileName === virtual));
}
