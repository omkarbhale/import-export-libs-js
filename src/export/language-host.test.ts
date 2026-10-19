import { describe, expect, it } from "vitest";
import { hostLanguageList, hostLanguageProblem, languageResourcesAction } from "./language-host.js";

describe("the language list of the reference host (LP-101)", () => {
  it("splits on commas, drops empty entries and keeps the first of each entry", () => {
    expect(hostLanguageList("en,de")).toEqual(["en", "de"]);
    expect(hostLanguageList(",de,,en,")).toEqual(["de", "en"]);
    expect(hostLanguageList("de,de,en")).toEqual(["de", "en"]);
    expect(hostLanguageList(",,")).toEqual([]);
    expect(hostLanguageList(null)).toEqual([]);
  });

  it("trims nothing and compares exactly", () => {
    expect(hostLanguageList("en, de")).toEqual(["en", " de"]);
    expect(hostLanguageList("de,DE,en")).toEqual(["de", "DE", "en"]);
  });

  it("refuses an empty list in either language mode and accepts it for a plain export", () => {
    const message = "\nParam error : 'langs' list can't be empty";
    expect(hostLanguageProblem("ExportLanguageResourcesOnly", [])).toBe(message);
    expect(hostLanguageProblem("ExportMetadataWithLanguageResources", [])).toBe(message);
    expect(hostLanguageProblem("Export", [])).toBeNull();
  });

  it("requires en unless the list starts with *, ignoring case", () => {
    const message = "'en' language is required for 'langs' list";
    expect(hostLanguageProblem("ExportLanguageResourcesOnly", ["de"])).toBe(message);
    expect(hostLanguageProblem("Export", ["de", "fr"])).toBe(message);
    expect(hostLanguageProblem("ExportLanguageResourcesOnly", ["EN", "de"])).toBeNull();
    expect(hostLanguageProblem("ExportLanguageResourcesOnly", ["*", "de"])).toBeNull();
    expect(hostLanguageProblem("ExportLanguageResourcesOnly", ["de", "*", "en"])).toBeNull();
    expect(hostLanguageProblem("ExportLanguageResourcesOnly", ["de", "*"])).toBe(message);
  });

  it("maps the values of --language-resources to the engine's actions", () => {
    expect(languageResourcesAction("only")).toBe("ExportLanguageResourcesOnly");
    expect(languageResourcesAction("with-metadata")).toBe("ExportMetadataWithLanguageResources");
    expect(languageResourcesAction("both")).toBeUndefined();
  });
});
