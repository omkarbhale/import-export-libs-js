import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { bodyText, devServer, header, respond, type FakeHandler } from "../client/fake-transport.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import type { TransportRequest } from "../client/transport.js";
import { LOGIN_CALLS } from "../import/transcript-replay.js";

const DECLARATION = /^<\?xml[^>]*\?>/;

/** The requests of the login: the user lookup (WIRE-015) and the four of the version probe (WIRE-020), which the recording took from another server. */
const LOGIN_REQUEST = /^<Item type="User" action="get" select="default_vault"|<name>Version(Major|Minor|ServicePack|Build|ServiceUpdate)<\/name>/;

/**
 * The HTTP side of a recorded run, for the tests of the CLI: a fake Aras server that answers the login and the version probe as
 * `devServer` does (a 12.0 SP9 server), and whose every later request must be the next recorded one, which is answered with its
 * recorded response. A request that is not the recorded one is noted in `mismatches` and answered with a fault.
 */
export class RecordedServer {
  private next = LOGIN_CALLS;
  /** The requests that were not the recorded ones. */
  readonly mismatches: string[] = [];
  private readonly login = devServer();

  constructor(private readonly calls: readonly TranscriptCall[]) {}

  /** How many of the recorded requests after the login were sent. */
  get consumed(): number {
    return this.next - LOGIN_CALLS;
  }

  get total(): number {
    return this.calls.length - LOGIN_CALLS;
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
