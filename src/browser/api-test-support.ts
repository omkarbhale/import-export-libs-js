import { FakeTransport, devServer, header, respond } from "../client/fake-transport.js";
import type { ApiMessage } from "./api-run.js";

/**
 * What the tests of the browser API share, under Node (`api.test.ts`) and in the browsers (`api.browser.test.ts`): the fake servers of
 * the three Aras versions and the comparison of the engine's messages with a recording (HOST-270, HOST-272).
 *
 * @spec HOST-270 HOST-272
 */

export const SERVER_URL = "http://dev.example/12sp9";

/** The login every test gives `connect`. */
export const LOGIN = { url: SERVER_URL, database: "12sp9", userName: "admin", password: "secret-pw", timeZoneName: "UTC" } as const;

const IOM12_USER = `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><GetCurrentUserIDResponse><Result>USER1</Result></GetCurrentUserIDResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

/** A fake server that reports this version; IOM 12's login asks one more thing. */
export function serverOf(major: number, minor: number): FakeTransport {
  const base = devServer({
    variables: { VersionMajor: String(major), VersionMinor: String(minor), VersionServicePack: "0", VersionBuild: "36073", VersionServiceUpdate: "9" },
  });
  return new FakeTransport((request, index) => (header(request, "SOAPAction") === "GetCurrentUserID" ? respond(IOM12_USER) : base(request, index)));
}

/** A message as a recording keeps it. */
export interface Recorded {
  channel: ApiMessage["channel"];
  text: string;
}

/** The messages of a recording (`messages.jsonl`) that have a text, as channel and text. */
export function recordedMessages(jsonl: string): Recorded[] {
  return jsonl
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Recorded)
    .filter(({ text }) => text !== "")
    .map(({ channel, text }) => ({ channel, text }));
}

/** The engine's own messages of a run, as channel and text. */
export const engineMessages = (messages: readonly ApiMessage[]): Recorded[] =>
  messages.filter((message) => message.source === "engine").map(({ channel, text }) => ({ channel, text }));
