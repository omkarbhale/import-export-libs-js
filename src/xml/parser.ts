import {
  INVALID_XML_CHAR,
  XMLNS_NS,
  XML_NS,
  codePointAt,
  displayCharacter,
  hexValue,
  isNameChar,
  isNameStartChar,
  isXmlChar,
  isXmlWhitespace,
} from "./chars.js";
import {
  appendChild,
  createEntityReference,
  createXmlDocument,
  markEmpty,
  namespacesInScope,
  ownerDocument,
  setDeclaration,
} from "./dom.js";
import type { XmlDocument, XmlElement, XmlNode } from "./dom.js";
import { NotSupportedException, XmlException } from "./errors.js";

/**
 * The XML parser behind `XmlDocument.LoadXml` and `InnerXml`. No library parser can stand in for it: .NET reads
 * with `XmlTextReader` and `Normalization = false`, so it keeps CR, LF and tab as written even in attribute
 * values, it keeps `<x/>` apart from `<x></x>`, accepts a reference to a character XML does not allow and
 * rejects the raw character. It also words its errors and counts their positions in its own way.
 *
 * @spec IMP-007 IMP-016 IMP-017 IMP-018 MAN-003
 */

export interface LoadOptions {
  /** `XmlDocument.PreserveWhitespace`. */
  preserveWhitespace: boolean;
  /** Parse the text as element content (`InnerXml`): an unknown entity is a reference node, not an error. */
  fragment?: boolean;
  /**
   * Read as `XDocument.Parse` does (an `XmlReader`): line ends in text become LF, tab, CR and LF in attribute values
   * become spaces, and a reference to a character XML does not allow is an error. All white space is
   * insignificant unless `xml:space="preserve"` says otherwise.
   */
  xmlReader?: boolean;
}

interface Frame {
  element: XmlElement;
  qualifiedName: string;
  nameIndex: number;
  /** Namespace declarations made by this element, when it makes any. */
  scope: Map<string, string> | null;
  preserveSpace: boolean;
}

interface ParsedAttribute {
  qualifiedName: string;
  prefix: string;
  localName: string;
  value: string;
  nameIndex: number;
  quoteIndex: number;
}

const NAME_TERMINATORS_ELEMENT = " \t\r\n/>";
const NAME_TERMINATORS_ATTRIBUTE = " \t\r\n=/>";
const NAME_TERMINATORS_PI = " \t\r\n?";
const NAME_TERMINATORS_DOCTYPE = " \t\r\n>[";

const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** `XmlDocument.LoadXml(text)`. @spec IMP-007 IMP-017 IMP-018 MAN-003 */
export function loadXml(text: string, options: LoadOptions): XmlDocument {
  const doc = createXmlDocument(options.preserveWhitespace);
  new Parser(text, doc, options).parseDocument();
  return doc;
}

/**
 * Parses the text as the content of `parent`, as the `InnerXml` setter does: several roots and text are
 * allowed, and the namespaces in scope at `parent` apply. Returns the nodes, not yet attached.
 */
export function parseFragment(text: string, parent: XmlElement): XmlNode[] {
  const doc = ownerDocument(parent);
  const container = doc.createElementNS(null, "fragment");
  // the content of InnerXml keeps all its white space, whatever the document says
  const parser = new Parser(text, doc, { preserveWhitespace: true, fragment: true });
  parser.parseContentOf(container, namespacesInScope(parent));
  const nodes: XmlNode[] = [];
  for (let child = container.firstChild; child; child = child.nextSibling) nodes.push(child);
  for (const node of nodes) container.removeChild(node);
  return nodes;
}

class Parser {
  private lineStarts: number[] | null = null;
  private readonly stack: Frame[] = [];
  private container: XmlNode;
  private baseScope: Map<string, string> | null = null;
  private readonly preserveWhitespace: boolean;
  private readonly xmlReader: boolean;
  private readonly fragment: boolean;
  /** Index of the next ']]>' in the text, -2 before the first search and -1 when there is none. */
  private closerIndex = -2;

  constructor(
    private readonly text: string,
    private readonly doc: XmlDocument,
    options: LoadOptions,
  ) {
    this.container = doc;
    this.preserveWhitespace = options.preserveWhitespace && !options.xmlReader;
    this.xmlReader = options.xmlReader === true;
    this.fragment = options.fragment === true;
  }

  // ---------------------------------------------------------------- positions and errors

  /** Line and column of a text index, counting LF, CR and CRLF as one line break each. */
  private lineAndColumn(index: number): { line: number; column: number } {
    if (!this.lineStarts) {
      const starts = [0];
      const text = this.text;
      for (let i = 0; i < text.length; i += 1) {
        const unit = text.charCodeAt(i);
        if (unit === 0x0a) starts.push(i + 1);
        else if (unit === 0x0d) {
          if (text.charCodeAt(i + 1) === 0x0a) i += 1;
          starts.push(i + 1);
        }
      }
      this.lineStarts = starts;
    }
    const starts = this.lineStarts;
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] ?? 0) <= index) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: index - (starts[low] ?? 0) + 1 };
  }

  private fail(message: string, index: number): never {
    const { line, column } = this.lineAndColumn(index);
    throw new XmlException(message, line, column);
  }

  private unexpectedToken(index: number, expected: string): never {
    const { character } = codePointAt(this.text, index);
    return this.fail(`'${character}' is an unexpected token. ${expected}`, index);
  }

  /** The end of the text inside markup or content: the elements still open are named, innermost first. */
  private unclosedElements(): never {
    const names = this.stack.map((frame) => frame.qualifiedName).reverse().join(", ");
    return this.fail(`Unexpected end of file has occurred. The following elements are not closed: ${names}${names === "" ? "" : "."}`, this.text.length);
  }

  private invalidCharacter(index: number): never {
    const { character, codePoint } = codePointAt(this.text, index);
    return this.fail(`'${displayCharacter(character)}', hexadecimal value ${hexValue(codePoint)}, is an invalid character.`, index);
  }

  private checkCharacters(start: number, end: number): void {
    const segment = this.text.slice(start, end);
    const found = INVALID_XML_CHAR.exec(segment);
    if (found) this.invalidCharacter(start + found.index);
  }

  // ---------------------------------------------------------------- documents

  parseDocument(): void {
    const text = this.text;
    let rootSeen = false;
    let doctypeSeen = false;
    let i = 0;
    if (text.startsWith("<?xml") && (isXmlWhitespace(text.charCodeAt(5)) || text.charCodeAt(5) === 0x3f)) {
      i = this.parseDeclaration();
    }
    for (;;) {
      const start = i;
      while (i < text.length && isXmlWhitespace(text.charCodeAt(i))) i += 1;
      if (i > start && this.preserveWhitespace) {
        appendChild(this.doc, this.doc.createTextNode(this.lineEnds(text.slice(start, i))));
      }
      if (i >= text.length) break;
      if (text.charCodeAt(i) !== 0x3c) this.fail("Data at the root level is invalid.", i);
      // XmlTextReader needs four characters to tell what comes after a root-level '<'
      if (text.length - i < 4) this.fail("Data at the root level is invalid.", i);
      const next = text.charCodeAt(i + 1);
      if (next === 0x3f) {
        i = this.parseProcessingInstruction(i);
      } else if (next === 0x21) {
        if (text.startsWith("<!--", i)) {
          i = this.parseComment(i);
        } else if (text.charCodeAt(i + 2) === 0x5b) {
          this.fail("Data at the root level is invalid.", i);
        } else {
          const word = this.readWord(i + 2);
          if (word !== "DOCTYPE") this.fail(`'${word}' is an unexpected token. The expected token is 'DOCTYPE'.`, i + 2);
          if (doctypeSeen) this.fail("Cannot have multiple DTDs.", i);
          if (rootSeen) this.fail("DTD must be defined before the document root element.", i);
          doctypeSeen = true;
          i = this.parseDoctype(i);
        }
      } else if (next === 0x2f) {
        this.fail("Unexpected end tag.", i + 2);
      } else {
        if (rootSeen) this.fail("There are multiple root elements.", i + 1);
        rootSeen = true;
        i = this.runContent(i, true);
      }
    }
    if (!rootSeen) throw new XmlException("Root element is missing.");
  }

  /** Parses `text` as element content into `container`. */
  parseContentOf(container: XmlNode, scope: Map<string, string>): void {
    this.container = container;
    this.baseScope = scope;
    const text = this.text;
    let start = 0;
    if (text.startsWith("<?xml") && (isXmlWhitespace(text.charCodeAt(5)) || text.charCodeAt(5) === 0x3f)) start = this.parseDeclaration();
    const end = this.runContent(start, false);
    if (end < this.text.length) this.fail("Data at the root level is invalid.", end);
  }

  private lineEnds(value: string): string {
    return this.xmlReader ? value.replace(/\r\n?/g, "\n") : value;
  }

  // ---------------------------------------------------------------- declaration, DOCTYPE, comments, PIs

  /**
   * `<?xml version="1.0" encoding="..." standalone="..."?>` at the very start. A document keeps it as its declaration.
   * In a fragment it becomes a processing instruction named `xml`, which the item-file writer then refuses to write.
   * Returns the index after it.
   */
  private parseDeclaration(): number {
    const text = this.text;
    let i = 5;
    if (!isXmlWhitespace(text.charCodeAt(i))) this.fail("Syntax for an XML declaration is invalid.", i);
    const values: Record<string, string> = {};
    const order = ["version", "encoding", "standalone"];
    let expected = 0;
    for (;;) {
      while (isXmlWhitespace(text.charCodeAt(i))) i += 1;
      if (i >= text.length) this.fail("Unexpected end of file has occurred.", text.length);
      if (text.startsWith("?>", i)) {
        i += 2;
        break;
      }
      if (text.charCodeAt(i) === 0x3f) this.fail("Unexpected end of file has occurred.", i);
      const nameStart = i;
      const word = this.readWord(i);
      let found = -1;
      for (let k = expected; k < order.length; k += 1) {
        if (order[k] === word) {
          found = k;
          break;
        }
      }
      if (found < 0 || (found > 0 && expected === 0) || word === "") this.fail("Syntax for an XML declaration is invalid.", nameStart);
      i += word.length;
      while (isXmlWhitespace(text.charCodeAt(i))) i += 1;
      if (text.charCodeAt(i) !== 0x3d) this.fail("Syntax for an XML declaration is invalid.", i);
      i += 1;
      while (isXmlWhitespace(text.charCodeAt(i))) i += 1;
      const quote = text.charCodeAt(i);
      if (quote !== 0x22 && quote !== 0x27) this.fail("Syntax for an XML declaration is invalid.", i);
      const close = text.indexOf(String.fromCharCode(quote), i + 1);
      if (close < 0) this.fail("There is an unclosed literal string.", text.length);
      const value = text.slice(i + 1, close);
      if (word === "version" && value !== "1.0") this.fail(`Version number '${value}' is invalid.`, i + 1);
      if (word === "standalone" && value !== "yes" && value !== "no") this.fail("Syntax for an XML declaration is invalid.", i);
      values[word] = value;
      expected = found + 1;
      i = close + 1;
    }
    if (this.fragment) {
      let data = `version="${values["version"] ?? "1.0"}"`;
      if (values["encoding"] !== undefined) data += ` encoding="${values["encoding"]}"`;
      if (values["standalone"] !== undefined) data += ` standalone="${values["standalone"]}"`;
      appendChild(this.container, this.doc.createProcessingInstruction("xml", data));
    } else {
      setDeclaration(this.doc, {
        version: values["version"] ?? "1.0",
        encoding: values["encoding"] ?? "",
        standalone: values["standalone"] ?? "",
      });
    }
    return i;
  }

  /** A run of name characters starting at `index`, without validation. */
  private readWord(index: number): string {
    const text = this.text;
    let end = index;
    while (end < text.length) {
      const unit = text.charCodeAt(end);
      if (isXmlWhitespace(unit) || unit === 0x3e || unit === 0x5b || unit === 0x2f || unit === 0x3d || unit === 0x3f) break;
      end += 1;
    }
    return text.slice(index, end);
  }

  /**
   * `<!DOCTYPE name>` only. A DOCTYPE with an internal subset or an external identifier is a document .NET can read
   * but whose entities and attribute defaults the port does not model (IMP-016).
   */
  private parseDoctype(start: number): number {
    const text = this.text;
    let i = start + 9;
    if (i >= text.length) this.fail("Incomplete DTD content.", text.length);
    if (!isXmlWhitespace(text.charCodeAt(i))) this.unexpectedToken(i, "Expecting white space.");
    while (isXmlWhitespace(text.charCodeAt(i))) i += 1;
    if (i + this.readWord(i).length >= text.length) this.fail("Incomplete DTD content.", text.length);
    const { name, end } = this.readQualifiedName(i, NAME_TERMINATORS_DOCTYPE);
    i = end;
    while (isXmlWhitespace(text.charCodeAt(i))) i += 1;
    if (i >= text.length) this.fail("Incomplete DTD content.", text.length);
    if (text.charCodeAt(i) === 0x5b && text.charCodeAt(i + 1) === 0x5d) {
      i += 2;
      while (isXmlWhitespace(text.charCodeAt(i))) i += 1;
      if (i >= text.length) this.fail("Incomplete DTD content.", text.length);
    }
    if (text.charCodeAt(i) !== 0x3e) {
      if (text.charCodeAt(i) === 0x5b && text.indexOf("]", i) < 0) this.fail("Incomplete DTD content.", text.length);
      throw new NotSupportedException(
        `The DOCTYPE of '${name}' has an internal subset or an external identifier, which the port does not load (IMP-016).`,
      );
    }
    appendChild(this.doc, this.doc.implementation.createDocumentType(name, "", ""));
    return i + 1;
  }

  private parseComment(start: number): number {
    const text = this.text;
    const contentStart = start + 4;
    // XmlTextReader looks for three characters before it scans; a shorter rest is reported where the content starts
    if (text.length - contentStart < 3) this.fail("Unexpected end of file while parsing Comment has occurred.", contentStart);
    const dashes = text.indexOf("--", contentStart);
    if (dashes < 0) this.fail("Unexpected end of file while parsing Comment has occurred.", text.length);
    if (text.charCodeAt(dashes + 2) !== 0x3e) {
      if (dashes + 2 >= text.length) this.fail("Unexpected end of file while parsing Comment has occurred.", text.length);
      this.fail("An XML comment cannot contain '--', and '-' cannot be the last character.", dashes);
    }
    this.checkCharacters(contentStart, dashes);
    appendChild(this.currentParent(), this.doc.createComment(this.lineEnds(text.slice(contentStart, dashes))));
    return dashes + 3;
  }

  private parseCData(start: number): number {
    const text = this.text;
    const contentStart = start + 9;
    if (text.length - contentStart < 3) this.fail("Unexpected end of file while parsing CDATA has occurred.", contentStart);
    const close = text.indexOf("]]>", contentStart);
    if (close < 0) this.fail("Unexpected end of file while parsing CDATA has occurred.", text.length);
    this.checkCharacters(contentStart, close);
    appendChild(this.currentParent(), this.doc.createCDATASection(this.lineEnds(text.slice(contentStart, close))));
    return close + 3;
  }

  private parseProcessingInstruction(start: number): number {
    const text = this.text;
    const nameStart = start + 2;
    const { name, end } = this.readQualifiedName(nameStart, NAME_TERMINATORS_PI, false);
    if (name.toLowerCase() === "xml") {
      if (name === "xml") {
        this.fail("Unexpected XML declaration. The XML declaration must be the first node in the document, and no white space characters are allowed to appear before it.", nameStart);
      }
      this.fail(`'${name}' is an invalid name for processing instructions.`, nameStart);
    }
    let i = end;
    let data = "";
    if (text.startsWith("?>", i)) {
      i += 2;
    } else {
      if (i >= text.length) this.fail("Unexpected end of file while parsing PI has occurred.", text.length);
      if (!isXmlWhitespace(text.charCodeAt(i))) this.fail(`The '${text.charAt(i)}' character, hexadecimal value ${hexValue(text.charCodeAt(i))}, cannot be included in a name.`, i);
      while (isXmlWhitespace(text.charCodeAt(i))) i += 1;
      const close = text.indexOf("?>", i);
      if (close < 0) this.fail("Unexpected end of file while parsing PI has occurred.", text.length);
      this.checkCharacters(i, close);
      data = this.lineEnds(text.slice(i, close));
      i = close + 2;
    }
    appendChild(this.currentParent(), this.doc.createProcessingInstruction(name, data));
    return i;
  }

  // ---------------------------------------------------------------- names

  /**
   * Reads an XML name with at most one colon from `index`. The characters in `terminators` end it; any other
   * character that is not a name character is an error, as in `XmlTextReader`.
   */
  private readQualifiedName(index: number, terminators: string, allowColon = true): { name: string; end: number } {
    const text = this.text;
    let i = index;
    let colon = -1;
    let partStart = i;
    for (;;) {
      if (i >= text.length) this.fail("Unexpected end of file while parsing Name has occurred.", text.length);
      const { character, codePoint } = codePointAt(text, i);
      const first = i === partStart;
      if (character === ":" && allowColon) {
        if (first) this.fail(`Name cannot begin with the ':' character, hexadecimal value 0x3A.`, i);
        if (colon >= 0) this.fail(`The ':' character, hexadecimal value 0x3A, cannot be included in a name.`, i);
        colon = i;
        i += 1;
        partStart = i;
        continue;
      }
      if (first ? isNameStartChar(character) : isNameChar(character)) {
        i += character.length;
        continue;
      }
      if (!first && terminators.includes(character)) break;
      const shown = displayCharacter(character);
      if (first) this.fail(`Name cannot begin with the '${shown}' character, hexadecimal value ${hexValue(codePoint)}.`, i);
      this.fail(`The '${shown}' character, hexadecimal value ${hexValue(codePoint)}, cannot be included in a name.`, i);
    }
    return { name: text.slice(index, i), end: i };
  }

  // ---------------------------------------------------------------- elements and content

  private currentParent(): XmlNode {
    const top = this.stack[this.stack.length - 1];
    return top ? top.element : this.container;
  }

  /**
   * Parses markup and text from `start`. With `untilClosed` it stops when the element opened at `start` closes;
   * otherwise it reads to the end of the text.
   */
  private runContent(start: number, untilClosed: boolean): number {
    const text = this.text;
    let i = start;
    let opened = false;
    for (;;) {
      if (untilClosed && opened && this.stack.length === 0) return i;
      if (i >= text.length) {
        if (this.stack.length > 0) this.unclosedElements();
        return i;
      }
      if (text.charCodeAt(i) !== 0x3c) {
        i = this.parseText(i);
        continue;
      }
      if (i + 1 >= text.length) {
        if (this.stack.length > 0) this.unclosedElements();
        this.fail("Data at the root level is invalid.", i);
      }
      // outside any element XmlTextReader needs four characters to tell what the '<' starts
      if (this.stack.length === 0 && text.length - i < 4) this.fail("Data at the root level is invalid.", i);
      const next = text.charCodeAt(i + 1);
      if (next === 0x2f) {
        i = this.parseEndTag(i);
      } else if (next === 0x21) {
        if (text.startsWith("<!--", i)) i = this.parseComment(i);
        else if (text.startsWith("<![CDATA[", i)) i = this.parseCData(i);
        else {
          const word = this.readWord(i + 2);
          if (word === "DOCTYPE") this.fail("Unexpected DTD declaration.", i + 2);
          this.fail(`'${word}' is an unexpected token. The expected token is '<!--' or '<[CDATA['.`, i + 2);
        }
      } else if (next === 0x3f) {
        i = this.parseProcessingInstruction(i);
      } else {
        i = this.parseStartTag(i);
        opened = true;
      }
    }
  }

  private lookupNamespace(prefix: string, declared: Map<string, string> | null): string | undefined {
    if (declared?.has(prefix)) return declared.get(prefix);
    for (let k = this.stack.length - 1; k >= 0; k -= 1) {
      const scope = this.stack[k]?.scope;
      if (scope?.has(prefix)) return scope.get(prefix);
    }
    if (this.baseScope?.has(prefix)) return this.baseScope.get(prefix);
    if (prefix === "xml") return XML_NS;
    return prefix === "" ? "" : undefined;
  }

  private inPreservedSpace(): boolean {
    return this.stack[this.stack.length - 1]?.preserveSpace ?? false;
  }

  private parseStartTag(start: number): number {
    const text = this.text;
    const nameIndex = start + 1;
    const { name: qualifiedName, end: nameEnd } = this.readQualifiedName(nameIndex, NAME_TERMINATORS_ELEMENT);
    let i = nameEnd;
    const attributes: ParsedAttribute[] = [];
    let selfClosing = false;
    for (;;) {
      const wordStart = i;
      while (isXmlWhitespace(text.charCodeAt(i))) i += 1;
      const hadSpace = i > wordStart;
      if (i >= text.length) this.unclosedElements();
      const unit = text.charCodeAt(i);
      if (unit === 0x3e) {
        i += 1;
        break;
      }
      if (unit === 0x2f) {
        if (attributes.length === 0 && !hadSpace) {
          if (text.charCodeAt(i + 1) !== 0x3e) this.unexpectedToken(i, "The expected token is '>'.");
        } else if (text.charCodeAt(i + 1) !== 0x3e) {
          if (i + 1 >= text.length) this.unclosedElements();
          this.unexpectedToken(i + 1, "The expected token is '>'.");
        }
        selfClosing = true;
        i += 2;
        break;
      }
      if (!hadSpace) this.unexpectedToken(i, "Expecting white space.");
      const attribute = this.parseAttribute(i);
      attributes.push(attribute);
      i = attribute.endIndex;
    }
    this.buildElement(qualifiedName, nameIndex, attributes, selfClosing);
    return i;
  }

  private parseAttribute(start: number): ParsedAttribute & { endIndex: number } {
    const text = this.text;
    const { name, end } = this.readQualifiedName(start, NAME_TERMINATORS_ATTRIBUTE);
    let i = end;
    while (isXmlWhitespace(text.charCodeAt(i))) i += 1;
    if (i >= text.length) this.fail("Unexpected end of file has occurred.", text.length);
    if (text.charCodeAt(i) !== 0x3d) this.unexpectedToken(i, "The expected token is '='.");
    i += 1;
    while (isXmlWhitespace(text.charCodeAt(i))) i += 1;
    if (i >= text.length) this.fail("Unexpected end of file has occurred.", text.length);
    const quote = text.charCodeAt(i);
    if (quote !== 0x22 && quote !== 0x27) this.unexpectedToken(i, `The expected token is '"' or '''.`);
    const quoteIndex = i;
    i += 1;
    let value = "";
    let segmentStart = i;
    for (;;) {
      if (i >= text.length) this.fail("There is an unclosed literal string.", text.length);
      const unit = text.charCodeAt(i);
      if (unit === quote) break;
      if (unit === 0x3c) this.fail(`'<', hexadecimal value 0x3C, is an invalid attribute character.`, i);
      if (unit === 0x26) {
        value += this.normalizeAttribute(text.slice(segmentStart, i));
        const reference = this.parseReference(i, true);
        value += reference.value;
        i = reference.end;
        segmentStart = i;
        continue;
      }
      if (INVALID_XML_CHAR.test(text.charAt(i))) this.invalidCharacter(i);
      i += 1;
    }
    value += this.normalizeAttribute(text.slice(segmentStart, i));
    const colon = name.indexOf(":");
    return {
      qualifiedName: name,
      prefix: colon < 0 ? "" : name.slice(0, colon),
      localName: colon < 0 ? name : name.slice(colon + 1),
      value,
      nameIndex: start,
      quoteIndex,
      endIndex: i + 1,
    };
  }

  /** XmlReader turns literal tab, CR and LF of an attribute value into spaces (CRLF into one). */
  private normalizeAttribute(value: string): string {
    return this.xmlReader ? value.replace(/\r\n|[\t\r\n]/g, " ") : value;
  }

  private buildElement(qualifiedName: string, nameIndex: number, attributes: ParsedAttribute[], selfClosing: boolean): void {
    // namespace declarations first: they apply to the element's own name and attributes
    let declared: Map<string, string> | null = null;
    for (const attribute of attributes) {
      let prefix: string | null = null;
      if (attribute.qualifiedName === "xmlns") prefix = "";
      else if (attribute.prefix === "xmlns") prefix = attribute.localName;
      if (prefix === null) continue;
      if (prefix === "xml" && attribute.value !== XML_NS) {
        this.fail(`Prefix "xml" is reserved for use by XML and can be mapped only to namespace name "${XML_NS}".`, attribute.nameIndex);
      }
      if (prefix === "xmlns") this.fail(`Prefix "xmlns" is reserved for use by XML.`, attribute.nameIndex);
      if (attribute.value === XMLNS_NS) {
        this.fail(`Prefix '${prefix}' cannot be mapped to namespace name reserved for "xml" or "xmlns".`, attribute.quoteIndex + 1);
      }
      if (prefix !== "" && attribute.value === "") this.fail("Invalid namespace declaration.", attribute.quoteIndex);
      declared ??= new Map();
      declared.set(prefix, attribute.value);
    }

    const colon = qualifiedName.indexOf(":");
    const elementPrefix = colon < 0 ? "" : qualifiedName.slice(0, colon);
    const elementUri = this.lookupNamespace(elementPrefix, declared);
    if (elementUri === undefined) this.fail(`'${elementPrefix}' is an undeclared prefix.`, nameIndex);

    const element = this.doc.createElementNS(elementUri === "" ? null : elementUri, qualifiedName);
    const seen = new Set<string>();
    let preserveSpace = this.inPreservedSpace();
    for (const attribute of attributes) {
      let uri: string | null = null;
      if (attribute.qualifiedName === "xmlns" || attribute.prefix === "xmlns") {
        uri = XMLNS_NS;
      } else if (attribute.prefix !== "") {
        const resolved = this.lookupNamespace(attribute.prefix, declared);
        if (resolved === undefined) this.fail(`'${attribute.prefix}' is an undeclared prefix.`, attribute.nameIndex);
        uri = resolved;
      }
      const identity = `${uri ?? ""}\u0000${attribute.localName}`;
      if (seen.has(identity)) this.fail(`'${attribute.qualifiedName}' is a duplicate attribute name.`, attribute.nameIndex);
      seen.add(identity);
      if (attribute.qualifiedName === "xml:space") {
        if (attribute.value === "preserve") preserveSpace = true;
        else if (attribute.value === "default") preserveSpace = false;
        else this.fail(`'${attribute.value}' is an invalid xml:space value.`, attribute.nameIndex);
      }
      element.setAttributeNS(uri, attribute.qualifiedName, attribute.value);
    }

    appendChild(this.currentParent(), element);
    if (selfClosing) {
      markEmpty(element);
      return;
    }
    this.stack.push({ element, qualifiedName, nameIndex, scope: declared, preserveSpace });
  }

  private parseEndTag(start: number): number {
    const text = this.text;
    const nameIndex = start + 2;
    const top = this.stack[this.stack.length - 1];
    if (!top) this.fail("Unexpected end tag.", nameIndex);
    // the name ends at the first character that cannot be part of it; what follows must be '>'
    let end = nameIndex;
    let colon = false;
    while (end < text.length) {
      const { character } = codePointAt(text, end);
      if (character === ":" && !colon && end > nameIndex) colon = true;
      else if (!(end === nameIndex ? isNameStartChar(character) : isNameChar(character))) break;
      end += character.length;
    }
    if (nameIndex >= text.length) this.fail("Unexpected end of file while parsing Name has occurred.", text.length);
    if (end === nameIndex && end < text.length) {
      const { character, codePoint } = codePointAt(text, end);
      this.fail(`Name cannot begin with the '${displayCharacter(character)}' character, hexadecimal value ${hexValue(codePoint)}.`, end);
    }
    if (end >= text.length) this.unclosedElements();
    const name = text.slice(nameIndex, end);
    if (name !== top.qualifiedName) {
      const open = this.lineAndColumn(top.nameIndex);
      this.fail(`The '${top.qualifiedName}' start tag on line ${open.line} position ${open.column} does not match the end tag of '${name}'.`, nameIndex);
    }
    let i = end;
    while (isXmlWhitespace(text.charCodeAt(i))) i += 1;
    if (i >= text.length) this.unclosedElements();
    if (text.charCodeAt(i) !== 0x3e) this.unexpectedToken(i, "The expected token is '>'.");
    this.stack.pop();
    return i + 1;
  }

  // ---------------------------------------------------------------- text and references

  private parseText(start: number): number {
    const text = this.text;
    let i = start;
    let value = "";
    let segmentStart = start;
    // XmlTextReader does not count a run that holds a decimal character reference as white space, whatever it decodes to
    let hasDecimalReference = false;
    for (;;) {
      const next = this.nextSpecial(i);
      if (next > i) {
        this.checkCharacters(i, next);
        const closer = this.closerFrom(i);
        if (closer >= 0 && closer < next) this.fail("']]>' is not allowed in character data.", closer);
      }
      i = next;
      if (i >= text.length || text.charCodeAt(i) === 0x3c) break;
      value += this.lineEnds(text.slice(segmentStart, i));
      const reference = this.parseReference(i, false);
      if (reference.entity !== undefined) {
        if (value !== "") appendChild(this.currentParent(), this.doc.createTextNode(value));
        value = "";
        appendChild(this.currentParent(), createEntityReference(this.doc, reference.entity));
      } else {
        value += reference.value;
      }
      if (reference.decimal) hasDecimalReference = true;
      i = reference.end;
      segmentStart = i;
    }
    value += this.lineEnds(text.slice(segmentStart, i));
    if (value === "") return i;
    if (!hasDecimalReference && isWhitespaceOnly(value)) {
      // XmlTextReader hands over white space on its own; XmlDocument keeps it only when told to, or in xml:space="preserve"
      if (!this.preserveWhitespace && !this.inPreservedSpace()) return i;
    }
    appendChild(this.currentParent(), this.doc.createTextNode(value));
    return i;
  }

  /** Index of the first ']]>' at or after `index`, found without searching the rest of the text again for every run. */
  private closerFrom(index: number): number {
    if (this.closerIndex === -2 || (this.closerIndex >= 0 && this.closerIndex < index)) this.closerIndex = this.text.indexOf("]]>", index);
    return this.closerIndex;
  }

  /** Index of the next '<' or '&' at or after `index`, or the end of the text. */
  private nextSpecial(index: number): number {
    const text = this.text;
    let i = index;
    while (i < text.length) {
      const unit = text.charCodeAt(i);
      if (unit === 0x3c || unit === 0x26) return i;
      i += 1;
    }
    return i;
  }

  /** A reference starting at the '&' at `ampersand`. */
  private parseReference(ampersand: number, inAttribute: boolean): { value: string; end: number; entity?: string; decimal?: boolean } {
    const text = this.text;
    let i = ampersand + 1;
    if (i >= text.length) this.fail("Unexpected end of file has occurred.", ampersand);
    if (text.charCodeAt(i) === 0x23) {
      i += 1;
      const hex = text.charCodeAt(i) === 0x78;
      if (hex) i += 1;
      const digitsStart = i;
      while (i < text.length && (hex ? /[0-9a-fA-F]/ : /[0-9]/).test(text.charAt(i))) i += 1;
      if (i >= text.length) this.fail("Unexpected end of file while parsing  has occurred.", ampersand);
      if (text.charCodeAt(i) !== 0x3b || i === digitsStart) {
        this.fail(`Invalid syntax for a ${hex ? "hexadecimal" : "decimal"} numeric entity reference.`, i);
      }
      let codePoint = 0;
      for (let k = digitsStart; k < i; k += 1) {
        codePoint = codePoint * (hex ? 16 : 10) + parseInt(text.charAt(k), 16);
        if (codePoint > 0x7fffffff) this.fail("Invalid value of a character entity reference.", k);
      }
      if (this.xmlReader && !isXmlChar(codePoint)) {
        const character = codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
        this.fail(`'${character}', hexadecimal value ${hexValue(codePoint)}, is an invalid character.`, digitsStart);
      }
      return { value: characterOf(codePoint), end: i + 1, decimal: !hex };
    }
    const nameStart = i;
    while (i < text.length) {
      const { character } = codePointAt(text, i);
      if (!(i === nameStart ? isNameStartChar(character) : isNameChar(character))) break;
      i += character.length;
    }
    const name = text.slice(nameStart, i);
    if (name === "" || (!inAttribute && text.charCodeAt(i) !== 0x3b)) {
      this.fail("An error occurred while parsing EntityName.", nameStart);
    }
    if (text.charCodeAt(i) !== 0x3b) {
      if (i >= text.length) this.fail("Unexpected end of file has occurred.", ampersand);
      this.unexpectedToken(i, "The expected token is ';'.");
    }
    const replacement = PREDEFINED_ENTITIES[name];
    if (replacement === undefined) {
      if (this.fragment && !inAttribute) return { value: "", end: i + 1, entity: name };
      this.fail(`Reference to undeclared entity '${name}'.`, nameStart);
    }
    return { value: replacement, end: i + 1 };
  }
}

function isWhitespaceOnly(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (!isXmlWhitespace(value.charCodeAt(i))) return false;
  }
  return true;
}

/**
 * The UTF-16 text of a character reference. A value past U+10FFFF goes through the same surrogate arithmetic as any
 * other astral value, so U+110000 becomes two low surrogates, as .NET gives.
 */
function characterOf(codePoint: number): string {
  if (codePoint <= 0xffff) return String.fromCharCode(codePoint);
  const offset = codePoint - 0x10000;
  return String.fromCharCode((0xd800 + (offset >> 10)) & 0xffff, (0xdc00 + (offset & 0x3ff)) & 0xffff);
}
