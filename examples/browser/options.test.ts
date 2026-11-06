import { describe, expect, it } from "vitest";
import { DB_PATCHES_USAGE, EXPORT_USAGE, IMPORT_USAGE, LANGUAGE_PACK_USAGE } from "../../src/cli/usage.js";
import { FLAGS_NOT_ON_THE_PAGE, MODES, type Mode, RUN_OPTIONS, optionsOf } from "./options.js";

/**
 * The options of the page are the CLI's flags (HOST-280): every control names its flag, and the flags of a command's usage text are
 * all either a control or on the list of the ones that have none, with the reason.
 *
 * @spec HOST-280
 */

const USAGE: Record<Mode, string> = {
  export: EXPORT_USAGE,
  import: IMPORT_USAGE,
  "language-pack": LANGUAGE_PACK_USAGE,
  "db-patches": DB_PATCHES_USAGE,
};

/** The flags a usage text defines: an option line starts with two spaces and the flag. */
function definedFlags(usage: string): string[] {
  return [...usage.matchAll(/^ {2}(--[a-z][a-z-]*)/gm)].map((match) => match[1] as string);
}

describe("the options of the page and the CLI's flags (HOST-280)", () => {
  it.for(MODES.map((entry) => entry.mode))("%s: every control names a flag of its command", (mode) => {
    const defined = new Set(definedFlags(USAGE[mode]));
    for (const spec of [...optionsOf(mode), ...RUN_OPTIONS]) {
      expect(defined.has(spec.flag), `${spec.key} stands for ${spec.flag}, which ${mode}'s usage text does not define`).toBe(true);
    }
  });

  it.for(MODES.map((entry) => entry.mode))("%s: every flag of the command is a control or says why it is not", (mode) => {
    const known = new Set([...optionsOf(mode), ...RUN_OPTIONS].map((spec) => spec.flag));
    for (const flag of definedFlags(USAGE[mode])) {
      expect(known.has(flag) || flag in FLAGS_NOT_ON_THE_PAGE, `${flag} of ${mode} has no control and is not on the list of those that have none`).toBe(true);
    }
  });

  it.for(MODES.map((entry) => entry.mode))("%s: the choices of a control are the ones the usage text names", (mode) => {
    for (const spec of optionsOf(mode)) {
      for (const choice of spec.choices ?? []) {
        if (choice !== "") expect(USAGE[mode], `${spec.flag} choice ${choice}`).toContain(choice);
      }
    }
  });

  it("has one control per key in a mode, and a help text for each", () => {
    for (const { mode } of MODES) {
      const keys = [...optionsOf(mode), ...RUN_OPTIONS].map((spec) => spec.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const spec of optionsOf(mode)) expect(spec.help.length).toBeGreaterThan(10);
    }
  });

  it("has no flag for the password: it is not an option (HOST-281)", () => {
    for (const { mode } of MODES) {
      for (const spec of [...optionsOf(mode), ...RUN_OPTIONS]) expect(spec.key.toLowerCase()).not.toContain("password");
    }
  });
});
