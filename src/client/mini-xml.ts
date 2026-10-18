/**
 * A small XML reader and writer for the client's own needs: the request root
 * IOM re-serialises (WIRE-004), and the SOAP responses and faults it reads
 * (WIRE-050, WIRE-053). It follows .NET's `XmlDocument` with
 * `PreserveWhitespace = true`:
 *
 * - loading normalises nothing: CR, LF and tab stay as written, in text and in
 *   attribute values, and references to any character load;
 * - an element written `<x/>` remembers it was empty and is written `<x />`; one
 *   written `<x></x>` is written `<x></x>`;
 * - `OuterXml` is the legacy `XmlTextWriter`'s: attribute values are
 *   double-quoted with `& < > "` escaped and LF and CR written as `&#xA;` and
 *   `&#xD;`; text escapes `& < >` and keeps everything else raw.
 *
 * Error messages are .NET's `XmlException` texts, with their line and position.
 * A document type declaration is the one thing .NET reads that this does not.
 * The XML core (wayfinder ticket 27) owns the full DOM, XPath and the item-file
 * writers; nothing here is meant for them.
 */

export interface XmlAttribute {
  name: string;
  value: string;
}

export interface XmlElement {
  kind: "element";
  name: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
  /** True when the element was written `<x/>`; it is serialised `<x />`. */
  isEmpty: boolean;
  parent: XmlElement | undefined;
}

export interface XmlText {
  kind: "text" | "cdata" | "comment";
  value: string;
}

export interface XmlProcessingInstruction {
  kind: "pi";
  target: string;
  value: string;
}

export type XmlNode = XmlElement | XmlText | XmlProcessingInstruction;

export interface XmlDocument {
  /** The XML declaration's text between `<?xml` and `?>`, when there is one. */
  declaration: string | undefined;
  /** Nodes before the root element: whitespace, comments and processing instructions. */
  before: XmlNode[];
  root: XmlElement;
  after: XmlNode[];
}

/** The text of the `XmlException` .NET would throw, with its line and position. */
export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

const NAME_END = /[\s/>=<&"']/;
const NAME_START = /[A-Za-z_:À-￿]/;
const WHITESPACE = (c: string) => /\s/.test(c);

export function parseXml(text: string): XmlDocument {
  return new Parser(text).parseDocument();
}

function hex(character: string): string {
  return `0x${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
}

class Parser {
  private index = 0;

  constructor(private readonly text: string) {}

  parseDocument(): XmlDocument {
    const before: XmlNode[] = [];
    let declaration: string | undefined;
    if (this.text.startsWith("<?xml") && /\s/.test(this.text.charAt(5))) {
      const end = this.text.indexOf("?>");
      if (end < 0) this.fail("Unexpected end of file while parsing XmlDeclaration has occurred.", this.text.length);
      declaration = this.text.slice(5, end);
      this.index = end + 2;
    }
    let root: XmlElement | undefined;
    const after: XmlNode[] = [];
    for (;;) {
      const space = this.readWhile(WHITESPACE);
      const target = root ? after : before;
      if (space !== "") target.push({ kind: "text", value: space });
      if (this.index >= this.text.length) break;
      if (this.text.startsWith("<!--", this.index)) {
        target.push(this.readComment());
      } else if (this.text.startsWith("<?", this.index)) {
        target.push(this.readProcessingInstruction());
      } else if (this.text.startsWith("<!", this.index)) {
        this.fail("A document type declaration is not supported by this reader.", this.index + 2);
      } else if (this.text.charAt(this.index) === "<" && !root) {
        root = this.readElement(undefined);
      } else {
        const element = root !== undefined && this.text.charAt(this.index) === "<";
        this.fail(element ? "There are multiple root elements." : "Data at the root level is invalid.", this.index + (element ? 1 : 0));
      }
    }
    if (!root) throw new XmlParseError("Root element is missing.");
    return { declaration, before, root, after };
  }

  private readElement(parent: XmlElement | undefined): XmlElement {
    this.index += 1;
    const start = this.index;
    const name = this.readName();
    const element: XmlElement = { kind: "element", name, attributes: [], children: [], isEmpty: false, parent };
    for (;;) {
      this.readWhile(WHITESPACE);
      const c = this.text.charAt(this.index);
      if (c === "/" && this.text.charAt(this.index + 1) === ">") {
        this.index += 2;
        element.isEmpty = true;
        return element;
      }
      if (c === ">") {
        this.index += 1;
        break;
      }
      if (this.index >= this.text.length) this.unclosed(element);
      const attributeStart = this.index;
      const attributeName = this.readName();
      this.readWhile(WHITESPACE);
      if (this.text.charAt(this.index) !== "=") {
        this.fail(`'${this.text.charAt(this.index)}' is an unexpected token. The expected token is '='.`);
      }
      this.index += 1;
      this.readWhile(WHITESPACE);
      const quote = this.text.charAt(this.index);
      if (quote !== '"' && quote !== "'") {
        this.fail(`'${quote}' is an unexpected token. The expected token is '"' or '''.`);
      }
      this.index += 1;
      const close = this.text.indexOf(quote, this.index);
      if (close < 0) this.fail("There is an unclosed literal string.", this.text.length);
      const raw = this.text.slice(this.index, close);
      if (raw.includes("<")) {
        this.fail("'<', hexadecimal value 0x3C, is an invalid attribute character.", this.index + raw.indexOf("<"));
      }
      if (element.attributes.some((a) => a.name === attributeName)) {
        this.fail(`'${attributeName}' is a duplicate attribute name.`, attributeStart);
      }
      element.attributes.push({ name: attributeName, value: this.decode(raw, this.index) });
      this.index = close + 1;
    }

    for (;;) {
      if (this.index >= this.text.length) this.unclosed(element);
      if (this.text.startsWith("</", this.index)) {
        this.index += 2;
        const closeStart = this.index;
        const closeName = this.readName();
        this.readWhile(WHITESPACE);
        if (closeName !== name) {
          const [line, position] = this.position(start);
          this.fail(`The '${name}' start tag on line ${line} position ${position} does not match the end tag of '${closeName}'.`, closeStart);
        }
        if (this.text.charAt(this.index) !== ">") {
          this.fail(`'${this.text.charAt(this.index)}' is an unexpected token. The expected token is '>'.`);
        }
        this.index += 1;
        return element;
      }
      if (this.text.startsWith("<!--", this.index)) {
        element.children.push(this.readComment());
      } else if (this.text.startsWith("<![CDATA[", this.index)) {
        const end = this.text.indexOf("]]>", this.index);
        if (end < 0) this.unclosed(element);
        element.children.push({ kind: "cdata", value: this.text.slice(this.index + 9, end) });
        this.index = end + 3;
      } else if (this.text.startsWith("<?", this.index)) {
        element.children.push(this.readProcessingInstruction());
      } else if (this.text.charAt(this.index) === "<") {
        element.children.push(this.readElement(element));
      } else {
        let end = this.text.indexOf("<", this.index);
        if (end < 0) end = this.text.length;
        element.children.push({ kind: "text", value: this.decode(this.text.slice(this.index, end), this.index) });
        this.index = end;
      }
    }
  }

  private readComment(): XmlText {
    const end = this.text.indexOf("-->", this.index + 4);
    if (end < 0) this.fail("Unexpected end of file while parsing Comment has occurred.", this.index + 4);
    const value = this.text.slice(this.index + 4, end);
    this.index = end + 3;
    return { kind: "comment", value };
  }

  private readProcessingInstruction(): XmlProcessingInstruction {
    const end = this.text.indexOf("?>", this.index + 2);
    if (end < 0) this.fail("Unexpected end of file while parsing ProcessingInstruction has occurred.", this.index + 2);
    const body = this.text.slice(this.index + 2, end);
    this.index = end + 2;
    const split = /^(\S+)\s*([\s\S]*)$/.exec(body);
    return { kind: "pi", target: split?.[1] ?? "", value: split?.[2] ?? "" };
  }

  private readName(): string {
    const begin = this.index;
    while (this.index < this.text.length && !NAME_END.test(this.text.charAt(this.index))) this.index += 1;
    const name = this.text.slice(begin, this.index);
    const bad = name === "" ? this.text.charAt(begin) : NAME_START.test(name.charAt(0)) ? "" : name.charAt(0);
    if (bad !== "") this.fail(`Name cannot begin with the '${bad}' character, hexadecimal value ${hex(bad)}.`, begin);
    // a '<' straight after a name is part of the name token to .NET, which refuses it there (EXP-004)
    if (this.text.charAt(this.index) === "<") this.fail(`The '<' character, hexadecimal value 0x3C, cannot be included in a name.`, this.index);
    return name;
  }

  private readWhile(test: (c: string) => boolean): string {
    const begin = this.index;
    while (this.index < this.text.length && test(this.text.charAt(this.index))) this.index += 1;
    return this.text.slice(begin, this.index);
  }

  /** Expands character and entity references; nothing else is normalised. */
  private decode(raw: string, at: number): string {
    if (!raw.includes("&")) return raw;
    return raw.replace(/&([^;&\s<]*);?/g, (match, body: string, offset: number) => {
      const name = at + offset + 1;
      if (!match.endsWith(";")) this.fail("An error occurred while parsing EntityName.", name);
      const hexReference = /^#x([0-9a-fA-F]+)$/.exec(body);
      const decimalReference = /^#([0-9]+)$/.exec(body);
      if (hexReference || decimalReference) {
        const code = Number.parseInt(hexReference?.[1] ?? decimalReference?.[1] ?? "", hexReference ? 16 : 10);
        if (code > 0x10ffff) this.fail("Invalid syntax for a decimal numeric entity reference.", name);
        return String.fromCodePoint(code);
      }
      switch (body) {
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "amp":
          return "&";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default:
          return this.fail(`Reference to undeclared entity '${body}'.`, name);
      }
    });
  }

  private unclosed(element: XmlElement): never {
    const open: string[] = [];
    for (let e: XmlElement | undefined = element; e; e = e.parent) open.push(e.name);
    this.fail(`Unexpected end of file has occurred. The following elements are not closed: ${open.join(", ")}.`, this.text.length);
  }

  /** 1-based line and position of the character at the 0-based `index` (CR LF counts as one line break). */
  private position(index: number): [number, number] {
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < index && i < this.text.length; i++) {
      const c = this.text.charAt(i);
      if (c === "\n" || (c === "\r" && this.text.charAt(i + 1) !== "\n")) {
        line += 1;
        lineStart = i + 1;
      }
    }
    return [line, index - lineStart + 1];
  }

  private fail(message: string, index: number = this.index): never {
    const [line, position] = this.position(index);
    throw new XmlParseError(`${message} Line ${line}, position ${position}.`);
  }
}

const ATTRIBUTE_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "\n": "&#xA;",
  "\r": "&#xD;",
};
const TEXT_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/** `OuterXml` of a node, as .NET writes it. */
export function outerXml(node: XmlNode): string {
  switch (node.kind) {
    case "element": {
      let out = `<${node.name}`;
      for (const attribute of node.attributes) {
        out += ` ${attribute.name}="${attribute.value.replace(/[&<>"\n\r]/g, (c) => ATTRIBUTE_ESCAPES[c] ?? c)}"`;
      }
      if (node.children.length === 0 && node.isEmpty) return `${out} />`;
      return `${out}>${node.children.map(outerXml).join("")}</${node.name}>`;
    }
    case "text":
      return node.value.replace(/[&<>]/g, (c) => TEXT_ESCAPES[c] ?? c);
    case "cdata":
      return `<![CDATA[${node.value}]]>`;
    case "comment":
      return `<!--${node.value}-->`;
    case "pi":
      return node.value === "" ? `<?${node.target}?>` : `<?${node.target} ${node.value}?>`;
  }
}

/** `OuterXml` of a document: its declaration, if any, and every top-level node. */
export function documentOuterXml(doc: XmlDocument): string {
  const declaration = doc.declaration === undefined ? "" : `<?xml${doc.declaration}?>`;
  return declaration + [...doc.before, doc.root, ...doc.after].map(outerXml).join("");
}

/** `InnerText` of a node: its text and CDATA descendants, in order. */
export function innerText(node: XmlNode): string {
  switch (node.kind) {
    case "element":
      return node.children.map(innerText).join("");
    case "text":
    case "cdata":
      return node.value;
    default:
      return "";
  }
}

export function childElements(element: XmlElement, name?: string): XmlElement[] {
  return element.children.filter((c): c is XmlElement => c.kind === "element" && (name === undefined || c.name === name));
}

export function attributeOf(element: XmlElement, name: string): string | undefined {
  return element.attributes.find((a) => a.name === name)?.value;
}

export function localName(name: string): string {
  return name.slice(name.indexOf(":") + 1);
}

/** The namespace URI an element's name resolves to, or "" for none. */
export function namespaceUri(element: XmlElement): string {
  const colon = element.name.indexOf(":");
  const prefix = colon < 0 ? "" : element.name.slice(0, colon);
  if (prefix === "xml") return "http://www.w3.org/XML/1998/namespace";
  const declaration = prefix === "" ? "xmlns" : `xmlns:${prefix}`;
  for (let e: XmlElement | undefined = element; e; e = e.parent) {
    const value = attributeOf(e, declaration);
    if (value !== undefined) return value;
  }
  return "";
}

/** All descendant elements in document order, the element itself excluded. */
export function descendantElements(element: XmlElement): XmlElement[] {
  return childElements(element).flatMap((child) => [child, ...descendantElements(child)]);
}
