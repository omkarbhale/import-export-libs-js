import { ResponseDocument } from "./fault.js";
import type { ServerConnection } from "./innovator.js";
import { documentOuterXml, parseXml } from "./mini-xml.js";

/** Thrown when a stub is asked a question its script has no answer for: the probe stopping, not the engine failing. */
export class StubStop extends Error {
  constructor(requests: number) {
    super(`stop after ${requests}`);
    this.name = "StubStop";
  }
}

const ENVELOPE_OPEN = '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>';
const ENVELOPE_CLOSE = "</SOAP-ENV:Body></SOAP-ENV:Envelope>";

/** A success answer holding `inner`, as the request probe's stub writes it. */
export const stubResult = (inner: string): string => `${ENVELOPE_OPEN}<Result>${inner}</Result>${ENVELOPE_CLOSE}`;

/** A fault answer, as the request probe's stub writes it. */
export const stubFault = (code: string, text: string): string =>
  `${ENVELOPE_OPEN}<SOAP-ENV:Fault xmlns:af="http://www.aras.com/InnovatorFault"><faultcode>${code}</faultcode>` +
  `<faultstring><![CDATA[${text}]]></faultstring><detail><af:legacy_detail><![CDATA[${text}]]></af:legacy_detail></detail></SOAP-ENV:Fault>${ENVELOPE_CLOSE}`;

/**
 * An IOM connection that never touches a network: it records what the engine hands it, written out the way the
 * connection writes it (WIRE-004), and answers from a script. A request the script does not answer ends the run
 * with {@link StubStop}.
 */
export class StubConnection implements ServerConnection {
  /** The wire text of every request, in order. */
  readonly requests: string[] = [];
  readonly actions: string[] = [];

  /** `respond` gets the wire text of a request and returns the answer's XML, or undefined to stop. */
  constructor(private readonly respond: (request: string, action: string) => string | undefined) {}

  async callAction(action: string, request: string): Promise<ResponseDocument> {
    const wire = documentOuterXml(parseXml(request));
    this.actions.push(action);
    this.requests.push(wire);
    const answer = this.respond(wire, action);
    if (answer === undefined) throw new StubStop(this.requests.length);
    return ResponseDocument.parse(answer);
  }
}
