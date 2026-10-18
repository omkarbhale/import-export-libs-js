import { beforeEach, describe, expect, it } from "vitest";
import { DotNetException } from "./dotnet.js";
import { FakeTransport, bodyText, devServer, header, respond } from "./fake-transport.js";
import {
  DiscoveryNotFound,
  OAuthServerError,
  PasswordTokenProvider,
  bearerProtocol,
  discover,
  forgetAccessibleOAuthServer,
} from "./oauth.js";

const DISCOVERY = "http://dev.example/12sp9/Server/OAuthServerDiscovery.aspx";

beforeEach(() => forgetAccessibleOAuthServer());

describe("discover (WIRE-010, WIRE-011)", () => {
  it("makes the three requests in order, with the Host header and nothing else", async () => {
    const transport = new FakeTransport(devServer());
    const document = await discover(transport, DISCOVERY);
    expect(transport.requests.map((r) => [r.method, r.url])).toEqual([
      ["GET", DISCOVERY],
      ["GET", "http://dev.example/12sp9/OAuthServer/.well-known/openid-configuration"],
      ["GET", "http://dev.example/12sp9/OAuthServer/.well-known/openid-configuration/jwks"],
    ]);
    expect(transport.requests.map((r) => r.headers)).toEqual([[["Host", "dev.example"]], [["Host", "dev.example"]], [["Host", "dev.example"]]]);
    expect(document).toEqual({ tokenEndpoint: "http://dev.example/12sp9/OAuthServer/connect/token", protocolType: "Standard", supportsOAuth: true });
  });

  it("tries the locations on the discovery host first, then the rest in order, until one answers", async () => {
    const transport = new FakeTransport((request, index) => {
      if (request.url === DISCOVERY) {
        return respond('{"locations":[{"uri":"http://a.example/x"},{"uri":"http://B.example/y/"},{"uri":"http://DEV.example/z"}]}');
      }
      if (request.url.includes("dev.example/z/") && request.url.endsWith("openid-configuration")) return respond("{}", { status: 503, reason: "Service Unavailable" });
      return devServer({ base: "http://dev.example/12sp9" })(request, index);
    });
    await discover(transport, DISCOVERY);
    expect(transport.requests.map((r) => r.url).filter((u) => u.endsWith("openid-configuration"))).toEqual([
      "http://dev.example/z/.well-known/openid-configuration",
      "http://a.example/x/.well-known/openid-configuration",
    ]);
    expect(transport.requests).toHaveLength(4);
  });

  it("remembers the location that answered, for the process, and tries it first next time", async () => {
    const twoLocations = (request: Parameters<ReturnType<typeof devServer>>[0], index: number) =>
      request.url === DISCOVERY
        ? respond('{"locations":[{"uri":"http://dev.example/one/"},{"uri":"http://dev.example/two/"}]}')
        : request.url.startsWith("http://dev.example/one/") && request.url.endsWith("openid-configuration")
          ? respond("", { status: 500, reason: "Internal Server Error" })
          : devServer()(request, index);
    const first = new FakeTransport(twoLocations);
    await discover(first, DISCOVERY);
    expect(first.requests.map((r) => r.url).filter((u) => u.endsWith("openid-configuration"))).toEqual([
      "http://dev.example/one/.well-known/openid-configuration",
      "http://dev.example/two/.well-known/openid-configuration",
    ]);
    const second = new FakeTransport(twoLocations);
    await discover(second, DISCOVERY);
    expect(second.requests.map((r) => r.url).filter((u) => u.endsWith("openid-configuration"))).toEqual([
      "http://dev.example/two/.well-known/openid-configuration",
    ]);
  });

  it.each([
    ["a 404", respond("", { status: 404, reason: "Not Found" })],
    ["an empty body", respond("")],
  ])("falls back to the legacy login on %s", async (_name, answer) => {
    await expect(discover(new FakeTransport(() => answer), DISCOVERY)).rejects.toBeInstanceOf(DiscoveryNotFound);
  });

  it.each([
    [
      "another error status",
      respond("", { status: 500, reason: "Internal Server Error" }),
      `System.Net.Http.HttpRequestException: Cannot get OAuthServer urls from '${DISCOVERY}' url: (500) Internal Server Error.`,
    ],
    [
      "a body that is not JSON",
      respond("<html>"),
      "Newtonsoft.Json.JsonReaderException: Unexpected character encountered while parsing value: <. Path '', line 0, position 0.",
    ],
    ["no locations", respond("{}"), "System.AggregateException: Cannot get OAuthServer discovery document."],
    ["an empty list of locations", respond('{"locations":[]}'), "System.AggregateException: Cannot get OAuthServer discovery document."],
  ])("fails login on %s", async (_name, answer, faultString) => {
    const error = await discover(new FakeTransport(() => answer), DISCOVERY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DotNetException);
    expect((error as DotNetException).faultString).toBe(faultString);
  });

  it("fails login when no location gives a usable configuration", async () => {
    const transport = new FakeTransport((request, index) =>
      request.url.endsWith("openid-configuration") ? respond('{"issuer":"x"}') : devServer()(request, index),
    );
    await expect(discover(transport, DISCOVERY)).rejects.toThrow("Cannot get OAuthServer discovery document.");
  });

  it("fails login when the key set cannot be read, and that failure is not retried on another location", async () => {
    const transport = new FakeTransport((request, index) =>
      request.url.endsWith("/jwks") ? respond("", { status: 500, reason: "Internal Server Error" }) : devServer()(request, index),
    );
    await expect(discover(transport, DISCOVERY)).rejects.toThrow("Cannot get key set: (500) Internal Server Error.");
    expect(transport.requests).toHaveLength(3);
    await expect(discover(new FakeTransport((r, i) => (r.url.endsWith("/jwks") ? respond("  ") : devServer()(r, i))), DISCOVERY)).rejects.toThrow(
      "Cannot get key set: Response content is empty.",
    );
  });

  it("selects the OAuth login only for protocol version 1.0 or later", async () => {
    const supports = async (protocolVersion: string | undefined) =>
      (await discover(new FakeTransport(devServer({ protocolVersion })), DISCOVERY)).supportsOAuth;
    expect(await supports("1.0")).toBe(true);
    expect(await supports("1.1.3")).toBe(true);
    expect(await supports("0.9")).toBe(false);
    expect(await supports("1")).toBe(false);
    expect(await supports("one")).toBe(false);
    expect(await supports(undefined)).toBe(false);
  });

  it("names the bearer header and the refusal status by protocol type", () => {
    expect(bearerProtocol("Standard")).toEqual({ header: "Authorization", unauthorizedStatus: 401 });
    expect(bearerProtocol("Custom")).toEqual({ header: "X-Aras-Authorization", unauthorizedStatus: 498 });
  });
});

describe("PasswordTokenProvider (WIRE-012, WIRE-013)", () => {
  const TOKEN = "http://dev.example/12sp9/OAuthServer/connect/token";
  const credentials = { database: "12sp9", userName: "admin", password: "test" };
  const provider = (transport: FakeTransport, overrides: Partial<typeof credentials> = {}) =>
    new PasswordTokenProvider(transport, TOKEN, { ...credentials, ...overrides });
  const ok = respond('{"access_token":"abc","expires_in":3600}');

  it("posts the form fields in order, with the MD5 digest", async () => {
    const transport = new FakeTransport(() => ok);
    expect(await provider(transport).getAccessToken()).toBe("abc");
    const [request] = transport.requests;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(TOKEN);
    expect(request?.headers).toEqual([
      ["Accept", "application/json"],
      ["Content-Type", "application/x-www-form-urlencoded"],
      ["Host", "dev.example"],
      ["Content-Length", "124"],
    ]);
    expect(bodyText(request!)).toBe(
      "grant_type=password&client_id=IOMApp&scope=Innovator&database=12sp9&username=admin&password=098f6bcd4621d373cade4e832627b4f6",
    );
  });

  it("encodes reserved characters as Uri.EscapeDataString does, with a space as +", async () => {
    const transport = new FakeTransport(() => ok);
    await provider(transport, { database: "a b/c", userName: "Ü!*'()~-._&=" }).getAccessToken();
    expect(bodyText(transport.requests[0]!)).toContain("database=a+b%2Fc&username=%C3%9C%21%2A%27%28%29~-._%26%3D&");
  });

  it("refuses an empty database or user name before it asks for anything", () => {
    const transport = new FakeTransport(() => ok);
    expect(() => provider(transport, { database: "" })).toThrow(new DotNetException("System.ArgumentException", "Database"));
    expect(() => provider(transport, { userName: "" })).toThrow("UserName");
    expect(transport.requests).toHaveLength(0);
  });

  it("raises the error code and description of a 400, looked up in any case", async () => {
    const answer = respond('{"error":"invalid_grant","Error_Description":"Wrong password"}', { status: 400, reason: "Bad Request" });
    const error = await provider(new FakeTransport(() => answer)).getAccessToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OAuthServerError);
    expect([(error as OAuthServerError).errorCode, (error as OAuthServerError).message]).toEqual(["invalid_grant", "Wrong password"]);
  });

  it("uses the code as the message when there is no description, and reads an error from a 200 too", async () => {
    const error = await provider(new FakeTransport(() => respond('{"error":"invalid_client"}'))).getAccessToken().catch((e: unknown) => e);
    expect([(error as OAuthServerError).errorCode, (error as OAuthServerError).message]).toEqual(["invalid_client", "invalid_client"]);
  });

  it("names any other status as server_error with the status name and reason", async () => {
    const error = await provider(new FakeTransport(() => respond("", { status: 500, reason: "Internal Server Error" })))
      .getAccessToken()
      .catch((e: unknown) => e);
    expect([(error as OAuthServerError).errorCode, (error as OAuthServerError).message]).toEqual([
      "server_error",
      "(InternalServerError) Internal Server Error",
    ]);
  });

  it("gives a body that is not JSON as both the code and the message", async () => {
    const error = await provider(new FakeTransport(() => respond("oops"))).getAccessToken().catch((e: unknown) => e);
    const message = "Unexpected character encountered while parsing value: o. Path '', line 0, position 0.";
    expect([(error as OAuthServerError).errorCode, (error as OAuthServerError).message]).toEqual([message, message]);
  });

  it("fails when the token is missing", async () => {
    await expect(provider(new FakeTransport(() => respond('{"expires_in":1}'))).getAccessToken()).rejects.toThrow(
      "Token value can not be null or empty.",
    );
  });

  it("retries once with the uppercase SHA-256 digest when the server asks for that hash", async () => {
    const transport = new FakeTransport((_request, index) =>
      index === 0 ? respond('{"error":"incompatible_hash_use_sha256"}', { status: 400, reason: "Bad Request" }) : ok,
    );
    expect(await provider(transport).getAccessToken()).toBe("abc");
    expect(transport.requests.map((r) => bodyText(r).split("password=")[1])).toEqual([
      "098f6bcd4621d373cade4e832627b4f6",
      "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08",
    ]);
  });

  it("retries only once, and never for other codes", async () => {
    const asksForSha = respond('{"error":"incompatible_hash_use_sha256"}', { status: 400, reason: "Bad Request" });
    const twice = new FakeTransport(() => asksForSha);
    await expect(provider(twice).getAccessToken()).rejects.toThrow("incompatible_hash_use_sha256");
    expect(twice.requests).toHaveLength(2);

    const md5 = new FakeTransport(() => respond('{"error":"incompatible_hash_use_md5"}', { status: 400, reason: "Bad Request" }));
    await expect(provider(md5).getAccessToken()).rejects.toThrow("incompatible_hash_use_md5");
    expect(md5.requests).toHaveLength(1);
  });

  it("keeps the original error when the password is already an MD5 hash and cannot be switched", async () => {
    const transport = new FakeTransport(() => respond('{"error":"incompatible_hash_use_sha256","error_description":"use sha"}', { status: 400, reason: "Bad Request" }));
    const error = await provider(transport, { password: "098F6BCD4621D373CADE4E832627B4F6" }).getAccessToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OAuthServerError);
    expect((error as Error).message).toBe("use sha");
    expect(transport.requests).toHaveLength(1);
  });

  it("sends the Host header of the token endpoint", async () => {
    const transport = new FakeTransport(() => ok);
    await new PasswordTokenProvider(transport, "https://oauth.example:8443/t", credentials).getAccessToken();
    expect(header(transport.requests[0]!, "Host")).toBe("oauth.example:8443");
  });
});
