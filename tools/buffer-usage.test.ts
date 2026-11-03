import { readdirSync } from "node:fs";
import { Buffer as NodeBuffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCases, usageKey } from "../src/browser/buffer-conformance.js";
import { type BufferUsage, usageOfFiles, usageOfText } from "./buffer-usage.js";

// The guard of the Buffer conformance suite (roadmap/browser-host.md, D5 and ticket 14): every Buffer call the source makes must be
// one `src/browser/buffer-shim.test.ts` compares with Node's, so a new Buffer call fails here until the suite covers it. @spec HOST-262
//
// It scans every library source file (everything under `src/` but the CLI, the tests and `src/browser/` itself), not only the files
// `tsconfig.browser.json` lists today: the ratchet list grows to the closure of the browser entry as the seam tickets land, and
// the Buffer calls sit mostly in files that are not on it yet (`client/connection.ts`, `io/windows-fs.ts`, ...). It also reaches
// the helpers no entry point imports (`client/fake-transport.ts`, `manifest/hashtable-cases.ts`), which the browser tests use.
// A call is covered before its file is on the ratchet.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The library's own source files, repo-relative: `src/**` minus the CLI (Node only), the tests, and the conformance harness. */
function librarySources(): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(path.join(repoRoot, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (relative !== "src/cli" && relative !== "src/browser") walk(relative);
      } else if (/\.ts$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name) && !/^src\/cli[-.]/.test(relative)) found.push(relative);
    }
  };
  walk("src");
  return found.sort();
}

const cases = buildCases(NodeBuffer);
const compared = new Set(cases.map((entry) => usageKey(entry.method, entry.encoding)));
/** Keys whose every case documents a difference of the raw shim: the source must not call these directly (it goes through `io/utf8.ts`). */
const forbidden = new Set([...compared].filter((key) => cases.filter((entry) => usageKey(entry.method, entry.encoding) === key).every((entry) => entry.differs !== undefined)));

function describeUsage(usages: BufferUsage[]): string {
  const byKey = new Map<string, string[]>();
  for (const usage of usages) byKey.set(usage.key, [...(byKey.get(usage.key) ?? []), `${usage.file}:${usage.line}`]);
  return [...byKey].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, where]) => `  ${key}  ${where.join(" ")}`).join("\n");
}

describe("Buffer usage scanner", () => {
  it("finds statics, typed instance calls and encodings, and ignores numbers", () => {
    const keys = usageOfText(`
      const a = Buffer.from("x", "base64");
      const b = Buffer.from("x");
      const c = Buffer.from([1, 2, 3]);
      const d = Buffer.from(new ArrayBuffer(4), 1, 2);
      const e = Buffer.concat([a, b], 3);
      const f = Buffer.alloc(4);
      const n: number = 255;
      const g = n.toString(16);
      const h = f.toString("latin1");
      const i = f.swap16().readUInt32BE(0);
      const j = Buffer.from(new Uint8Array(2)).toString();
      const encoding: BufferEncoding = "hex";
      const k = f.toString(encoding);
      const l = new Uint8Array(2).slice(0);
      const m = f.length;
      const o = f.subarray(1);
      const p = Buffer.byteLength("x", "utf16le");
      const q = (x: unknown) => x instanceof Buffer;
      export { a, b, c, d, e, g, h, i, j, k, l, m, o, p, q };
    `).map((usage) => usage.key);
    expect(keys.sort()).toEqual(
      [
        "Buffer.from(string):base64", "Buffer.from(string):default", "Buffer.from(bytes)", "Buffer.from(arraybuffer)", "Buffer.concat", "Buffer.alloc",
        "#toString:latin1", "#swap16", "#readUInt32BE", "Buffer.from(bytes)", "#toString:default", "#toString:dynamic", "#length", "#subarray",
        "Buffer.byteLength:utf16le", "Buffer (as a value)",
      ].sort(),
    );
  });
});

describe("Buffer usage of the library (HOST-262)", () => {
  const files = librarySources();
  const usages = usageOfFiles(files);

  it("calls only what the conformance suite compares", () => {
    const untested = usages.filter((usage) => !compared.has(usage.key));
    expect(
      untested,
      `The source calls Buffer members that src/browser/buffer-shim.test.ts does not compare with Node's.\n${describeUsage(untested)}\nAdd cases for them to src/browser/buffer-conformance.ts (and to src/browser/globals.d.ts if the browser typecheck needs the type), or use a Uint8Array helper.`,
    ).toEqual([]);
  });

  it("does not call a Buffer member the shim is known to get wrong (UTF-8 goes through io/utf8.ts)", () => {
    const direct = usages.filter((usage) => forbidden.has(usage.key));
    expect(direct, `Call utf8Bytes(text) or utf8Text(bytes) from src/io/utf8.ts instead:\n${describeUsage(direct)}`).toEqual([]);
  });

  it("lists what the source calls (the compared set must contain it)", () => {
    expect(usages.length).toBeGreaterThan(0);
    console.info(`Buffer calls in the ${files.length} library source files (${usages.length} calls, ${new Set(usages.map((u) => u.key)).size} distinct):\n${describeUsage(usages)}`);
  });
});
