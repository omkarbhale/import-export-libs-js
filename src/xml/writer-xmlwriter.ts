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
  isEmpty,
} from "./dom.js";
import type { XmlDocument, XmlElement, XmlNode } from "./dom.js";
import { ArgumentException } from "./errors.js";
import { hexValue } from "./chars.js";

/**
 * `XmlWriter.Create(writer, settings)` as the engine configures it, driven by `XmlNode.WriteTo` over a DOM. It writes
 * the item files (EXP-423 to EXP-428), the re-indented DAC conditions (EXP-119) and `XDocument.ToString` (EXP-121).
 * The state machine below is the one of .NET's `XmlEncodedRawTextWriterIndent`.
 *
 * @spec EXP-423 EXP-424 EXP-425 EXP-426 EXP-427 EXP-428 EXP-119 EXP-121
 */

export interface XmlWriterSettings {
  /** `IndentChars`, or null for `Indent = false`. */
  indentChars: string | null;
  /** `ConformanceLevel.Document` (a document) or `Fragment`/`Auto` (several roots and text at the top). */
  conformance: "document" | "fragment";
}

/** The settings of an item file: one space per level, no XML declaration, a document. */
export const ITEM_FILE_SETTINGS: XmlWriterSettings = { indentChars: " ", conformance: "document" };

const NEW_LINE = "\r\n";

class RawIndentWriter {
  private out = "";
  private indentLevel = 0;
  private mixed = false;
  private readonly mixedStack: boolean[] = [];
  /** True between '<name attributes' and the '>' that the first content (or the end) writes. */
  private startTagOpen = false;
  /** Whether anything was written after the '>' of the current start tag. */
  private contentWritten = false;

  constructor(private readonly settings: XmlWriterSettings) {}

  get text(): string {
    return this.out;
  }

  writeDocument(doc: XmlDocument): void {
    for (let child = doc.firstChild; child; child = child.nextSibling) this.writeNode(child);
  }

  writeNodes(nodes: XmlNode[]): void {
    for (const node of nodes) this.writeNode(node);
  }

  private fail(message: string): never {
    throw new ArgumentException(message, this.out);
  }

  private writeIndent(): void {
    if (this.settings.indentChars === null) return;
    this.out += NEW_LINE + this.settings.indentChars.repeat(this.indentLevel);
  }

  private indentBeforeNode(): void {
    if (this.settings.indentChars !== null && !this.mixed && this.out.length > 0) this.writeIndent();
  }

  /** Writes the '>' of a start tag that is still open. */
  private closeStartTag(): void {
    if (this.startTagOpen) {
      this.out += ">";
      this.startTagOpen = false;
    }
  }

  private markContent(): void {
    this.closeStartTag();
    this.contentWritten = true;
  }

  private writeNode(node: XmlNode): void {
    switch (node.nodeType) {
      case ELEMENT_NODE:
        this.writeElement(node as XmlElement);
        break;
      case TEXT_NODE: {
        const entity = entityReferenceName(node);
        if (entity !== undefined) {
          this.mixed = true;
          this.markContent();
          this.out += `&${entity};`;
        } else {
          this.writeString((node as unknown as { data: string }).data, true);
        }
        break;
      }
      case CDATA_SECTION_NODE:
        this.writeCData((node as unknown as { data: string }).data);
        break;
      case COMMENT_NODE:
        this.markContentAfterIndent(() => {
          this.out += `<!--${normalizeLineBreaks(this.checked((node as unknown as { data: string }).data))}-->`;
        });
        break;
      case PROCESSING_INSTRUCTION_NODE: {
        const pi = node as unknown as { target: string; data: string };
        if (pi.target === "xml") {
          // an XML declaration is left out when it is the very first thing written, and refused anywhere else
          if (this.out === "") break;
          this.fail("Cannot write XML declaration. WriteStartDocument method has already written it.");
        }
        this.markContentAfterIndent(() => {
          this.out += pi.data === "" ? `<?${pi.target}?>` : `<?${pi.target} ${normalizeLineBreaks(this.checked(pi.data))}?>`;
        });
        break;
      }
      case DOCUMENT_TYPE_NODE:
        this.markContentAfterIndent(() => {
          this.out += `<!DOCTYPE ${(node as unknown as { name: string }).name} []>`;
        });
        break;
      case DOCUMENT_FRAGMENT_NODE:
      case DOCUMENT_NODE:
        for (let child = node.firstChild; child; child = child.nextSibling) this.writeNode(child);
        break;
      default:
        break;
    }
  }

  private markContentAfterIndent(write: () => void): void {
    this.closeStartTag();
    this.indentBeforeNode();
    write();
    this.contentWritten = true;
  }

  private writeElement(element: XmlElement): void {
    this.closeStartTag();
    this.indentBeforeNode();
    this.indentLevel += 1;
    this.mixedStack.push(this.mixed);
    this.out += `<${element.tagName}`;
    for (const attribute of attributesOf(element)) {
      this.out += ` ${attribute.name}="`;
      this.out += `${escapeAttributeValue(this.checked(attribute.value, true))}"`;
    }
    this.startTagOpen = true;
    this.contentWritten = false;
    // the content of the root of a document is never mixed; any other element keeps the state it started in
    this.mixed = this.indentLevel === 1 && this.settings.conformance === "document" ? false : (this.mixedStack[this.mixedStack.length - 1] ?? false);

    const shortForm = isEmpty(element) && !element.firstChild;
    for (let child = element.firstChild; child; child = child.nextSibling) this.writeNode(child);

    this.indentLevel -= 1;
    if (!this.mixed && this.contentWritten) {
      this.closeStartTag();
      this.writeIndent();
    }
    this.mixed = this.mixedStack.pop() ?? false;
    if (shortForm && this.startTagOpen) {
      this.out += " />";
      this.startTagOpen = false;
    } else {
      this.closeStartTag();
      this.out += `</${element.tagName}>`;
    }
    // the element is content of its parent
    this.contentWritten = true;
  }

  private writeString(value: string, markMixed: boolean): void {
    if (markMixed) this.mixed = true;
    this.closeStartTag();
    if (value === "") return;
    this.contentWritten = true;
    const text = this.checked(value);
    this.out += escapeText(text);
  }

  private writeCData(value: string): void {
    this.mixed = true;
    this.markContent();
    const text = normalizeLineBreaks(this.checked(value));
    this.out += `<![CDATA[${text.split("]]>").join("]]]]><![CDATA[>")}]]>`;
  }

  /** `CheckCharacters`: a character XML cannot hold makes the writer throw (EXP-428). */
  private checked(value: string, insideStartTag = false): string {
    const message = invalidCharacterMessage(value);
    if (message === undefined) return value;
    if (!insideStartTag) this.closeStartTag();
    this.fail(message);
  }
}

/**
 * The message `XmlWriter` throws (`ArgumentException`) for the first character of `value` that an XML document cannot hold, or
 * undefined when every character is valid.
 * @spec EXP-428 EXP-361
 */
export function invalidCharacterMessage(value: string): string | undefined {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0x20 && unit < 0xd800) continue;
    if (unit === 0x09 || unit === 0x0a || unit === 0x0d) continue;
    if (unit >= 0xe000 && unit <= 0xfffd) continue;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      if (i + 1 >= value.length) return "The surrogate pair is invalid. Missing a low surrogate character.";
      return `The surrogate pair (${hexValue(unit)}, ${hexValue(next)}) is invalid. A high surrogate character (0xD800 - 0xDBFF) must always be paired with a low surrogate character (0xDC00 - 0xDFFF).`;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      return `Invalid high surrogate character (${hexValue(unit)}). A high surrogate character must have a value from range (0xD800 - 0xDBFF).`;
    }
    return `'${String.fromCharCode(unit)}', hexadecimal value ${hexValue(unit)}, is an invalid character.`;
  }
  return undefined;
}

/** CR, LF and CRLF become the writer's new line (`NewLineHandling.Replace`). */
export function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n|\r|\n/g, NEW_LINE);
}

/** Element text as the writer escapes it: `&`, `<` and `>` become references and line breaks become `\r\n`. */
export function escapeText(value: string): string {
  return normalizeLineBreaks(value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
}

/** An attribute value as the writer escapes it (`NewLineHandling.Replace` writes each line break as a character reference). */
export function escapeAttributeValue(value: string): string {
  return value.replace(/[&<>"\t\n\r]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "\t":
        return "&#x9;";
      case "\n":
        return "&#xA;";
      default:
        return "&#xD;";
    }
  });
}

/** `XmlDocument.Save(XmlWriter)` for a document, written with the given settings. */
export function writeDocument(doc: XmlDocument, settings: XmlWriterSettings): string {
  const writer = new RawIndentWriter(settings);
  writer.writeDocument(doc);
  return writer.text;
}

/** The nodes written as the content of a writer with the given settings (a fragment). */
export function writeNodes(nodes: XmlNode[], settings: XmlWriterSettings): string {
  const writer = new RawIndentWriter(settings);
  writer.writeNodes(nodes);
  return writer.text;
}
