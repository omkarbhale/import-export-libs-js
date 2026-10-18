/**
 * The .NET exception types the engine's XML handling can raise. The message of each is the .NET Framework
 * text, because an exception that reaches the log is part of the observable behaviour (EXP-400, IMP-011).
 */

/** `System.Xml.XmlException`: a malformed document. A load error names the position as .NET counts it. */
export class XmlException extends Error {
  override name = "XmlException";

  /** 1-based line and column (in UTF-16 units) of the error, when .NET names one. */
  constructor(
    message: string,
    readonly lineNumber?: number,
    readonly linePosition?: number,
  ) {
    super(lineNumber === undefined ? message : `${message} Line ${lineNumber}, position ${linePosition}.`);
  }
}

/** `System.Xml.XPath.XPathException`: an expression .NET refuses. */
export class XPathException extends Error {
  override name = "XPathException";
}

/**
 * `System.ArgumentException`. The XML writers raise it for a character an XML document cannot hold; the
 * text written before the failing node is kept in `partialOutput` (EXP-428).
 */
export class ArgumentException extends Error {
  override name = "ArgumentException";

  constructor(
    message: string,
    readonly partialOutput?: string,
  ) {
    super(message);
  }
}

/** A document the port cannot load although .NET can (IMP-016). */
export class NotSupportedException extends Error {
  override name = "NotSupportedException";
}
