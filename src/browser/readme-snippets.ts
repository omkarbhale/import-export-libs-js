/**
 * The README's browser snippets, as code a test runs (HOST-282): every `ts` block of the README's `## Browser` section is taken out
 * of the text and run as it is written, so that a snippet that no longer matches the library fails a test instead of a reader.
 *
 * A snippet is plain JavaScript in a `ts` fence: its `import` lines name the package's browser entry, and its other lines run in an
 * async function whose parameters are the names it imports and the names the caller gives it (the snippet's inputs, such as `url`
 * or `file`). The runner adds one line after the snippet, a `return` of the constants the snippet declares at its top level, so that
 * the test can look at what it made. Nothing else of the text is changed.
 *
 * @spec HOST-282
 */

/** The heading of the README section whose snippets run. */
export const README_BROWSER_SECTION = "## Browser";

/** The module specifiers a snippet may import from: the package's browser entry, as a caller writes it. */
export const SNIPPET_MODULES: readonly string[] = ["import-export-libs-js/browser", "import-export-libs-js"];

export interface ReadmeSnippet {
  /** The 1-based line of the README where the snippet's code starts. */
  line: number;
  /** The code as the README has it. */
  code: string;
  /** The names its `import` lines take from the library. */
  imports: string[];
  /** The code without its `import` lines, which is what runs. */
  body: string;
  /** The constants the snippet declares at its top level, in order. */
  declared: string[];
}

export class SnippetError extends Error {
  override name = "SnippetError";
}

/** The text of one section of a Markdown document: from its heading to the next heading of the same or a higher level. */
export function sectionOf(markdown: string, heading: string): { text: string; line: number } {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === heading);
  if (start < 0) throw new SnippetError(`the README has no section "${heading}"`);
  const level = /^#+/.exec(heading)?.[0].length ?? 2;
  let end = lines.length;
  for (let at = start + 1; at < lines.length; at += 1) {
    const marks = /^(#+)\s/.exec(lines[at] ?? "")?.[1];
    if (marks !== undefined && marks.length <= level) {
      end = at;
      break;
    }
  }
  return { text: lines.slice(start, end).join("\n"), line: start + 1 };
}

const IMPORT_LINE = /^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";?\s*$/;

/** The names a top-level `const` declares: `const a =` or `const { a, b: c, ...d } =`. */
function declaredBy(line: string): string[] {
  const simple = /^const\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
  if (simple?.[1] !== undefined) return [simple[1]];
  const pattern = /^const\s*\{([^}]*)\}\s*=/.exec(line);
  if (pattern?.[1] === undefined) return [];
  return pattern[1]
    .split(",")
    .map((part) => part.trim().replace(/^\.\.\./, ""))
    .filter((part) => part !== "")
    .map((part) => (part.includes(":") ? (part.split(":")[1] ?? "") : part).split("=")[0]?.trim() ?? "");
}

/** Every `ts` block of the README's browser section, in order. */
export function readmeSnippets(markdown: string): ReadmeSnippet[] {
  const section = sectionOf(markdown, README_BROWSER_SECTION);
  const lines = section.text.split("\n");
  const snippets: ReadmeSnippet[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    if (lines[at]?.trim() !== "```ts") continue;
    const close = lines.findIndex((line, index) => index > at && line.trim() === "```");
    if (close < 0) throw new SnippetError(`the block at README line ${section.line + at} is not closed`);
    const code = lines.slice(at + 1, close);
    const imports: string[] = [];
    const body: string[] = [];
    for (const line of code) {
      const imported = IMPORT_LINE.exec(line);
      if (imported === null) {
        if (/^import\b/.test(line)) throw new SnippetError(`README line ${section.line + at + 1 + code.indexOf(line)}: an import a snippet may not have: ${line}`);
        body.push(line);
        continue;
      }
      const [, names = "", from = ""] = imported;
      if (!SNIPPET_MODULES.includes(from)) throw new SnippetError(`README line ${section.line + at + 1 + code.indexOf(line)}: a snippet imports only the library's browser entry, not "${from}"`);
      imports.push(...names.split(",").map((name) => name.trim()).filter((name) => name !== ""));
    }
    snippets.push({ line: section.line + at + 1, code: code.join("\n"), imports, body: body.join("\n"), declared: body.flatMap(declaredBy) });
    at = close;
  }
  return snippets;
}

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;

/**
 * Runs a snippet as the README has it. `library` is the module its imports come from (the browser entry); `inputs` are the other names
 * it reads, and may also stand in for a library name (a test gives `createEngineWorker` the Worker file a test page serves). Answers the
 * constants the snippet declared.
 */
export async function runSnippet(snippet: ReadmeSnippet, library: Readonly<Record<string, unknown>>, inputs: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const missing = snippet.imports.filter((name) => !(name in library));
  if (missing.length > 0) throw new SnippetError(`README line ${snippet.line}: the browser entry does not export ${missing.join(", ")}`);
  const scope = new Map<string, unknown>();
  for (const name of snippet.imports) scope.set(name, library[name]);
  for (const [name, value] of Object.entries(inputs)) scope.set(name, value);
  const run = new AsyncFunction(...scope.keys(), `${snippet.body}\nreturn { ${snippet.declared.join(", ")} };`);
  return (await run(...scope.values())) as Record<string, unknown>;
}
