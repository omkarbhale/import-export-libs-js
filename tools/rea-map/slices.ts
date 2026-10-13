/**
 * Turns a method's sequence-point span into the slice of ILSpy's C# that a
 * method lock binds: the whole member for an ordinary method or accessor, and
 * just the expression lines for a lambda that ILSpy inlines into its parent.
 */

export interface Slice {
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** The slice's lines joined with "\n", whatever the file's line endings. */
  text: string;
}

const indent = (line: string): number => /^\t*/.exec(line)?.[0].length ?? 0;
const isBlank = (line: string): boolean => line.trim() === "";

/** Lines that end a declaration scan upward: anything that closes a previous member. */
const endsPrevious = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed === "" || trimmed === "{" || trimmed.endsWith(";") || trimmed.endsWith("}");
};

export function sliceMethod(lines: readonly string[], startLine: number, endLine: number): Slice {
  const at = (n: number) => lines[n - 1] ?? "";
  let start = startLine;
  let end = endLine;

  // The opening brace is the first sequence point itself, or the nearest
  // shallower line above it. Anything else (a lambda inside an expression)
  // keeps the bare span.
  let brace: number | undefined;
  if (at(start).trim() === "{") {
    brace = start;
  } else {
    let n = start - 1;
    while (n >= 1 && (isBlank(at(n)) || indent(at(n)) >= indent(at(start)))) n--;
    if (n >= 1 && at(n).trim() === "{") brace = n;
  }

  if (brace !== undefined) {
    const depth = indent(at(brace));
    start = brace;
    while (start - 1 >= 1 && indent(at(start - 1)) === depth && !endsPrevious(at(start - 1))) start--;
    let close = Math.max(end, brace);
    while (close <= lines.length && !(indent(at(close)) === depth && /^\}[;,)]*$/.test(at(close).trim()))) close++;
    if (close <= lines.length) end = close;
  }

  return { startLine: start, endLine: end, text: lines.slice(start - 1, end).join("\n") };
}

/**
 * Auto-property accessors have no sequence points; their C# is the property's
 * one-line declaration, `Type Name { get; set; }`.
 */
export function slicePropertyDeclaration(lines: readonly string[], accessor: string): Slice | undefined {
  const property = /^[gs]et_(.+)$/.exec(accessor)?.[1];
  if (!property) return undefined;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\s${escaped}\\s*\\{\\s*(?:(?:public|internal|protected|private)\\s+)*[gs]et;`);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) return undefined;
  return { startLine: index + 1, endLine: index + 1, text: lines[index] ?? "" };
}
