import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { bodyText, devServer, header, respond, type FakeHandler } from "../client/fake-transport.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import type { TransportRequest } from "../client/transport.js";
import type { Engine } from "../engines.js";
import { LOGIN_CALLS, LOGIN_CALLS_12_0 } from "../import/transcript-replay.js";

/** The dev server with `GetCurrentUserID` added, which IOM 12 asks after `ValidateUser`. */
const iom12Login =
  (server: FakeHandler): FakeHandler =>
  (request, index) =>
    header(request, "SOAPAction") === "GetCurrentUserID"
      ? respond(
          `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><GetCurrentUserIDResponse><Result>USER1</Result></GetCurrentUserIDResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`,
        )
      : server(request, index);

const DECLARATION = /^<\?xml[^>]*\?>/;

/** The requests of the login: the user lookup (WIRE-015) and the four of the version probe (WIRE-020), which the recording took from another server. */
const LOGIN_REQUEST = /^<Item type="User" action="get" select="default_vault"|<name>Version(Major|Minor|ServicePack|Build|ServiceUpdate)<\/name>/;

/**
 * The HTTP side of a recorded run, for the tests of the CLI: a fake Aras server that answers the login and the version probe as
 * `devServer` does (a 12.0 SP9 server), and whose every later request must be the next recorded one, which is answered with its
 * recorded response. A request that is not the recorded one is noted in `mismatches` and answered with a fault.
 */
export class RecordedServer {
  private next: number;
  private readonly loginCalls: number;
  /** The requests that were not the recorded ones. */
  readonly mismatches: string[] = [];
  private readonly login: FakeHandler;

  /** `engine` 12.0 answers IOM 12's login, which asks `GetCurrentUserID` and sends one request less (WIRE-017). */
  constructor(
    private readonly calls: readonly TranscriptCall[],
    engine: Engine = "14.0.7",
  ) {
    this.loginCalls = engine === "12.0" ? LOGIN_CALLS_12_0 : LOGIN_CALLS;
    this.next = this.loginCalls;
    this.login = engine === "12.0" ? iom12Login(devServer()) : devServer();
  }

  /** How many of the recorded requests after the login were sent. */
  get consumed(): number {
    return this.next - this.loginCalls;
  }

  get total(): number {
    return this.calls.length - this.loginCalls;
  }

  readonly handler: FakeHandler = (request: TransportRequest, index: number) => {
    const action = header(request, "SOAPAction");
    if (action === undefined || !["ApplyAML", "ApplyItem", "ApplySQL"].includes(action)) return this.login(request, index);
    const wire = documentOuterXml(parseXml(bodyText(request).replace(DECLARATION, "")));
    if (LOGIN_REQUEST.test(wire)) return this.login(request, index);
    const call = this.calls[this.next];
    if (call?.action === action && call.request === wire) {
      this.next += 1;
      return respond(call.response ?? "");
    }
    this.mismatches.push(`request ${this.consumed + 1}: sent ${action} ${wire.slice(0, 400)}\n  recorded ${call?.action} ${call?.request.slice(0, 400)}`);
    return this.login(request, index);
  };
}
