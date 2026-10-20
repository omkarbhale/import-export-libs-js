import { describe, expect, it } from "vitest";
import { EXPORT_ACTION, LANGUAGE_RESOURCES_ONLY, LANGUAGE_RESOURCES_WITH_METADATA } from "../export/export-context.js";
import { languageOptions, parallelismOption } from "./export-command.js";
import { UsageError } from "./usage.js";

/** `--language-resources` and `--languages` (HOST-031): what the flags put in the engine's context, and what the host refuses (LP-101). */

const values = (entries: Record<string, string>) => entries as never;

describe("export, the language-resource flags (HOST-031, LP-101)", () => {
  it("leaves a plain export alone", () => {
    expect(languageOptions(values({}), "14.0.7")).toEqual({ action: EXPORT_ACTION, languages: null });
    expect(languageOptions(values({}), "14.35")).toEqual({ action: EXPORT_ACTION, languages: null });
  });

  it.for([
    [{ "language-resources": "only", languages: "*" }, LANGUAGE_RESOURCES_ONLY, ["*"]],
    [{ "language-resources": "with-metadata", languages: "en,de" }, LANGUAGE_RESOURCES_WITH_METADATA, ["en", "de"]],
    [{ "language-resources": "only", languages: "*,de" }, LANGUAGE_RESOURCES_ONLY, ["*", "de"]],
    [{ "language-resources": "only", languages: "EN,,de,de" }, LANGUAGE_RESOURCES_ONLY, ["EN", "de"]],
    [{ "language-resources": "only", languages: "en, de" }, LANGUAGE_RESOURCES_ONLY, ["en", " de"]],
    [{ languages: "en" }, EXPORT_ACTION, ["en"]],
  ] as const)("%j sets the action and the list the host would", ([given, action, languages]) => {
    expect(languageOptions(values({ ...given }), "14.35")).toEqual({ action, languages });
  });

  it.for([
    [{ "language-resources": "only", languages: "*" }, "12.0", "--language-resources needs --engine 14.35; engine 12.0"],
    [{ "language-resources": "only", languages: "*" }, "14.0.7", "--language-resources needs --engine 14.35; engine 14.0.7"],
    [{ languages: "en" }, "14.0.7", "--languages needs --engine 14.35; engine 14.0.7"],
    [{ "language-resources": "all", languages: "*" }, "14.35", "--language-resources is only or with-metadata, not 'all'"],
    [{ "language-resources": "only" }, "14.35", "--language-resources needs --languages"],
    [{ "language-resources": "only", languages: "" }, "14.35", "--languages needs a list of language codes"],
    [{ "language-resources": "only", languages: ",," }, "14.35", "--languages needs a list of language codes"],
    [{ "language-resources": "with-metadata", languages: "de,fr" }, "14.35", "--languages must include en"],
    [{ languages: "de" }, "14.35", "--languages must include en"],
  ] as const)("%j on %s is refused: %s", ([given, engine, message]) => {
    expect(() => languageOptions(values({ ...given }), engine)).toThrow(UsageError);
    expect(() => languageOptions(values({ ...given }), engine)).toThrow(message);
  });
});

describe("export, --parallelism (HOST-007)", () => {
  it("is not set unless it is given", () => {
    expect(parallelismOption(values({}), "14.35")).toBeUndefined();
    expect(parallelismOption(values({}), "12.0")).toBeUndefined();
  });

  it.for([
    ["1", 1],
    ["8", 8],
    ["123456789", 123456789],
  ] as const)("reads %s as %d on 14.35", ([text, count]) => {
    expect(parallelismOption(values({ parallelism: text }), "14.35")).toBe(count);
  });

  it.for(["0", "-1", "1.5", "", " 2", "2 ", "1e3", "08", "9999999999", "many"])("refuses '%s' on 14.35", (text) => {
    expect(() => parallelismOption(values({ parallelism: text }), "14.35")).toThrow("--parallelism is a whole number of 1 or more");
  });

  it.for(["12.0", "14.0.7"] as const)("is refused on %s, which exports one item at a time", (engine) => {
    expect(() => parallelismOption(values({ parallelism: "2" }), engine)).toThrow(`--parallelism needs --engine 14.35; engine ${engine}`);
  });
});
