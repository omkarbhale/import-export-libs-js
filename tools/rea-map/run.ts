import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** Runs the pinned external tools: `rea` and `ilspycmd`. */

export const ILSPY_VERSION = "8.2.0.7535";
export const REA_VERSION = "6.4.0";

/** ilspycmd 8.2 targets .NET 6; on a machine with only the .NET 8 SDK it needs to roll forward. */
function dotnetEnv(): NodeJS.ProcessEnv {
  const dotnetRoot = process.env.DOTNET_ROOT ?? join(homedir(), ".dotnet");
  return {
    ...process.env,
    DOTNET_ROOT: dotnetRoot,
    DOTNET_ROLL_FORWARD: "Major",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    PATH: [process.env.PATH, dotnetRoot, join(dotnetRoot, "tools")].filter(Boolean).join(delimiter),
  };
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 30, env: env ?? process.env });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export function checkVersions(): void {
  const rea = run("rea", ["--version"]).trim();
  if (rea !== REA_VERSION) throw new Error(`rea ${REA_VERSION} is required, found ${rea}`);
  const ilspy = run("ilspycmd", ["--version"], dotnetEnv());
  if (!ilspy.includes(`ilspycmd: ${ILSPY_VERSION}`)) {
    throw new Error(`ilspycmd ${ILSPY_VERSION} is required, found:\n${ilspy.trim()}`);
  }
}

/** `ilspycmd -p` (the project tree) and `-genpdb` (the line map) into `outDir`. */
export function decompile(dll: string, referenceDir: string, projectDir: string, pdbDir: string): void {
  const common = ["--disable-updatecheck", "-r", referenceDir];
  run("ilspycmd", [...common, "-p", "-o", projectDir, dll], dotnetEnv());
  run("ilspycmd", [...common, "-genpdb", "-o", pdbDir, dll], dotnetEnv());
}

/** A REA command's full output envelope, `data` included (it is Evidence). */
export function rea(command: string, ...args: string[]): { data: { normalized_result: unknown } & Record<string, unknown> } {
  const stdout = run("rea", [command, ...args, "--format", "json", "--full-output"]);
  const envelope = JSON.parse(stdout) as { ok?: boolean; data?: unknown; error?: unknown };
  if (envelope.ok === false || !envelope.data) {
    throw new Error(`rea ${command} failed: ${JSON.stringify(envelope.error ?? envelope)}`);
  }
  return envelope as { data: { normalized_result: unknown } & Record<string, unknown> };
}

export const ILSPY_OPTIONS = ["-p", "-genpdb", "--disable-updatecheck"];
