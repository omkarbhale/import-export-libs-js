import type { TranscriptCall } from "../../oracle/src/transcript.js";
import { ResponseDocument } from "../client/fault.js";
import type { ServerConnection } from "../client/innovator.js";
import { documentOuterXml, parseXml } from "../client/mini-xml.js";

/**
 * The connection that serves a recorded run (IMP-400 to IMP-471), and the number of requests a login sends: each request is answered
 * with the next recorded call, which must be the same request. It reads no file, so the replays in a browser page use it as the disk
 * replays do (HOST-265, HOST-266); it was in `transcript-replay.ts`, which still exports it, and moved here unchanged.
 *
 * @spec HOST-265
 * @spec HOST-266
 */

/** The requests of a login, which the replays of a whole run do not send again: `ValidateUser`, the user lookup and the version probe. */
export const LOGIN_CALLS = 6;

/** 12.0's login sends one request less: `GetCurrentUserID` replaces the user lookup, and the probe is two requests (WIRE-017). */
export const LOGIN_CALLS_12_0 = 5;

/** Answers each request with the next recorded call, which must be the same request. */
export class SequentialConnection implements ServerConnection {
  private next: number;

  constructor(
    private readonly calls: TranscriptCall[],
    private readonly loginCalls = LOGIN_CALLS,
  ) {
    this.next = loginCalls;
  }

  get consumed(): number {
    return this.next - this.loginCalls;
  }

  get total(): number {
    return this.calls.length - this.loginCalls;
  }

  async callAction(action: string, request: string): Promise<ResponseDocument> {
    const wire = documentOuterXml(parseXml(request));
    const call = this.calls[this.next];
    if (call?.action !== action || call.request !== wire) {
      throw new Error(
        `request ${this.next - this.loginCalls + 1} differs from the recorded one:\nsent:     ${action} ${wire.slice(0, 600)}\nrecorded: ${call?.action} ${call?.request.slice(0, 600)}`,
      );
    }
    this.next += 1;
    return ResponseDocument.parse(call.response ?? "");
  }
}
