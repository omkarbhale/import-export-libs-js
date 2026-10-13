import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINES, type Engine } from "../../src/engines.js";
import { MANIFEST_PATH, NATIVE_DIR, listFiles, sha256, type Manifest, type ToolsetEntry } from "./manifest.js";
import { readModuleMvid } from "./pe.js";
import { toWindowsPath } from "./windows.js";

/** Each engine's tool folder on the captain's machine, relative to the Windows Desktop. */
export const TOOLSET_SOURCES: Readonly<Record<Engine, string>> = {
  "12.0": "ImportExport\\12\\Import",
  "14.0.7": "ImportExport\\23\\Import",
  "14.35": "Delete me\\PackageImportExportUtilities35\\Import",
};

/**
 * Source entries that are not part of the toolset. They are the GUI tool's
 * per-user state, not code the engine loads.
 */
const EXCLUDED: readonly { path: string; reason: string }[] = [
  { path: "log/", reason: "the GUI tool's run logs from the captain's machine; not loaded by the engine" },
  { path: "config.xml", reason: "the GUI tool's saved settings (server URL, user, paths); not loaded by the engine" },
];

function isExcluded(path: string): boolean {
  return EXCLUDED.some((e) => (e.path.endsWith("/") ? path.startsWith(e.path) : path === e.path));
}

/** Assembly version read by .NET itself, since the PE reader stops at the MVID. */
function assemblyVersion(wslPath: string): string {
  const windows = toWindowsPath(wslPath).replace(/'/g, "''");
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `[Reflection.AssemblyName]::GetAssemblyName('${windows}').Version.ToString()`],
    { encoding: "utf8", cwd: "/mnt/c" },
  ).trim();
}

/**
 * Replaces `oracle/native/<engine>/` with the tool folder at `from` (minus
 * the excluded entries) and rewrites that engine's manifest entry. This is
 * the only way the vendored toolsets change.
 */
export function vendorToolset(engine: Engine, from: string): ToolsetEntry {
  if (!existsSync(join(from, "Libs.dll")) || !existsSync(join(from, "IOM.dll"))) {
    throw new Error(`${from} has no Libs.dll and IOM.dll`);
  }
  const target = join(NATIVE_DIR, engine);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const files = listFiles(from).filter((p) => !isExcluded(p));
  for (const path of files) cpSync(join(from, path), join(target, path));

  const identity = (name: string) => {
    const mvid = readModuleMvid(readFileSync(join(target, name)));
    if (mvid === null) throw new Error(`${name}: no module MVID`);
    return { version: assemblyVersion(join(from, name)), mvid };
  };
  const entry: ToolsetEntry = {
    source: `Desktop\\${TOOLSET_SOURCES[engine]}`,
    libs: identity("Libs.dll"),
    iom: identity("IOM.dll"),
    excluded: EXCLUDED.filter((e) => listFiles(from).some((p) => (e.path.endsWith("/") ? p.startsWith(e.path) : p === e.path))),
    files: files.map((path) => {
      const bytes = readFileSync(join(target, path));
      return { path, size: statSync(join(target, path)).size, sha256: sha256(bytes) };
    }),
  };

  const manifest: Partial<Manifest["engines"]> = existsSync(MANIFEST_PATH)
    ? (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest).engines
    : {};
  manifest[engine] = entry;
  const ordered = Object.fromEntries(ENGINES.filter((e) => manifest[e]).map((e) => [e, manifest[e]]));
  writeFileSync(MANIFEST_PATH, `${JSON.stringify({ engines: ordered }, null, 2)}\n`);
  return entry;
}
