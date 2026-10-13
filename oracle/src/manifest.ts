import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Engine } from "../../src/engines.js";
import { readModuleMvid } from "./pe.js";

/** `oracle/` in this checkout. */
export const ORACLE_DIR = fileURLToPath(new URL("..", import.meta.url));
export const NATIVE_DIR = join(ORACLE_DIR, "native");
export const MANIFEST_PATH = join(NATIVE_DIR, "manifest.json");

export interface ManifestFileEntry {
  /** Relative to `native/<engine>/`, forward slashes. */
  path: string;
  size: number;
  sha256: string;
}

export interface AssemblyIdentity {
  version: string;
  mvid: string;
}

export interface ToolsetEntry {
  /** Where the toolset came from on the captain's machine. */
  source: string;
  libs: AssemblyIdentity;
  iom: AssemblyIdentity;
  /** Source entries left out of the vendored copy, and why. */
  excluded: { path: string; reason: string }[];
  files: ManifestFileEntry[];
}

export interface Manifest {
  engines: Record<Engine, ToolsetEntry>;
}

export function readManifest(path = MANIFEST_PATH): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A short digest over a toolset's file list. It names the staged copy, so a
 * changed toolset never reuses a stale staging folder.
 */
export function toolsetDigest(entry: ToolsetEntry): string {
  const lines = [...entry.files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}\0${f.sha256}\n`)
    .join("");
  return sha256(Buffer.from(lines, "utf8")).slice(0, 12);
}

/** Every regular file under `dir`, as sorted forward-slash relative paths. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Checks a toolset folder against its manifest entry: the exact file set,
 * every size and sha256, and the Libs and IOM MVIDs. Returns the problems
 * found; an empty list means the folder is the recorded toolset.
 */
export function verifyToolset(dir: string, entry: ToolsetEntry): string[] {
  const problems: string[] = [];
  let present: string[];
  try {
    present = listFiles(dir);
  } catch (error) {
    return [`${dir}: cannot list (${(error as Error).message})`];
  }
  const expected = new Map(entry.files.map((f) => [f.path, f]));
  for (const path of present) {
    if (!expected.has(path)) problems.push(`${path}: not in the manifest`);
  }
  for (const file of entry.files) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(dir, file.path));
    } catch {
      problems.push(`${file.path}: missing`);
      continue;
    }
    if (bytes.length !== file.size) problems.push(`${file.path}: size ${bytes.length}, manifest ${file.size}`);
    const digest = sha256(bytes);
    if (digest !== file.sha256) problems.push(`${file.path}: sha256 ${digest}, manifest ${file.sha256}`);
    const mvid = file.path === "Libs.dll" ? entry.libs.mvid : file.path === "IOM.dll" ? entry.iom.mvid : null;
    if (mvid !== null) {
      const actual = readModuleMvid(bytes);
      if (actual !== mvid) problems.push(`${file.path}: MVID ${actual ?? "unreadable"}, manifest ${mvid}`);
    }
  }
  return problems;
}
