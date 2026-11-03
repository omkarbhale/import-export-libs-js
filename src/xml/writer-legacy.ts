import {
  CDATA_SECTION_NODE,
  COMMENT_NODE,
  DOCUMENT_FRAGMENT_NODE,
  DOCUMENT_NODE,
  DOCUMENT_TYPE_NODE,
  ELEMENT_NODE,
  PROCESSING_INSTRUCTION_NODE,
  TEXT_NODE,
  attributesOf,
  entityReferenceName,
  getDeclaration,
  isEmpty,
} from "./dom.js";
import type { XmlDocument, XmlElement, XmlNode } from "./dom.js";
import { ArgumentException, NotSupportedException } from "./errors.js";
import { hexValue } from "./chars.js";
import { utf8Bytes } from "../io/utf8.js";

/**
 * .NET's legacy `XmlTextWriter`, which writes the manifest (`XmlDocument.Save(path)`) and which `OuterXml` and
 * `InnerXml` use without indentation. It escapes and indents differently from the `XmlWriter` of the item files: it
 * leaves CR, LF and tab in text alone, writes attribute CR and LF as references but tab as it is, and writes
 * a character that XML does not allow as a reference.
 *
 * @spec MAN-006 IMP-010 EXP-405
 */

const NEW_LINE = "\r\n";
const INDENT = "  ";

interface Scope {
  mixed: boolean;
  /** Namespace declarations in force from this element: its own attributes plus those the writer had to add. */
  namespaces: Map<string, string>;
}

class LegacyWriter {
  private out = "";
  private readonly scopes: Scope[] = [{ mixed: false, namespaces: new Map() }];
  private startTagOpen = false;

  constructor(private readonly indented: boolean) {}

  get text(): string {
    return this.out;
  }

  private get scope(): Scope {
    return this.scopes[this.scopes.length - 1] as Scope;
  }

  writeDeclaration(doc: XmlDocument): void {
    const declaration = getDeclaration(doc);
    if (!declaration) return;
    let value = `version="${declaration.version}"`;
    if (declaration.encoding !== "") value += ` encoding="${declaration.encoding}"`;
    if (declaration.standalone !== "") value += ` standalone="${declaration.standalone}"`;
    this.out += `<?xml ${value}?>`;
  }

  writeChildren(node: XmlNode): void {
    for (let child = node.firstChild; child; child = child.nextSibling) this.writeNode(child);
  }

  writeNode(node: XmlNode): void {
    switch (node.nodeType) {
      case ELEMENT_NODE:
        this.writeElement(node as XmlElement);
        break;
      case TEXT_NODE: {
        const entity = entityReferenceName(node);
        if (entity !== undefined) {
          this.beforeContent();
          this.scope.mixed = true;
          this.out += `&${entity};`;
        } else {
          this.writeText((node as unknown as { data: string }).data);
        }
        break;
      }
      case CDATA_SECTION_NODE: {
        const data = (node as unknown as { data: string }).data;
        if (data.includes("]]>")) throw new ArgumentException("Cannot have ']]>' inside an XML CDATA block.");
        this.beforeContent();
        this.scope.mixed = true;
        this.out += `<![CDATA[${data}]]>`;
        break;
      }
      case COMMENT_NODE:
        this.beforeMarkup();
        this.out += `<!--${(node as unknown as { data: string }).data}-->`;
        break;
      case PROCESSING_INSTRUCTION_NODE: {
        const pi = node as unknown as { target: string; data: string };
        this.beforeMarkup();
        this.out += `<?${pi.target} ${pi.data}?>`;
        break;
      }
      case DOCUMENT_TYPE_NODE:
        this.beforeMarkup();
        this.out += `<!DOCTYPE ${(node as unknown as { name: string }).name}[]>`;
        break;
      case DOCUMENT_FRAGMENT_NODE:
      case DOCUMENT_NODE:
        this.writeChildren(node);
        break;
      default:
        break;
    }
  }

  private closeStartTag(): void {
    if (this.startTagOpen) {
      this.out += ">";
      this.startTagOpen = false;
    }
  }

  private writeIndent(depth: number): void {
    this.out += NEW_LINE + INDENT.repeat(depth);
  }

  /** What precedes an element, comment, processing instruction or DOCTYPE. */
  private beforeMarkup(): void {
    this.closeStartTag();
    if (this.indented && !this.scope.mixed && this.out.length > 0) this.writeIndent(this.scopes.length - 1);
  }

  /** What precedes text, white space and CDATA: the start tag is closed and nothing is indented. */
  private beforeContent(): void {
    this.closeStartTag();
  }

  private isDeclared(prefix: string, uri: string, element = false): boolean {
    for (let k = this.scopes.length - 1; k >= 0; k -= 1) {
      const known = this.scopes[k]?.namespaces.get(prefix);
      if (known !== undefined) return known === uri;
    }
    // an attribute can use the xml prefix without a declaration; an element that does is declared
    return prefix === "" ? uri === "" : prefix === "xml" && !element;
  }

  private writeElement(element: XmlElement): void {
    this.beforeMarkup();
    const attributes = attributesOf(element);
    const namespaces = new Map<string, string>();
    for (const attribute of attributes) {
      if (attribute.name === "xmlns") namespaces.set("", attribute.value);
      else if (attribute.prefix === "xmlns") namespaces.set(attribute.localName ?? "", attribute.value);
    }
    const scope: Scope = { mixed: this.scope.mixed, namespaces };
    this.scopes.push(scope);

    this.out += `<${element.tagName}`;
    for (const attribute of attributes) {
      this.out += ` ${attribute.name}="${this.escape(attribute.value, true)}"`;
    }
    // a prefix whose declaration lies outside the written part is declared on the element that first uses it
    const implicit: [string, string][] = [];
    const require = (prefix: string, uri: string, isElement = false): void => {
      if (this.isDeclared(prefix, uri, isElement)) return;
      namespaces.set(prefix, uri);
      implicit.push([prefix, uri]);
    };
    require(element.prefix ?? "", element.namespaceURI ?? "", true);
    for (const attribute of attributes) {
      if (attribute.name === "xmlns" || attribute.prefix === "xmlns" || !attribute.prefix) continue;
      require(attribute.prefix, attribute.namespaceURI ?? "");
    }
    for (const [prefix, uri] of implicit) {
      this.out += prefix === "" ? ` xmlns="${this.escape(uri, true)}"` : ` xmlns:${prefix}="${this.escape(uri, true)}"`;
    }

    if (isEmpty(element) && !element.firstChild) {
      this.scopes.pop();
      this.out += " />";
      return;
    }
    this.startTagOpen = true;
    this.writeChildren(element);
    const own = this.scopes.pop() as Scope;
    this.closeStartTag();
    if (this.indented && !own.mixed) this.writeIndent(this.scopes.length - 1);
    this.out += `</${element.tagName}>`;
  }

  private writeText(data: string): void {
    if (data === "") return;
    this.beforeContent();
    this.scope.mixed = true;
    this.out += this.escape(data, false);
  }

  private escape(value: string, attribute: boolean): string {
    let result = "";
    for (let i = 0; i < value.length; i += 1) {
      const unit = value.charCodeAt(i);
      switch (unit) {
        case 0x26:
          result += "&amp;";
          continue;
        case 0x3c:
          result += "&lt;";
          continue;
        case 0x3e:
          result += "&gt;";
          continue;
        case 0x22:
          result += attribute ? "&quot;" : '"';
          continue;
        case 0x0a:
          result += attribute ? "&#xA;" : "\n";
          continue;
        case 0x0d:
          result += attribute ? "&#xD;" : "\r";
          continue;
        case 0x09:
          result += "\t";
          continue;
        default:
          break;
      }
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          result += value.slice(i, i + 2);
          i += 1;
          continue;
        }
        const second = Number.isNaN(next) ? unit : next;
        throw new ArgumentException(
          `The surrogate pair (${hexValue(unit)}, ${hexValue(second)}) is invalid. A high surrogate character (0xD800 - 0xDBFF) must always be paired with a low surrogate character (0xDC00 - 0xDFFF).`,
        );
      }
      if (unit >= 0xdc00 && unit <= 0xdfff) {
        throw new ArgumentException(`Invalid high surrogate character (${hexValue(unit)}). A high surrogate character must have a value from range (0xD800 - 0xDBFF).`);
      }
      if (unit < 0x20 || unit === 0xfffe || unit === 0xffff) {
        result += `&#x${unit.toString(16).toUpperCase()};`;
        continue;
      }
      result += value[i];
    }
    return result;
  }
}

/** `XmlNode.OuterXml`. */
export function outerXml(node: XmlNode): string {
  const writer = new LegacyWriter(false);
  if (node.nodeType === DOCUMENT_NODE) writer.writeDeclaration(node as XmlDocument);
  writer.writeNode(node);
  return writer.text;
}

/** `XmlNode.InnerXml`. */
export function innerXml(node: XmlNode): string {
  const writer = new LegacyWriter(false);
  writer.writeChildren(node);
  return writer.text;
}

/**
 * The bytes `XmlDocument.Save(path)` writes: the legacy writer, two spaces per level, in the encoding the declaration
 * names (UTF-8 without a byte-order mark when the document has no declaration or none names an encoding).
 * @spec MAN-006
 */
export function saveBytes(doc: XmlDocument): Buffer {
  const writer = new LegacyWriter(true);
  writer.writeDeclaration(doc);
  writer.writeChildren(doc);
  return encode(writer.text, getDeclaration(doc)?.encoding ?? "");
}

const CP1252: Readonly<Record<number, number>> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

function singleByte(text: string, byteOf: (codePoint: number) => number | undefined): Buffer {
  const bytes: number[] = [];
  for (const character of text) bytes.push(byteOf(character.codePointAt(0) ?? 0) ?? 0x3f);
  return Buffer.from(bytes);
}

function encode(text: string, encoding: string): Buffer {
  switch (encoding.toLowerCase()) {
    case "":
      return utf8Bytes(text);
    case "utf-8":
    case "utf8":
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8Bytes(text)]);
    case "utf-16":
    case "utf-16le":
    case "unicode":
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    case "utf-16be":
      return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]);
    case "iso-8859-1":
    case "latin1":
      return singleByte(text, (codePoint) => (codePoint < 0x100 ? codePoint : undefined));
    case "us-ascii":
    case "ascii":
      return singleByte(text, (codePoint) => (codePoint < 0x80 ? codePoint : undefined));
    case "windows-1252":
      return singleByte(text, (codePoint) => (codePoint < 0x80 || (codePoint >= 0xa0 && codePoint < 0x100) ? codePoint : CP1252[codePoint]));
    default:
      throw new NotSupportedException(`The port cannot save a document in the encoding '${encoding}' (MAN-006).`);
  }
}
