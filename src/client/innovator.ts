import { DotNetException } from "./dotnet.js";
import { ResponseDocument } from "./fault.js";
import { outerXml } from "./mini-xml.js";

/** What the engine needs of an IOM connection: one SOAP call at a time (`IServerConnection.CallAction`). */
export interface ServerConnection {
  callAction(action: string, request: string): Promise<ResponseDocument>;
}

/**
 * IOM's `Innovator` as the engine uses it: `applyAML` and applying a single
 * item. Neither throws for a fault; the response document tells.
 *
 * @spec WIRE-004 WIRE-006
 */
export class Innovator {
  constructor(readonly connection: ServerConnection) {}

  /** `Innovator.applyAML`: sends the AML as written, with whatever root it has, as `ApplyAML`. */
  applyAML(aml: string): Promise<ResponseDocument> {
    return this.connection.callAction("ApplyAML", aml);
  }

  /**
   * `newItem().loadAML(aml).apply()`: sends the one item of the AML as
   * `ApplyItem`. Anything that is not exactly one `Item`, directly or under
   * `AML` or `Result`, is refused before a request is made.
   */
  async applyItem(aml: string): Promise<ResponseDocument> {
    const items = ResponseDocument.parse(aml).items;
    const [item] = items;
    if (items.length !== 1 || item === undefined) throw new DotNetException("System.Exception", "Not a single item");
    return this.connection.callAction("ApplyItem", outerXml(item));
  }
}
