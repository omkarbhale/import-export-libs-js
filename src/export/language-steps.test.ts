import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeItemFile, loadXml } from "../xml/index.js";
import type { XmlDocument } from "../xml/index.js";
import {
  addI18nNamespaceToAllRootItems,
  markPropertiesWithTranslationsIfNeeded,
  orderPropertiesWithTranslations,
  removeNotLocalizedProperties,
} from "./language-steps.js";
import { escapeProbe, unescapeProbe } from "./language-probe.js";

/**
 * The four steps that follow the transform in a language export, replayed against `fixtures/export-language/probe-14.35.txt`: sections
 * `MK`, `RM`, `ORD` and `ADD` are the engine's private methods called on in-memory documents (LP-141 to LP-144). The probe prints the
 * input, and the document after the step as the item-file writer writes it, with the BOM and every character outside printable ASCII
 * escaped.
 */
const PROBE = readFileSync(new URL("../../fixtures/export-language/probe-14.35.txt", import.meta.url), "utf8").split("\n");

interface StepCase {
  id: string;
  action: string;
  input: string;
  /** What the probe printed after `out:`, or after `doc:` when the step returned null. */
  output: string;
  returnedNull: boolean;
}

function cases(prefix: string): StepCase[] {
  const found: StepCase[] = [];
  for (let at = 0; at < PROBE.length; at += 1) {
    const header = new RegExp(`^(${prefix}\\d+)(?: action=(\\w+))?$`).exec(PROBE[at] ?? "");
    if (!header) continue;
    const id = header[1] as string;
    const input = (PROBE[at + 1] ?? "").slice(`${id} in : `.length);
    const result = PROBE[at + 2] ?? "";
    const returnedNull = result === `${id} out: <null returned>`;
    const line = returnedNull ? (PROBE[at + 3] ?? "").slice(`${id} doc: `.length) : result.slice(`${id} out: `.length);
    found.push({ id, action: header[2] ?? "ExportLanguageResourcesOnly", input: unescapeProbe(input), output: line.replace(/ \((same|another) document\)$/, ""), returnedNull });
  }
  return found;
}

/** What the probe's `Dump` prints for a document. */
const dump = (doc: XmlDocument): string => {
  const bytes = encodeItemFile(doc);
  return `[BOM]"${escapeProbe(bytes.subarray(3).toString("utf8"))}"`;
};

const load = (text: string): XmlDocument => loadXml(text, { preserveWhitespace: true });

describe("MarkPropertiesWithTranslationsIfNeeded (LP-141)", () => {
  const all = cases("MK");
  it("replays the 20 probe cases", () => expect(all).toHaveLength(20));
  it.each(all)("$id", ({ action, input, output }) => {
    const doc = load(input);
    markPropertiesWithTranslationsIfNeeded(doc, action);
    expect(dump(doc)).toBe(output);
  });
});

describe("RemoveNotLocalizedProperties (LP-142, LP-186)", () => {
  const all = cases("RM");
  it("replays the 24 probe cases", () => expect(all).toHaveLength(24));
  it.each(all)("$id", ({ input, output, returnedNull }) => {
    const doc = load(input);
    const result = removeNotLocalizedProperties(doc);
    if (returnedNull) {
      expect(result).toBeNull();
      expect(dump(doc)).toBe(output);
    } else {
      expect(result).not.toBeNull();
      expect(dump(result as XmlDocument)).toBe(output);
    }
  });
});

describe("OrderPropertiesWithTranslations (LP-143, LP-183)", () => {
  const all = cases("ORD");
  it("replays the 20 probe cases", () => expect(all).toHaveLength(20));
  it.each(all)("$id", ({ action, input, output }) => {
    const doc = load(input);
    orderPropertiesWithTranslations(doc, action);
    expect(dump(doc)).toBe(output);
  });
});

describe("AddI18NNamespaceToAllRootItems (LP-144)", () => {
  const all = cases("ADD");
  it("replays the 11 probe cases", () => expect(all).toHaveLength(11));
  it.each(all)("$id", ({ action, input, output }) => {
    const doc = load(input);
    addI18nNamespaceToAllRootItems(doc, action);
    expect(dump(doc)).toBe(output);
  });
});
