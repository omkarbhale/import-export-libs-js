import { describe, expect, it } from "vitest";
import { CItemException, ResponseDocument, getProperty, iomFault, unknownErrorFault } from "./fault.js";

const NO_ITEMS =
  '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault xmlns:af="http://www.aras.com/InnovatorFault"><faultcode>0</faultcode><faultstring><![CDATA[No items of type Variable found.]]></faultstring><detail><af:legacy_detail><![CDATA[No items of type Variable found using the criteria: ]]></af:legacy_detail><af:legacy_faultstring><![CDATA[No items of type Variable found.]]></af:legacy_faultstring></detail></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>';

describe("ResponseDocument (WIRE-052, WIRE-053)", () => {
  it("reads a server fault", () => {
    const response = ResponseDocument.parse(NO_ITEMS);
    expect(response.isError).toBe(true);
    expect(response.errorCode).toBe("0");
    expect(response.errorString).toBe("No items of type Variable found.");
    expect(response.errorDetail).toBe("No items of type Variable found using the criteria: No items of type Variable found.");
    expect(response.errorSource).toBe("");
    expect(response.isEmpty).toBe(true);
  });

  it("matches the envelope in the SOAP namespace or in none, and nothing else", () => {
    const fault = "<Body><Fault><faultcode>7</faultcode></Fault></Body>";
    expect(ResponseDocument.parse(`<Envelope>${fault}</Envelope>`).errorCode).toBe("7");
    expect(ResponseDocument.parse(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">${fault.replace(/</g, "<s:").replace(/<s:\//g, "</s:")}</s:Envelope>`).isError).toBe(true);
    expect(ResponseDocument.parse(`<Envelope xmlns="urn:other">${fault}</Envelope>`).isError).toBe(false);
    expect(ResponseDocument.parse(`<Envelope><Result>${fault}</Result></Envelope>`).isError).toBe(false);
  });

  it("is not an empty result for any other faultcode", () => {
    expect(ResponseDocument.parse(NO_ITEMS.replace("<faultcode>0<", "<faultcode>1<")).isEmpty).toBe(false);
  });

  it("answers an absent fault part with the empty string, and a result with isError false", () => {
    const response = ResponseDocument.parse("<Envelope><Body><Result><Item/></Result></Body></Envelope>");
    expect([response.isError, response.errorCode, response.errorDetail, response.isEmpty]).toEqual([false, "", "", false]);
  });

  it("finds items directly, under AML and under any Result", () => {
    expect(ResponseDocument.parse("<Item/>").items).toHaveLength(1);
    expect(ResponseDocument.parse("<AML><Item/><Item/><x/></AML>").items).toHaveLength(2);
    expect(ResponseDocument.parse("<e><b><Result><Item/><Item/><Item/></Result></b></e>").items).toHaveLength(3);
    expect(ResponseDocument.parse("<e><b><Other><Item/></Other></b></e>").items).toHaveLength(0);
  });
});

describe("iomFault (WIRE-050)", () => {
  const ENVELOPE =
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N"><SOAP-ENV:Body><SOAP-ENV:Fault>';

  it("writes the template with CRLF and tab whitespace", () => {
    expect(iomFault("System.Net.WebException: The operation has timed out").outerXml).toBe(
      `${ENVELOPE}\r\n\t<faultcode>999</faultcode>\r\n\t<faultstring>System.Net.WebException: The operation has timed out</faultstring>` +
        "\r\n\t<faultactor>HttpServerConnection</faultactor>\r\n\t<detail>unknown error</detail>\r\n</SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>",
    );
  });

  it("replaces the code, the actor and the detail, and escapes the message", () => {
    const fault = iomFault("a < b & c", {
      code: "invalid_grant",
      actor: "OAuthServer",
      detail: '<message key="password_hash_algorithm" value="MD5" />',
    });
    expect([fault.errorCode, fault.errorString, fault.errorSource]).toEqual(["invalid_grant", "a < b & c", "OAuthServer"]);
    expect(fault.outerXml).toContain("<faultstring>a &lt; b &amp; c</faultstring>");
    expect(fault.outerXml).toContain('<detail><message key="password_hash_algorithm" value="MD5" /></detail>');
  });

  it("keeps the defaults for an empty code or actor", () => {
    const fault = iomFault("x", { code: "", actor: "" });
    expect([fault.errorCode, fault.errorSource]).toEqual(["999", "HttpServerConnection"]);
  });

  it("writes the Unknown error item as IOM's newError does", () => {
    const fault = unknownErrorFault();
    expect([fault.errorCode, fault.errorSource, fault.errorString]).toEqual(["1", "", "Unknown error"]);
    expect(fault.outerXml).toContain("<faultactor></faultactor>\r\n\t\t\t<faultstring>Unknown error</faultstring>");
  });
});

describe("CItemException (WIRE-051)", () => {
  const fault = ResponseDocument.parse(NO_ITEMS);

  it("built from a response alone has its outer XML as text and message", () => {
    const error = CItemException.fromResponse(fault);
    expect([error.faultcode, error.faultstring, error.message]).toEqual([0, fault.outerXml, fault.outerXml]);
    expect(error.faultdetail).toBe(fault.errorDetail);
  });

  it("built from a request and a response spells Responce as Aras does", () => {
    const error = CItemException.fromRequest("<Item/>", fault);
    expect(error.faultstring).toBe(`Server error\r\n\r\nRequest: <Item/>\r\n\r\nResponce: ${fault.outerXml}`);
    expect(error.message).toBe(error.faultstring);
  });

  it("takes faultcode 1 from a code that is not an integer", () => {
    expect(CItemException.fromResponse(iomFault("x", { code: "invalid_grant" })).faultcode).toBe(1);
    expect(CItemException.fromResponse(iomFault("x", { code: " 12 " })).faultcode).toBe(12);
  });

  it("uses the detail as the message of the engine's own errors", () => {
    const error = new CItemException(-100, "text", "detail");
    expect([error.faultcode, error.faultstring, error.faultdetail, error.message]).toEqual([-100, "text", "detail", "detail"]);
  });

  it("has .NET's default message when the engine gives no detail", () => {
    expect(new CItemException(0, "text", null).message).toBe(
      "Exception of type 'Aras.Tools.SolutionUpgrade.CItemException' was thrown.",
    );
  });
});

describe("getProperty", () => {
  const item = (xml: string) => ResponseDocument.parse(xml).document.root;

  it("reads the text of a child", () => {
    expect(getProperty(item("<Item><value>SP9</value></Item>"), "value")).toBe("SP9");
  });

  it("gives null for an absent child, and for a blank one flagged is_null", () => {
    expect(getProperty(item("<Item/>"), "value")).toBeNull();
    expect(getProperty(item('<Item><value is_null="1"/></Item>'), "value")).toBeNull();
    expect(getProperty(item("<Item><value/></Item>"), "value")).toBe("");
    expect(getProperty(item('<Item><value is_null="1">x</value></Item>'), "value")).toBe("x");
  });

  it("gives the id of a nested item", () => {
    expect(getProperty(item('<Item><owned_by_id><Item id="ABC"/></owned_by_id></Item>'), "owned_by_id")).toBe("ABC");
  });
});
