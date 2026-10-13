import { execFileSync, spawn } from "node:child_process";

/**
 * WSL ↔ Windows plumbing. The oracle runs on Windows PowerShell 5.1 through
 * WSL interop; .NET Framework refuses assemblies under `\\wsl.localhost`, so
 * everything it loads or writes lives under %LOCALAPPDATA%.
 */

/** `wslpath` conversions; both directions need the path to be absolute. */
export function toWindowsPath(wslPath: string): string {
  return execFileSync("wslpath", ["-w", wslPath], { encoding: "utf8" }).trim();
}

export function toWslPath(windowsPath: string): string {
  return execFileSync("wslpath", ["-u", windowsPath], { encoding: "utf8" }).trim();
}

let localAppData: string | undefined;

/** The Windows user's %LOCALAPPDATA%, as a Windows path. */
export function windowsLocalAppData(): string {
  if (localAppData === undefined) {
    // cwd on a Windows drive keeps cmd.exe from warning about a UNC working directory.
    const out = execFileSync("cmd.exe", ["/d", "/c", "echo %LOCALAPPDATA%"], { encoding: "utf8", cwd: "/mnt/c" });
    const value = out.trim();
    if (!/^[A-Za-z]:\\/.test(value)) throw new Error(`cannot read %LOCALAPPDATA% through WSL interop (got '${value}')`);
    localAppData = value;
  }
  return localAppData;
}

/** Joins Windows path segments with backslashes. */
export function winJoin(...parts: string[]): string {
  return parts.map((p, i) => (i === 0 ? p.replace(/\\+$/, "") : p.replace(/^\\+|\\+$/g, ""))).join("\\");
}

export interface PowerShellResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a script file under Windows PowerShell 5.1. `env` entries are passed
 * to the Windows process through WSLENV only, never on its command line.
 */
export function runPowerShellFile(
  scriptWindowsPath: string,
  env: Record<string, string>,
  onOutput: (chunk: string) => void,
): Promise<PowerShellResult> {
  const names = Object.keys(env);
  const wslenv = [...names, ...(process.env.WSLENV ? [process.env.WSLENV] : [])].join(":");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptWindowsPath],
      { cwd: "/mnt/c", env: { ...process.env, ...env, WSLENV: wslenv }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      onOutput(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
      onOutput(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
