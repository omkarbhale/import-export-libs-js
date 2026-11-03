import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { defaultTransport } from "../host/default-host.js";
import { PasswordDigest } from "./digest.js";
import { DotNetException } from "./dotnet.js";
import { CLIENT_ENGINES, EngineNotSupportedError } from "./engine-support.js";
import { ResponseDocument, failedToLoginFault, iomFault, loadXml, unknownErrorFault } from "./fault.js";
import {
  attributeOf,
  childElements,
  descendantElements,
  documentOuterXml,
  innerText,
  localName,
  outerXml,
  type XmlDocument,
  type XmlElement,
} from "./mini-xml.js";
import {
  DiscoveryNotFound,
  OAuthServerError,
  PasswordTokenProvider,
  type TokenProvider,
  bearerProtocol,
  discover,
  discoverIom12,
} from "./oauth.js";
import { Iom15PasswordTokenProvider } from "./oauth-iom15.js";
import { localWindowsTimeZoneId } from "./timezone.js";
import { type HttpTransport, TransportError, type TransportResponse } from "./transport.js";
import { serverUrls } from "./url.js";

/** One call through the connection, as the oracle's recorder sees it. */
export interface CallRecord {
  action: string;
  /** The request document's outer XML, as loaded (before the root is taken for the wire). */
  request: string;
  /** The response document's outer XML. */
  response: string;
}

export interface ConnectionSettings {
  /** The engine whose IOM this connection reproduces: IOM 12 for `12.0`, IOM 14 for `14.0.7`, IOM 15 for `14.35`. Default `14.0.7`. */
  engine?: Engine;
  url: string;
  database: string;
  userName: string;
  password: string;
  locale: string;
  /** The `TIMEZONE_NAME` sent until `ValidateUser` replaces it; this machine's Windows time zone id when absent (WIRE-005). */
  timeZoneName?: string | undefined;
  /**
   * The HTTP layer. The default is the default host's transport, `nodeTransport` on Node; where the host has none (a browser build
   * that has not been given one), the setting is required and the constructor throws (HOST-230).
   */
  transport?: HttpTransport;
  onCall?: (call: CallRecord) => void;
}

type Authenticator =
  | {
      kind: "bearer";
      provider: TokenProvider;
      protocol: ReturnType<typeof bearerProtocol>;
      token: string | undefined;
    }
  | { kind: "legacy"; digest: PasswordDigest };

const XML_DECLARATION = "<?xml version='1.0' encoding='utf-8' ?>";
/** .NET's defaults when the connection timeout is 0: to get a response, and between reads of its body. */
const DEFAULT_RESPONSE_TIMEOUT_MS = 100_000;
const READ_TIMEOUT_MS = 300_000;

/** The cookies the server set, replayed on every later request of the connection. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  store(response: TransportResponse): void {
    for (const [name, value] of response.headers) {
      if (name.toLowerCase() !== "set-cookie") continue;
      const [pair = "", ...attributes] = value.split(";").map((part) => part.trim());
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const cookieName = pair.slice(0, separator);
      const expired = attributes.some((attribute) => {
        const [key = "", setting = ""] = attribute.split("=");
        if (key.toLowerCase() === "max-age") return Number(setting) <= 0;
        return key.toLowerCase() === "expires" && Date.parse(setting) < Date.now();
      });
      if (expired) this.cookies.delete(cookieName);
      else this.cookies.set(cookieName, pair.slice(separator + 1));
    }
  }

  get header(): string | undefined {
    return this.cookies.size === 0 ? undefined : [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function webException(error: unknown): unknown {
  return error instanceof TransportError ? new DotNetException("System.Net.WebException", error.message) : error;
}

/** The text of a child of the first `i18nsessioncontext`, trimmed; empty when absent or blank. */
function sessionContextValue(response: ResponseDocument, name: string): string {
  const root = response.document.root;
  const context = childElements(root).flatMap((e) => childElements(e)).flatMap((e) => childElements(e, "i18nsessioncontext"))[0];
  const element = context ? childElements(context, name)[0] : undefined;
  return element ? innerText(element).trim() : "";
}

/** `//Result/<name>`: the first such element in document order. */
function resultChild(response: ResponseDocument, name: string): XmlElement | undefined {
  for (const element of [response.document.root, ...descendantElements(response.document.root)]) {
    if (element.name !== "Result") continue;
    const child = childElements(element, name)[0];
    if (child) return child;
  }
  return undefined;
}

/** The `schema` element a legacy-login fault offers, when the fault has a `supported_authentication_schema`. */
function authenticationSchema(response: ResponseDocument): { present: boolean; mode: string | undefined } {
  const fault = response.faultElement;
  const detail = fault ? childElements(fault).find((c) => localName(c.name) === "detail") : undefined;
  const supported = detail ? childElements(detail).find((c) => localName(c.name) === "supported_authentication_schema") : undefined;
  const schema = supported ? childElements(supported).find((c) => localName(c.name) === "schema") : undefined;
  return { present: supported !== undefined, mode: schema?.attributes.find((a) => a.name === "mode")?.value ?? (schema ? "" : undefined) };
}

/**
 * IOM 15's `IsReadonlyRequest`: an `ApplyItem` whose root `Item` has `readOnly="1"`, or an `ApplyAML` in which every
 * `/AML/Item` has it (so also one with no such item). The action name is compared exactly.
 */
function isReadOnlyRequest(action: string, request: XmlDocument): boolean {
  const root = request.root;
  const flagged = (item: XmlElement): boolean => attributeOf(item, "readOnly") === "1";
  if (action === "ApplyItem") return root.name === "Item" && flagged(root);
  if (action === "ApplyAML") return root.name !== "AML" || childElements(root, "Item").every(flagged);
  return false;
}

/**
 * IOM's `HttpServerConnection`, as the engine uses it: password login, then
 * SOAP calls that never throw for transport problems and answer with a fault
 * instead.
 *
 * @spec WIRE-003 WIRE-004 WIRE-005 WIRE-010 WIRE-011 WIRE-012 WIRE-013 WIRE-015 WIRE-016 WIRE-018 WIRE-030 WIRE-040 WIRE-050 HOST-230
 * WIRE-060
 */
export class HttpServerConnection {
  readonly engine: Engine;
  locale: string;
  timeZoneName: string;
  /** The user id, the database and the login name that the last successful login returned. */
  userId: string | undefined;
  loggedOnDatabase: string | undefined;
  loggedOnUser: string | undefined;

  private timeoutMs = 0;
  private authenticator: Authenticator | undefined;
  private readonly cookies = new CookieJar();
  private readonly iom12: boolean;
  private readonly urls: ReturnType<typeof serverUrls>;
  private readonly transport: HttpTransport;
  private readonly onCall: ((call: CallRecord) => void) | undefined;

  constructor(private readonly settings: ConnectionSettings) {
    this.engine = settings.engine ?? DEFAULT_ENGINE;
    if (!CLIENT_ENGINES.includes(this.engine)) throw new EngineNotSupportedError(this.engine);
    this.iom12 = this.engine === "12.0";
    this.urls = serverUrls(settings.url, this.engine);
    const transport = settings.transport ?? defaultTransport();
    if (transport === undefined) throw new Error("a transport is required in this environment");
    this.transport = transport;
    this.onCall = settings.onCall;
    this.locale = settings.locale;
    this.timeZoneName = settings.timeZoneName ?? localWindowsTimeZoneId();
  }

  /** Milliseconds to wait for a response; 0 keeps .NET's 100 seconds and -1 waits for ever. */
  get timeout(): number {
    return this.timeoutMs;
  }

  set timeout(value: number) {
    if (value < 0 && value !== -1) {
      throw new DotNetException(
        "System.ArgumentOutOfRangeException",
        "Timeout can be only be set to 'System.Threading.Timeout.Infinite' or a value >= 0.\r\nParameter name: value",
      );
    }
    this.timeoutMs = value;
  }

  /**
   * Sends one SOAP call and answers with the response document. Transport
   * problems, error statuses and unreadable bodies come back as faults (WIRE-050).
   */
  async callAction(action: string, request: string): Promise<ResponseDocument> {
    const requestDocument = loadXml(request);
    const response = await this.callActionImpl(action, requestDocument);
    this.onCall?.({ action, request: documentOuterXml(requestDocument), response: response.outerXml });
    return response;
  }

  private async callActionImpl(action: string, request: XmlDocument): Promise<ResponseDocument> {
    const body = Buffer.from(`${XML_DECLARATION}${outerXml(request.root)}`, "utf8");
    const readOnly = this.engine === "14.35" && isReadOnlyRequest(action, request);
    let response: ResponseDocument;
    try {
      response = await this.exchange(action, body, readOnly);
      const schema = authenticationSchema(response);
      if (schema.present && this.updateAuthenticator(schema.mode)) return await this.callActionImpl(action, request);
    } catch (error) {
      return this.faultFor(error);
    }
    if (action.toLowerCase() === "validateuser") {
      this.locale = sessionContextValue(response, "locale");
      this.timeZoneName = sessionContextValue(response, "time_zone");
    }
    return response;
  }

  private faultFor(error: unknown): ResponseDocument {
    if (error instanceof OAuthServerError) {
      const hash =
        error.errorCode === "incompatible_hash_use_md5" ? "MD5" : error.errorCode === "incompatible_hash_use_sha256" ? "SHA256" : "";
      return iomFault(error.message, {
        code: error.errorCode,
        actor: "OAuthServer",
        detail: hash === "" ? undefined : `<message key="password_hash_algorithm" value="${hash}" />`,
      });
    }
    const name = error instanceof DotNetException ? error.typeName : "System.Exception";
    return iomFault(`${name}: ${(error as Error).message}`);
  }

  /** The authenticator, found by discovery the first time it is needed and kept once it is. */
  private async resolveAuthenticator(): Promise<Authenticator> {
    if (this.authenticator) return this.authenticator;
    const { database, userName, password } = this.settings;
    let discovered;
    try {
      discovered = await (this.iom12 ? discoverIom12 : discover)(this.transport, this.urls.discovery);
    } catch (error) {
      if (!(error instanceof DiscoveryNotFound)) throw error;
    }
    this.authenticator = discovered?.supportsOAuth
      ? {
          kind: "bearer",
          provider:
            this.engine === "14.35"
              ? new Iom15PasswordTokenProvider(this.transport, discovered.tokenEndpoint, { database, userName, password })
              : new PasswordTokenProvider(this.transport, discovered.tokenEndpoint, { database, userName, password }, this.iom12),
          protocol: bearerProtocol(discovered.protocolType),
          token: undefined,
        }
      : { kind: "legacy", digest: new PasswordDigest(password) };
    return this.authenticator;
  }

  private updateAuthenticator(mode: string | undefined): boolean {
    if (mode === undefined || this.authenticator?.kind !== "legacy") return false;
    if (this.authenticator.digest.mode.toLowerCase() === mode.toLowerCase()) return false;
    this.authenticator.digest.switchTo(mode);
    return true;
  }

  private async exchange(action: string, body: Buffer, readOnly: boolean): Promise<ResponseDocument> {
    const authenticator = await this.resolveAuthenticator();
    let renewToken = false;
    for (;;) {
      const headers: [string, string][] = [
        ["Content-Type", "text/xml"],
        ["LOCALE", this.locale],
        ["TIMEZONE_NAME", this.timeZoneName],
      ];
      if (readOnly) headers.push(["Aras-Request-ReadOnly", "1"]);
      headers.push(["SOAPAction", action]);
      if (authenticator.kind === "bearer") {
        if (authenticator.token === undefined || renewToken) authenticator.token = await authenticator.provider.getAccessToken();
        if (authenticator.token === "") throw new DotNetException("System.ArgumentException", "Token value can not be null or empty.");
        headers.push([authenticator.protocol.header, `Bearer ${authenticator.token}`]);
      } else {
        headers.push(
          ["AUTHUSER", this.settings.userName],
          ["AUTHPASSWORD", authenticator.digest.value],
          ["DATABASE", this.settings.database],
        );
      }
      headers.push(["Host", new URL(this.urls.soap).host]);
      const cookie = this.cookies.header;
      if (cookie !== undefined) headers.push(["Cookie", cookie]);
      headers.push(["Content-Length", String(body.length)]);

      let response: TransportResponse;
      try {
        response = await this.transport.send({
          method: "POST",
          url: this.urls.soap,
          headers,
          body,
          responseTimeoutMs: this.timeoutMs > 0 ? this.timeoutMs : this.timeoutMs === -1 ? 0 : DEFAULT_RESPONSE_TIMEOUT_MS,
          readTimeoutMs: READ_TIMEOUT_MS,
        });
      } catch (error) {
        throw webException(error);
      }
      this.cookies.store(response);
      if (response.status >= 400) {
        if (authenticator.kind === "bearer" && !renewToken && response.status === authenticator.protocol.unauthorizedStatus) {
          renewToken = true;
          continue;
        }
        throw new DotNetException("System.Net.WebException", `The remote server returned an error: (${response.status}) ${response.reason}.`);
      }
      const text = Buffer.from(response.body).toString("utf8");
      return ResponseDocument.parse(text.startsWith("\uFEFF") ? text.slice(1) : text);
    }
  }

  /**
   * Logs in and answers with the user's item, or with a fault: an unreachable
   * or unsuitable OAuth server, a refused password, or a user record that
   * cannot be read.
   */
  async login(): Promise<ResponseDocument> {
    try {
      await this.resolveAuthenticator();
    } catch (error) {
      return this.faultFor(error);
    }
    const validated = await this.callAction("ValidateUser", "<Item/>");
    const id = resultChild(validated, "id");
    if (!id) return validated.isError ? validated : this.iom12 ? failedToLoginFault() : unknownErrorFault();
    if (this.iom12) return this.loginIom12();
    this.userId = innerText(id);
    const user = await this.readUser(this.userId);
    if (user.isError) {
      this.userId = undefined;
      return user;
    }
    const database = resultChild(validated, "database");
    if (database && innerText(database) !== "") this.loggedOnDatabase = innerText(database);
    const loginName = resultChild(validated, "login_name");
    if (loginName && innerText(loginName) !== "") this.loggedOnUser = innerText(loginName);
    return user;
  }

  /**
   * IOM 12's `getUserInfo` after a `ValidateUser` that gave an id (WIRE-015): the user id comes from a second call,
   * `GetCurrentUserID`, and the user record is read as in IOM 14. The database and the login name are not kept.
   */
  private async loginIom12(): Promise<ResponseDocument> {
    const current = await this.callAction("GetCurrentUserID", "<Empty/>");
    if (current.isError) return current;
    const result = descendantElements(current.document.root).find((e) => e.name === "Result");
    if (!result) throw new DotNetException("System.Exception", "Cannot obtain user id");
    this.userId = innerText(result);
    const user = await this.readUser(this.userId);
    if (user.isError) this.userId = undefined;
    return user;
  }

  /** The user record: with the user's read priorities, and without them when that fails. */
  private async readUser(id: string): Promise<ResponseDocument> {
    const withPriorities =
      `<Item type='User' action='get' select='default_vault' expand='1'><id>${id}</id>` +
      "<Relationships><Item type='ReadPriority' action='get' select='priority, related_id' expand='1' orderBy='priority'/></Relationships></Item>";
    const first = await this.callAction("ApplyItem", withPriorities);
    if (!first.isError) return first;
    return this.callAction("ApplyItem", `<Item type='User' action='get' select='default_vault' expand='1'><id>${id}</id></Item>`);
  }

  /** Sends the logoff call and forgets the user. The answer, and any failure, are ignored. */
  async logout(unlockOnLogout = false): Promise<void> {
    await this.callAction("Logoff", `<logoff skip_unlock='${unlockOnLogout ? "0" : "1"}'/>`);
    this.userId = undefined;
  }
}

/**
 * The connection Aras's ConsoleUpgrade.exe makes: IOM's password login with
 * locale `en-US`.
 *
 * @spec WIRE-002 WIRE-005 WIRE-040 WIRE-090
 */
export class HttpConnectorExtension extends HttpServerConnection {
  constructor(settings: Omit<ConnectionSettings, "locale">) {
    super({ ...settings, locale: "en-US" });
  }
}

/**
 * The connection timeout the engine applies after login: when it is above 0 or
 * exactly -1, and the connection is an IOM one.
 *
 * @spec WIRE-031
 */
export function applyContextTimeout(connection: unknown, timeout: number): void {
  if ((timeout > 0 || timeout === -1) && connection instanceof HttpServerConnection) connection.timeout = timeout;
}
