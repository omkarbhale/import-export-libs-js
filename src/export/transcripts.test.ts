import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ELEMENT_NODE, attributesOf, innerText, loadXml } from "../xml/index.js";
import type { XmlDocument, XmlElement, XmlNode } from "../xml/index.js";
import { ExportItem, exportFileName } from "./export-item.js";
import { CASES, OTHER_AREAS, caseNames, replayCase } from "./replay-cases.js";
import type { Case } from "./replay-cases.js";
import { transformExport } from "./transform.js";

/**
 * The recorded 14.0.7 export cases replayed through the fetch requests and the rewrites of `export-prexsl.md` (see
 * replay-cases.ts). What the port's rewritten answer becomes after the transform must hold everything the recorded item file
 * holds; the whole of `Export` and the files it writes are compared in export-folders.test.ts.
 */
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

const childElementsOf = (element: XmlElement): XmlElement[] => {
  const found: XmlElement[] = [];
  for (let child: XmlNode | null = element.firstChild; child; child = child.nextSibling) if (child.nodeType === ELEMENT_NODE) found.push(child as XmlElement);
  return found;
};

/**
 * What an item file says, as one string per element: its path of element names, its attributes (sorted) and, for an element with
 * no child element, its text. Only the first `Item` of the `AML` is read: the items after it are the transform's follow-up items.
 */
function signatures(aml: XmlElement): Set<string> {
  const found = new Set<string>();
  const visit = (element: XmlElement, path: string): void => {
    const attributes = attributesOf(element)
      .filter((attribute) => !attribute.name.startsWith("xmlns"))
      .map((attribute) => `${attribute.name}=${attribute.value}`)
      .sort()
      .join(",");
    const children = childElementsOf(element);
    const here = `${path}/${element.tagName}`;
    // the text of a filter is re-wrapped in CDATA by the step after the transform (EXP-405), so only its presence is compared
    const text = children.length === 0 && !FILTER_ELEMENTS.has(element.tagName) ? `=${innerText(element)}` : "";
    found.add(`${here}[${attributes}]${text}`);
    for (const child of children) visit(child, here);
  };
  const first = childElementsOf(aml)[0];
  if (first) visit(first, "");
  return found;
}

/** The elements whose text `CdataFilterXml` rewrites after the transform (EXP-405). */
const FILTER_ELEMENTS = new Set(["condition_xml", "implementation_query"]);

/** The fix items of the transform (`action="edit"` and `"delete"` with a `where`), which the transform's second half writes. */
const FIX_ITEM = /\[(?:[^\]]*,)?action=(?:edit|delete)[,\]]|where=/;

/**
 * Everything the recorded file of an item holds, except the fix items, is in what the transform makes of the rewritten answer.
 * The steps after the transform only take things out of the file or change references in it; the rewrites of `export-prexsl.md` are
 * what put the config ids, the dependency levels, the embedded items and the `set` attributes in it. Returns false when the
 * case wrote no file for the item.
 */
function expectRecordedFile(name: string, item: ExportItem, doc: XmlDocument): boolean {
  const files = walk(join(CASES, name, "output")).filter((path) => path.endsWith(`/${item.typeName}/${exportFileName(item)}`));
  if (files.length !== 1) return false;
  const text = transformExport(doc).replace(' xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"', "");
  const mine = signatures(loadXml(text, { preserveWhitespace: false }).documentElement as XmlElement);
  const recorded = loadXml(readFileSync(files[0] as string, "utf8").replace(/^\uFEFF/, ""), { preserveWhitespace: false });
  const missing = [...signatures(recorded.documentElement as XmlElement)].filter((signature) => !mine.has(signature) && !FIX_ITEM.test(signature));
  expect(missing, `${name}: what the recorded file holds and the rewritten answer lacks`).toEqual([]);
  return true;
}

describe("the recorded 14.0.7 export cases, replayed through the port's fetch requests (EXP-001 to EXP-053)", () => {
  const families = new Map<string, number>();
  let comparedFiles = 0;
  it("has the recorded cases", () => {
    expect(caseNames.length).toBeGreaterThan(70);
  });

  it.each(caseNames)("%s", async (name) => {
    const input = JSON.parse(readFileSync(join(CASES, name, "case.json"), "utf8")) as Case;
    const replay = await replayCase(name);
    for (const family of replay.sent) families.set(family, (families.get(family) ?? 0) + 1);
    expect(replay.leftover.filter((request) => !OTHER_AREAS.some((pattern) => pattern.test(request)))).toEqual([]);
    if (!input.expectsError) expect(replay.sent.length).toBeGreaterThan(0);
    for (const { item, doc } of replay.rewritten) if (expectRecordedFile(name, item, doc)) comparedFiles += 1;
  });

  it("compared the rewritten answer of every item that has a recorded file", () => {
    expect(comparedFiles).toBeGreaterThan(65);
  });

  it("covered every request family at least once", () => {
    expect([...families.keys()].filter((family) => family !== "other").sort()).toEqual(
      ["EXP-010", "EXP-011", "EXP-020", "EXP-040", "EXP-042", "EXP-043", "EXP-044", "EXP-045", "EXP-046", "EXP-048", "EXP-049", "EXP-050", "EXP-051", "EXP-052", "EXP-053"],
    );
  });
});
