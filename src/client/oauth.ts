import { DotNetException } from "./dotnet.js";
import { PasswordDigest } from "./digest.js";
import {
  type HttpTransport,
  type TransportRequest,
  type TransportResponse,
  TransportError,
} from "./transport.js";

/** HttpClient's default timeout, which IOM leaves in place for its OAuth requests. */
const OAUTH_TIMEOUT_MS = 100_000;
const NO_READ_LIMIT = 0;

export type ProtocolType = "Standard" | "Custom";

export interface DiscoveryDocument {
  tokenEndpoint: string;
  protocolType: ProtocolType;
  /** True when the server's `protocol_version` is 1.0 or later. */
  supportsOAuth: boolean;
}

/** The password grant failed: the code the token endpoint gave, and its message. */
export class OAuthServerError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "OAuthServerError";
  }
}

/** The discovery answered that OAuth is not there, so IOM falls back to the legacy headers. */
export class DiscoveryNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryNotFound";
  }
}

/** Standard and Custom OAuth servers name their bearer header and their refusal status differently. */
export function bearerProtocol(type: ProtocolType): { header: string; unauthorizedStatus: number } {
  return type === "Standard"
    ? { header: "Authorization", unauthorizedStatus: 401 }
    : { header: "X-Aras-Authorization", unauthorizedStatus: 498 };
}

const STATUS_NAMES: Record<number, string> = {
  300: "MultipleChoices",
  301: "MovedPermanently",
  302: "Found",
  303: "SeeOther",
  304: "NotModified",
  305: "UseProxy",
  307: "TemporaryRedirect",
  400: "BadRequest",
  401: "Unauthorized",
  402: "PaymentRequired",
  403: "Forbidden",
  404: "NotFound",
  405: "MethodNotAllowed",
  406: "NotAcceptable",
  407: "ProxyAuthenticationRequired",
  408: "RequestTimeout",
  409: "Conflict",
  410: "Gone",
  411: "LengthRequired",
  412: "PreconditionFailed",
  413: "RequestEntityTooLarge",
  414: "RequestUriTooLong",
  415: "UnsupportedMediaType",
  416: "RequestedRangeNotSatisfiable",
  417: "ExpectationFailed",
  426: "UpgradeRequired",
  500: "InternalServerError",
  501: "NotImplemented",
  502: "BadGateway",
  503: "ServiceUnavailable",
  504: "GatewayTimeout",
  505: "HttpVersionNotSupported",
};

/** .NET's `HttpStatusCode` as text: its member name, or the number when it has none. */
function statusName(status: number): string {
  return STATUS_NAMES[status] ?? String(status);
}

function text(response: TransportResponse): string {
  const decoded = Buffer.from(response.body).toString("utf8");
  return decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
}

/** What a failed HttpClient request throws in .NET Framework. */
function clientException(error: unknown): unknown {
  if (!(error instanceof TransportError)) return error;
  return error.failure === "timeout"
    ? new DotNetException("System.Threading.Tasks.TaskCanceledException", "A task was canceled.")
    : new DotNetException("System.Net.Http.HttpRequestException", "An error occurred while sending the request.");
}

async function send(transport: HttpTransport, request: TransportRequest): Promise<TransportResponse> {
  try {
    return await transport.send(request);
  } catch (error) {
    throw clientException(error);
  }
}

function get(transport: HttpTransport, url: string): Promise<TransportResponse> {
  return send(transport, {
    method: "GET",
    url,
    headers: [["Host", new URL(url).host]],
    responseTimeoutMs: OAUTH_TIMEOUT_MS,
    readTimeoutMs: NO_READ_LIMIT,
  });
}

/** Newtonsoft's message for text it cannot read as the JSON object the caller asked for. */
function notJsonObject(body: string): DotNetException {
  const position = body.length - body.trimStart().length;
  const lines = body.slice(0, position).split("\n");
  const where = `Path '', line ${lines.length - 1}, position ${position - (body.slice(0, position).lastIndexOf("\n") + 1)}.`;
  const first = body.trimStart().charAt(0);
  if (first === "[") {
    return new DotNetException(
      "Newtonsoft.Json.JsonReaderException",
      `Error reading JObject from JsonReader. Current JsonReader item is not an object: StartArray. Path '', line 1, position ${position + 1}.`,
    );
  }
  return new DotNetException(
    "Newtonsoft.Json.JsonReaderException",
    first === ""
      ? "Error reading JObject from JsonReader. Path '', line 0, position 0."
      : `Unexpected character encountered while parsing value: ${first}. ${where}`,
  );
}

function parseJsonObject(body: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw notJsonObject(body);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw notJsonObject(body);
  return value as Record<string, unknown>;
}

function stringValue(json: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = json?.[name];
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function requiredString(json: Record<string, unknown>, name: string): string {
  const value = stringValue(json, name);
  if (value === undefined || value === "") {
    throw new DotNetException("System.InvalidOperationException", `'${name}' property is missing in DiscoveryDocument json.`);
  }
  return value;
}

/** `Version.TryParse(text)` is at least 1.0. */
function versionAtLeastOne(value: string | undefined): boolean {
  const match = /^\s*(\d+)\.(\d+)(?:\.(\d+)(?:\.(\d+))?)?\s*$/.exec(value ?? "");
  return match !== null && Number(match[1]) >= 1;
}

function parseDiscoveryDocument(body: string): DiscoveryDocument & { jwksUri: string } {
  if (body === "") throw new DotNetException("System.ArgumentNullException", "Value cannot be null.\r\nParameter name: json");
  const json = parseJsonObject(body);
  requiredString(json, "issuer");
  const jwksUri = requiredString(json, "jwks_uri");
  requiredString(json, "authorization_endpoint");
  const tokenEndpoint = requiredString(json, "token_endpoint");
  requiredString(json, "end_session_endpoint");
  const supportsOAuth = versionAtLeastOne(stringValue(json, "protocol_version"));
  const info = json["protocol_info"];
  if (info === undefined || info === null) {
    throw new DotNetException("System.InvalidOperationException", "'protocol_info' property is missing in DiscoveryDocument json.");
  }
  const protocolInfo = info as Record<string, unknown>;
  const type = requiredString(protocolInfo, "protocol_type");
  if (type !== "Standard" && type !== "Custom") {
    throw new DotNetException(
      "System.ArgumentException",
      `Requested value '${type}' was not found.`,
    );
  }
  requiredString(protocolInfo, "authorization_header");
  requiredString(protocolInfo, "www_authenticate_header");
  const status = requiredString(protocolInfo, "unauthorized_status_code");
  if (!/^[\t\n\v\f\r ]*[+-]?\d+[\t\n\v\f\r ]*$/.test(status)) {
    throw new DotNetException("System.FormatException", "Input string was not in a correct format.");
  }
  return { tokenEndpoint, protocolType: type, supportsOAuth, jwksUri };
}

/** The last OAuth server URL that answered, kept for the process like IOM keeps it, and tried first. */
let lastAccessibleUrl: string | undefined;

/** Forgets the remembered OAuth server URL, as a new process would. */
export function forgetAccessibleOAuthServer(): void {
  lastAccessibleUrl = undefined;
}

async function oauthServerUrls(transport: HttpTransport, discoveryUrl: string): Promise<string[]> {
  const response = await get(transport, discoveryUrl);
  const body = text(response);
  if (response.status < 200 || response.status > 299) {
    const message = `Cannot get OAuthServer urls from '${discoveryUrl}' url: (${response.status}) ${response.reason}.`;
    if (response.status === 404) throw new DiscoveryNotFound(message);
    throw new DotNetException("System.Net.Http.HttpRequestException", message);
  }
  if (body.trim() === "") throw new DiscoveryNotFound(`Cannot get OAuthServer urls from '${discoveryUrl}' url.`);
  const json = parseJsonObject(body);
  const locations = Array.isArray(json["locations"]) ? (json["locations"] as unknown[]) : [];
  const uris = locations.map((l) => stringValue(l as Record<string, unknown>, "uri") ?? "");
  const host = new URL(discoveryUrl).host.toLowerCase();
  const hostOf = (uri: string): string => {
    try {
      return new URL(uri).host.toLowerCase();
    } catch {
      return "";
    }
  };
  return [...uris.filter((u) => hostOf(u) === host), ...uris.filter((u) => hostOf(u) !== host)];
}

async function openIdConfiguration(transport: HttpTransport, locations: string[]): Promise<DiscoveryDocument & { jwksUri: string }> {
  const remembered = lastAccessibleUrl?.toLowerCase();
  const ordered = [
    ...locations.filter((l) => l.toLowerCase() === remembered),
    ...locations.filter((l) => l.toLowerCase() !== remembered),
  ];
  for (const location of ordered) {
    try {
      const base = new URL(location).href;
      const endpoint = new URL(".well-known/openid-configuration", base.endsWith("/") ? base : `${base}/`).href;
      const response = await get(transport, endpoint);
      if (response.status < 200 || response.status > 299) {
        throw new DotNetException("System.InvalidOperationException", `Request failed: (${response.status}) ${response.reason}.`);
      }
      const document = parseDiscoveryDocument(text(response));
      lastAccessibleUrl = location;
      return document;
    } catch {
      // IOM wraps each failure and tries the next location.
    }
  }
  throw new DotNetException("System.AggregateException", "Cannot get OAuthServer discovery document.");
}

async function keySet(transport: HttpTransport, jwksUri: string): Promise<void> {
  const response = await get(transport, new URL(jwksUri).href);
  if (response.status < 200 || response.status > 299) {
    throw new DotNetException("System.InvalidOperationException", `Cannot get key set: (${response.status}) ${response.reason}.`);
  }
  if (text(response).trim() === "") {
    throw new DotNetException("System.InvalidOperationException", "Cannot get key set: Response content is empty.");
  }
}

/**
 * IOM's OAuth discovery: where the OAuth servers are, the first configuration
 * that answers, and its key set. Throws `DiscoveryNotFound` when the server has
 * no discovery page, which is when the legacy login applies.
 *
 * @spec WIRE-010 WIRE-011
 */
export async function discover(transport: HttpTransport, discoveryUrl: string): Promise<DiscoveryDocument> {
  const locations = await oauthServerUrls(transport, discoveryUrl);
  const { jwksUri, ...document } = await openIdConfiguration(transport, locations);
  await keySet(transport, jwksUri);
  return document;
}

/** `Version.TryParse` is at least 1.0, as IOM 12 reads `protocol_version`: absent or unparsable counts as 0.0. */
function protocolVersionSupportsOAuth(value: unknown): boolean {
  return versionAtLeastOne(typeof value === "string" ? value : undefined);
}

/**
 * IOM 12's discovery (WIRE-010): the locations from `OAuthServerDiscovery.aspx`, asked for with the extra header
 * `Aras-Set-HttpSessionState-Behavior: switch_to_initial`, then the OpenID configuration of each location in turn until one
 * answers with a document that has a known `protocol_info.protocol_type`. Only the protocol type and version are read; there
 * is no key set request. The token endpoint is `connect/token` below the location that won. The failures that are not "no
 * discovery page" are .NET's `WebException`, `JsonReaderException` and `AggregateException` (WIRE-011).
 *
 * @spec WIRE-010 WIRE-011
 */
export async function discoverIom12(transport: HttpTransport, discoveryUrl: string): Promise<DiscoveryDocument> {
  let response: TransportResponse;
  try {
    response = await transport.send({
      method: "GET",
      url: discoveryUrl,
      headers: [
        ["Aras-Set-HttpSessionState-Behavior", "switch_to_initial"],
        ["Host", new URL(discoveryUrl).host],
      ],
      responseTimeoutMs: OAUTH_TIMEOUT_MS,
      readTimeoutMs: NO_READ_LIMIT,
    });
  } catch (error) {
    throw error instanceof TransportError ? new DotNetException("System.Net.WebException", error.message) : error;
  }
  if (response.status === 404) throw new DiscoveryNotFound(`The remote server returned an error: (404) ${response.reason}.`);
  if (response.status < 200 || response.status > 299) {
    throw new DotNetException("System.Net.WebException", `The remote server returned an error: (${response.status}) ${response.reason}.`);
  }
  const body = text(response);
  if (body.trim() === "") throw new DiscoveryNotFound("The discovery page is empty.");
  const json = parseJsonObject(body);
  const locations = Array.isArray(json["locations"]) ? (json["locations"] as unknown[]) : [];
  const uris = locations.map((l) => stringValue(l as Record<string, unknown>, "uri") ?? "");
  const host = new URL(discoveryUrl).host.toLowerCase();
  const hostOf = (uri: string): string => {
    try {
      return new URL(uri).host.toLowerCase();
    } catch {
      return "";
    }
  };
  const sameHost = [...uris.filter((u) => hostOf(u) === host), ...uris.filter((u) => hostOf(u) !== host)];
  const remembered = lastAccessibleUrl?.toLowerCase();
  const ordered = [
    ...sameHost.filter((l) => l.toLowerCase() === remembered),
    ...sameHost.filter((l) => l.toLowerCase() !== remembered),
  ];
  for (const location of ordered) {
    try {
      const base = new URL(location).href;
      const directory = base.endsWith("/") ? base : `${base}/`;
      const configuration = await get(transport, new URL(".well-known/openid-configuration", directory).href);
      if (configuration.status < 200 || configuration.status > 299) continue;
      const document = parseJsonObject(text(configuration));
      const info = document["protocol_info"];
      const type = info !== null && typeof info === "object" ? stringValue(info as Record<string, unknown>, "protocol_type") : undefined;
      if (type !== "Standard" && type !== "Custom") continue;
      lastAccessibleUrl = location;
      return {
        tokenEndpoint: new URL("connect/token", directory).href,
        protocolType: type,
        supportsOAuth: protocolVersionSupportsOAuth(document["protocol_version"]),
      };
    } catch {
      // IOM 12 skips a location that does not answer or whose document it cannot read.
    }
  }
  const inner = ordered.map((location) => ` (Cannot require OAuth server discovery information based on '${location}' url.)`).join("");
  throw new DotNetException("System.AggregateException", `Cannot require OAuth server discovery information.${inner}`);
}

/** What a failure inside a .NET task becomes when the caller waits for it: IOM 12's token client (WIRE-012). */
function oneOrMoreErrors(inner: string): DotNetException {
  return new DotNetException("System.AggregateException", `One or more errors occurred. (${inner})`);
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** `Uri.EscapeDataString` with `%20` as `+`, which is how IOM form-encodes. */
function formEncode(value: string): string {
  return encodeURIComponent(value.replace(LONE_SURROGATE, "\uFFFD"))
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/** What a token endpoint answered: the tokens it named, each absent when the answer had none. */
export interface TokenAnswer {
  accessToken: string | undefined;
  refreshToken: string | undefined;
}

/** Where IOM gets a bearer token from; the connection asks again, once, when a request is refused. */
export interface TokenProvider {
  getAccessToken(): Promise<string>;
}

/**
 * One form-encoded POST to the token endpoint, and the reading of its answer: a 200 or 400 JSON body, an `error` field
 * as an OAuth error, any other status as `server_error`.
 *
 * @spec WIRE-012
 */
export async function postTokenForm(
  transport: HttpTransport,
  tokenEndpoint: string,
  fields: ReadonlyArray<readonly [string, string]>,
  iom12 = false,
): Promise<TokenAnswer> {
  const body = Buffer.from(fields.map(([name, value]) => `${name}=${formEncode(value)}`).join("&"), "utf8");
  let response: TransportResponse;
  try {
    response = await send(transport, {
      method: "POST",
      url: tokenEndpoint,
      headers: [
        ["Accept", "application/json"],
        ["Content-Type", "application/x-www-form-urlencoded"],
        ["Host", new URL(tokenEndpoint).host],
        ["Content-Length", String(body.length)],
      ],
      body,
      responseTimeoutMs: OAUTH_TIMEOUT_MS,
      readTimeoutMs: NO_READ_LIMIT,
    });
  } catch (error) {
    // IOM 12 runs the request inside a task, so a failure reaches the caller wrapped in an AggregateException
    if (iom12 && error instanceof DotNetException) throw oneOrMoreErrors(error.message);
    throw error;
  }

  if (response.status !== 200 && response.status !== 400) {
    throw new OAuthServerError("server_error", `(${statusName(response.status)}) ${response.reason}`);
  }
  let json: Record<string, unknown>;
  try {
    json = parseJsonObject(text(response));
  } catch (error) {
    if (iom12) throw oneOrMoreErrors("Invalid JSON response");
    const message = (error as Error).message;
    throw new OAuthServerError(message, message);
  }
  const code = stringValue(json, "error");
  if (code !== undefined && code.trim() !== "") {
    const key = Object.keys(json).find((k) => k.toLowerCase() === "error_description");
    throw new OAuthServerError(code, key === undefined ? code : (stringValue(json, key) ?? code));
  }
  return { accessToken: stringValue(json, "access_token"), refreshToken: stringValue(json, "refresh_token") };
}

/**
 * The password grant of IOM's `PasswordTokenProvider`, with its one retry that
 * uses SHA-256 when the server asks for that hash.
 *
 * @spec WIRE-012 WIRE-013 WIRE-014
 */
export class PasswordTokenProvider implements TokenProvider {
  private readonly digest: PasswordDigest;

  /**
   * Throws like IOM when the database or user name is empty. IOM 12 (`iom12`) accepts an empty user name and leaves `username`
   * out of the request, and puts `client_id` first (WIRE-012).
   */
  constructor(
    private readonly transport: HttpTransport,
    private readonly tokenEndpoint: string,
    private readonly credentials: { database: string; userName: string; password: string },
    private readonly iom12 = false,
  ) {
    if (credentials.database === "") throw new DotNetException("System.ArgumentException", "Database");
    if (!iom12 && credentials.userName === "") throw new DotNetException("System.ArgumentException", "UserName");
    this.digest = new PasswordDigest(credentials.password);
  }

  async getAccessToken(): Promise<string> {
    try {
      return await this.requestToken();
    } catch (error) {
      if (!(error instanceof OAuthServerError) || error.errorCode !== "incompatible_hash_use_sha256") throw error;
      try {
        this.digest.switchTo("SHA256");
      } catch {
        throw error;
      }
      return this.requestToken();
    }
  }

  private async requestToken(): Promise<string> {
    const fields: [string, string][] = this.iom12
      ? [
          ["client_id", "IOMApp"],
          ["grant_type", "password"],
          ["scope", "Innovator"],
          ...(this.credentials.userName === "" ? [] : [["username", this.credentials.userName] as [string, string]]),
          ["database", this.credentials.database],
          ["password", this.digest.value],
        ]
      : [
          ["grant_type", "password"],
          ["client_id", "IOMApp"],
          ["scope", "Innovator"],
          ["database", this.credentials.database],
          ["username", this.credentials.userName],
          ["password", this.digest.value],
        ];
    const { accessToken } = await postTokenForm(this.transport, this.tokenEndpoint, fields, this.iom12);
    if (accessToken === undefined || accessToken === "") {
      throw new DotNetException("System.ArgumentException", "Token value can not be null or empty.");
    }
    return accessToken;
  }
}
