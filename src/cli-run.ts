import { readFileSync } from "node:fs";
import { EngineNotSupportedError } from "./client/engine-support.js";
import { applyDbPatchesCommand } from "./cli/db-patches-command.js";
import { exportCommand } from "./cli/export-command.js";
import { importCommand, languagePackCommand } from "./cli/import-command.js";
import { EXIT } from "./cli/exit.js";
import { type CliIo, processIo } from "./cli/io.js";
import { planCommand } from "./cli/plan-command.js";
import { USAGE, UsageError } from "./cli/usage.js";
import { NotSupportedException } from "./xml/errors.js";

export { EXIT };
export type { CliIo };

const COMMANDS: Readonly<Record<string, (args: readonly string[], io: CliIo) => Promise<number>>> = {
  export: exportCommand,
  import: importCommand,
  plan: planCommand,
  "import-language-pack": languagePackCommand,
  "apply-db-patches": applyDbPatchesCommand,
};

/**
 * The CLI: `aras-pkg <command> …`. A usage error is written to standard error and ends with 64. A command that reaches the
 * engine reports its own outcome (0, 1 or 2); an engine without its variant slice is "not yet supported" (1).
 */
export async function run(argv: readonly string[], io: CliIo = processIo()): Promise<number> {
  const [first, ...rest] = argv;
  if (first === undefined || first === "--help" || first === "-h") {
    io.stdout.write(USAGE);
    return first === undefined ? EXIT.usage : EXIT.ok;
  }
  if (first === "--version") {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    io.stdout.write(`${pkg.version}\n`);
    return EXIT.ok;
  }
  const command = Object.hasOwn(COMMANDS, first) ? COMMANDS[first] : undefined;
  if (command === undefined) {
    io.stderr.write(`aras-pkg: unknown command '${first}'\n\n${USAGE}`);
    return EXIT.usage;
  }
  try {
    return await command(rest, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`aras-pkg ${first}: ${error.message}\nRun 'aras-pkg ${first} --help' for the options.\n`);
      return EXIT.usage;
    }
    if (error instanceof EngineNotSupportedError || error instanceof NotSupportedException) {
      io.stderr.write(`aras-pkg ${first}: ${error.message}\n`);
      return EXIT.failed;
    }
    io.stderr.write(`aras-pkg ${first}: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.failed;
  }
}
