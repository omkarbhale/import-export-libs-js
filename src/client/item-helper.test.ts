import { beforeEach, describe, expect, it } from "vitest";
import { HttpConnectorExtension, HttpServerConnection } from "./connection.js";
import { DEV_VARIABLES, FakeTransport, bodyText, devServer, header, respond, soapFault } from "./fake-transport.js";
import { CItemException } from "./fault.js";
import { CItemHelper, CLIENT_ENGINES, EngineNotSupportedError } from "./item-helper.js";
import { Innovator } from "./innovator.js";
import { forgetAccessibleOAuthServer } from "./oauth.js";
import { ArasVersion, VersionRefusal, currentUtilityVersion, engineAcceptsServer, enginesAcceptingServer } from "./version.js";

beforeEach(() => forgetAccessibleOAuthServer());

const connect = (transport: FakeTransport) =>
  new HttpConnectorExtension({
    url: "http://dev.example/12sp9",
    database: "12sp9",
    userName: "admin",
    password: "test",
    timeZoneName: "Local Zone",
    transport,
  });

const withVariables = (variables: Record<string, string | undefined>) => new FakeTransport(devServer({ variables }));
const probeRequests = (transport: FakeTransport) =>
  transport.requests.filter((r) => header(r, "SOAPAction") === "ApplyAML").map(bodyText);

const caught = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
};

describe("CItemHelper.login: the version probe (WIRE-020, WIRE-021)", () => {
  it("sends four ApplyAML requests whose CRLF and tab whitespace reach the wire", async () => {
    const transport = withVariables(DEV_VARIABLES);
    await new CItemHelper(connect(transport)).login();
    const declaration = "<?xml version='1.0' encoding='utf-8' ?>";
    const one = (name: string) =>
      `${declaration}<AML>\r\n\t\t\t\t<Item type="Variable" action="get" select="name, value">\r\n\t\t\t\t\t<name>${name}</name>\r\n\t\t\t\t</Item>\r\n\t\t\t</AML>`;
    expect(probeRequests(transport)).toEqual([
      `${declaration}<AML>\r\n\t\t\t\t<Item type="Variable" action="get" select="name, value">\r\n\t\t\t\t\t<name>VersionMajor</name>\r\n\t\t\t\t</Item>\r\n\t\t\t\t<Item type="Variable" action="get" select="name, value">\r\n\t\t\t\t\t<name>VersionMinor</name>\r\n\t\t\t\t</Item>\r\n\t\t\t</AML>`,
      one("VersionServicePack"),
      one("VersionBuild"),
      one("VersionServiceUpdate"),
    ]);
  });

  it("reads dev's 12.0 SP9 build 24090", async () => {
    const helper = new CItemHelper(connect(withVariables(DEV_VARIABLES)));
    await helper.login();
    expect(helper.innovatorVersion).toEqual(new ArasVersion(12, 0, 9, 24090, 0));
    expect(helper.innovatorVersion?.fullString).toBe("12.0 SP9 Build 24090");
  });

  it.each([
    ["SP9", 9],
    ["9", 9],
    ["SPSP4", 4],
    ["SP9 SU1", 0],
    ["", 0],
    ["x", 0],
    [undefined, 0],
  ])("reads the service pack %j as %d", async (value, expected) => {
    const helper = new CItemHelper(connect(withVariables({ ...DEV_VARIABLES, VersionServicePack: value })));
    await helper.login();
    expect(helper.innovatorVersion?.servicePack).toBe(expected);
  });

  it("counts a missing build or service update (faultcode 0) as 0", async () => {
    const helper = new CItemHelper(connect(withVariables({ ...DEV_VARIABLES, VersionBuild: undefined, VersionServiceUpdate: undefined })));
    await helper.login();
    expect(helper.innovatorVersion).toEqual(new ArasVersion(12, 0, 9, 0, 0));
  });

  it("throws the fault of any other faultcode from the later requests, built from the response alone", async () => {
    const transport = new FakeTransport((request, index) =>
      bodyText(request).includes("VersionBuild") ? respond(soapFault("5", "boom")) : devServer()(request, index),
    );
    const error = await caught(new CItemHelper(connect(transport)).login());
    expect(error).toBeInstanceOf(CItemException);
    expect((error as CItemException).faultcode).toBe(5);
    expect(error.message).toContain("<faultcode>5</faultcode>");
  });

  it("throws on a fault of the first request, faultcode 0 included", async () => {
    const error = await caught(new CItemHelper(connect(withVariables({}))).login());
    expect(error).toBeInstanceOf(CItemException);
    expect((error as CItemException).faultcode).toBe(0);
  });

  it("fails the integer parse of the build or service update", async () => {
    expect((await caught(new CItemHelper(connect(withVariables({ ...DEV_VARIABLES, VersionBuild: "24090a" }))).login())).message).toBe(
      "Input string was not in a correct format.",
    );
    expect((await caught(new CItemHelper(connect(withVariables({ ...DEV_VARIABLES, VersionServiceUpdate: "99999999999" }))).login())).message).toBe(
      "Value was either too large or too small for an Int32.",
    );
  });

  it("fails the parse, as a format error, of a build with no value element (the probe reads an empty value)", async () => {
    const transport = new FakeTransport((request, index) =>
      bodyText(request).includes("VersionBuild")
        ? respond('<Envelope><Body><Result><Item type="Variable"><name>VersionBuild</name></Item></Result></Body></Envelope>')
        : devServer()(request, index),
    );
    expect(await caught(new CItemHelper(connect(transport)).login())).toMatchObject({
      name: "System.FormatException",
      message: "Input string was not in a correct format.",
    });
  });

  it("reads major and minor last, so their parse failure comes after all four requests", async () => {
    const transport = withVariables({ ...DEV_VARIABLES, VersionMajor: "twelve" });
    expect((await caught(new CItemHelper(connect(transport)).login())).message).toBe("Input string was not in a correct format.");
    expect(probeRequests(transport)).toHaveLength(4);
  });

  it("crashes with IndexOutOfRangeException when only one of VersionMajor and VersionMinor exists (WIRE-054)", async () => {
    for (const variables of [
      { ...DEV_VARIABLES, VersionMinor: undefined },
      { ...DEV_VARIABLES, VersionMajor: undefined },
    ]) {
      const error = await caught(new CItemHelper(connect(withVariables(variables))).login());
      expect(error).toMatchObject({ name: "System.IndexOutOfRangeException", message: "IndexOutOfRangeException" });
      expect(error).not.toBeInstanceOf(CItemException);
    }
  });

  it("says Not a single item for a later Variable that comes back twice", async () => {
    const transport = new FakeTransport((request, index) =>
      bodyText(request).includes("VersionBuild")
        ? respond('<Envelope><Body><Result><Item type="Variable"><value>1</value></Item><Item type="Variable"><value>2</value></Item></Result></Body></Envelope>')
        : devServer()(request, index),
    );
    expect((await caught(new CItemHelper(connect(transport)).login())).message).toBe("Not a single item");
  });
});

describe("CItemHelper.login: login faults (WIRE-017)", () => {
  it("throws faultcode -100 with the whole fault document in the text and the message", async () => {
    const transport = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ValidateUser" ? respond(soapFault("SOAP-ENV:Server.Authentication", "bad")) : devServer()(request, index),
    );
    const error = (await caught(new CItemHelper(connect(transport)).login())) as CItemException;
    expect(error.faultcode).toBe(-100);
    expect(error.faultstring).toMatch(/^Failed login to Innovator; original error: <SOAP-ENV:Envelope xmlns:SOAP-ENV=.+<\/SOAP-ENV:Envelope>$/s);
    expect(error.message).toBe(error.faultstring);
    expect(probeRequests(transport)).toHaveLength(0);
  });

  it("assumes a connection that is not an IOM one is logged in already, and only probes", async () => {
    const calls: string[] = [];
    const connection = {
      callAction: async (action: string, request: string) => {
        calls.push(action);
        return (await connect(withVariables(DEV_VARIABLES)).callAction(action, request));
      },
    };
    const helper = new CItemHelper(connection);
    await helper.login();
    expect(calls).toEqual(["ApplyAML", "ApplyAML", "ApplyAML", "ApplyAML"]);
    expect(helper.innovatorVersion?.major).toBe(12);
  });
});

describe("the version gate (WIRE-022 to WIRE-024)", () => {
  const login = (major: string, options = {}) => {
    const helper = new CItemHelper(connect(withVariables({ ...DEV_VARIABLES, VersionMajor: major })), options);
    return { helper, result: helper.login() };
  };

  it("takes the engine's own version from its assembly", () => {
    expect(currentUtilityVersion("14.0.7")).toEqual(new ArasVersion(14, 0, 0, 0, 0));
    expect(currentUtilityVersion("14.35")).toEqual(new ArasVersion(14, 35, 0, 0, 0));
    expect(currentUtilityVersion("12.0")).toEqual(new ArasVersion(12, 0, 0, 0, 0));
  });

  it("writes the version as text by its major", () => {
    expect(new ArasVersion(14, 35, 0, 43890, 3).fullString).toBe("14.35.3.43890");
    expect(new ArasVersion(13, 1, 4, 99, 0).fullString).toBe("13.1 SP4 Build 99");
  });

  it.each([
    ["10", "14.0.7", false],
    ["11", "14.0.7", false],
    ["12", "14.0.7", true],
    ["13", "14.0.7", true],
    ["14", "14.0.7", true],
    ["15", "14.0.7", false],
    ["9", "12.0", false],
    ["10", "12.0", true],
    ["12", "12.0", true],
    ["13", "12.0", false],
  ] as const)("server %s with engine %s is accepted: %s", (major, engine, accepted) => {
    expect(engineAcceptsServer(engine, Number(major))).toBe(accepted);
  });

  it.each([
    [9, []],
    [10, ["12.0"]],
    [11, ["12.0"]],
    [12, ["12.0", "14.0.7", "14.35"]],
    [14, ["14.0.7", "14.35"]],
    [15, []],
  ])("lists the engines that accept server %d", (major, engines) => {
    expect(enginesAcceptingServer(major)).toEqual(engines);
  });

  it("accepts servers 12 to 14 for 14.0.7 and records the decision", async () => {
    const { helper, result } = login("13");
    await result;
    expect(helper.versionGate).toMatchObject({ engine: "14.0.7", accepted: true, skipped: false, fittingEngines: ["14.0.7", "14.35"] });
  });

  it("refuses a newer server with the engine's own error: faultcode 0 and the type names (the bug)", async () => {
    const { result } = login("15");
    const error = (await caught(result)) as VersionRefusal;
    expect(error).toBeInstanceOf(VersionRefusal);
    expect(error).toBeInstanceOf(CItemException);
    expect(error.faultcode).toBe(0);
    expect(error.faultstring).toBe(
      "You are trying to use incompatible utility of version Aras.Tools.SolutionUpgrade.ArasVersion with innovator version Aras.Tools.SolutionUpgrade.ArasVersion.",
    );
    expect(error.faultdetail).toBeNull();
    expect(error.message).toBe("Exception of type 'Aras.Tools.SolutionUpgrade.CItemException' was thrown.");
  });

  it("names the engines that fit the server in the library's hint", async () => {
    const old = (await caught(login("10").result)) as VersionRefusal;
    expect(old.fittingEngines).toEqual(["12.0"]);
    expect(old.hint).toBe(
      "Engine 14.0.7 does not accept Aras server 10.0. Engines that accept it: 12.0. Use --engine with one of them, or --skip-version-check to run 14.0.7 anyway.",
    );
    const newer = (await caught(login("15").result)) as VersionRefusal;
    expect(newer.hint).toBe(
      "Engine 14.0.7 does not accept Aras server 15.0, and no engine of this library does. Use --skip-version-check to run 14.0.7 anyway.",
    );
  });

  it("still runs the whole probe, and lets the server through, with --skip-version-check", async () => {
    const { helper, result } = login("15", { skipVersionCheck: true });
    await result;
    expect(helper.innovatorVersion?.major).toBe(15);
    expect(helper.versionGate).toMatchObject({ accepted: false, skipped: true, fittingEngines: [] });
  });

  it("does not mark a server inside the window as skipped", async () => {
    const { helper, result } = login("12", { skipVersionCheck: true });
    await result;
    expect(helper.versionGate).toMatchObject({ accepted: true, skipped: false });
  });

  it("is built only for the engines whose client behaviour exists", () => {
    expect(CLIENT_ENGINES).toEqual(["12.0", "14.0.7", "14.35"]);
    expect(() => new HttpConnectorExtension({ engine: "12.0", url: "http://dev.example/12sp9", database: "d", userName: "u", password: "p" })).not.toThrow();
  });

  it("refuses a connection that belongs to another engine's IOM", () => {
    expect(() => new CItemHelper(connect(withVariables({})), { engine: "14.35" })).toThrow("a 14.0.7 connection cannot serve the 14.35 engine");
  });
});

describe("CItemHelper.applyAML (WIRE-006)", () => {
  it("sends the item as ApplyItem, bare, and returns the whole response", async () => {
    const transport = new FakeTransport(devServer());
    const helper = new CItemHelper(connect(transport));
    const response = await helper.applyAML("<Item type='User' action='get'><id>1</id></Item>");
    expect(response.isError).toBe(false);
    const request = transport.requests.at(-1)!;
    expect(header(request, "SOAPAction")).toBe("ApplyItem");
    expect(bodyText(request)).toBe("<?xml version='1.0' encoding='utf-8' ?><Item type=\"User\" action=\"get\"><id>1</id></Item>");
  });

  it("sends the one item of an AML wrapper", async () => {
    const transport = new FakeTransport(devServer());
    await new CItemHelper(connect(transport)).applyAML("<AML><Item type='User'/></AML>");
    expect(bodyText(transport.requests.at(-1)!)).toBe("<?xml version='1.0' encoding='utf-8' ?><Item type=\"User\" />");
  });

  it.each(["<Foo/>", "<AML/>", "<AML><Item/><Item/></AML>"])("refuses %s before anything is sent", async (aml) => {
    const transport = new FakeTransport(devServer());
    const error = await caught(new CItemHelper(connect(transport)).applyAML(aml));
    expect(error).toMatchObject({ name: "System.Exception", message: "Not a single item" });
    expect(transport.requests).toHaveLength(0);
  });

  it("throws on any fault, faultcode 0 included, naming the request and the response", async () => {
    const transport = new FakeTransport((request, index) =>
      header(request, "SOAPAction") === "ApplyItem" ? respond(soapFault("0", "No items of type Part found.")) : devServer()(request, index),
    );
    const aml = "<Item type='Part' action='get'/>";
    const error = (await caught(new CItemHelper(connect(transport)).applyAML(aml))) as CItemException;
    expect(error.faultcode).toBe(0);
    expect(error.message).toMatch(/^Server error\r\n\r\nRequest: <Item type='Part' action='get'\/>\r\n\r\nResponce: <SOAP-ENV:Envelope /);
  });

  it("exposes the Innovator wrapper over its connection", () => {
    const connection = connect(withVariables({}));
    expect(new CItemHelper(connection).inn).toBeInstanceOf(Innovator);
    expect(new CItemHelper(connection).inn.connection).toBe(connection);
  });
});

describe("CItemHelper.logout (WIRE-040)", () => {
  const logoffs = (transport: FakeTransport) => transport.requests.filter((r) => header(r, "SOAPAction") === "Logoff");

  it("logs off a connection of exactly the console tool's type", async () => {
    const transport = new FakeTransport(devServer());
    const helper = new CItemHelper(connect(transport));
    await helper.login();
    await helper.logout();
    expect(logoffs(transport)).toHaveLength(1);
  });

  it("sends nothing for any other connection type, subclasses included", async () => {
    class Recording extends HttpConnectorExtension {}
    for (const make of [
      (transport: FakeTransport) => new HttpServerConnection({ url: "http://dev.example/12sp9", database: "d", userName: "u", password: "p", locale: "en-US", timeZoneName: "z", transport }),
      (transport: FakeTransport) => new Recording({ url: "http://dev.example/12sp9", database: "d", userName: "u", password: "p", timeZoneName: "z", transport }),
    ]) {
      const transport = new FakeTransport(devServer());
      const helper = new CItemHelper(make(transport));
      await helper.login();
      await helper.logout();
      expect(logoffs(transport)).toHaveLength(0);
    }
  });
});
