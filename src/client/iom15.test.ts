import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { HttpConnectorExtension } from "./connection.js";
import { DotNetException } from "./dotnet.js";
import { DEV_VARIABLES, FakeTransport, bodyText, devServer, header, respond, soapFault, soapResult } from "./fake-transport.js";
import type { DevServerOptions } from "./fake-transport.js";
import { CItemException } from "./fault.js";
import { CItemHelper } from "./item-helper.js";
import { Innovator } from "./innovator.js";
import { forgetAccessibleOAuthServer } from "./oauth.js";
import { Iom15PasswordTokenProvider } from "./oauth-iom15.js";
import { TransportError } from "./transport.js";
import type { TransportRequest, TransportResponse } from "./transport.js";
import { ScriptedConnection, fault } from "./scripted-connection.js";
import { VersionRefusal } from "./version.js";

/** The `[14.35]` variants of the client: IOM 15's password handling, framing, faults and the connection state of `CItemHelper`. */

beforeEach(() => forgetAccessibleOAuthServer());

/** The probe's record of which requests IOM 15 marks read-only (`fixtures/wire/14.35-probe/`, `F.iomHelpers`). */
const PROBE_READ_ONLY: Record<string, boolean> = (
  JSON.parse(readFileSync(new URL("../../fixtures/wire/14.35-probe/probe.json", import.meta.url), "utf8")) as {
    scenarios: Record<string, Record<string, Record<string, boolean>>>;
  }
).scenarios["F.iomHelpers"]!["readOnlyHeader"]!;

const MD5_TEST = "098f6bcd4621d373cade4e832627b4f6";
const SHA256_TEST = "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08";
const SHA256_SHAPED = "a".repeat(64);

const settings = (transport: FakeTransport, extra: Record<string, unknown> = {}) => ({
  engine: "14.35" as const,
  url: "http://dev.example/12sp9",
  database: "12sp9",
  userName: "admin",
  password: "test",
  timeZoneName: "Local Zone",
  transport,
  ...extra,
});

const connect = (transport: FakeTransport, extra: Record<string, unknown> = {}) => new HttpConnectorExtension(settings(transport, extra));
const soap = (transport: FakeTransport) => transport.requests.filter((r) => r.url.endsWith("InnovatorServer.aspx"));
const tokens = (transport: FakeTransport) => transport.requests.filter((r) => r.url.endsWith("/connect/token"));
const tokenBody = (request: TransportRequest) => bodyText(request);

/** What a server that wants a hash says to a password it does not like. */
const wantsHash = (code: string) => respond(`{"error":"${code}","error_description":"Incompatible password hash algorithm."}`, { status: 400, reason: "Bad Request" });

/** A dev server whose token endpoint is answered by `token`, which may fall through with undefined. */
const withToken = (token: (request: TransportRequest, nth: number) => TransportResponse | undefined, options: DevServerOptions = {}) => {
  let nth = 0;
  return new FakeTransport(
    devServer({
      ...options,
      override: (request, index) => (request.url.endsWith("/connect/token") ? token(request, nth++) : options.override?.(request, index)),
    }),
  );
};

/** An ApplyAML that the dev server answers with a row. */
const FOUND_AML = "<AML><Item type='Variable' action='get'><name>VersionMajor</name></Item></AML>";

const caught = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
};

describe("the password grant sends the password as given (WIRE-012, WIRE-014)", () => {
  it("puts the password in the request unchanged, in the field order of 14.0.7", async () => {
    const transport = new FakeTransport(devServer());
    await connect(transport).login();
    const [request] = tokens(transport);
    expect(tokenBody(request!)).toBe("grant_type=password&client_id=IOMApp&scope=Innovator&database=12sp9&username=admin&password=test");
    expect(request!.headers).toEqual([
      ["Accept", "application/json"],
      ["Content-Type", "application/x-www-form-urlencoded"],
      ["Host", "dev.example"],
      ["Content-Length", String(Buffer.byteLength(tokenBody(request!)))],
    ]);
    expect(tokens(transport)).toHaveLength(1);
  });

  it("form-encodes a password with reserved and non-ASCII characters as UTF-8", async () => {
    const transport = new FakeTransport(devServer());
    await connect(transport, { password: "p&ss wä€" }).login();
    expect(tokenBody(tokens(transport)[0]!)).toMatch(/&password=p%26ss\+w%C3%A4%E2%82%AC$/);
  });

  it("sends a password that is a hash as it is, and an empty password", async () => {
    const hashed = new FakeTransport(devServer());
    await connect(hashed, { password: MD5_TEST }).login();
    expect(tokenBody(tokens(hashed)[0]!)).toMatch(/&password=098f6bcd4621d373cade4e832627b4f6$/);
    const empty = new FakeTransport(devServer());
    await connect(empty, { password: "" }).login();
    expect(tokenBody(tokens(empty)[0]!)).toMatch(/&password=$/);
  });

  it("refuses a null password and an empty database or user name like IOM does", () => {
    const transport = new FakeTransport(devServer());
    const credentials = { database: "d", userName: "u", password: "p" as string | null };
    const make = (override: { database?: string; userName?: string; password?: string | null }) => () =>
      new Iom15PasswordTokenProvider(transport, "http://dev.example/token", { ...credentials, ...override });
    expect(make({ password: null })).toThrow(new DotNetException("System.ArgumentException", "Password"));
    expect(make({ database: "" })).toThrow("Database");
    expect(make({ userName: "" })).toThrow("UserName");
    expect(make({ database: "", userName: "" })).toThrow("Database");
    expect(make({ password: "" })).not.toThrow();
  });
});

describe("the rehash retry (WIRE-013)", () => {
  it("sends the MD5 digest once when the server wants MD5, and keeps going", async () => {
    const transport = withToken((_request, nth) => (nth === 0 ? wantsHash("incompatible_hash_use_md5") : undefined));
    const connection = connect(transport);
    expect((await connection.login()).isError).toBe(false);
    expect(tokens(transport).map(tokenBody)).toEqual([
      "grant_type=password&client_id=IOMApp&scope=Innovator&database=12sp9&username=admin&password=test",
      `grant_type=password&client_id=IOMApp&scope=Innovator&database=12sp9&username=admin&password=${MD5_TEST}`,
    ]);
    expect(soap(transport).map((r) => header(r, "SOAPAction"))).toEqual(["ValidateUser", "ApplyItem"]);
  });

  it("sends the uppercase SHA-256 digest when the server wants SHA-256", async () => {
    const transport = withToken((_request, nth) => (nth === 0 ? wantsHash("incompatible_hash_use_sha256") : undefined));
    await connect(transport).login();
    expect(tokens(transport).map(tokenBody).map((b) => b.split("&password=")[1])).toEqual(["test", SHA256_TEST]);
  });

  it("lets the error stand when the password is already the other kind of hash", async () => {
    const md5Wanted = withToken(() => wantsHash("incompatible_hash_use_md5"));
    const sha = await connect(md5Wanted, { password: SHA256_SHAPED }).login();
    expect([sha.errorCode, sha.errorSource, sha.errorDetail]).toEqual(["incompatible_hash_use_md5", "OAuthServer", ""]);
    expect(sha.outerXml).toContain('<detail><message key="password_hash_algorithm" value="MD5" /></detail>');
    expect(tokens(md5Wanted)).toHaveLength(1);

    const sha256Wanted = withToken(() => wantsHash("incompatible_hash_use_sha256"));
    const md5 = await connect(sha256Wanted, { password: MD5_TEST }).login();
    expect(md5.outerXml).toContain('<detail><message key="password_hash_algorithm" value="SHA256" /></detail>');
    expect(tokens(sha256Wanted)).toHaveLength(1);
    expect(soap(sha256Wanted)).toHaveLength(0);
  });

  it("makes the second request final, whatever its error", async () => {
    const again = withToken(() => wantsHash("incompatible_hash_use_md5"));
    const fault = await connect(again).login();
    expect(fault.errorCode).toBe("incompatible_hash_use_md5");
    expect(tokens(again)).toHaveLength(2);

    const swapped = withToken((_request, nth) => wantsHash(nth === 0 ? "incompatible_hash_use_md5" : "incompatible_hash_use_sha256"));
    expect((await connect(swapped).login()).errorCode).toBe("incompatible_hash_use_sha256");
    expect(tokens(swapped)).toHaveLength(2);

    const rejected = withToken((_request, nth) =>
      nth === 0 ? wantsHash("incompatible_hash_use_md5") : respond('{"error":"invalid_grant","error_description":"Authentication failed for u"}', { status: 400, reason: "Bad Request" }),
    );
    const final = await connect(rejected).login();
    expect([final.errorCode, final.errorString, final.errorSource, final.errorDetail]).toEqual([
      "invalid_grant",
      "Authentication failed for u",
      "OAuthServer",
      "unknown error",
    ]);
    expect(soap(rejected)).toHaveLength(0);
  });

  it("does not retry another first error", async () => {
    const transport = withToken(() => respond('{"error":"invalid_grant"}', { status: 400, reason: "Bad Request" }));
    const fault = await connect(transport).login();
    expect(fault.errorCode).toBe("invalid_grant");
    expect(tokens(transport)).toHaveLength(1);
    const unavailable = withToken(() => respond("", { status: 503, reason: "Service Unavailable" }));
    expect((await connect(unavailable).login()).errorString).toBe("(ServiceUnavailable) Service Unavailable");
    expect(tokens(unavailable)).toHaveLength(1);
  });

  it("hashes the ASCII bytes of the password at the retry: non-ASCII characters become question marks (WIRE-055)", async () => {
    const transport = withToken((_request, nth) => (nth === 0 ? wantsHash("incompatible_hash_use_md5") : undefined));
    await connect(transport, { password: "päss€" }).login();
    const digest = tokens(transport).map(tokenBody).map((b) => b.split("&password=")[1]);
    expect(digest[0]).toBe("p%C3%A4ss%E2%82%AC");
    expect(digest[1]).toBe("b544f7a9f782edc511bf8336c43a4180");
  });
});

describe("token renewal (WIRE-018)", () => {
  const refuseOnce = (token: (nth: number) => TransportResponse | undefined) => {
    let refused = 0;
    const transport: FakeTransport = withToken((_request, nth) => token(nth), {
      override: (request) => {
        if (header(request, "SOAPAction") === "ApplyAML" && header(request, "Authorization") === "Bearer token-1") {
          refused++;
          return respond("", { status: 401, reason: "Unauthorized" });
        }
        return undefined;
      },
    });
    return { transport, refused: () => refused };
  };

  it("repeats the password grant with the digest the retry left, when the server issued no refresh token", async () => {
    const { transport } = refuseOnce((nth) =>
      nth === 0 ? wantsHash("incompatible_hash_use_md5") : respond(`{"access_token":"token-${nth}"}`),
    );
    const connection = connect(transport);
    await connection.login();
    expect(tokens(transport)).toHaveLength(2);
    const response = await connection.callAction("ApplyAML", FOUND_AML);
    expect(response.isError).toBe(false);
    expect(tokens(transport).map(tokenBody).map((b) => b.split("&password=")[1])).toEqual(["test", MD5_TEST, MD5_TEST]);
    expect(soap(transport).slice(-2).map((r) => header(r, "Authorization"))).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it("renews with the refresh token when the password grant gave one, and replaces it with each answer", async () => {
    let valid = 1;
    let issued = 0;
    const transport = withToken(
      (request) => {
        issued++;
        return respond(
          tokenBody(request).startsWith("grant_type=password")
            ? '{"access_token":"token-1","refresh_token":"r1","expires_in":3600}'
            : `{"access_token":"token-${issued}","refresh_token":"r${issued}"}`,
        );
      },
      {
        override: (request) =>
          header(request, "SOAPAction") === "ApplyAML" && header(request, "Authorization") !== `Bearer token-${valid}`
            ? respond("", { status: 401, reason: "Unauthorized" })
            : undefined,
      },
    );
    const connection = connect(transport);
    await connection.login();
    for (const next of [2, 3]) {
      valid = next;
      expect((await connection.callAction("ApplyAML", FOUND_AML)).isError).toBe(false);
    }
    const [grant, refresh1, refresh2] = tokens(transport);
    expect(tokenBody(grant!)).toMatch(/^grant_type=password/);
    expect(tokenBody(refresh1!)).toBe("grant_type=refresh_token&client_id=IOMApp&refresh_token=r1");
    expect(tokenBody(refresh2!)).toBe("grant_type=refresh_token&client_id=IOMApp&refresh_token=r2");
    expect(refresh1!.headers.map(([name]) => name)).toEqual(["Accept", "Content-Type", "Host", "Content-Length"]);
    expect(tokens(transport)).toHaveLength(3);
    expect(soap(transport).filter((r) => header(r, "SOAPAction") === "ApplyAML").map((r) => header(r, "Authorization"))).toEqual([
      "Bearer token-1",
      "Bearer token-2",
      "Bearer token-2",
      "Bearer token-3",
    ]);
  });

  it("renews by itself once for each of several requests refused at the same time (WIRE-060)", async () => {
    let valid = 1;
    let issued = 0;
    const transport = withToken(
      () => respond(`{"access_token":"token-${++issued}"}`),
      {
        override: (request) =>
          header(request, "SOAPAction") === "ApplyAML" && header(request, "Authorization") !== `Bearer token-${valid}`
            ? respond("", { status: 401, reason: "Unauthorized" })
            : undefined,
      },
    );
    const connection = connect(transport);
    await connection.login();
    valid = 100;
    const results = await Promise.all([1, 2, 3].map(() => connection.callAction("ApplyAML", "<AML/>")));
    expect(results.map((r) => r.isError)).toEqual([true, true, true]);
    // Every one of the three was refused, each renewed, and each renewed token was refused in turn: nothing serialises them.
    expect(tokens(transport)).toHaveLength(1 + 3);
  });

  it("is the fault of a missing refresh token or access token", async () => {
    const missing = async (answer: string) => {
      const transport = withToken(
        (request) =>
          tokenBody(request).startsWith("grant_type=password") ? respond('{"access_token":"token-1","refresh_token":"r1"}') : respond(answer),
        { override: (request) => (header(request, "SOAPAction") === "ApplyAML" ? respond("", { status: 401, reason: "Unauthorized" }) : undefined) },
      );
      const connection = connect(transport);
      await connection.login();
      const response = await connection.callAction("ApplyAML", "<AML/>");
      return [response.errorCode, response.errorString, soap(transport).filter((r) => header(r, "SOAPAction") === "ApplyAML").length];
    };
    expect(await missing('{"access_token":"token-2"}')).toEqual(["999", "System.InvalidOperationException: Refresh token is missing.", 1]);
    expect(await missing('{"refresh_token":"r2"}')).toEqual(["999", "System.InvalidOperationException: Access token is missing.", 1]);
    expect(await missing('{"error":"invalid_grant","error_description":"expired"}')).toEqual(["invalid_grant", "expired", 1]);
  });

  it("makes a second refusal the 999 fault, and sends the request twice", async () => {
    const transport = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ApplyAML" ? respond("", { status: 401, reason: "Unauthorized" }) : devServer()(request, index),
    );
    const response = await connect(transport).callAction("ApplyAML", "<AML/>");
    expect([response.errorCode, response.errorString]).toEqual(["999", "System.Net.WebException: The remote server returned an error: (401) Unauthorized."]);
    expect(soap(transport)).toHaveLength(2);
  });

  it("takes the refusal status from the protocol type, not from the document", async () => {
    const custom = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ApplyAML" && header(request, "X-Aras-Authorization") === "Bearer token-1"
        ? respond("", { status: 498, reason: "Token Expired" })
        : devServer({ protocolType: "Custom" })(request, index),
    );
    const connection = connect(custom);
    await connection.callAction("ApplyAML", "<AML/>");
    expect(tokens(custom)).toHaveLength(2);
    // The document says 401, but a Custom server is refused with 498: a 401 is an ordinary error.
    const ordinary = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ApplyAML" ? respond("", { status: 401, reason: "Unauthorized" }) : devServer({ protocolType: "Custom" })(request, index),
    );
    const response = await connect(ordinary).callAction("ApplyAML", "<AML/>");
    expect(response.errorString).toContain("(401) Unauthorized");
    expect(tokens(ordinary)).toHaveLength(1);
  });
});

describe("the legacy login is IOM 14's (WIRE-016)", () => {
  it("sends AUTHPASSWORD as the MD5 digest first, and switches on a challenge", async () => {
    const legacy = new FakeTransport((request, index) =>
      request.url.endsWith("OAuthServerDiscovery.aspx") ? respond("", { status: 404, reason: "Not Found" }) : devServer()(request, index),
    );
    await connect(legacy).login();
    expect(soap(legacy).map((r) => header(r, "AUTHPASSWORD"))).toEqual([MD5_TEST, MD5_TEST]);
    expect(tokens(legacy)).toHaveLength(0);
  });
});

describe("the read-only header (WIRE-005)", () => {
  const sent = async (engine: "14.0.7" | "14.35", action: string, request: string) => {
    const transport = new FakeTransport(devServer());
    const connection = new HttpConnectorExtension(settings(transport, { engine }));
    await connection.callAction(action, request);
    return soap(transport)[0]!;
  };

  it("is written between TIMEZONE_NAME and SOAPAction, as the capture's order puts the others", async () => {
    const request = await sent("14.35", "ApplyItem", '<Item type="Part" action="get" readOnly="1"/>');
    expect(request.headers.map(([name]) => name)).toEqual([
      "Content-Type",
      "LOCALE",
      "TIMEZONE_NAME",
      "Aras-Request-ReadOnly",
      "SOAPAction",
      "Authorization",
      "Host",
      "Content-Length",
    ]);
    expect(header(request, "Aras-Request-ReadOnly")).toBe("1");
  });

  it.each([
    ["ApplyItem readOnly=1", "ApplyItem", '<Item type="Part" action="get" readOnly="1" />', true],
    ["ApplyItem no attribute", "ApplyItem", '<Item type="Part" action="get" />', false],
    ["ApplyItem readOnly=true", "ApplyItem", '<Item type="Part" action="get" readOnly="true" />', false],
    [
      "ApplyAML all readOnly",
      "ApplyAML",
      '<AML><Item type="Part" action="get" readOnly="1" /><Item type="Part" action="get" readOnly="1" /></AML>',
      true,
    ],
    ["ApplyAML one not readOnly", "ApplyAML", '<AML><Item type="Part" action="get" readOnly="1" /><Item type="Part" action="get" /></AML>', false],
    ["ApplyAML no items", "ApplyAML", "<AML />", true],
    ["ValidateUser", "ValidateUser", '<Item readOnly="1" />', false],
    ["Logoff", "Logoff", '<logoff skip_unlock="1" />', false],
  ] as const)("%s: %s", async (name, action, request, expected) => {
    expect(PROBE_READ_ONLY[name]).toBe(expected);
    expect(header(await sent("14.35", action, request), "Aras-Request-ReadOnly")).toBe(expected ? "1" : undefined);
  });

  it("is also sent for an ApplyAML whose root is not AML, which has no /AML/Item to disagree", async () => {
    expect(header(await sent("14.35", "ApplyAML", "<Item type='Part'/>"), "Aras-Request-ReadOnly")).toBe("1");
  });

  it("matches the action name exactly, and the raw actions and ApplySQL never carry it", async () => {
    expect(header(await sent("14.35", "applyitem", '<Item readOnly="1"/>'), "Aras-Request-ReadOnly")).toBeUndefined();
    expect(header(await sent("14.35", "ApplySQL", "<sql><Query>select 1</Query></sql>"), "Aras-Request-ReadOnly")).toBeUndefined();
    expect(header(await sent("14.35", "GetItem", '<Item readOnly="1"/>'), "Aras-Request-ReadOnly")).toBeUndefined();
  });

  it("is not an IOM 14 header", async () => {
    expect(header(await sent("14.0.7", "ApplyItem", '<Item readOnly="1"/>'), "Aras-Request-ReadOnly")).toBeUndefined();
  });
});

describe("framing of the requests only 14.35 reaches (WIRE-004)", () => {
  it("sends applySQL as <sql><Query>…</Query></sql> with the text escaped", async () => {
    const transport = new FakeTransport(devServer());
    const innovator = new Innovator(connect(transport));
    await innovator.applySql("update t set a = 'x' where b < 2 & c > 1");
    const request = soap(transport)[0]!;
    expect(header(request, "SOAPAction")).toBe("ApplySQL");
    expect(bodyText(request)).toBe(
      "<?xml version='1.0' encoding='utf-8' ?><sql><Query>update t set a = 'x' where b &lt; 2 &amp; c &gt; 1</Query></sql>",
    );
  });

  it("sends a raw action's document re-serialised, and a raw ValidateUser resets the locale", async () => {
    const transport = new FakeTransport(devServer());
    const connection = connect(transport);
    await connection.callAction("GetItem", "<Empty/>");
    expect(bodyText(soap(transport)[0]!)).toBe("<?xml version='1.0' encoding='utf-8' ?><Empty />");
    await connection.callAction("ValidateUser", "<Item/>");
    await connection.callAction("ApplyAML", "<AML/>");
    expect(header(soap(transport)[2]!, "TIMEZONE_NAME")).toBe("Server Time");
  });
});

describe("a cancelled login (WIRE-017, WIRE-056)", () => {
  /** A transport whose requests to `matching` time out, like the proxy that held the discovery request for 105 s. */
  const timingOut = (matching: (request: TransportRequest) => boolean) =>
    new FakeTransport((request, index) => {
      if (matching(request)) throw new TransportError("timeout", "The operation has timed out", "dev.example");
      return devServer()(request, index);
    });

  it.each([
    ["discovery", (r: TransportRequest) => r.url.endsWith("OAuthServerDiscovery.aspx"), 1],
    ["the token request", (r: TransportRequest) => r.url.endsWith("/connect/token"), 4],
  ] as const)("returns with no connection when %s times out, and sends nothing after", async (_name, matching, sent) => {
    const transport = timingOut(matching);
    const helper = new CItemHelper(connect(transport), { engine: "14.35" });
    await expect(helper.login()).resolves.toBeUndefined();
    expect(helper.isConnected).toBe(false);
    expect(helper.innovatorVersion).toBeUndefined();
    expect(helper.versionGate).toBeUndefined();
    expect(transport.requests).toHaveLength(sent);

    const reused = await caught(helper.applyAML("<Item type='User' action='get'/>"));
    expect(reused).toMatchObject({ name: "System.NullReferenceException", message: "Object reference not set to an instance of an object." });
    await helper.logout();
    expect(transport.requests).toHaveLength(sent);
  });

  it("takes any login fault whose faultstring has the exception name, whatever its source, and only that spelling", async () => {
    const login = (faultstring: string) => {
      const connection = new ScriptedConnection({ login: () => fault("999", faultstring) });
      const helper = new CItemHelper(connection, { engine: "14.35" });
      return { helper, connection, result: helper.login() };
    };
    for (const text of ["System.Threading.Tasks.TaskCanceledException: A task was canceled.", "x System.Threading.Tasks.TaskCanceledException y"]) {
      const { helper, connection, result } = login(text);
      await expect(result).resolves.toBeUndefined();
      expect([helper.isConnected, connection.requests]).toEqual([false, []]);
    }
    const lower = login("system.threading.tasks.taskcanceledexception");
    expect(await caught(lower.result)).toMatchObject({ faultcode: -100 });
    expect(lower.helper.isConnected).toBe(true);
  });

  it("makes the manager's constructor fail only when it copies a timeout", async () => {
    const helper = new CItemHelper(connect(timingOut((r) => r.url.endsWith("OAuthServerDiscovery.aspx"))), { engine: "14.35" });
    await helper.login();
    for (const timeout of [5000, -1]) {
      expect(() => helper.applyTimeout(timeout)).toThrow("Object reference not set to an instance of an object.");
    }
    for (const timeout of [0, -2]) expect(() => helper.applyTimeout(timeout)).not.toThrow();
  });

  it("copies the context timeout to the connection of a helper that is connected", async () => {
    const connection = connect(new FakeTransport(devServer()));
    const helper = new CItemHelper(connection, { engine: "14.35" });
    helper.applyTimeout(250);
    expect(connection.timeout).toBe(250);
    helper.applyTimeout(0);
    expect(connection.timeout).toBe(250);
  });

  it("is an ordinary login failure for 14.0.7", async () => {
    const connection = new ScriptedConnection({ engine: "14.0.7", login: () => fault("999", "System.Threading.Tasks.TaskCanceledException: A task was canceled.") });
    expect(await caught(new CItemHelper(connection).login())).toMatchObject({ faultcode: -100 });
  });
});

describe("the gate and the connection state (WIRE-023, WIRE-024, WIRE-040)", () => {
  const login = (major: string, options: { skipVersionCheck?: boolean } = {}) => {
    const transport = new FakeTransport(devServer({ variables: { ...DEV_VARIABLES, VersionMajor: major, VersionServiceUpdate: "5", VersionBuild: "77" } }));
    const helper = new CItemHelper(connect(transport), { engine: "14.35", ...options });
    return { transport, helper, result: helper.login() };
  };
  const logoffs = (transport: FakeTransport) => soap(transport).filter((r) => header(r, "SOAPAction") === "Logoff");

  it("accepts servers 12 to 14 and stays connected", async () => {
    for (const major of ["12", "13", "14"]) {
      const { helper, result } = login(major);
      await result;
      expect(helper.isConnected).toBe(true);
      expect(helper.versionGate).toMatchObject({ engine: "14.35", accepted: true, skipped: false });
    }
  });

  it.each([
    ["15", "15.0.5.77"],
    ["16", "16.0.5.77"],
    ["11", "11.0 SP9 Build 77"],
    ["9", "9.0 SP9 Build 77"],
  ])("refuses server %s naming both versions, and drops the connection", async (major, text) => {
    const { transport, helper, result } = login(major);
    const error = (await caught(result)) as VersionRefusal;
    expect(error).toBeInstanceOf(VersionRefusal);
    expect(error.faultcode).toBe(0);
    expect(error.faultstring).toBe(`You are trying to use incompatible utility of version 14.35.0.0 with innovator version ${text}.`);
    expect(error.faultdetail).toBeNull();
    expect(error.message).toBe("Exception of type 'Aras.Tools.SolutionUpgrade.CItemException' was thrown.");
    expect(helper.isConnected).toBe(false);
    await helper.logout();
    expect(logoffs(transport)).toHaveLength(0);
  });

  it("lets a refused server through with --skip-version-check and keeps the connection", async () => {
    const { helper, result } = login("15", { skipVersionCheck: true });
    await result;
    expect(helper.isConnected).toBe(true);
    expect(helper.versionGate).toMatchObject({ accepted: false, skipped: true });
  });

  it("logs off once, forgets the connection, and then does nothing", async () => {
    const { transport, helper, result } = login("12");
    await result;
    await helper.logout();
    expect(logoffs(transport)).toHaveLength(1);
    expect(bodyText(logoffs(transport)[0]!)).toBe("<?xml version='1.0' encoding='utf-8' ?><logoff skip_unlock=\"1\" />");
    expect(helper.isConnected).toBe(false);
    await helper.logout();
    expect(logoffs(transport)).toHaveLength(1);
  });

  it("forgets the connection after a logout on any connection type, sending nothing for another type", async () => {
    const connection = new ScriptedConnection({});
    const helper = new CItemHelper(connection, { engine: "14.35" });
    expect(helper.isConnected).toBe(true);
    await helper.logout();
    expect([helper.isConnected, connection.requests]).toEqual([false, []]);
    await expect(helper.logout()).resolves.toBeUndefined();
  });

  it("swallows a transport failure at logoff and still forgets the connection", async () => {
    const down = new FakeTransport((request, index) => {
      if (header(request, "SOAPAction") === "Logoff") throw new TransportError("refused", "Unable to connect to the remote server", "dev.example");
      return devServer()(request, index);
    });
    const helper = new CItemHelper(connect(down), { engine: "14.35" });
    await helper.login();
    await expect(helper.logout()).resolves.toBeUndefined();
    expect(helper.isConnected).toBe(false);
  });

  it("keeps the connection after a probe error or a login failure", async () => {
    const probe = new CItemHelper(connect(new FakeTransport(devServer({ variables: { VersionMajor: "12" } }))), { engine: "14.35" });
    expect(await caught(probe.login())).toMatchObject({ name: "System.IndexOutOfRangeException" });
    expect(probe.isConnected).toBe(true);
  });

  it("reads Inn first, so a second login on a dropped connection is a null reference", async () => {
    const { helper, result } = login("15");
    await caught(result);
    expect(await caught(helper.login())).toMatchObject({ name: "System.NullReferenceException" });
  });
});

describe("CItemException texts (WIRE-006, WIRE-017, WIRE-051)", () => {
  it("indents the response and the request in applyAML's exception, with the spelling corrected", async () => {
    const transport = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ApplyItem" ? respond(soapFault("0", "No items of type Part found.")) : devServer()(request, index),
    );
    const error = (await caught(new CItemHelper(connect(transport), { engine: "14.35" }).applyAML("<Item type='Part' action='get'><id>X</id></Item>"))) as CItemException;
    expect(error.faultcode).toBe(0);
    expect(error.faultdetail).toBe("");
    expect(error.faultstring).toBe(
      'Server error\r\n\r\nRequest (formatted):\r\n<Item type="Part" action="get">\r\n  <id>X</id>\r\n</Item>\r\n\r\nResponse (formatted):\r\n' +
        '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">\r\n  <SOAP-ENV:Body>\r\n' +
        "    <SOAP-ENV:Fault>\r\n      <faultcode>0</faultcode>\r\n      <faultstring>No items of type Part found.</faultstring>\r\n" +
        "      <faultactor></faultactor>\r\n      <detail></detail>\r\n    </SOAP-ENV:Fault>\r\n  </SOAP-ENV:Body>\r\n</SOAP-ENV:Envelope>",
    );
    expect(error.message).toBe(error.faultstring);
  });

  it("writes the login failure as IOM made it, not indented", async () => {
    const transport = new FakeTransport((request, index) =>
      request.url.endsWith("/connect/token")
        ? respond('{"error":"invalid_grant","error_description":"Authentication failed for u"}', { status: 400, reason: "Bad Request" })
        : devServer()(request, index),
    );
    const error = (await caught(new CItemHelper(connect(transport, { password: MD5_TEST }), { engine: "14.35" }).login())) as CItemException;
    expect(error.faultcode).toBe(-100);
    expect(error.faultstring).toBe(
      'Failed login to Innovator; original error: <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N">' +
        "<SOAP-ENV:Body><SOAP-ENV:Fault>\r\n\t<faultcode>invalid_grant</faultcode>\r\n\t<faultstring>Authentication failed for u</faultstring>\r\n" +
        "\t<faultactor>OAuthServer</faultactor>\r\n\t<detail>unknown error</detail>\r\n</SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>",
    );
  });

  it("builds the probe's exceptions from the response alone, indented", async () => {
    const transport = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ApplyAML" ? respond(soapFault("500", "boom")) : devServer()(request, index),
    );
    const error = (await caught(new CItemHelper(connect(transport), { engine: "14.35" }).login())) as CItemException;
    expect(error.faultcode).toBe(500);
    expect(error.faultstring).toMatch(/^<SOAP-ENV:Envelope xmlns:SOAP-ENV="[^"]+">\r\n  <SOAP-ENV:Body>\r\n    <SOAP-ENV:Fault>/);
  });

  it("keeps 14.0.7's texts for 14.0.7", async () => {
    const response = (await import("./fault.js")).ResponseDocument.parse(soapFault("1", "x"));
    expect(CItemException.fromRequest("<Item/>", response).message).toMatch(/^Server error\r\n\r\nRequest: <Item\/>\r\n\r\nResponce: /);
    expect(CItemException.fromResponse(response).message).toBe(response.outerXml);
  });
});
