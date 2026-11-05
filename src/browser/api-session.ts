import { HttpConnectorExtension } from "../client/connection.js";
import { CItemException } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import type { VersionGate } from "../client/item-helper.js";
import type { TokenProvider } from "../client/oauth.js";
import type { HttpTransport } from "../client/transport.js";
import { type ArasVersion, VersionRefusal, engineAcceptsServer } from "../client/version.js";
import { DEFAULT_ENGINE, type Engine, isEngine } from "../engines.js";
import type { ServerConnection } from "../client/innovator.js";
import { OptionError, RunAbortedError } from "./api-run.js";

/**
 * The session of the browser API (HOST-270): one login of one connection, the engine it runs, and the rule that it serves one
 * operation at a time.
 *
 * @spec HOST-270 HOST-271
 */

/** What `connect` takes (HOST-270). */
export interface ConnectOptions {
  /** The server's address as the CLI's `--url` takes it, such as `https://aras.example.com/InnovatorServer`. */
  url: string;
  database: string;
  /** The login name. Needed with `password`; with a `tokenProvider` it may be left out (the server's own name for the user is used). */
  userName?: string;
  /** The password. It is held by the connection only; nothing is stored (HOST-270). */
  password?: string;
  /**
   * Where the bearer tokens come from, instead of the password grant (HOST-271): the way a page inside a signed-in Aras client passes
   * the client's session. It is never read from the page by the library; the caller decides.
   */
  tokenProvider?: TokenProvider;
  /** The engine to run. `"auto"` (the default) follows the server's version (HOST-270). */
  engine?: Engine | "auto";
  /** Runs an engine on a server outside its window, as the CLI's `--skip-version-check` does (WIRE-024). */
  skipVersionCheck?: boolean;
  /** The initial `TIMEZONE_NAME`, a Windows time zone id (WIRE-005). Default: the CLDR mapping of the page's zone (HOST-242). */
  timeZoneName?: string;
  /** The initial `LOCALE`; the server replaces it at login (WIRE-005). Default `en-US`. */
  locale?: string;
  /** The context timeout in milliseconds: 0 for the engine's own, -1 for none (WIRE-031). */
  timeoutMs?: number;
  /** The HTTP layer; default the browser's `fetch` transport (HOST-230). */
  transport?: HttpTransport;
}

/** An operation on a session that is closed (HOST-270). */
export class SessionClosedError extends Error {
  override name = "SessionClosedError";

  constructor() {
    super("the session is closed: connect again");
  }
}

/** An operation that starts while another runs on the same session (HOST-270). */
export class SessionBusyError extends Error {
  override name = "SessionBusyError";

  constructor() {
    super("the session is running another operation: a session serves one at a time");
  }
}

/**
 * The engine whose behaviour matches a server of this version (HOST-270): 12.0 for a server of major version 12 or below, 14.35 for
 * a 14 of minor version 35 or more, 14.0.7 for the other servers of major 13 to 14, and the default engine, which refuses it, for any
 * other.
 */
export function engineForServer(version: Pick<ArasVersion, "major" | "minor">): Engine {
  if (version.major <= 12) return "12.0";
  if (version.major === 14 && version.minor >= 35) return "14.35";
  if (version.major >= 13 && version.major <= 14) return "14.0.7";
  return DEFAULT_ENGINE;
}

/** Refuses every call but the logoff once the signal is raised, until the function it answers is called (HOST-272). */
function gateServerCalls(connection: ServerConnection, signal: AbortSignal): () => void {
  const send = connection.callAction;
  connection.callAction = (action, request) =>
    signal.aborted && action !== "Logoff" ? Promise.reject(new RunAbortedError()) : send.call(connection, action, request);
  return () => {
    Reflect.deleteProperty(connection, "callAction");
  };
}

/** A logged-in connection and the engine over it (HOST-270). */
export class Session {
  readonly engine: Engine;
  /** The server's version as the probe read it. */
  readonly serverVersion: ArasVersion;
  readonly url: string;
  readonly database: string;
  /** The login name given to `connect`; with a token provider and none given, the one the server reported. */
  readonly userName: string;
  readonly timeoutMs: number;
  /** The engine's helper over the connection, for a caller that wires a run by hand (the low-level API). */
  readonly helper: CItemHelper;
  /** What the version gate decided (WIRE-022); `skipped` is true for a server let through by `skipVersionCheck`. */
  readonly versionGate: VersionGate | undefined;

  private isClosed = false;
  private isBusy = false;

  /** @internal Made by {@link connect}. */
  constructor(parts: {
    engine: Engine;
    helper: CItemHelper;
    serverVersion: ArasVersion;
    url: string;
    database: string;
    userName: string;
    timeoutMs: number;
  }) {
    this.engine = parts.engine;
    this.helper = parts.helper;
    this.serverVersion = parts.serverVersion;
    this.url = parts.url;
    this.database = parts.database;
    this.userName = parts.userName;
    this.timeoutMs = parts.timeoutMs;
    this.versionGate = parts.helper.versionGate;
  }

  /** The server version text the engine writes in its log, such as `14.0.9.36073` or `12.0 SP9 Build 24090` (WIRE-022). */
  get serverVersionText(): string {
    return this.serverVersion.fullString;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** Sends the logoff (WIRE-040). A second call does nothing. */
  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    await this.helper.logout();
  }

  /** @internal For a flow that always ends with the logoff itself (the language-pack import, LP-001), called as that flow is entered. */
  markLoggedOff(): void {
    this.isClosed = true;
  }

  /**
   * @internal Runs one operation: refuses a closed or busy session, and marks it busy until the operation is over. With `stopCallsOn`,
   * a server call that starts after the signal is raised is not sent (HOST-272).
   */
  async run<T>(operation: () => Promise<T>, options: { stopCallsOn?: AbortSignal } = {}): Promise<T> {
    if (this.isClosed) throw new SessionClosedError();
    if (this.isBusy) throw new SessionBusyError();
    this.isBusy = true;
    const openGate = options.stopCallsOn === undefined ? undefined : gateServerCalls(this.helper.inn.connection, options.stopCallsOn);
    try {
      return await operation();
    } finally {
      openGate?.();
      this.isBusy = false;
    }
  }
}

interface Opened {
  helper: CItemHelper;
  version: ArasVersion;
  userName: string;
}

/** The steps of WIRE-002 for one engine: the connection, the helper and the login with the probe and gate. */
async function open(engine: Engine, options: ConnectOptions, skipVersionCheck: boolean): Promise<Opened> {
  const connection = new HttpConnectorExtension({
    engine,
    url: options.url,
    database: options.database,
    userName: options.userName ?? "",
    password: options.password ?? "",
    ...(options.timeZoneName === undefined ? {} : { timeZoneName: options.timeZoneName }),
    ...(options.transport === undefined ? {} : { transport: options.transport }),
    ...(options.tokenProvider === undefined ? {} : { tokenProvider: options.tokenProvider }),
  });
  if (options.locale !== undefined) connection.locale = options.locale;
  const helper = new CItemHelper(connection, { engine, skipVersionCheck });
  await helper.login();
  const version = helper.innovatorVersion;
  if (!helper.isConnected || version === undefined) throw new CItemException(-100, "The login was cancelled", "The login was cancelled");
  return { helper, version, userName: options.userName ?? connection.loggedOnUser ?? "" };
}

function checkOptions(options: ConnectOptions): void {
  if (options.url === "") throw new OptionError("connect needs the url of the server");
  if (options.database === "") throw new OptionError("connect needs the database");
  if (options.tokenProvider === undefined && ((options.userName ?? "") === "" || (options.password ?? "") === "")) {
    throw new OptionError("connect needs the userName and the password, or a tokenProvider");
  }
  if (options.engine !== undefined && options.engine !== "auto" && !isEngine(options.engine)) {
    throw new OptionError(`unknown engine '${String(options.engine)}'`);
  }
  const timeout = options.timeoutMs ?? 0;
  if (!Number.isInteger(timeout) || timeout < -1) throw new OptionError("timeoutMs is a whole number of milliseconds, 0 or more, or -1 for none");
}

/**
 * Logs in and answers with a session (HOST-270): the browser's `openSession`. The engine is the one named, or the one that fits the
 * server's version; a server outside the engine's window is refused with a `VersionRefusal` unless `skipVersionCheck`. A login the
 * server refuses throws the engine's `CItemException`.
 */
export async function connect(options: ConnectOptions): Promise<Session> {
  checkOptions(options);
  const skip = options.skipVersionCheck ?? false;
  const timeoutMs = options.timeoutMs ?? 0;
  const make = (engine: Engine, opened: Opened): Session =>
    new Session({ engine, helper: opened.helper, serverVersion: opened.version, url: options.url, database: options.database, userName: opened.userName, timeoutMs });

  if (options.engine !== undefined && options.engine !== "auto") return make(options.engine, await open(options.engine, options, skip));

  // the engine follows the server: probe with the default engine, whose login every server takes, with the gate off
  const probe = await open(DEFAULT_ENGINE, options, true);
  const picked = engineForServer(probe.version);
  if (picked !== DEFAULT_ENGINE) {
    await probe.helper.logout();
    return make(picked, await open(picked, options, skip));
  }
  if (!engineAcceptsServer(picked, probe.version.major) && !skip) {
    await probe.helper.logout().catch(() => undefined);
    throw new VersionRefusal(picked, probe.version);
  }
  return make(picked, probe);
}
