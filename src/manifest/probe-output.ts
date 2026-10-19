import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads the `.out` files of `fixtures/manifest/14.0.7/probes/` (and of `14.35/probes/`), which the probe scripts of the real
 * 14.0.7 (14.35) engine wrote:
 * one `label => result` line per case, with strings in the script's `Esc` form (`\\`, `\"`, `\r`, `\n`, `\t`, `\uXXXX`).
 * For the tests only.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/manifest");
const PROBES = join(FIXTURES, "14.0.7/probes");
const PROBES_14_35 = join(FIXTURES, "14.35/probes");

/** The lines of one `## ` section of a probe output (the lines up to the next `## ` heading). */
export function probeSection(file: string, heading: string, engine: "14.0.7" | "14.35" = "14.0.7"): string[] {
  const lines = readFileSync(join(engine === "14.35" ? PROBES_14_35 : PROBES, file), "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${heading}`);
  if (start < 0) throw new Error(`${file} has no section "${heading}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).filter((line) => line.length > 0);
}

/** Every quoted string of a line, unescaped, in order. */
export function quotedStrings(line: string): string[] {
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => unescapeProbe(match[1] as string));
}

export function unescapeProbe(text: string): string {
  return text.replace(/\\(u[0-9A-Fa-f]{4}|.)/g, (_, escape: string) => {
    if (escape.length === 5) return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    if (escape === "r") return "\r";
    if (escape === "n") return "\n";
    if (escape === "t") return "\t";
    return escape;
  });
}

export type ProbeResult = { value: string } | { type: string; message: string };

/** The result of a `label => result` line whose result is one quoted string or `System.Type: "message"`. */
export function resultOf(line: string): ProbeResult {
  const error = /=> (System\.[\w.]+): "((?:[^"\\]|\\.)*)"$/.exec(line);
  if (error) return { type: (error[1] as string).split(".").pop() as string, message: unescapeProbe(error[2] as string) };
  const value = /=> "((?:[^"\\]|\\.)*)"$/.exec(line);
  if (!value) throw new Error(`no result in: ${line}`);
  return { value: unescapeProbe(value[1] as string) };
}

/** Runs `action` and returns what .NET would have printed for it: the value, or the exception's type and message. */
export function observe(action: () => string): ProbeResult {
  try {
    return { value: action() };
  } catch (error) {
    const { name, message } = error as Error;
    return { type: name, message };
  }
}
