import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The ambient-Node ratchet for what is not file I/O (HOST-203): outside the CLI, the Node host and the test tooling, no file of
 * `src/` reads `process`, imports `node:os` or `node:crypto`, or calls `setImmediate`. What is still there is listed with the ticket
 * of the browser map that removes it; the list only ever shrinks.
 *
 * @spec HOST-203
 */
const ALLOWED: Readonly<Record<string, string>> = {};

const AMBIENT = /\bprocess\.[A-Za-z_]|node:os|node:crypto|\bsetImmediate\b/;

function sources(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const exempt = (path: string): boolean =>
  path.startsWith("src/cli/") ||
  path === "src/cli.ts" ||
  path === "src/host/node.ts" ||
  path === "src/host/default-host.ts" ||
  path === "src/host/types.ts" || // type-only: its JSDoc names the Node calls the members replace
  /\.test\.ts$/.test(path) ||
  /probe|replay/.test(path);

describe("HOST-203: the core reads the machine through HostEnv", () => {
  const root = process.cwd();
  const found = sources(join(root, "src"))
    .map((file) => relative(root, file).split("\\").join("/"))
    .filter((path) => !exempt(path))
    .filter((path) => AMBIENT.test(readFileSync(join(root, path), "utf8")));

  it("has no file outside the allowlist that reads the process, node:os or node:crypto, or calls setImmediate", () => {
    expect(found.filter((path) => !(path in ALLOWED))).toEqual([]);
  });

  it("lists in the allowlist only files that still need it", () => {
    expect(Object.keys(ALLOWED).filter((path) => !found.includes(path))).toEqual([]);
  });
});
