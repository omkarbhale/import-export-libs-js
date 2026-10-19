import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { HttpConnectorExtension, HttpServerConnection, applyContextTimeout } from "./connection.js";
import { DotNetException } from "./dotnet.js";
import { CLIENT_ENGINES, EngineNotSupportedError } from "./engine-support.js";
import { CItemException, type ResponseDocument } from "./fault.js";
import { Innovator, type ServerConnection } from "./innovator.js";
import { ItemLookups } from "./item-lookups.js";
import { ItemReferences } from "./item-references.js";
import { probeServerVersion } from "./probe.js";
import { type ArasVersion, VersionRefusal, engineAcceptsServer, enginesAcceptingServer } from "./version.js";

export { CLIENT_ENGINES, EngineNotSupportedError };

/**
 * The request of `getSolutions` (EXP-507): the current package definitions with their groups' elements and their dependencies.
 * The line ends and the indentation are part of the request and reach the wire (WIRE-007).
 */
const GET_SOLUTIONS_AML = [
  "<Item type='PackageDefinition' select='name,generation' action='get' >",
  `${" ".repeat(14)}<is_current>1</is_current>`,
  `${" ".repeat(14)}<Relationships>`,
  `${" ".repeat(16)}<Item type='PackageGroup' select='name'>`,
  `${" ".repeat(18)}<Relationships>`,
  `${" ".repeat(20)}<Item type='PackageElement' select='name,element_id,element_type' />`,
  `${" ".repeat(18)}</Relationships>`,
  `${" ".repeat(16)}</Item>`,
  `${" ".repeat(16)}<Item type='PackageDependsOn' select='name' />`,
  `${" ".repeat(14)}</Relationships>`,
  `${" ".repeat(12)}</Item>`,
].join("\r\n");

/** A login fault whose text has this is a cancelled login for 14.35 (WIRE-017). */
const CANCELLED_LOGIN = "System.Threading.Tasks.TaskCanceledException";

export interface ItemHelperOptions {
  engine?: Engine;
  /** Runs the probe but does not refuse a server outside the engine's window (the library's `--skip-version-check`). */
  skipVersionCheck?: boolean;
}

/** What the gate decided about the server it probed. */
export interface VersionGate {
  engine: Engine;
  server: ArasVersion;
  /** The server is inside the engine's window. */
  accepted: boolean;
  /** The server is outside the window and was let through because the check was skipped. */
  skipped: boolean;
  /** The engines whose window holds the server. */
  fittingEngines: Engine[];
}

/**
 * The part of the engine's `CItemHelper` that owns the connection: login with
 * the version probe and gate, `applyAML`, and logout.
 *
 * `[14.35]` has a connection state: `Inn` is null after a refused server, a cancelled login and `logout`, and then
 * `isConnected` is false and the first use of `inn` fails like a null reference (WIRE-001, WIRE-056).
 *
 * @spec WIRE-001 WIRE-002 WIRE-006 WIRE-017 WIRE-022 WIRE-023 WIRE-024 WIRE-031 WIRE-040 WIRE-056 EXP-507
 */
export class CItemHelper {
  readonly engine: Engine;
  private innovator: Innovator | undefined;
  /** The server version `login` read. */
  innovatorVersion: ArasVersion | undefined;
  /** The folder of the package being exported, which the item files go into (`Folder`, set by the export run: EXP-513). */
  folder: string | null = null;
  /** The gate's decision, set by `login`. */
  versionGate: VersionGate | undefined;
  /** The export-side lookups and their cache, one per helper (EXP-030). */
  readonly lookups: ItemLookups = new ItemLookups(this);
  /** The rewrites of an answer's references (EXP-113 to EXP-116) and the id of a related item (EXP-114). */
  readonly references: ItemReferences = new ItemReferences(this);

  private readonly skipVersionCheck: boolean;

  constructor(
    private readonly connection: ServerConnection,
    options: ItemHelperOptions = {},
  ) {
    this.engine = options.engine ?? DEFAULT_ENGINE;
    if (!CLIENT_ENGINES.includes(this.engine)) throw new EngineNotSupportedError(this.engine);
    if (connection instanceof HttpServerConnection && connection.engine !== this.engine) {
      throw new Error(`a ${connection.engine} connection cannot serve the ${this.engine} engine`);
    }
    this.skipVersionCheck = options.skipVersionCheck ?? false;
    this.innovator = new Innovator(connection);
  }

  /** The `Innovator` over the connection (`Inn`). Reading it when there is no connection fails like the engine's first use of a null `Inn`. */
  get inn(): Innovator {
    if (this.innovator === undefined) {
      throw new DotNetException("System.NullReferenceException", "Object reference not set to an instance of an object.");
    }
    return this.innovator;
  }

  /** True while `Inn` is set (`IsConnected`, 14.35). */
  get isConnected(): boolean {
    return this.innovator !== undefined;
  }

  /**
   * Logs the connection in, reads the server version and applies the gate. A
   * connection that is not an IOM one is taken to be logged in already.
   */
  async login(): Promise<void> {
    const connection = this.inn.connection;
    if (connection instanceof HttpServerConnection) {
      const user = await connection.login();
      if (user.isError) {
        if (this.engine === "14.35" && user.errorString.includes(CANCELLED_LOGIN)) {
          this.innovator = undefined;
          return;
        }
        const message = `Failed login to Innovator; original error: ${user.outerXml}`;
        throw new CItemException(-100, message, message);
      }
    }
    const server = await probeServerVersion(this.inn, this.engine);
    this.innovatorVersion = server;
    const accepted = engineAcceptsServer(this.engine, server.major);
    this.versionGate = {
      engine: this.engine,
      server,
      accepted,
      skipped: !accepted && this.skipVersionCheck,
      fittingEngines: enginesAcceptingServer(server.major),
    };
    if (!accepted && !this.skipVersionCheck) {
      if (this.engine === "14.35") this.innovator = undefined;
      throw new VersionRefusal(this.engine, server);
    }
  }

  /**
   * Applies an item and throws on any fault, faultcode 0 included; callers that
   * read faultcode 0 as an empty result catch it and test `faultcode`.
   */
  async applyAML(aml: string): Promise<ResponseDocument> {
    const response = await this.inn.applyItem(aml);
    if (response.isError) throw CItemException.fromRequest(aml, response, this.engine);
    return response;
  }

  /**
   * `getSolutions`: the package definitions of the database, as the answer to {@link GET_SOLUTIONS_AML}. A fault with faultcode 0
   * (no definitions) gives null. Any other fault is rethrown with `Unable to get packages meta.` and the exception's message
   * (the whole `Server error` text of WIRE-051) added to its detail, with no separator.
   *
   * @spec EXP-507
   */
  async getSolutions(): Promise<ResponseDocument | null> {
    try {
      return await this.applyAML(GET_SOLUTIONS_AML);
    } catch (error) {
      if (!(error instanceof CItemException)) throw error;
      if (error.faultcode === 0) return null;
      error.faultdetail = `${error.faultdetail ?? ""}Unable to get packages meta.\r\n${error.message}`;
      throw error;
    }
  }

  /** The context timeout, which the manager's constructor copies to an IOM connection after login (WIRE-031). */
  applyTimeout(timeout: number): void {
    applyContextTimeout(this.connection, timeout);
  }

  /**
   * Logs off, but only on the connection Aras's console tool makes. `[14.35]`: a helper with no connection does nothing,
   * and one with a connection forgets it afterwards whatever its type.
   */
  async logout(): Promise<void> {
    if (this.engine === "14.35" && !this.isConnected) return;
    if (Object.getPrototypeOf(this.connection) === HttpConnectorExtension.prototype) {
      await (this.connection as HttpConnectorExtension).logout();
    }
    if (this.engine === "14.35") this.innovator = undefined;
  }

  /**
   * The timeout step of the `ImportExportManager` constructor: a timeout above 0, or exactly -1, is copied to an IOM
   * connection, which the constructor reads through `Inn` first.
   */
  applyContextTimeout(timeout: number): void {
    if (timeout > 0 || timeout === -1) applyContextTimeout(this.inn.connection, timeout);
  }
}
