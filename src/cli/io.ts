import type { HttpTransport } from "../client/transport.js";

/** What the CLI needs of the process it runs in. Tests give their own. */
export interface CliIo {
  env: Readonly<Record<string, string | undefined>>;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  /** The whole of standard input, for `--password-stdin`. */
  readStdin(): Promise<string>;
  /** The current directory, which the default log path is made in. */
  cwd(): string;
  now(): Date;
  /** The HTTP layer of the connection; the default is the host's (`nodeTransport` on Node). */
  transport?: HttpTransport;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

export function processIo(): CliIo {
  return {
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    readStdin: () => readAll(process.stdin),
    cwd: () => process.cwd(),
    now: () => new Date(),
  };
}
