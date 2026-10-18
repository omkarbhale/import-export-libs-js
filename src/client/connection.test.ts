import { beforeEach, describe, expect, it } from "vitest";
import { HttpConnectorExtension, HttpServerConnection, applyContextTimeout, type CallRecord } from "./connection.js";
import { FakeTransport, bodyText, devServer, header, respond, soapFault, soapResult } from "./fake-transport.js";
import { forgetAccessibleOAuthServer } from "./oauth.js";
import type { TransportRequest, TransportResponse } from "./transport.js";
import { localWindowsTimeZoneId } from "./timezone.js";
import { TransportError } from "./transport.js";

const settings = (transport: FakeTransport, extra: Record<string, unknown> = {}) => ({
  url: "http://dev.example/12sp9",
  database: "12sp9",
  userName: "admin",
  password: "test",
  timeZoneName: "Local Zone",
  transport,
  ...extra,
});

const soap = (transport: FakeTransport) => transport.requests.filter((r) => r.url.endsWith("InnovatorServer.aspx"));

beforeEach(() => forgetAccessibleOAuthServer());

describe("HttpServerConnection.callAction framing (WIRE-004, WIRE-005)", () => {
  it("posts the declaration and the re-serialised root, with the headers in order", async () => {
    const transport = new FakeTransport(devServer());
    const connection = new HttpConnectorExtension(settings(transport));
    await connection.callAction("ApplyAML", "\r\n\t<AML a='1'>\r\n\t<Item/>\r\n</AML>");
    const request = soap(transport)[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("http://dev.example/12sp9/Server/InnovatorServer.aspx");
    expect(bodyText(request)).toBe("<?xml version='1.0' encoding='utf-8' ?><AML a=\"1\">\r\n\t<Item />\r\n</AML>");
    expect(request.headers).toEqual([
      ["Content-Type", "text/xml"],
      ["LOCALE", "en-US"],
      ["TIMEZONE_NAME", "Local Zone"],
      ["SOAPAction", "ApplyAML"],
      ["Authorization", "Bearer token-1"],
      ["Host", "dev.example"],
      ["Content-Length", String(Buffer.byteLength(bodyText(request)))],
    ]);
  });

  it("sends the body as UTF-8 without a byte order mark", async () => {
    const transport = new FakeTransport(devServer());
    await new HttpConnectorExtension(settings(transport)).callAction("ApplyItem", "<Item>é€</Item>");
    const bytes = soap(transport)[0]!.body!;
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("<?xml");
    expect(Buffer.from(bytes).toString("utf8")).toContain("<Item>é€</Item>");
  });

  it("records each call with the document as loaded and the response document", async () => {
    const transport = new FakeTransport(devServer());
    const calls: CallRecord[] = [];
    const connection = new HttpConnectorExtension(settings(transport, { onCall: (c: CallRecord) => calls.push(c) }));
    await connection.callAction("ApplyAML", "\r\n<AML/>");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: "ApplyAML", request: "\r\n<AML />" });
  });

  it("does not catch a request that is not XML: the caller loaded it", async () => {
    const connection = new HttpConnectorExtension(settings(new FakeTransport(devServer())));
    await expect(connection.callAction("ApplyAML", "oops")).rejects.toThrow("Data at the root level is invalid.");
  });

  it("replays the cookies the server set", async () => {
    const transport = new FakeTransport(devServer());
    const connection = new HttpConnectorExtension(settings(transport));
    await connection.login();
    const requests = soap(transport);
    expect(requests.map((r) => header(r, "Cookie"))).toEqual([undefined, "ASP.NET_SessionId=abc"]);
    await connection.callAction("ApplyAML", "<AML/>");
    expect(header(soap(transport)[2]!, "Cookie")).toBe("ASP.NET_SessionId=abc");
  });

  it("drops a cookie the server expires", async () => {
    const transport = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ApplyAML" && index > 4
        ? respond(soapResult(""), { headers: [["Set-Cookie", "ASP.NET_SessionId=; Max-Age=0"]] })
        : devServer()(request, index),
    );
    const connection = new HttpConnectorExtension(settings(transport));
    await connection.login();
    await connection.callAction("ApplyAML", "<AML/>");
    await connection.callAction("ApplyAML", "<AML/>");
    expect(header(soap(transport)[3]!, "Cookie")).toBeUndefined();
  });

  it("takes the locale and time zone of every ValidateUser response, trimmed, and empties them when absent", async () => {
    const transport = new FakeTransport(devServer());
    const connection = new HttpConnectorExtension(settings(transport));
    await connection.login();
    await connection.callAction("ApplyAML", "<AML/>");
    expect(header(soap(transport)[1]!, "LOCALE")).toBe("en-US");
    expect(header(soap(transport)[1]!, "TIMEZONE_NAME")).toBe("Server Time");

    const bare = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ValidateUser" ? respond(soapFault("1", "denied")) : devServer()(request, index),
    );
    const blank = new HttpConnectorExtension(settings(bare));
    await blank.login();
    await blank.callAction("ApplyAML", "<AML/>");
    expect(header(soap(bare)[1]!, "LOCALE")).toBe("");
    expect(header(soap(bare)[1]!, "TIMEZONE_NAME")).toBe("");
  });

  it("starts with this machine's Windows time zone id when none is given", async () => {
    const transport = new FakeTransport(devServer());
    const { timeZoneName: _unused, ...withoutZone } = settings(transport);
    const connection = new HttpConnectorExtension(withoutZone);
    expect(connection.timeZoneName).toBe(localWindowsTimeZoneId());
  });

  it("uses the locale en-US whatever the settings say", () => {
    const connection = new HttpConnectorExtension({ ...settings(new FakeTransport(devServer())) });
    expect(connection.locale).toBe("en-US");
  });
});

describe("HttpServerConnection login (WIRE-015, WIRE-016, WIRE-018)", () => {
  it("runs discovery, the token request, ValidateUser and the user record, in that order", async () => {
    const transport = new FakeTransport(devServer());
    const connection = new HttpConnectorExtension(settings(transport));
    const user = await connection.login();
    expect(user.isError).toBe(false);
    expect(transport.requests.map((r) => (header(r, "SOAPAction") ?? r.url.split("/").slice(-1)[0]))).toEqual([
      "OAuthServerDiscovery.aspx",
      "openid-configuration",
      "jwks",
      "token",
      "ValidateUser",
      "ApplyItem",
    ]);
    expect(bodyText(soap(transport)[0]!)).toBe("<?xml version='1.0' encoding='utf-8' ?><Item />");
    expect(bodyText(soap(transport)[1]!)).toBe(
      "<?xml version='1.0' encoding='utf-8' ?><Item type=\"User\" action=\"get\" select=\"default_vault\" expand=\"1\"><id>USER1</id>" +
        '<Relationships><Item type="ReadPriority" action="get" select="priority, related_id" expand="1" orderBy="priority" /></Relationships></Item>',
    );
    expect([connection.userId, connection.loggedOnDatabase, connection.loggedOnUser]).toEqual(["USER1", "12sp9", "admin"]);
  });

  it("asks for the user record again without the read priorities when the first fails", async () => {
    let applyItems = 0;
    const transport = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ApplyItem" && applyItems++ === 0 ? respond(soapFault("1", "no")) : devServer()(request, index),
    );
    const user = await new HttpConnectorExtension(settings(transport)).login();
    expect(user.isError).toBe(false);
    expect(bodyText(soap(transport)[2]!)).toBe(
      "<?xml version='1.0' encoding='utf-8' ?><Item type=\"User\" action=\"get\" select=\"default_vault\" expand=\"1\"><id>USER1</id></Item>",
    );
  });

  it("returns the second fault when the user record fails twice, and forgets the user", async () => {
    const transport = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ApplyItem" ? respond(soapFault("7", "no user")) : devServer()(request, index),
    );
    const connection = new HttpConnectorExtension(settings(transport));
    const result = await connection.login();
    expect([result.isError, result.errorCode, result.errorString]).toEqual([true, "7", "no user"]);
    expect(connection.userId).toBeUndefined();
  });

  it("returns a fault from ValidateUser as received, and Unknown error for a response without an id", async () => {
    const refused = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ValidateUser" ? respond(soapFault("SOAP-ENV:Server.Authentication", "bad")) : devServer()(request, index),
    );
    expect((await new HttpConnectorExtension(settings(refused)).login()).errorCode).toBe("SOAP-ENV:Server.Authentication");

    const noId = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ValidateUser" ? respond(soapResult("<user_type>x</user_type>")) : devServer()(request, index),
    );
    const unknown = await new HttpConnectorExtension(settings(noId)).login();
    expect([unknown.errorCode, unknown.errorString]).toEqual(["1", "Unknown error"]);
  });

  it("returns an OAuth fault, with no ValidateUser, when the password is refused", async () => {
    const transport = new FakeTransport((request, index) =>
      request.url.endsWith("/connect/token")
        ? respond('{"error":"invalid_grant","error_description":"Authentication failed."}', { status: 400, reason: "Bad Request" })
        : devServer()(request, index),
    );
    const fault = await new HttpConnectorExtension(settings(transport)).login();
    expect([fault.errorCode, fault.errorString, fault.errorSource, fault.errorDetail]).toEqual([
      "invalid_grant",
      "Authentication failed.",
      "OAuthServer",
      "unknown error",
    ]);
    expect(soap(transport)).toHaveLength(0);
  });

  it.each([
    ["incompatible_hash_use_md5", "MD5"],
    ["incompatible_hash_use_sha256", "SHA256"],
  ])("names the hash algorithm in the detail of %s", async (code, algorithm) => {
    const transport = new FakeTransport((request, index) =>
      request.url.endsWith("/connect/token") ? respond(`{"error":"${code}"}`, { status: 400, reason: "Bad Request" }) : devServer()(request, index),
    );
    // A password that is already an MD5 hash cannot be switched, so even the SHA-256 request is not retried.
    const fault = await new HttpConnectorExtension(settings(transport, { password: "098f6bcd4621d373cade4e832627b4f6" })).login();
    expect(fault.outerXml).toContain(`<detail><message key="password_hash_algorithm" value="${algorithm}" /></detail>`);
  });

  it("returns IOM's own fault when discovery fails or the database is empty", async () => {
    const down = new FakeTransport(() => respond("", { status: 500, reason: "Internal Server Error" }));
    const discovery = await new HttpConnectorExtension(settings(down)).login();
    expect([discovery.errorCode, discovery.errorSource]).toEqual(["999", "HttpServerConnection"]);
    expect(discovery.errorString).toContain("System.Net.Http.HttpRequestException: Cannot get OAuthServer urls from");

    const transport = new FakeTransport(devServer());
    const empty = await new HttpConnectorExtension(settings(transport, { database: "" })).login();
    expect(empty.errorString).toBe("System.ArgumentException: Database");
    expect(soap(transport)).toHaveLength(0);
    expect(transport.requests).toHaveLength(3);
  });

  it("repeats discovery on the next call after a failure", async () => {
    let failing = true;
    const transport = new FakeTransport((request, index) =>
      failing && request.url.endsWith("OAuthServerDiscovery.aspx") ? respond("", { status: 500, reason: "Oops" }) : devServer()(request, index),
    );
    const connection = new HttpConnectorExtension(settings(transport));
    expect((await connection.login()).isError).toBe(true);
    failing = false;
    expect((await connection.login()).isError).toBe(false);
  });

  it("sends the Custom protocol's bearer in X-Aras-Authorization", async () => {
    const transport = new FakeTransport(devServer({ protocolType: "Custom" }));
    await new HttpConnectorExtension(settings(transport)).callAction("ApplyAML", "<AML/>");
    const request = soap(transport)[0]!;
    expect(header(request, "X-Aras-Authorization")).toBe("Bearer token-1");
    expect(header(request, "Authorization")).toBeUndefined();
  });

  it("renews the token once when the server answers with the refusal status, and resends", async () => {
    let tokens = 0;
    const transport = new FakeTransport((request, index) => {
      if (request.url.endsWith("/connect/token")) return respond(`{"access_token":"token-${++tokens}"}`);
      if (header(request, "SOAPAction") === "ApplyAML" && header(request, "Authorization") === "Bearer token-1") {
        return respond("", { status: 401, reason: "Unauthorized" });
      }
      return header(request, "SOAPAction") === "ApplyAML" ? respond(soapResult("")) : devServer()(request, index);
    });
    const connection = new HttpConnectorExtension(settings(transport));
    await connection.callAction("ApplyItem", "<Item/>");
    const response = await connection.callAction("ApplyAML", "<AML/>");
    expect(response.isError).toBe(false);
    expect(soap(transport).map((r) => header(r, "Authorization"))).toEqual(["Bearer token-1", "Bearer token-1", "Bearer token-2"]);
  });

  it("turns a second refusal into a 999 fault", async () => {
    const transport = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ApplyAML" ? respond("", { status: 401, reason: "Unauthorized" }) : devServer()(request, index),
    );
    const response = await new HttpConnectorExtension(settings(transport)).callAction("ApplyAML", "<AML/>");
    expect([response.errorCode, response.errorString]).toEqual(["999", "System.Net.WebException: The remote server returned an error: (401) Unauthorized."]);
    expect(soap(transport)).toHaveLength(2);
  });

  describe("the legacy login", () => {
    const legacy = (override?: (request: TransportRequest, index: number) => TransportResponse | undefined) =>
      new FakeTransport((request, index) =>
        request.url.endsWith("OAuthServerDiscovery.aspx")
          ? respond("", { status: 404, reason: "Not Found" })
          : (override?.(request, index) ?? devServer()(request, index)),
      );

    it("sends AUTHUSER, AUTHPASSWORD and DATABASE in place of the authorization header", async () => {
      const transport = legacy();
      await new HttpConnectorExtension(settings(transport)).login();
      expect(transport.requests).toHaveLength(3);
      expect(soap(transport)[0]!.headers).toEqual([
        ["Content-Type", "text/xml"],
        ["LOCALE", "en-US"],
        ["TIMEZONE_NAME", "Local Zone"],
        ["SOAPAction", "ValidateUser"],
        ["AUTHUSER", "admin"],
        ["AUTHPASSWORD", "098f6bcd4621d373cade4e832627b4f6"],
        ["DATABASE", "12sp9"],
        ["Host", "dev.example"],
        ["Content-Length", "47"],
      ]);
    });

    it("switches the hashing mode a fault asks for and resends the call", async () => {
      const challenge = (mode: string) =>
        respond(
          `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>1</faultcode><faultstring>x</faultstring><detail><supported_authentication_schema><schema mode="${mode}"/></supported_authentication_schema></detail></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`,
        );
      const transport = legacy((request) =>
        header(request, "SOAPAction") === "ValidateUser" && header(request, "AUTHPASSWORD") === "098f6bcd4621d373cade4e832627b4f6"
          ? challenge("SHA256")
          : undefined,
      );
      const connection = new HttpConnectorExtension(settings(transport));
      expect((await connection.login()).isError).toBe(false);
      expect(soap(transport).map((r) => header(r, "AUTHPASSWORD"))).toEqual([
        "098f6bcd4621d373cade4e832627b4f6",
        "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08",
        "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08",
      ]);
    });

    it("turns a mode other than MD5 or SHA256 into a 999 fault", async () => {
      const transport = legacy((request) =>
        header(request, "SOAPAction") === "ValidateUser"
          ? respond(
              '<Envelope><Body><Fault><faultcode>1</faultcode><detail><supported_authentication_schema><schema mode="Plain"/></supported_authentication_schema></detail></Fault></Body></Envelope>',
            )
          : undefined,
      );
      const fault = await new HttpConnectorExtension(settings(transport)).login();
      expect([fault.errorCode, fault.errorString]).toEqual(["999", "System.InvalidOperationException: Unknown hashing mode."]);
    });

    it("does not retry a refusal", async () => {
      const transport = legacy((request) => (header(request, "SOAPAction") === "ApplyAML" ? respond("", { status: 401, reason: "Unauthorized" }) : undefined));
      const response = await new HttpConnectorExtension(settings(transport)).callAction("ApplyAML", "<AML/>");
      expect(response.errorString).toContain("(401) Unauthorized");
      expect(soap(transport)).toHaveLength(1);
    });
  });
});

describe("faults IOM writes itself (WIRE-050)", () => {
  const callWith = async (answer: (request: TransportRequest) => TransportResponse | Promise<TransportResponse>) => {
    const transport = new FakeTransport((request, index) => (request.url.endsWith("InnovatorServer.aspx") ? answer(request) : devServer()(request, index)));
    const response = await new HttpConnectorExtension(settings(transport)).callAction("ApplyAML", "<AML/>");
    return [response.errorCode, response.errorString, response.errorSource, response.errorDetail];
  };

  it("names an error status", async () => {
    expect(await callWith(() => respond(soapFault("1", "server said"), { status: 500, reason: "Internal Server Error" }))).toEqual([
      "999",
      "System.Net.WebException: The remote server returned an error: (500) Internal Server Error.",
      "HttpServerConnection",
      "unknown error",
    ]);
  });

  it.each([
    ["timeout", "The operation has timed out"],
    ["refused", "Unable to connect to the remote server"],
    ["unresolved", "The remote name could not be resolved: 'dev.example'"],
  ] as const)("names a transport failure (%s)", async (failure, message) => {
    const result = await callWith(() => {
      throw new TransportError(failure, message, "dev.example");
    });
    expect(result[1]).toBe(`System.Net.WebException: ${message}`);
  });

  it("names a body that is not XML", async () => {
    expect((await callWith(() => respond("<html>")))[1]).toBe(
      "System.Xml.XmlException: Unexpected end of file has occurred. The following elements are not closed: html. Line 1, position 7.",
    );
    expect((await callWith(() => respond("")))[1]).toBe("System.Xml.XmlException: Root element is missing.");
  });

  it("reads a body with a byte order mark", async () => {
    expect((await callWith(() => respond(`\uFEFF${soapFault("0", "No items")}`)))[0]).toBe("0");
  });

  it("returns a fault the server sent with status 200 as received", async () => {
    expect(await callWith(() => respond(soapFault("0", "No items of type X found.")))).toEqual(["0", "No items of type X found.", "", ""]);
  });
});

describe("timeouts (WIRE-030, WIRE-031)", () => {
  const timeoutsOf = async (timeout: number | undefined) => {
    const transport = new FakeTransport(devServer());
    const connection = new HttpConnectorExtension(settings(transport));
    if (timeout !== undefined) connection.timeout = timeout;
    await connection.callAction("ApplyAML", "<AML/>");
    const request = soap(transport)[0]!;
    return [request.responseTimeoutMs, request.readTimeoutMs];
  };

  it("keeps .NET's defaults at 0: 100 seconds for the response, 300 for reads", async () => {
    expect(await timeoutsOf(undefined)).toEqual([100_000, 300_000]);
  });

  it("applies a timeout in milliseconds to the response only, and -1 waits for ever", async () => {
    expect(await timeoutsOf(5000)).toEqual([5000, 300_000]);
    expect(await timeoutsOf(-1)).toEqual([0, 300_000]);
  });

  it("limits the OAuth requests to 100 seconds whatever the timeout", async () => {
    const transport = new FakeTransport(devServer());
    const connection = new HttpConnectorExtension(settings(transport));
    connection.timeout = 5000;
    await connection.login();
    const oauth = transport.requests.filter((r) => !r.url.endsWith("InnovatorServer.aspx"));
    expect(oauth.map((r) => r.responseTimeoutMs)).toEqual([100_000, 100_000, 100_000, 100_000]);
  });

  it("refuses a negative timeout other than -1", () => {
    const connection = new HttpConnectorExtension(settings(new FakeTransport(devServer())));
    expect(() => (connection.timeout = -2)).toThrow(
      "Timeout can be only be set to 'System.Threading.Timeout.Infinite' or a value >= 0.\r\nParameter name: value",
    );
    connection.timeout = 0;
    expect(connection.timeout).toBe(0);
  });

  it("applies the context timeout only when it is above 0 or exactly -1, and to an IOM connection", () => {
    const connection = new HttpServerConnection({ ...settings(new FakeTransport(devServer())), locale: "en-US" });
    for (const [given, expected] of [[0, 0], [-2, 0], [250, 250], [0, 250], [-1, -1], [-5, -1]] as const) {
      applyContextTimeout(connection, given);
      expect(connection.timeout).toBe(expected);
    }
    expect(() => applyContextTimeout({}, 5)).not.toThrow();
  });
});

describe("logout (WIRE-040)", () => {
  it("sends Logoff with skip_unlock, and never fails for a transport problem", async () => {
    const transport = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "Logoff" ? respond("", { status: 500, reason: "Boom" }) : devServer()(request, index),
    );
    const connection = new HttpConnectorExtension(settings(transport));
    await connection.login();
    await expect(connection.logout()).resolves.toBeUndefined();
    const logoff = soap(transport).pop()!;
    expect(bodyText(logoff)).toBe("<?xml version='1.0' encoding='utf-8' ?><logoff skip_unlock=\"1\" />");
    expect(header(logoff, "SOAPAction")).toBe("Logoff");
    expect(connection.userId).toBeUndefined();
  });
});
