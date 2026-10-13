import { readFileSync } from "node:fs";
import { DEFAULT_ENGINE, ENGINES } from "./engines.js";

/** Exit codes shared by every command: 0 ok, 1 failed, 2 completed with engine errors, 64 usage. */
export const EXIT = { ok: 0, failed: 1, engineErrors: 2, usage: 64 } as const;

const USAGE = `Usage: aras-pkg <command> [options]

Commands are not implemented yet; this build is the repository scaffold.

Options:
  --help       Show this help
  --version    Show the package version

Engines: ${ENGINES.join(", ")} (default ${DEFAULT_ENGINE})
`;

export function run(argv: readonly string[]): number {
  const [first] = argv;
  if (first === undefined || first === "--help" || first === "-h") {
    process.stdout.write(USAGE);
    return first === undefined ? EXIT.usage : EXIT.ok;
  }
  if (first === "--version") {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    process.stdout.write(`${pkg.version}\n`);
    return EXIT.ok;
  }
  process.stderr.write(`aras-pkg: unknown command '${first}'\n\n${USAGE}`);
  return EXIT.usage;
}
