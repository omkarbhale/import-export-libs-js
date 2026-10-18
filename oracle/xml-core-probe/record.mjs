// Records the .NET Framework results for the cases of cases.mjs into fixtures/xml-core/vectors.json.
// Run from WSL at the repository root: `node oracle/xml-core-probe/record.mjs [id-prefix]`. With a prefix it
// re-records only the matching cases and keeps the others as they are. Needs Windows PowerShell 5.1.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cases from "./cases.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, "..", "..", "fixtures", "xml-core", "vectors.json");
const prefix = process.argv[2] ?? "";

const run = (command, args) => execFileSync(command, args, { encoding: "utf8" });
const localAppData = run("powershell.exe", ["-NoProfile", "-Command", "$env:LOCALAPPDATA"]).trim();
const wslPath = (windowsPath) => run("wslpath", ["-u", windowsPath]).trim();
const stageWindows = `${localAppData}\\libsjs-27-probe`;
const stage = wslPath(stageWindows);

const selected = cases.filter((c) => c.id.startsWith(prefix));
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const file of ["Probe.cs", "run.ps1"]) cpSync(join(here, file), join(stage, file));
writeFileSync(join(stage, "cases.json"), JSON.stringify(selected));
try {
  run("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", `${stageWindows}\\run.ps1`,
    "-Cases", `${stageWindows}\\cases.json`, "-Out", `${stageWindows}\\out.json`, "-Work", `${stageWindows}\\work`,
  ]);
  const { info, results } = JSON.parse(readFileSync(join(stage, "out.json"), "utf8"));
  const previous = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : { vectors: [] };
  const recorded = new Map(previous.vectors.map((v) => [v.id, v.expect]));
  for (const result of results) recorded.set(result.id, result.expect);
  const vectors = cases.filter((c) => recorded.has(c.id)).map((c) => ({ ...c, expect: recorded.get(c.id) }));
  mkdirSync(dirname(output), { recursive: true });
  const header = JSON.stringify({ info: prefix ? (previous.info ?? info) : info });
  writeFileSync(output, `${header.slice(0, -1)},"vectors":[\n${vectors.map((v) => JSON.stringify(v)).join(",\n")}\n]}\n`);
  console.log(`recorded ${results.length} of ${cases.length} cases on ${info.clr} / System.Xml ${info.systemXml}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
