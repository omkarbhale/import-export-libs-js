import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { HttpConnectorExtension, type CallRecord } from "./connection.js";
import { FakeTransport, bodyText, header, respond } from "./fake-transport.js";
import { CItemHelper } from "./item-helper.js";
import { forgetAccessibleOAuthServer } from "./oauth.js";

/**
 * Every 14.0.7 export case begins with the engine's login, user record and
 * version probe. The recorded AML of those first calls must be what the client
 * sends, and the recorded responses what it reads.
 */
const EXPORT_CASES = new URL("../../fixtures/14.0.7/export/", import.meta.url).pathname;
const cases = readdirSync(EXPORT_CASES).filter((name) => existsSync(join(EXPORT_CASES, name, "transcript.jsonl")));

interface Call {
  action: string;
  request: string;
  response: string;
}

function loginCalls(name: string): Call[] {
  return readFileSync(join(EXPORT_CASES, name, "transcript.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .slice(0, 6)
    .map((line) => {
      const { action, request, response } = JSON.parse(line) as Call;
      return { action, request, response };
    });
}

const OAUTH = {
  discovery: '{"locations":[{"uri":"http://dev.example/12sp9/OAuthServer/"}]}',
  configuration: JSON.stringify({
    issuer: "OAuthServer",
    jwks_uri: "http://dev.example/12sp9/OAuthServer/jwks",
    authorization_endpoint: "http://dev.example/12sp9/OAuthServer/connect/authorize",
    token_endpoint: "http://dev.example/12sp9/OAuthServer/connect/token",
    end_session_endpoint: "http://dev.example/12sp9/OAuthServer/connect/endsession",
    protocol_version: "1.0",
    protocol_info: {
      protocol_type: "Standard",
      authorization_header: "Authorization",
      www_authenticate_header: "WWW-Authenticate",
      unauthorized_status_code: "401",
    },
  }),
  token: '{"access_token":"token","expires_in":3600,"token_type":"Bearer"}',
};

describe("the login and version probe of every recorded 14.0.7 export", () => {
  beforeEach(() => forgetAccessibleOAuthServer());

  it("has export cases to replay", () => {
    expect(cases.length).toBeGreaterThan(50);
  });

  it.each(cases)("%s", async (name) => {
    const recorded = loginCalls(name);
    expect(recorded.map((c) => c.action)).toEqual(["ValidateUser", "ApplyItem", "ApplyAML", "ApplyAML", "ApplyAML", "ApplyAML"]);

    let soapCalls = 0;
    const transport = new FakeTransport((request) => {
      if (request.method === "GET") {
        if (request.url.endsWith("OAuthServerDiscovery.aspx")) return respond(OAUTH.discovery);
        return respond(request.url.endsWith("openid-configuration") ? OAUTH.configuration : '{"keys":[]}');
      }
      if (request.url.endsWith("/connect/token")) return respond(OAUTH.token);
      const call = recorded[soapCalls++];
      expect(header(request, "SOAPAction")).toBe(call?.action);
      return respond(call?.response ?? "");
    });

    const calls: CallRecord[] = [];
    const connection = new HttpConnectorExtension({
      url: "http://dev.example/12sp9",
      database: "12sp9",
      userName: "root",
      password: "not-a-real-password",
      timeZoneName: "India Standard Time",
      transport,
      onCall: (call) => calls.push(call),
    });
    const helper = new CItemHelper(connection);
    await helper.login();

    expect(calls.map((c) => ({ action: c.action, request: c.request, response: c.response }))).toEqual(recorded);
    expect(helper.innovatorVersion?.fullString).toBe("12.0 SP9 Build 24090");
    expect(helper.versionGate).toMatchObject({ accepted: true, skipped: false, fittingEngines: ["12.0", "14.0.7", "14.35"] });
    expect(bodyText(transport.requests[transport.requests.length - 1]!)).toContain("VersionServiceUpdate");
  });
});
