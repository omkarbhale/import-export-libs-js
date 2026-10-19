import type { HttpTransport } from "../client/transport.js";
import type { CliIo } from "./io.js";

export interface TestIo {
  io: CliIo;
  stdout(): string;
  stderr(): string;
}

/** A CLI environment for tests: output is collected, the clock is fixed, and nothing reaches the real process. */
export function testIo(
  options: { env?: Record<string, string>; stdin?: string; cwd?: string; transport?: HttpTransport } = {},
): TestIo {
  let out = "";
  let err = "";
  const io: CliIo = {
    env: options.env ?? {},
    stdout: { write: (text) => void (out += text) },
    stderr: { write: (text) => void (err += text) },
    readStdin: async () => options.stdin ?? "",
    cwd: () => options.cwd ?? "/work",
    now: () => new Date(2026, 9, 19, 8, 5, 3),
    ...(options.transport === undefined ? {} : { transport: options.transport }),
  };
  return { io, stdout: () => out, stderr: () => err };
}
