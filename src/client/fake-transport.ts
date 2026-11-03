import type { HttpTransport, TransportRequest, TransportResponse } from "./transport.js";
import { utf8Bytes, utf8Text } from "../io/utf8.js";

export type FakeHandler = (request: TransportRequest, index: number) => TransportResponse | Promise<TransportResponse>;

/** An in-memory transport for tests: it records every request and lets a handler answer. */
export class FakeTransport implements HttpTransport {
  readonly requests: TransportRequest[] = [];

  constructor(private readonly handler: FakeHandler) {}

  send(request: TransportRequest): Promise<TransportResponse> {
    const index = this.requests.length;
    this.requests.push(request);
    return Promise.resolve(this.handler(request, index));
  }
}

export function respond(
  body: string,
  options: { status?: number; reason?: string; headers?: ReadonlyArray<readonly [string, string]> } = {},
): TransportResponse {
  return {
    status: options.status ?? 200,
    reason: options.reason ?? "OK",
    headers: options.headers ?? [],
    body: utf8Bytes(body),
  };
}

/** The body of a request as text. */
export function bodyText(request: TransportRequest): string {
  return utf8Text(request.body ?? new Uint8Array());
}

/** A header's value, matched by name without regard to case. */
export function header(request: TransportRequest, name: string): string | undefined {
  return request.headers.find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1];
}

const SOAP_OPEN =
  '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>';
const SOAP_CLOSE = "</SOAP-ENV:Body></SOAP-ENV:Envelope>";

export const soapResult = (inner: string): string => `${SOAP_OPEN}<Result>${inner}</Result>${SOAP_CLOSE}`;

export const soapFault = (code: string, text: string): string =>
  `${SOAP_OPEN}<SOAP-ENV:Fault><faultcode>${code}</faultcode><faultstring>${text}</faultstring><faultactor></faultactor><detail></detail></SOAP-ENV:Fault>${SOAP_CLOSE}`;

export interface DevServerOptions {
  /** Host and path the fake OAuth server claims, default `http://dev.example/12sp9`. */
  base?: string;
  protocolType?: "Standard" | "Custom";
  protocolVersion?: string | undefined;
  /** Variables the server holds; an absent one is not found. Default: a 12.0 SP9 server. */
  variables?: Record<string, string | undefined>;
  /** Answers a route instead of the default; return undefined to fall through to the default. */
  override?: (request: TransportRequest, index: number) => TransportResponse | undefined;
}

export const DEV_VARIABLES: Record<string, string> = {
  VersionMajor: "12",
  VersionMinor: "0",
  VersionServicePack: "SP9",
  VersionBuild: "24090",
  VersionServiceUpdate: "0",
};

/**
 * A fake Aras server: OAuth discovery, the password grant, and SOAP answers
 * for login, the user record, the version probe and logoff.
 */
export function devServer(options: DevServerOptions = {}): FakeHandler {
  const base = options.base ?? "http://dev.example/12sp9";
  const variables = options.variables ?? DEV_VARIABLES;
  return (request, index) => {
    const overridden = options.override?.(request, index);
    if (overridden) return overridden;
    const url = request.url;
    if (url.endsWith("/OAuthServerDiscovery.aspx")) return respond(JSON.stringify({ locations: [{ uri: `${base}/OAuthServer/` }] }));
    if (url.endsWith("/.well-known/openid-configuration")) {
      return respond(
        JSON.stringify({
          issuer: "OAuthServer",
          jwks_uri: `${base}/OAuthServer/.well-known/openid-configuration/jwks`,
          authorization_endpoint: `${base}/OAuthServer/connect/authorize`,
          token_endpoint: `${base}/OAuthServer/connect/token`,
          end_session_endpoint: `${base}/OAuthServer/connect/endsession`,
          ...("protocolVersion" in options && options.protocolVersion === undefined ? {} : { protocol_version: options.protocolVersion ?? "1.0" }),
          protocol_info: {
            protocol_type: options.protocolType ?? "Standard",
            authorization_header: "Authorization",
            www_authenticate_header: "WWW-Authenticate",
            unauthorized_status_code: "401",
          },
        }),
      );
    }
    if (url.endsWith("/jwks")) return respond('{"keys":[]}');
    if (url.endsWith("/connect/token")) return respond('{"access_token":"token-1","expires_in":3600,"token_type":"Bearer"}');
    const action = header(request, "SOAPAction");
    const body = bodyText(request);
    switch (action) {
      case "ValidateUser":
        return respond(
          soapResult(
            "<id>USER1</id><login_name>admin</login_name><database>12sp9</database>" +
              "<i18nsessioncontext><locale>en-US</locale><time_zone>Server Time</time_zone></i18nsessioncontext>",
          ),
          { headers: [["Set-Cookie", "ASP.NET_SessionId=abc; path=/; HttpOnly"]] },
        );
      case "ApplyItem":
        return respond(soapResult('<Item type="User" id="USER1"><default_vault keyed_name="Default" type="Vault">V1</default_vault></Item>'));
      case "ApplyAML": {
        const names = [...body.matchAll(/<name>(\w+)<\/name>/g)].map((m) => m[1] ?? "");
        const found = names.filter((n) => variables[n] !== undefined);
        if (found.length === 0) return respond(soapFault("0", "No items of type Variable found."));
        return respond(
          soapResult(
            found
              .map((n) => `<Item type="Variable" id="${n}"><id keyed_name="${n}" type="Variable">${n}</id><value>${variables[n]}</value><name>${n}</name></Item>`)
              .join(""),
          ),
        );
      }
      case "Logoff":
        return respond(`${SOAP_OPEN}<LogOffResponse><Result>ok</Result></LogOffResponse>${SOAP_CLOSE}`);
      default:
        return respond(soapFault("1", `unexpected request ${url} ${action}`));
    }
  };
}
