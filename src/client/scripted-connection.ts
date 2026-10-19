import { HttpServerConnection } from "./connection.js";
import { FakeTransport, soapResult } from "./fake-transport.js";
import { ResponseDocument } from "./fault.js";
import { documentOuterXml, parseXml } from "./mini-xml.js";

/** A fault the way IOM writes its own, for a scripted login. */
export function fault(code: string, text: string, actor = "HttpServerConnection"): string {
  return (
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N"><SOAP-ENV:Body><SOAP-ENV:Fault>' +
    `\r\n\t<faultcode>${code}</faultcode>\r\n\t<faultstring>${text}</faultstring>\r\n\t<faultactor>${actor}</faultactor>\r\n\t<detail>unknown error</detail>\r\n` +
    "</SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>"
  );
}

/** The probe's `StubConnection`: an IOM connection with no network, a scripted login and a scripted answer to every call. */
export class ScriptedConnection extends HttpServerConnection {
  readonly requests: string[] = [];
  readonly actions: string[] = [];
  readonly scripted: { login?: () => string; respond?: (action: string, request: string) => string };

  constructor(script: { engine?: "14.0.7" | "14.35"; login?: () => string; respond?: (action: string, request: string) => string }) {
    super({
      engine: script.engine ?? "14.35",
      url: "http://stub.example/db",
      database: "db",
      userName: "u",
      password: "p",
      locale: "en-US",
      timeZoneName: "Local Zone",
      transport: new FakeTransport(() => {
        throw new Error("a scripted connection has no network");
      }),
    });
    this.scripted = script;
  }

  override async login() {
    return ResponseDocument.parse(this.scripted.login?.() ?? soapResult("<id>1</id>"));
  }

  override async callAction(action: string, request: string) {
    this.actions.push(action);
    this.requests.push(documentOuterXml(parseXml(request)));
    return ResponseDocument.parse(this.scripted.respond?.(action, request) ?? soapResult(""));
  }
}
