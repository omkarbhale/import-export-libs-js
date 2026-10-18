import { ArgumentException, escapeAttributeValue, escapeText, invalidCharacterMessage, normalizeLineBreaks } from "../xml/index.js";

/**
 * The text writer behind the export transform: `XslCompiledTransform` writing into a `StringWriter`, with the `xsl:output` of
 * `export.xsl` (method `xml`, no declaration, no indentation, `\r\n` line breaks). The transform calls it as the stylesheet
 * writes: elements, attributes, text and raw text. It decides what the text of the stylesheet's output looks like:
 *
 * - an element that received no text and no child is `<x />`, and one that received a text node, even an empty one, is `<x></x>` (EXP-204);
 * - an element that `xsl:copy` copies carries a declaration for each namespace in scope at its source that no output ancestor
 *   has declared, after its attributes (EXP-205);
 * - the text of the elements listed in `cdata-section-elements` is written as CDATA (EXP-360);
 * - text, attribute values and line breaks are escaped as the engine's `XmlWriter` does, and a character XML cannot hold fails
 *   the transform (EXP-361).
 *
 * @spec EXP-204 EXP-205 EXP-360 EXP-361
 */

/** The `cdata-section-elements` of 14.0.7's `export.xsl`, in the stylesheet's order. */
export const CDATA_SECTION_ELEMENTS: readonly string[] = [
  "html_code",
  "method_code",
  "sqlserver_body",
  "stylesheet",
  "query",
  "class_structure",
  "report_query",
  "xsl_stylesheet",
  "implementation_query",
  "filter_xml",
  "condition_xml",
  "event_data",
];

/** The prefix-to-URI bindings in scope; the key of the default namespace is the empty string. */
type Scope = ReadonlyMap<string, string>;

interface OpenElement {
  name: string;
  /** Written when the start tag is closed: attributes first, then namespace declarations. */
  attributes: string[];
  declarations: string[];
  scope: Scope;
  cdata: boolean;
  tagOpen: boolean;
  /** Whether a text node (even an empty one) or a child was written into it. */
  hasContent: boolean;
}

export class OutputWriter {
  private out = "";
  private readonly stack: OpenElement[] = [];
  /** Text written since the last element event; adjacent text nodes join, and null means none. */
  private pendingText: string | null = null;

  /**
   * `xsl:copy` of an element, or a literal result element. `inScope` is the namespace bindings in scope at the source of a copy, in
   * the order the engine declares them (outermost element first); a literal element has none and is in no namespace.
   */
  startElement(name: string, namespaceUri: string | null = null, inScope: Scope | null = null): void {
    this.flushText();
    this.openContent();
    const parent = this.stack[this.stack.length - 1];
    const parentScope: Scope = parent ? parent.scope : new Map();
    const declarations: string[] = [];
    let scope = parentScope;
    const declare = (prefix: string, uri: string): void => {
      declarations.push(prefix === "" ? `xmlns="${uri}"` : `xmlns:${prefix}="${uri}"`);
      const next = new Map(scope);
      if (uri === "") next.delete(prefix);
      else next.set(prefix, uri);
      scope = next;
    };
    for (const [prefix, uri] of inScope ?? []) {
      if (scope.get(prefix) !== uri) declare(prefix, uri);
    }
    // an element in no namespace below a default namespace undeclares it
    if (!namespaceUri && (scope.get("") ?? "") !== "") declare("", "");
    this.stack.push({
      name,
      attributes: [],
      declarations,
      scope,
      cdata: !namespaceUri && CDATA_SECTION_ELEMENTS.includes(name),
      tagOpen: true,
      hasContent: false,
    });
  }

  attribute(name: string, value: string): void {
    const element = this.stack[this.stack.length - 1];
    if (!element?.tagOpen) throw new Error("An attribute must follow the start of an element");
    this.fail(invalidCharacterMessage(value));
    element.attributes.push(` ${name}="${escapeAttributeValue(value)}"`);
  }

  /** A text node. Adjacent text nodes are one run, so an empty one next to others adds nothing. */
  text(value: string): void {
    this.pendingText = (this.pendingText ?? "") + value;
  }

  /** `xsl:text disable-output-escaping="yes"`: the value is written as it is, with only the line breaks of the writer. */
  rawText(value: string): void {
    this.flushText();
    this.fail(invalidCharacterMessage(value));
    this.openContent();
    this.out += normalizeLineBreaks(value);
  }

  /**
   * `xsl:comment`. Line breaks are written `\r\n`, and a hyphen that follows a hyphen gets a space before it, as `XmlWriter` does.
   * @spec EXP-361
   */
  comment(value: string): void {
    this.flushText();
    this.fail(invalidCharacterMessage(value));
    this.openContent();
    this.out += `<!--${normalizeLineBreaks(value).replace(/-(?=-)/g, "- ")}-->`;
  }

  endElement(): void {
    this.flushText();
    const element = this.stack.pop();
    if (!element) throw new Error("No element is open");
    if (element.tagOpen) {
      this.writeStartTag(element);
      this.out += element.hasContent ? `></${element.name}>` : " />";
    } else {
      this.out += `</${element.name}>`;
    }
  }

  /** The text written so far; every element must be closed. */
  finish(): string {
    this.flushText();
    if (this.stack.length > 0) throw new Error("An element is still open");
    return this.out;
  }

  private writeStartTag(element: OpenElement): void {
    this.out += `<${element.name}${element.attributes.join("")}${element.declarations.map((d) => ` ${d}`).join("")}`;
    element.tagOpen = false;
  }

  /** Closes the start tag of the open element, and records that it has content. */
  private openContent(): void {
    const element = this.stack[this.stack.length - 1];
    if (!element) return;
    if (element.tagOpen) {
      this.writeStartTag(element);
      this.out += ">";
    }
    element.hasContent = true;
  }

  private flushText(): void {
    const text = this.pendingText;
    if (text === null) return;
    this.pendingText = null;
    const element = this.stack[this.stack.length - 1];
    this.fail(invalidCharacterMessage(text));
    if (element?.cdata) {
      this.openContent();
      this.out += `<![CDATA[${normalizeLineBreaks(text).split("]]>").join("]]]]><![CDATA[>")}]]>`;
      return;
    }
    this.openContent();
    this.out += escapeText(text);
  }

  private fail(message: string | undefined): void {
    if (message !== undefined) throw new ArgumentException(message);
  }
}
