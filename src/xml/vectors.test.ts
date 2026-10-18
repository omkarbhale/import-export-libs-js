import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_NODE,
  CDATA_SECTION_NODE,
  COMMENT_NODE,
  DOCUMENT_NODE,
  DOCUMENT_TYPE_NODE,
  ELEMENT_NODE,
  PROCESSING_INSTRUCTION_NODE,
  TEXT_NODE,
  appendChild,
  attributesOf,
  createElement,
  documentElementOf,
  entityReferenceName,
  innerText,
  getDeclaration,
  isEmpty,
  removeAll,
  setInnerText,
  setIsEmpty,
} from "./dom.js";
import type { XmlDocument, XmlElement, XmlNode } from "./dom.js";
import { getInnerXml, setInnerXml } from "./dom-ops.js";
import { INVALID_FILE_NAME_CHARS } from "./file-names.js";
import { htmlDecode, htmlEncode } from "./html.js";
import { HTML_ENTITIES } from "./html-entities.js";
import { loadXml, parseFragment } from "./parser.js";
import { readAllText } from "./read-text.js";
import { evaluate } from "./xpath.js";
import { xdocumentToString } from "./xdocument.js";
import { ITEM_FILE_SETTINGS, writeDocument, writeNodes } from "./writer-xmlwriter.js";
import { outerXml, saveBytes } from "./writer-legacy.js";

/**
 * Replays fixtures/xml-core/vectors.json: inputs and the results .NET Framework 4.8.1 gave, recorded by
 * oracle/xml-core-probe/ (see its README). Each kind of vector runs one operation of the XML core.
 */

interface ErrorResult {
  type: string;
  message: string;
}

interface Vector {
  id: string;
  kind: string;
  text?: string;
  hex?: string;
  expr?: string;
  path?: string;
  mode?: string;
  preserve?: boolean;
  ns?: boolean;
  ops?: Record<string, unknown>[];
  expect: Record<string, unknown>;
}

const { vectors } = JSON.parse(readFileSync(fileURLToPath(new URL("../../fixtures/xml-core/vectors.json", import.meta.url)), "utf8")) as {
  vectors: Vector[];
};

/** Vectors whose result the port does not reproduce, each with the reason. */
const GAPS: Record<string, string> = {
  "3.doctype-internal": "a DOCTYPE with an internal subset is refused (IMP-016)",
  "wf.213": "a DOCTYPE with an internal subset is refused (IMP-016)",
  "wf.214": "a DOCTYPE with an external identifier is refused (IMP-016); .NET tries to read the file",
  "wf.215": "a DOCTYPE with an external identifier is refused (IMP-016); .NET tries to read the file",
  "xp.123": "xpath keeps a text node and the CDATA next to it apart (xpath.ts)",
  "xp.125": "xpath keeps a text node and the CDATA next to it apart (xpath.ts)",
  "xp.126": "xpath keeps a text node and the CDATA next to it apart (xpath.ts)",
  "xp.143": "number('1.') is NaN in xpath and 1 in .NET; no engine query converts a string to a number",
  "xp.269": "number() of an empty node set is 0 in a product in xpath and NaN in .NET; no engine query does arithmetic",
  "xp.296": "xpath does not read a number that ends in a point; no engine query writes one",
  "xp.151": "xpath writes a large number in full where .NET uses an exponent; no engine query turns a number into a string",
  "xp.152": "xpath writes a small number in full where .NET uses an exponent; no engine query turns a number into a string",
  "xp.153": "xpath writes a large number in full where .NET uses an exponent; no engine query turns a number into a string",
  "xp.order-following": "the following axis of xpath 0.0.34 skips following siblings; no engine query uses it",
  "xp.order-preceding": "the preceding axis of xpath 0.0.34 includes the ancestors; no engine query uses it",
};

// ---------------------------------------------------------------- helpers

const text = (vector: Vector): string => vector.text ?? "";

function dump(doc: XmlDocument): string {
  let out = "";
  const declaration = getDeclaration(doc);
  if (declaration) out += `X(${declaration.version}|${declaration.encoding}|${declaration.standalone})`;
  const visit = (node: XmlNode): void => {
    switch (node.nodeType) {
      case DOCUMENT_NODE:
        for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
        break;
      case DOCUMENT_TYPE_NODE:
        out += `D(${(node as unknown as { name: string }).name}|||)`;
        break;
      case ELEMENT_NODE: {
        const element = node as XmlElement;
        out += `E(${element.tagName}|${element.namespaceURI ?? ""}|${isEmpty(element) ? "1" : "0"}`;
        for (const attribute of attributesOf(element)) out += `|${attribute.name}=${attribute.namespaceURI ?? ""}=${attribute.value}`;
        out += "){";
        for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
        out += "}";
        break;
      }
      case TEXT_NODE:
        out += entityReferenceName(node) !== undefined ? `R(${entityReferenceName(node)})` : `T(${(node as unknown as { data: string }).data})`;
        break;
      case CDATA_SECTION_NODE:
        out += `C(${(node as unknown as { data: string }).data})`;
        break;
      case COMMENT_NODE:
        out += `M(${(node as unknown as { data: string }).data})`;
        break;
      case PROCESSING_INSTRUCTION_NODE: {
        const pi = node as unknown as { target: string; data: string };
        // an XML declaration inside the content of an element is a processing instruction named xml
        const declared = pi.target === "xml" ? /^version="([^"]*)"(?: encoding="([^"]*)")?(?: standalone="([^"]*)")?$/.exec(pi.data) : null;
        out += declared ? `X(${declared[1]}|${declared[2] ?? ""}|${declared[3] ?? ""})` : `P(${pi.target}|${pi.data})`;
        break;
      }
      default:
        out += `?(${node.nodeType})`;
    }
  };
  visit(doc);
  return out;
}

/** Runs the operation and returns its value, or the .NET-style exception it raised. */
function attempt<T>(operation: () => T): { value: T } | { error: ErrorResult } {
  try {
    return { value: operation() };
  } catch (error) {
    if (error instanceof Error) return { error: { type: error.name, message: error.message } };
    throw error;
  }
}

function expectError(actual: { error?: ErrorResult }, expected: ErrorResult): void {
  expect(actual.error).toEqual(expected);
}

function loadWith(vector: Vector, defaultPreserve: boolean): XmlDocument {
  return loadXml(text(vector), { preserveWhitespace: vector.preserve ?? defaultPreserve });
}

// ---------------------------------------------------------------- the kinds

function runLoad(vector: Vector): void {
  const result = attempt(() => loadWith(vector, false));
  const expected = vector.expect as { dump?: string; outer?: string | { error: ErrorResult }; error?: ErrorResult };
  if (expected.error) {
    expectError(result as { error?: ErrorResult }, expected.error);
    return;
  }
  if (!("value" in result)) throw new Error(`${result.error.type}: ${result.error.message}`);
  expect(dump(result.value)).toBe(expected.dump);
  const outer = attempt(() => outerXml(result.value));
  if (typeof expected.outer === "string") expect("value" in outer ? outer.value : outer.error).toBe(expected.outer);
  else expectError(outer as { error?: ErrorResult }, (expected.outer as { error: ErrorResult }).error);
}

function runItemWrite(vector: Vector): void {
  const loaded = attempt(() => loadWith(vector, true));
  const expected = vector.expect as { text?: string; partial?: string; error?: ErrorResult; loadError?: ErrorResult };
  if (expected.loadError) {
    expectError(loaded as { error?: ErrorResult }, expected.loadError);
    return;
  }
  if (!("value" in loaded)) throw new Error(`${loaded.error.type}: ${loaded.error.message}`);
  try {
    const written = writeDocument(loaded.value, ITEM_FILE_SETTINGS);
    expect(expected.error).toBeUndefined();
    expect(written).toBe(expected.text);
  } catch (error) {
    if (!(error instanceof Error) || !expected.error) throw error;
    expect({ type: error.name, message: error.message }).toEqual(expected.error);
    expect((error as { partialOutput?: string }).partialOutput).toBe(expected.partial);
  }
}

function runManifestWrite(vector: Vector): void {
  const loaded = attempt(() => loadWith(vector, false));
  const expected = vector.expect as { hex?: string; error?: ErrorResult; loadError?: ErrorResult };
  if (expected.loadError) {
    expectError(loaded as { error?: ErrorResult }, expected.loadError);
    return;
  }
  if (!("value" in loaded)) throw new Error(`${loaded.error.type}: ${loaded.error.message}`);
  const bytes = attempt(() => saveBytes(loaded.value).toString("hex").toUpperCase());
  if (expected.error) expectError(bytes as { error?: ErrorResult }, expected.error);
  else expect("value" in bytes ? bytes.value : bytes.error).toBe(expected.hex);
}

function runReadBytes(vector: Vector): void {
  const expected = vector.expect as { text: string; load: { dump?: string; error?: ErrorResult } };
  const decoded = readAllText(Buffer.from(vector.hex ?? "", "hex"));
  expect(decoded).toBe(expected.text);
  const loaded = attempt(() => loadXml(decoded, { preserveWhitespace: false }));
  if (expected.load.error) expectError(loaded as { error?: ErrorResult }, expected.load.error);
  else expect("value" in loaded ? dump(loaded.value) : loaded.error).toBe(expected.load.dump);
}

function runXdoc(vector: Vector): void {
  const result = attempt(() => xdocumentToString(text(vector), { disableFormatting: vector.mode === "none" }));
  const expected = vector.expect as { text?: string; error?: ErrorResult };
  if (expected.error) expectError(result as { error?: ErrorResult }, expected.error);
  else expect("value" in result ? result.value : result.error).toBe(expected.text);
}

function runHtml(vector: Vector, encode: boolean): void {
  const expected = (vector.expect as { text: string }).text;
  expect(encode ? htmlEncode(text(vector)) : htmlDecode(text(vector))).toBe(expected);
}

function describeNode(node: XmlNode): string {
  switch (node.nodeType) {
    case ELEMENT_NODE:
      return `element|${(node as XmlElement).tagName}|${outerXml(node)}`;
    case ATTRIBUTE_NODE: {
      const attribute = node as unknown as { name: string; value: string };
      return `attribute|${attribute.name}|${attribute.value}`;
    }
    case TEXT_NODE:
    case CDATA_SECTION_NODE:
      return `text||${(node as unknown as { data: string }).data}`;
    case COMMENT_NODE:
      return `comment||${(node as unknown as { data: string }).data}`;
    case PROCESSING_INSTRUCTION_NODE: {
      const pi = node as unknown as { target: string; data: string };
      return `pi|${pi.target}|${pi.data}`;
    }
    case DOCUMENT_NODE:
      return "root||";
    default:
      return `?${node.nodeType}||`;
  }
}

function runXpath(vector: Vector): void {
  const loaded = attempt(() => loadWith(vector, true));
  const expected = vector.expect as { nodes?: string[]; number?: string; boolean?: boolean; string?: string; error?: ErrorResult; loadError?: ErrorResult };
  if (expected.loadError) {
    expectError(loaded as { error?: ErrorResult }, expected.loadError);
    return;
  }
  if (!("value" in loaded)) throw new Error(`${loaded.error.type}: ${loaded.error.message}`);
  const doc = loaded.value;
  const result = attempt(() => evaluate(vector.expr ?? "", doc));
  if (expected.error) {
    expectError(result as { error?: ErrorResult }, expected.error);
    return;
  }
  if (!("value" in result)) throw new Error(`${result.error.type}: ${result.error.message}`);
  const value = result.value;
  if (expected.nodes) expect(Array.isArray(value) ? value.map(describeNode) : value).toEqual(expected.nodes);
  else if (expected.number !== undefined) {
    const wanted = Number(expected.number);
    if (Number.isNaN(wanted)) expect(Number.isNaN(value as number)).toBe(true);
    else expect(value).toBe(wanted);
  } else if (expected.boolean !== undefined) expect(value).toBe(expected.boolean);
  else expect(value).toBe(expected.string);
}

function runOps(vector: Vector): void {
  const loaded = attempt(() => loadWith(vector, true));
  const expected = vector.expect as {
    dump?: string;
    outer?: string | { error: ErrorResult };
    item?: { text?: string; partial?: string; error?: ErrorResult };
    loadError?: ErrorResult;
    opError?: ErrorResult;
  };
  if (expected.loadError) {
    expectError(loaded as { error?: ErrorResult }, expected.loadError);
    return;
  }
  if (!("value" in loaded)) throw new Error(`${loaded.error.type}: ${loaded.error.message}`);
  const doc = loaded.value;
  const applied = attempt(() => {
    for (const op of vector.ops ?? []) applyOp(doc, op);
  });
  if (expected.opError) {
    expectError(applied as { error?: ErrorResult }, expected.opError);
    return;
  }
  if (!("value" in applied)) throw new Error(`${applied.error.type}: ${applied.error.message}`);
  expect(dump(doc)).toBe(expected.dump);
  const outer = attempt(() => outerXml(doc));
  if (typeof expected.outer === "string") expect("value" in outer ? outer.value : outer.error).toBe(expected.outer);
  else expectError(outer as { error?: ErrorResult }, (expected.outer as { error: ErrorResult }).error);
  const written = attempt(() => writeDocument(doc, ITEM_FILE_SETTINGS));
  if (expected.item?.error) expectError(written as { error?: ErrorResult }, expected.item.error);
  else expect("value" in written ? written.value : written.error).toBe(expected.item?.text);
}

function applyOp(doc: XmlDocument, op: Record<string, unknown>): void {
  const path = String(op["path"]);
  const target = evaluate(path, doc);
  const node = Array.isArray(target) ? target[0] : undefined;
  if (!node) throw new Error(`no node at ${path}`);
  const element = node as XmlElement;
  const value = String(op["value"] ?? "");
  switch (op["op"]) {
    case "innerText":
      setInnerText(element, value);
      break;
    case "innerXml":
      setInnerXml(element, value);
      break;
    case "removeAll":
      removeAll(element);
      break;
    case "removeNode":
      node.parentNode?.removeChild(node);
      break;
    case "setIsEmpty":
      setIsEmpty(element, op["value"] === true);
      break;
    case "append":
      appendChild(element, createElement(doc, String(op["name"])));
      break;
    case "appendText":
      appendChild(element, doc.createTextNode(value));
      break;
    case "appendCData": {
      const section = doc.createCDATASection("x");
      (section as unknown as { data: string }).data = value;
      appendChild(element, section);
      break;
    }
    case "appendComment":
      appendChild(element, doc.createComment(value));
      break;
    case "setAttr":
      element.setAttribute(String(op["name"]), value);
      break;
    case "removeAttr":
      element.removeAttribute(String(op["name"]));
      break;
    default:
      throw new Error(`unknown op ${String(op["op"])}`);
  }
}

/** The DAC condition writer of EXP-119 over the nodes InnerXml made from the text. */
function runFragmentWrite(vector: Vector): void {
  const expected = vector.expect as { text?: string; partial?: string; error?: ErrorResult; setError?: ErrorResult };
  const doc = loadXml("<r/>", { preserveWhitespace: true });
  const root = documentElementOf(doc) as XmlElement;
  const set = attempt(() => setInnerXml(root, text(vector)));
  if (expected.setError) {
    expectError(set as { error?: ErrorResult }, expected.setError);
    return;
  }
  if (!("value" in set)) throw new Error(`${set.error.type}: ${set.error.message}`);
  const nodes = Array.from(root.childNodes as unknown as XmlNode[]);
  try {
    const written = writeNodes(nodes, { indentChars: " ", conformance: "fragment" });
    expect(expected.error).toBeUndefined();
    expect(written).toBe(expected.text);
  } catch (error) {
    if (!(error instanceof Error) || !expected.error) throw error;
    expect({ type: error.name, message: error.message }).toEqual(expected.error);
    expect((error as { partialOutput?: string }).partialOutput).toBe(expected.partial);
  }
}

function runInnerXml(vector: Vector): void {
  const loaded = attempt(() => loadWith(vector, true));
  const expected = vector.expect as { inner?: string; text?: string; error?: ErrorResult; loadError?: ErrorResult };
  if (expected.loadError) {
    expectError(loaded as { error?: ErrorResult }, expected.loadError);
    return;
  }
  if (!("value" in loaded)) throw new Error(`${loaded.error.type}: ${loaded.error.message}`);
  const node = evaluate(vector.path ?? "", loaded.value);
  const target = Array.isArray(node) ? (node[0] as XmlElement) : undefined;
  if (!target) throw new Error("no node");
  const inner = attempt(() => getInnerXml(target));
  if (expected.error) {
    expectError(inner as { error?: ErrorResult }, expected.error);
    return;
  }
  expect("value" in inner ? inner.value : inner.error).toBe(expected.inner);
  expect(innerText(target)).toBe(expected.text);
}

const RUNNERS: Record<string, (vector: Vector) => void> = {
  "fragment-write": runFragmentWrite,
  "inner-xml": runInnerXml,
  load: runLoad,
  "item-write": runItemWrite,
  "manifest-write": runManifestWrite,
  "read-bytes": runReadBytes,
  xdoc: runXdoc,
  "html-encode": (v) => runHtml(v, true),
  "html-decode": (v) => runHtml(v, false),
  xpath: runXpath,
  ops: runOps,
};

describe("recorded .NET Framework vectors", () => {
  for (const vector of vectors) {
    const run = RUNNERS[vector.kind];
    if (!run) continue;
    const gap = GAPS[vector.id];
    const title = `${vector.id} ${vector.kind}`;
    if (gap) it.skip(`${title} (${gap})`, () => undefined);
    else it(title, () => run(vector));
  }
});

describe("recorded .NET Framework tables", () => {
  it("has the HTML entity table of WebUtility", () => {
    const list = (vectors.find((v) => v.id === "5.entities")?.expect as { list: string[] }).list;
    expect(HTML_ENTITIES.size).toBe(list.length);
    for (const entry of list) {
      const dash = entry.indexOf("-", 1);
      expect(HTML_ENTITIES.get(entry.slice(dash + 1))).toBe(entry.slice(0, dash));
    }
  });

  it("encodes the characters WebUtility changes and no other BMP character", () => {
    const changed = (vectors.find((v) => v.id === "5.encode-changed")?.expect as { changed: string[] }).changed;
    const mine: string[] = [];
    for (let unit = 0; unit <= 0xffff; unit += 1) {
      const character = String.fromCharCode(unit);
      const encoded = htmlEncode(character);
      if (encoded !== character) mine.push(`${unit.toString(16).toUpperCase().padStart(4, "0")}>${encoded}`);
    }
    expect(mine).toEqual(changed);
  });

  it("has the invalid file name characters of Path.GetInvalidFileNameChars", () => {
    const chars = (vectors.find((v) => v.id === "6.invalid-file-name-chars")?.expect as { chars: number[] }).chars;
    expect([...INVALID_FILE_NAME_CHARS].map((c) => c.charCodeAt(0)).sort((a, b) => a - b)).toEqual([...chars].sort((a, b) => a - b));
  });
});
