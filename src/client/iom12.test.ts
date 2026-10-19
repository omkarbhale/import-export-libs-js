import { beforeEach, describe, expect, it } from "vitest";
import { HttpConnectorExtension, HttpServerConnection, type ConnectionSettings } from "./connection.js";
import { DEV_VARIABLES, FakeTransport, bodyText, devServer, header, respond, soapFault, soapResult } from "./fake-transport.js";
import { CItemException } from "./fault.js";
import { CItemHelper } from "./item-helper.js";
import { forgetAccessibleOAuthServer } from "./oauth.js";
import { serverUrls } from "./url.js";
import { VersionRefusal, currentUtilityVersion, engineAcceptsServer } from "./version.js";
import type { TransportRequest, TransportResponse } from "./transport.js";

/**
 * The `[12.0]` variants of the wire rules (`spec/wire.md`): IOM 12's URL test, its two-request discovery and token request, the
 * `GetCurrentUserID` login, the exact-type login dispatch, the two-request probe and the gate with major version 12. The capture
 * of the real reference host is replayed in capture.test.ts.
 */
beforeEach(() => forgetAccessibleOAuthServer());

const settings = (transport: FakeTransport, extra: Partial<ConnectionSettings> = {}): ConnectionSettings => ({
  url: "http://dev.example/12sp9",
  database: "12sp9",
  userName: "admin",
  password: "test",
  locale: "en-US",
  timeZoneName: "Local Zone",
  transport,
  engine: "12.0",
  ...extra,
});

/** The dev server of the fake transport, with GetCurrentUserID added: IOM 12 asks it after ValidateUser. */
const server =
  (override?: (request: TransportRequest, index: number) => TransportResponse | undefined, variables?: Record<string, string | undefined>) =>
  (request: TransportRequest, index: number): TransportResponse =>
    override?.(request, index) ??
    (header(request, "SOAPAction") === "GetCurrentUserID"
      ? respond(`<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><GetCurrentUserIDResponse><Result>USER1</Result></GetCurrentUserIDResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`)
      : (devServer(variables ? { variables } : {})(request, index) as TransportResponse));

const labels = (transport: FakeTransport): string[] =>
  transport.requests.map((r) => header(r, "SOAPAction") ?? (r.url.split("/").slice(-1)[0] as string));

const caught = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
};

describe("WIRE-003: IOM 12 tests for the suffix Server/InnovatorServer.aspx", () => {
  it.each([
    ["http://h/Innovator", "http://h/Innovator/Server/"],
    ["http://h/Innovator/", "http://h/Innovator/Server/"],
    ["http://h/Innovator/Server/InnovatorServer.aspx", "http://h/Innovator/Server/"],
    ["http://h/Innovator/SERVER/INNOVATORSERVER.ASPX", "http://h/Innovator/SERVER/"],
    // 14.0.7 takes this one as it stands
    ["http://h/Innovator/InnovatorServer.aspx", "http://h/Innovator/InnovatorServer.aspx/Server/"],
    ["http://h/Innovator/Server/InnovatorServerXaspx/Server/InnovatorServer.aspx", "http://h/Innovator/Server//Server/"],
  ])("%s has base %s", (url, base) => {
    expect(serverUrls(url, "12.0")).toEqual({ base, soap: `${base}InnovatorServer.aspx`, discovery: `${base}OAuthServerDiscovery.aspx` });
  });

  it("is unchanged for the other engines", () => {
    expect(serverUrls("http://h/Innovator/InnovatorServer.aspx").base).toBe("http://h/Innovator/");
  });
});

describe("WIRE-010 to WIRE-015: IOM 12's login", () => {
  it("runs two discovery requests (the first with its session header), the token request, ValidateUser, GetCurrentUserID and the user record", async () => {
    const transport = new FakeTransport(server());
    const connection = new HttpConnectorExtension(settings(transport));
    const user = await connection.login();
    expect(user.isError).toBe(false);
    expect(labels(transport)).toEqual(["OAuthServerDiscovery.aspx", "openid-configuration", "token", "ValidateUser", "GetCurrentUserID", "ApplyItem"]);
    expect(transport.requests[0]?.headers).toEqual([
      ["Aras-Set-HttpSessionState-Behavior", "switch_to_initial"],
      ["Host", "dev.example"],
    ]);
    expect(transport.requests[1]?.headers).toEqual([["Host", "dev.example"]]);
    expect(bodyText(transport.requests[4] as TransportRequest)).toBe("<?xml version='1.0' encoding='utf-8' ?><Empty />");
    expect(connection.userId).toBe("USER1");
    // the database and the login name of the answer are not kept
    expect([connection.loggedOnDatabase, connection.loggedOnUser]).toEqual([undefined, undefined]);
  });

  it("sends the token request with client_id first, and username before database", async () => {
    const transport = new FakeTransport(server());
    await new HttpConnectorExtension(settings(transport)).login();
    expect(bodyText(transport.requests[2] as TransportRequest)).toBe(
      "client_id=IOMApp&grant_type=password&scope=Innovator&username=admin&database=12sp9&password=098f6bcd4621d373cade4e832627b4f6",
    );
  });

  it("leaves username out for an empty user name, and refuses an empty database after the discovery", async () => {
    const transport = new FakeTransport(server());
    await new HttpConnectorExtension(settings(transport, { userName: "" })).login();
    expect(bodyText(transport.requests[2] as TransportRequest)).toBe(
      "client_id=IOMApp&grant_type=password&scope=Innovator&database=12sp9&password=098f6bcd4621d373cade4e832627b4f6",
    );

    const empty = new FakeTransport(server());
    const fault = await new HttpConnectorExtension(settings(empty, { database: "" })).login();
    expect(fault.errorString).toBe("System.ArgumentException: Database");
    expect(empty.requests).toHaveLength(2);
  });

  it("never asks for the key set, and reads only the protocol type and version of the configuration", async () => {
    const transport = new FakeTransport(
      server((request) =>
        request.url.endsWith("openid-configuration")
          ? respond('{"protocol_version":"1.0","protocol_info":{"protocol_type":"Custom"}}')
          : undefined,
      ),
    );
    const connection = new HttpConnectorExtension(settings(transport));
    await connection.login();
    expect(transport.requests.some((r) => r.url.endsWith("/jwks"))).toBe(false);
    expect(header(transport.requests[3] as TransportRequest, "X-Aras-Authorization")).toBe("Bearer token-1");
  });

  it("uses the legacy headers for a protocol version below 1.0, and when the discovery page is missing or empty", async () => {
    for (const discovery of [respond("", { status: 404, reason: "Not Found" }), respond("  ")]) {
      const transport = new FakeTransport(server((request) => (request.url.endsWith("OAuthServerDiscovery.aspx") ? discovery : undefined)));
      await new HttpConnectorExtension(settings(transport)).login();
      expect(labels(transport)).toEqual(["OAuthServerDiscovery.aspx", "ValidateUser", "GetCurrentUserID", "ApplyItem"]);
      expect(header(transport.requests[1] as TransportRequest, "AUTHUSER")).toBe("admin");
    }
    const old = new FakeTransport(
      server((request) => (request.url.endsWith("openid-configuration") ? respond('{"protocol_version":"0.9","protocol_info":{"protocol_type":"Standard"}}') : undefined)),
    );
    await new HttpConnectorExtension(settings(old)).login();
    expect(header(old.requests[3] as TransportRequest, "AUTHPASSWORD")).toBe("098f6bcd4621d373cade4e832627b4f6");
  });

  it("skips a location that does not answer with a usable document, and tries the next", async () => {
    const transport = new FakeTransport(
      server((request) => {
        if (request.url.endsWith("OAuthServerDiscovery.aspx")) {
          return respond('{"locations":[{"uri":"http://dev.example/bad/"},{"uri":"http://dev.example/12sp9/OAuthServer"}]}');
        }
        if (request.url === "http://dev.example/bad/.well-known/openid-configuration") return respond('{"protocol_info":{"protocol_type":"Other"}}');
        if (request.url === "http://dev.example/12sp9/OAuthServer/.well-known/openid-configuration") {
          return respond('{"protocol_version":"1.0","protocol_info":{"protocol_type":"Standard"}}');
        }
        return undefined;
      }),
    );
    await new HttpConnectorExtension(settings(transport)).login();
    expect(transport.requests.map((r) => r.url).slice(0, 4)).toEqual([
      "http://dev.example/12sp9/Server/OAuthServerDiscovery.aspx",
      "http://dev.example/bad/.well-known/openid-configuration",
      "http://dev.example/12sp9/OAuthServer/.well-known/openid-configuration",
      "http://dev.example/12sp9/OAuthServer/connect/token",
    ]);
  });

  it("fails with IOM 12's own faults when discovery does not work", async () => {
    const status = await new HttpConnectorExtension(
      settings(new FakeTransport(() => respond("", { status: 500, reason: "Internal Server Error" }))),
    ).login();
    expect([status.errorCode, status.errorString]).toEqual(["999", "System.Net.WebException: The remote server returned an error: (500) Internal Server Error."]);

    const notJson = await new HttpConnectorExtension(settings(new FakeTransport(() => respond("<html/>")))).login();
    expect(notJson.errorString).toContain("Newtonsoft.Json.JsonReaderException: ");

    const none = await new HttpConnectorExtension(
      settings(new FakeTransport((request) => (request.url.endsWith("OAuthServerDiscovery.aspx") ? respond("{}") : respond("")))),
    ).login();
    expect(none.errorString).toBe("System.AggregateException: Cannot require OAuth server discovery information.");

    const unusable = await new HttpConnectorExtension(
      settings(new FakeTransport((request) => (request.url.endsWith("OAuthServerDiscovery.aspx") ? respond('{"locations":[{"uri":"http://dev.example/x/"}]}') : respond("{}")))),
    ).login();
    expect(unusable.errorString).toBe(
      "System.AggregateException: Cannot require OAuth server discovery information. (Cannot require OAuth server discovery information based on 'http://dev.example/x/' url.)",
    );
  });

  it("wraps a token answer that is not JSON in an AggregateException, and reads an OAuth error as 14.0.7 does", async () => {
    const notJson = new FakeTransport(server((request) => (request.url.endsWith("/connect/token") ? respond("oops") : undefined)));
    const fault = await new HttpConnectorExtension(settings(notJson)).login();
    expect(fault.errorString).toBe("System.AggregateException: One or more errors occurred. (Invalid JSON response)");

    const refused = new FakeTransport(
      server((request) =>
        request.url.endsWith("/connect/token") ? respond('{"error":"invalid_grant","error_description":"No."}', { status: 400, reason: "Bad Request" }) : undefined,
      ),
    );
    const oauth = await new HttpConnectorExtension(settings(refused)).login();
    expect([oauth.errorCode, oauth.errorString, oauth.errorSource]).toEqual(["invalid_grant", "No.", "OAuthServer"]);
  });

  it("answers a ValidateUser without an id with Failed to login, and returns a GetCurrentUserID fault", async () => {
    const noId = new FakeTransport(server((request) => (header(request, "SOAPAction") === "ValidateUser" ? respond(soapResult("<user_type>x</user_type>")) : undefined)));
    const failed = await new HttpConnectorExtension(settings(noId)).login();
    expect([failed.errorCode, failed.errorString, failed.errorSource]).toEqual(["1", "Failed to login", ""]);

    const fault = new FakeTransport(server((request) => (header(request, "SOAPAction") === "GetCurrentUserID" ? respond(soapFault("7", "no id")) : undefined)));
    const second = await new HttpConnectorExtension(settings(fault)).login();
    expect([second.errorCode, second.errorString]).toEqual(["7", "no id"]);
  });

  it("throws System.Exception when GetCurrentUserID answers without a Result", async () => {
    const transport = new FakeTransport(
      server((request) =>
        header(request, "SOAPAction") === "GetCurrentUserID"
          ? respond('<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><Other/></SOAP-ENV:Body></SOAP-ENV:Envelope>')
          : undefined,
      ),
    );
    const error = await caught(new HttpConnectorExtension(settings(transport)).login());
    expect(error).toMatchObject({ typeName: "System.Exception", message: "Cannot obtain user id" });
  });

  it("asks for the user record again without the read priorities, and returns the second fault", async () => {
    let records = 0;
    const transport = new FakeTransport(server((request) => (header(request, "SOAPAction") === "ApplyItem" && records++ === 0 ? respond(soapFault("1", "no")) : undefined)));
    expect((await new HttpConnectorExtension(settings(transport)).login()).isError).toBe(false);
    expect(labels(transport).slice(-2)).toEqual(["ApplyItem", "ApplyItem"]);
  });
});

describe("WIRE-017, WIRE-040: the exact-type login dispatch", () => {
  const dev = () => new FakeTransport(server());

  it("logs in a connection of exactly the type HttpConnectorExtension", async () => {
    const transport = dev();
    const helper = new CItemHelper(new HttpConnectorExtension(settings(transport)), { engine: "12.0" });
    await helper.login();
    expect(labels(transport)).toContain("ValidateUser");
    expect(labels(transport).filter((label) => label === "ApplyAML")).toHaveLength(2);
    expect(helper.innovatorVersion).toMatchObject({ major: 12, minor: 0, servicePack: 9, build: 0, serviceUpdate: 0 });
  });

  it("sends no ValidateUser for a plain HttpServerConnection or a subclass: the probe starts the discovery", async () => {
    class Derived extends HttpConnectorExtension {}
    for (const make of [() => new HttpServerConnection(settings(dev())), () => new Derived(settings(dev()))]) {
      const connection = make();
      await new CItemHelper(connection, { engine: "12.0" }).login();
      const labelsOf = (connection as unknown as { settings: { transport: FakeTransport } }).settings.transport;
      expect(labels(labelsOf)).not.toContain("ValidateUser");
      expect(labels(labelsOf)[0]).toBe("OAuthServerDiscovery.aspx");
    }
  });

  it("14.0.7 logs in any HttpServerConnection", async () => {
    const transport = new FakeTransport(devServer());
    await new CItemHelper(new HttpServerConnection({ ...settings(transport), engine: "14.0.7" }), { engine: "14.0.7" }).login();
    expect(labels(transport)).toContain("ValidateUser");
  });

  it("throws the -100 login failure with the fault's outer XML", async () => {
    const transport = new FakeTransport(server((request) => (header(request, "SOAPAction") === "ValidateUser" ? respond(soapFault("9", "denied")) : undefined)));
    const error = (await caught(new CItemHelper(new HttpConnectorExtension(settings(transport)), { engine: "12.0" }).login())) as CItemException;
    expect(error.faultcode).toBe(-100);
    expect(error.message).toContain("Failed login to Innovator; original error: <SOAP-ENV:Envelope");
  });
});

describe("WIRE-020 to WIRE-024: the probe and the gate of the 12.0 engine", () => {
  it("sends two ApplyAML requests with the literals of 14.0.7: major and minor, then the service pack", async () => {
    const transport = new FakeTransport(server());
    await new CItemHelper(new HttpConnectorExtension(settings(transport)), { engine: "12.0" }).login();
    const declaration = "<?xml version='1.0' encoding='utf-8' ?>";
    expect(transport.requests.filter((r) => header(r, "SOAPAction") === "ApplyAML").map(bodyText)).toEqual([
      `${declaration}<AML>\r\n\t\t\t\t<Item type="Variable" action="get" select="name, value">\r\n\t\t\t\t\t<name>VersionMajor</name>\r\n\t\t\t\t</Item>\r\n\t\t\t\t<Item type="Variable" action="get" select="name, value">\r\n\t\t\t\t\t<name>VersionMinor</name>\r\n\t\t\t\t</Item>\r\n\t\t\t</AML>`,
      `${declaration}<AML>\r\n\t\t\t\t<Item type="Variable" action="get" select="name, value">\r\n\t\t\t\t\t<name>VersionServicePack</name>\r\n\t\t\t\t</Item>\r\n\t\t\t</AML>`,
    ]);
  });

  it("reads the service pack as 14.0.7 does", async () => {
    for (const [value, expected] of [["SP9", 9], ["SP9 SU1", 0], ["", 0], [undefined, 0]] as const) {
      const transport = new FakeTransport(server(undefined, { ...DEV_VARIABLES, VersionServicePack: value }));
      const helper = new CItemHelper(new HttpConnectorExtension(settings(transport)), { engine: "12.0" });
      await helper.login();
      expect(helper.innovatorVersion?.servicePack).toBe(expected);
    }
  });

  it("gates on the engine's major version 12: servers 10, 11 and 12 pass, 9 and 13 do not", () => {
    expect(currentUtilityVersion("12.0")).toMatchObject({ major: 12, minor: 0, servicePack: 0 });
    expect([9, 10, 11, 12, 13].map((major) => engineAcceptsServer("12.0", major))).toEqual([false, true, true, true, false]);
  });

  it("refuses a server of 13 with the faultcode 0 and the type names, and a 10 server is let in", async () => {
    const refused = new CItemHelper(new HttpConnectorExtension(settings(new FakeTransport(server(undefined, { ...DEV_VARIABLES, VersionMajor: "13" })))), { engine: "12.0" });
    const error = await caught(refused.login());
    expect(error).toBeInstanceOf(VersionRefusal);
    expect(error).toMatchObject({
      faultcode: 0,
      faultstring:
        "You are trying to use incompatible utility of version Aras.Tools.SolutionUpgrade.ArasVersion with innovator version Aras.Tools.SolutionUpgrade.ArasVersion.",
    });
    const ten = new CItemHelper(new HttpConnectorExtension(settings(new FakeTransport(server(undefined, { ...DEV_VARIABLES, VersionMajor: "10" })))), { engine: "12.0" });
    await ten.login();
    expect(ten.versionGate).toMatchObject({ accepted: true, engine: "12.0" });
  });
});

describe("WIRE-006, WIRE-051: applyAML builds its exception from the response alone", () => {
  it("has the response's outer XML as faultstring and message, with no Server error text", async () => {
    const transport = new FakeTransport(server((request) => (header(request, "SOAPAction") === "ApplyItem" ? respond(soapFault("5", "nope")) : undefined)));
    const helper = new CItemHelper(new HttpConnectorExtension(settings(transport)), { engine: "12.0" });
    const error = (await caught(helper.applyAML("<Item type='List' action='get'/>"))) as CItemException;
    expect(error.faultcode).toBe(5);
    expect(error.faultstring?.startsWith("<SOAP-ENV:Envelope")).toBe(true);
    expect(error.message).toBe(error.faultstring);
    expect(error.message).not.toContain("Server error");
  });

  it("adds Unable to get packages meta. alone to the detail of getSolutions", async () => {
    const transport = new FakeTransport(server((request) => (header(request, "SOAPAction") === "ApplyItem" ? respond(soapFault("5", "nope")) : undefined)));
    const helper = new CItemHelper(new HttpConnectorExtension(settings(transport)), { engine: "12.0" });
    const error = (await caught(helper.getSolutions())) as CItemException;
    expect(error.faultdetail).toBe("Unable to get packages meta.");
  });
});
