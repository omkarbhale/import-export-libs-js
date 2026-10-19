import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Engine } from "../../src/engines.js";
import { sha256 } from "./manifest.js";
import { oracleWindowsRoot, type StagedDir } from "./stage.js";
import { toWslPath, winJoin, windowsLocalAppData } from "./windows.js";

/**
 * Aras's own console tool, `ConsoleUpgrade.exe`, of each toolset. It is not vendored (`oracle/export-modes-probe/README.md`): the
 * export modes of wayfinder ticket 66 run its `ProcessExport` for real, so the oracle reads it from the captain's toolset folder and
 * checks it against the sha256 pinned here before the host loads it. Its `Libs.dll` is not used; the vendored one is, and has the same MVID.
 */
export const CONSOLE_TOOLS: Readonly<Partial<Record<Engine, { desktop: string; sha256: string }>>> = {
  "12.0": { desktop: "ImportExport\\12\\ConsoleUpgrade\\ConsoleUpgrade.exe", sha256: "b00085df94ee5719cef1c12388c60fc69e60c9f2278d7373373192ae810d70d7" },
  "14.0.7": { desktop: "ImportExport\\23\\ConsoleUpgrade\\ConsoleUpgrade.exe", sha256: "10c7ff72613f9784c8edecf5a7c91c775c93d224acc9fde45f662a579ff8a3f8" },
  "14.35": {
    desktop: "Delete me\\PackageImportExportUtilities35\\ConsoleUpgrade\\ConsoleUpgrade.exe",
    sha256: "237f412b4621755683e253ac68b46aae4f7524a8d051f24fac819e060a6736a9",
  },
};

/** Where the captain's toolset keeps the engine's console tool, as a WSL path. */
export function consoleToolSource(engine: Engine): string {
  const tool = CONSOLE_TOOLS[engine];
  if (tool === undefined) throw new Error(`no console tool is pinned for engine ${engine}`);
  const profile = windowsLocalAppData().replace(/\\AppData\\Local$/i, "");
  return toWslPath(`${profile}\\Desktop\\${tool.desktop}`);
}

/**
 * Copies the engine's `ConsoleUpgrade.exe` to `<root>\console-<digest>\` once, after checking it is the pinned build, and
 * returns where it is staged with its digest. A staged copy that no longer matches is replaced.
 */
export function stageConsoleTool(engine: Engine): StagedDir & { sha256: string } {
  const tool = CONSOLE_TOOLS[engine];
  if (tool === undefined) throw new Error(`no console tool is pinned for engine ${engine}`);
  const windows = winJoin(oracleWindowsRoot(), `console-${engine}-${tool.sha256.slice(0, 12)}`, "ConsoleUpgrade.exe");
  const wsl = toWslPath(winJoin(oracleWindowsRoot(), `console-${engine}-${tool.sha256.slice(0, 12)}`)) + "/ConsoleUpgrade.exe";
  if (existsSync(wsl) && sha256(readFileSync(wsl)) === tool.sha256) return { windows, wsl, sha256: tool.sha256 };
  const source = consoleToolSource(engine);
  const actual = sha256(readFileSync(source));
  if (actual !== tool.sha256) throw new Error(`${source} has sha256 ${actual}, not the pinned ${tool.sha256}`);
  rmSync(dirname(wsl), { recursive: true, force: true });
  mkdirSync(dirname(wsl), { recursive: true });
  const partial = `${wsl}.partial-${process.pid}`;
  copyFileSync(source, partial);
  renameSync(partial, wsl);
  return { windows, wsl, sha256: tool.sha256 };
}
