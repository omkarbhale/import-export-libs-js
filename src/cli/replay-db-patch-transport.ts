import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { bodyText, devServer, header, respond, type FakeHandler } from "../client/fake-transport.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";
import type { TransportRequest } from "../client/transport.js";

const DECLARATION = /^<\?xml[^>]*\?>/;

/** The calls of the host's login (WIRE-002) in a recording: the user lookup, the version probe and `ValidateUser`. */
const LOGIN_CALLS = 6;

/** The requests of the login, which the fake server answers as a 12.0 SP9 server: the `ValidateUser` of the login has the body `<Item />`. */
const LOGIN_REQUEST = /^<Item \/>$|^<Item type="User" action="get" select="default_vault"|<name>Version(Major|Minor|ServicePack|Build|ServiceUpdate)<\/name>/;

/** The ids the engine gave the items it added, which a run of the port draws for itself. */
const ADDED_ID = /(action="add" id=")[0-9A-F]{32}"/;

const SOAP_ACTIONS = ["ApplyAML", "ApplyItem", "ValidateUser", "GetItem", "ApplyUpdate"];

/**
 * The HTTP side of a recorded DB patch run, for the tests of the CLI: a fake Aras server that answers the login and the version
 * probe as `devServer` does, and whose every later request must be the next recorded one, which is answered with its recorded
 * response. The id of an item the request adds is the port's own and is not compared. A request that is not the recorded one is
 * noted in `mismatches` and answered with a fault.
 */
export class RecordedDbPatchServer {
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
    if (action === undefined || !SOAP_ACTIONS.includes(action)) return this.login(request, index);
    const wire = documentOuterXml(parseXml(bodyText(request).replace(DECLARATION, "")));
    if (LOGIN_REQUEST.test(wire)) return this.login(request, index);
    const call = this.calls[this.next];
    if (call?.action === action && call.request.replace(ADDED_ID, "$1<new>\"") === wire.replace(ADDED_ID, "$1<new>\"")) {
      this.next += 1;
      return respond(call.response ?? "");
    }
    this.mismatches.push(`request ${this.consumed + 1}: sent ${action} ${wire.slice(0, 400)}\n  recorded ${call?.action} ${call?.request.slice(0, 400)}`);
    return this.login(request, index);
  };
}
