import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Engine } from "../../src/engines.js";
import { NATIVE_DIR, ORACLE_DIR, listFiles, sha256, toolsetDigest, verifyToolset, type Manifest } from "./manifest.js";
import { toWslPath, winJoin, windowsLocalAppData } from "./windows.js";

export const HOST_DIR = join(ORACLE_DIR, "host");

export interface StagedDir {
  windows: string;
  wsl: string;
}

/** %LOCALAPPDATA%\import-export-libs-js\oracle: staged toolsets, host scripts and run folders. */
export function oracleWindowsRoot(): string {
  return winJoin(windowsLocalAppData(), "import-export-libs-js", "oracle");
}

/** Fails unless `oracle/native/<engine>/` is exactly the toolset the manifest records. */
export function assertVendoredToolset(engine: Engine, manifest: Manifest): void {
  const problems = verifyToolset(join(NATIVE_DIR, engine), manifest.engines[engine]);
  if (problems.length > 0) {
    throw new Error(`oracle/native/${engine} does not match manifest.json:\n  ${problems.join("\n  ")}`);
  }
}

/**
 * Copies `oracle/native/<engine>/` to `<root>\<engine>-<digest>\` once, and
 * re-checks the staged copy against the manifest on every run. A staged
 * folder that no longer matches is replaced.
 */
export function stageToolset(engine: Engine, manifest: Manifest): StagedDir {
  assertVendoredToolset(engine, manifest);
  const entry = manifest.engines[engine];
  const windows = winJoin(oracleWindowsRoot(), `${engine}-${toolsetDigest(entry)}`);
  const wsl = toWslPath(windows);
  if (existsSync(wsl) && verifyToolset(wsl, entry).length === 0) return { windows, wsl };
  rmSync(wsl, { recursive: true, force: true });
  const partial = `${wsl}.partial-${process.pid}`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  cpSync(join(NATIVE_DIR, engine), partial, { recursive: true });
  const problems = verifyToolset(partial, entry);
  if (problems.length > 0) {
    rmSync(partial, { recursive: true, force: true });
    throw new Error(`staged copy of ${engine} does not match manifest.json:\n  ${problems.join("\n  ")}`);
  }
  renameSync(partial, wsl);
  return { windows, wsl };
}

/** Copies `oracle/host/` to `<root>\host-<digest>\`, keyed by the scripts' content. */
export function stageHost(): StagedDir {
  const files = listFiles(HOST_DIR);
  const digest = sha256(
    Buffer.concat(files.map((f) => Buffer.concat([Buffer.from(`${f}\0`), readFileSync(join(HOST_DIR, f))]))),
  ).slice(0, 12);
  const windows = winJoin(oracleWindowsRoot(), `host-${digest}`);
  const wsl = toWslPath(windows);
  if (!existsSync(wsl)) {
    const partial = `${wsl}.partial-${process.pid}`;
    mkdirSync(partial, { recursive: true });
    cpSync(HOST_DIR, partial, { recursive: true });
    renameSync(partial, wsl);
  }
  return { windows, wsl };
}
