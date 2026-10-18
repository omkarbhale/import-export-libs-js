import {
  type XmlDocument,
  type XmlElement,
  attributeOf,
  childElements,
  descendantElements,
  documentOuterXml,
  innerText,
  localName,
  namespaceUri,
  parseXml,
  XmlParseError,
} from "./mini-xml.js";
import { DotNetException, tryParseInt32 } from "./dotnet.js";

const SOAP_ENVELOPE = "http://schemas.xmlsoap.org/soap/envelope/";

/** `XmlDocument.LoadXml`: a document, or the `XmlException` .NET would throw. */
export function loadXml(text: string): XmlDocument {
  try {
    return parseXml(text);
  } catch (error) {
    if (error instanceof XmlParseError) throw new DotNetException("System.Xml.XmlException", error.message);
    throw error;
  }
}

/** `name`, matched by local name in the SOAP envelope namespace or in no namespace. */
function soapChild(parent: XmlElement, name: string): XmlElement | undefined {
  return childElements(parent).find((c) => {
    const ns = namespaceUri(c);
    return localName(c.name) === name && (ns === SOAP_ENVELOPE || ns === "");
  });
}

/** An element's text, trimmed of nothing: the empty string when the element is absent. */
function textOf(element: XmlElement | undefined): string {
  return element ? innerText(element) : "";
}

/**
 * A response document and its error accessors, as IOM's `Item` gives them.
 *
 * @spec WIRE-052 WIRE-053
 */
export class ResponseDocument {
  /** `sourceText` is the text the document was read from, when it was read from text. */
  constructor(
    readonly document: XmlDocument,
    readonly sourceText?: string,
  ) {}

  static parse(text: string): ResponseDocument {
    return new ResponseDocument(loadXml(text), text);
  }

  /** The whole document's outer XML, envelope included, with its whitespace. */
  get outerXml(): string {
    return documentOuterXml(this.document);
  }

  /** The `Envelope/Body/Fault` element, matched by local name in the SOAP namespace or in none. */
  get faultElement(): XmlElement | undefined {
    const root = this.document.root;
    const rootNamespace = namespaceUri(root);
    if (localName(root.name) !== "Envelope" || (rootNamespace !== SOAP_ENVELOPE && rootNamespace !== "")) return undefined;
    const body = soapChild(root, "Body");
    return body ? soapChild(body, "Fault") : undefined;
  }

  /** IOM's `isError()`. */
  get isError(): boolean {
    return this.faultElement !== undefined;
  }

  private faultChild(name: string): string {
    const fault = this.faultElement;
    return textOf(fault ? childElements(fault, name)[0] : undefined);
  }

  get errorCode(): string {
    return this.faultChild("faultcode");
  }

  get errorString(): string {
    return this.faultChild("faultstring");
  }

  /** The text of the whole `detail` subtree, run together. */
  get errorDetail(): string {
    return this.faultChild("detail");
  }

  get errorSource(): string {
    return this.faultChild("faultactor");
  }

  /** A fault with faultcode `0`: "no items matched". */
  get isEmpty(): boolean {
    return this.isError && this.errorCode === "0";
  }

  /** The items IOM finds in a response: `Item|AML/Item|//Result/Item`. */
  get items(): XmlElement[] {
    const root = this.document.root;
    const found: XmlElement[] = [];
    if (root.name === "Item") found.push(root);
    if (root.name === "AML") found.push(...childElements(root, "Item"));
    for (const element of [root, ...descendantElements(root)]) {
      if (element.name === "Result") found.push(...childElements(element, "Item"));
    }
    return found;
  }
}

/** The envelope IOM writes for its own faults (WIRE-050). `\r\n\t` below are CR, LF and tab. */
const FAULT_TEMPLATE = (code: string, message: string, actor: string, detail: string): string =>
  '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N">' +
  "<SOAP-ENV:Body><SOAP-ENV:Fault>" +
  `\r\n\t<faultcode>${code}</faultcode>` +
  `\r\n\t<faultstring>${escapeText(message)}</faultstring>` +
  `\r\n\t<faultactor>${actor}</faultactor>` +
  `\r\n\t<detail>${detail}</detail>` +
  "\r\n</SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>";

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface IomFaultOptions {
  /** Replaces the default faultcode `999` when non-empty. */
  code?: string | undefined;
  /** Replaces the default faultactor `HttpServerConnection` when non-empty. */
  actor?: string | undefined;
  /** Markup that replaces the default detail `unknown error`. */
  detail?: string | undefined;
}

/**
 * A fault IOM writes itself instead of throwing.
 *
 * @spec WIRE-050
 */
export function iomFault(message: string, options: IomFaultOptions = {}): ResponseDocument {
  return ResponseDocument.parse(
    FAULT_TEMPLATE(
      options.code ? escapeText(options.code) : "999",
      message,
      options.actor ? escapeText(options.actor) : "HttpServerConnection",
      options.detail ?? "unknown error",
    ),
  );
}

/**
 * IOM's "Unknown error" item, for a login response with neither a fault nor a user id.
 *
 * @spec WIRE-050
 */
export function unknownErrorFault(): ResponseDocument {
  return ResponseDocument.parse(
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N">' +
      "<SOAP-ENV:Body><SOAP-ENV:Fault>\r\n\t\t\t<faultcode>1</faultcode>\r\n\t\t\t<faultactor></faultactor>" +
      "\r\n\t\t\t<faultstring>Unknown error</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>",
  );
}

/**
 * The value of a property of a single item, as IOM's `getProperty` reads it:
 * the text of its `name` child, the id of a nested item, or null when the
 * element is absent or is blank with `is_null="1"`.
 */
export function getProperty(item: XmlElement, name: string): string | null {
  const element = childElements(item, name)[0];
  if (!element) return null;
  const nested = childElements(element, "Item")[0];
  if (nested) return attributeOf(nested, "id") ?? null;
  const text = innerText(element);
  return text === "" && attributeOf(element, "is_null") === "1" ? null : text;
}

/** What .NET prints for the engine's exception type. */
export const CITEM_EXCEPTION_TYPE = "Aras.Tools.SolutionUpgrade.CItemException";

/** The text .NET gives an exception that was made with no message. */
const DEFAULT_MESSAGE = "Exception of type 'Aras.Tools.SolutionUpgrade.CItemException' was thrown.";

/**
 * An engine error: a fault code, its text and detail.
 *
 * @spec WIRE-051 WIRE-052
 */
export class CItemException extends Error {
  /** True for an error made from another exception, false for one made from a server response. */
  bInnError = true;

  /**
   * The engine's own errors: an explicit code, text, detail and cause. The
   * detail is the message; with none, the message is .NET's default text.
   */
  constructor(
    readonly faultcode: number,
    readonly faultstring: string | null,
    /** Mutable like the engine's field: callers add to it and rethrow, and the message stays as it was made. */
    public faultdetail: string | null,
    cause?: unknown,
  ) {
    super(faultdetail ?? DEFAULT_MESSAGE, cause === undefined ? undefined : { cause });
    this.name = "CItemException";
  }

  /** Built from a fault response alone: the response's whole outer XML is the text and the message. */
  static fromResponse(response: ResponseDocument): CItemException {
    return CItemException.fromFault(response.outerXml, response);
  }

  /** Built from the request that was sent and the fault it got back. */
  static fromRequest(request: string, response: ResponseDocument): CItemException {
    return CItemException.fromFault(`Server error\r\n\r\nRequest: ${request}\r\n\r\nResponce: ${response.outerXml}`, response);
  }

  private static fromFault(text: string, response: ResponseDocument): CItemException {
    const exception = new CItemException(tryParseInt32(response.errorCode) ?? 1, text, response.errorDetail);
    exception.message = text;
    exception.bInnError = false;
    return exception;
  }
}

/**
 * The text the engine puts in a `faultstring` where it writes an exception's stack. The port cannot reproduce
 * .NET frames, so it writes the type name, a colon and the message.
 *
 * @spec EXP-055
 */
export function stackText(error: unknown): string {
  if (error instanceof DotNetException) return error.faultString;
  if (error instanceof CItemException) return `${CITEM_EXCEPTION_TYPE}: ${error.message}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
