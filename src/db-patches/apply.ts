import { randomUUID } from "node:crypto";
import { attributeOf } from "../client/mini-xml.js";
import { responseDom } from "../client/answer.js";
import { DotNetException } from "../client/dotnet.js";
import { type ResponseDocument, getProperty } from "../client/fault.js";
import type { CItemHelper } from "../client/item-helper.js";
import { ENGINE_ASSEMBLY_VERSIONS } from "../engines.js";
import type { SolutionUpgradeContext } from "../export/export-context.js";
import { type Message, type MessagesFactory } from "../export/messages.js";
import { RunLog, formatWithArgs, invariantDateTime } from "../export/run-log.js";
import { defaultOsUser } from "../import/import-helper.js";
import { ArgumentException, ArgumentNullException, Exception, NullReferenceException } from "../io/errors.js";
import { fileExists, type PathEnvironment } from "../io/host-path.js";
import { pathCombineAll } from "../io/win-path.js";
import { selectSingleNode } from "../xml/xpath.js";
import { type XmlElement, innerText } from "../xml/dom.js";
import { loadXml } from "../xml/parser.js";
import { xmlDocumentLoad } from "../xml/read-text.js";
import { outerXml } from "../xml/writer-legacy.js";
import { xelementParseToString } from "../xml/xdocument.js";
import { DBUpdateConfig, type UpdateNode, inRunOrder, readUpdateNodes, targetRelease } from "./config.js";
import { dbPatchMessage } from "./messages.js";

/** The id of the Super User identity, which the user `root` must hold through its Alias (DBP-011). */
const SUPER_USER_ID = "6B14D33C4A7D41C188CCF2BC15BD01A3";
/** The id of the Innovator Admin identity (DBP-011). */
const INNOVATOR_ADMIN_ID = "DBA5D86402BF43D5976854B8B48FCDD1";

/** The `upgrade_status` of a `DatabaseUpgrade` row (DBP-030, DBP-044): set at the start of a run, then to 1 or 2 at its end. */
const STATUS_STARTED = "0";
const STATUS_APPLIED = "1";
const STATUS_FAILED = "2";

/** What a DB patch run needs of the engine's manager, which builds it (DBP-001). */
export interface DbPatchHost {
  context: SolutionUpgradeContext;
  messages: MessagesFactory;
  itemHelper: CItemHelper;
  environment: PathEnvironment;
  /** The clock of the log's date-times. */
  now: () => Date;
  /** The value of `os_user` in the `DatabaseUpgrade` row, or a function that gives it; the default is IMP-452's. */
  osUser?: string | (() => string);
  /** Gives the id of a new item. The engine gives an `add` an id of its own, a random GUID; tests inject theirs. */
  newId?: () => string;
}

/** The faults of the JavaScript runtime itself, which no .NET exception stands for: a bug of the port, never an exception of the engine. */
function isRuntimeFault(error: unknown): boolean {
  return error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError || error instanceof SyntaxError;
}

/** The full .NET type name of an exception the XML core or the client raises, which is what `Exception.ToString()` starts with. */
function exceptionTypeName(error: Error): string {
  if (error instanceof DotNetException) return error.typeName;
  return error.name === "XmlException" ? "System.Xml.XmlException" : `System.${error.name}`;
}

const isNullOrEmpty = (text: string | null | undefined): boolean => text === null || text === undefined || text === "";

/** The text IOM writes for a property value: `&`, `<` and `>` escaped (`setProperty` sets the element's text). */
const escapeText = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * An item as IOM's `newItem(type, action)` and its setters build it: `isNew` and `isTemp` first, then `type`, `action` and the
 * attributes in the order the engine sets them, and the properties in order. Property values are escaped; attribute values are ids
 * and fixed words.
 */
function itemXml(attributes: ReadonlyArray<readonly [string, string]>, properties: ReadonlyArray<readonly [string, string]> = []): string {
  const attributeText = attributes.map(([name, value]) => ` ${name}="${value}"`).join("");
  const content = properties.map(([name, value]) => `<${name}>${escapeText(value)}</${name}>`).join("");
  return `<Item isNew="1" isTemp="1"${attributeText}>${content}</Item>`;
}

/** `Item.getID()` of an answer: its one item's `id`; anything but one item is the engine's `Not a single item`. */
function singleItemId(response: ResponseDocument): string {
  const [item, ...more] = response.items;
  if (item === undefined || more.length > 0) throw new DotNetException("System.Exception", "Not a single item");
  return attributeOf(item, "id") ?? "";
}

/**
 * The engine's `ImportExportManager.ApplyDBUpdateManifest` and the members it calls (DBP-001 to DBP-094): it checks the user, reads
 * the manifest of patches, records a `DatabaseUpgrade` row for the target release, hands each patch file to the server's
 * `ApplyUpdate` action, links the applied update to the row and sets the row's status. Messages and log lines share one helper
 * ({@link DbPatchApplication.logTrace}). A failed patch is an `error` message and a status of 2, not an exception (DBP-094).
 *
 * @spec DBP-001 DBP-003 DBP-004 DBP-005 DBP-010 DBP-011 DBP-012 DBP-020 DBP-021 DBP-022 DBP-030 DBP-031 DBP-040 DBP-041 DBP-042 DBP-043
 * @spec DBP-044 DBP-050 DBP-060 DBP-061 DBP-062 DBP-070 DBP-071 DBP-090 DBP-091 DBP-092 DBP-093 DBP-094
 */
export class DbPatchApplication {
  private readonly context: SolutionUpgradeContext;
  private readonly messages: MessagesFactory;
  private readonly itemHelper: CItemHelper;
  private readonly environment: PathEnvironment;
  private readonly now: () => Date;
  private readonly osUser: () => string;
  private readonly newId: () => string;

  constructor(host: DbPatchHost) {
    this.context = host.context;
    this.messages = host.messages;
    this.itemHelper = host.itemHelper;
    this.environment = host.environment;
    this.now = host.now;
    this.osUser = typeof host.osUser === "string" ? () => host.osUser as string : (host.osUser ?? (() => defaultOsUser()));
    this.newId = host.newId ?? (() => randomUUID().replace(/-/g, "").toUpperCase());
  }

  private timestamp(): string {
    return invariantDateTime(this.now());
  }

  /**
   * `ApplyDBUpdateManifest(config)`. In this order (DBP-003): a null config is refused; the log is opened, outside the `try`;
   * inside it the header, the start lines, the `root` check, the check of the two paths, `ValidateRootUser`, the manifest and
   * the patches. One handler sends an exception's message on the `error` channel, logs it and rethrows it; the end lines are sent
   * whatever happened, and the log is closed after them.
   */
  async applyDBUpdateManifest(config: DBUpdateConfig | null): Promise<void> {
    if (config === null) throw new ArgumentNullException("config");
    const log = RunLog.open(this.context.logFilePath, this.environment);
    try {
      const status = this.messages.getStatusMessage();
      const error = this.messages.getErrorMessage();
      try {
        await this.applyPatches(config, status, log);
      } catch (thrown) {
        await this.logTrace(thrown instanceof Error ? thrown.message : String(thrown), error, log);
        throw thrown;
      } finally {
        await this.logTrace(dbPatchMessage("EndOfImportingDBPackages"), status, log);
        await this.logTrace(dbPatchMessage("EndDateTime", this.timestamp()), status, log);
      }
    } finally {
      log.dispose();
    }
  }

  /** The body of the `try` of {@link applyDBUpdateManifest}: everything after the log is open. */
  private async applyPatches(config: DBUpdateConfig, status: Message, log: RunLog): Promise<void> {
    this.logInputParameters(config, log);
    await this.logTrace(dbPatchMessage("StartOfImportingDBPackages"), status, log);
    await this.logTrace(dbPatchMessage("StartDateTime", this.timestamp()), status, log);

    // DBP-010: a name check on what the host configured, before anything is sent
    if (this.context.userName !== "root") {
      throw new ArgumentException(dbPatchMessage("LoginNameIsNotRootCheckYourConfigFile", this.context.userName));
    }
    this.validateInputParameters(config);
    await this.validateRootUser();

    const manifestPath = config.dbUpdatedManifestFilePath;
    const manifest = xmlDocumentLoad(manifestPath, this.environment);
    const release = targetRelease(manifest);
    await this.logTrace(dbPatchMessage("LoadedForUpgradeToRelease", manifestPath, release), status, log);
    const updates = readUpdateNodes(manifest);
    await this.logTrace(dbPatchMessage("ThereAreUpdates", String(updates.length)), status, log);

    const upgradeId = await this.createOrGetDatabaseUpgradeItemId(config.toolName, release, status, log);
    let upgradeStatus = STATUS_APPLIED;
    for (const update of inRunOrder(updates)) {
      if (!(await this.applyPatch(update, config, upgradeId, status, log))) upgradeStatus = STATUS_FAILED;
    }
    if (!isNullOrEmpty(upgradeId)) await this.setUpgradeStatus(upgradeId as string, upgradeStatus, status, log);
  }

  /**
   * `LogInputParameters` for a DB patch run: the block of EXP-506 with the settings of this operation in place of the export's.
   * The optional export and import contexts are null, so their lines are absent. The words `nanifest` and `pathes` are misspelt
   * in the engine. A helper that never logged in has no `Innovator version`, a `NullReferenceException`.
   *
   * @spec DBP-005
   */
  private logInputParameters(config: DBUpdateConfig, log: RunLog): void {
    const version = this.itemHelper.innovatorVersion;
    if (version === undefined) throw new NullReferenceException();
    const context = this.context;
    const lines = [
      formatWithArgs("Tool version: {0}", ENGINE_ASSEMBLY_VERSIONS[this.itemHelper.engine]),
      formatWithArgs("Action: {0}", context.action),
      formatWithArgs("Manifest file: {0}", context.manifestFile),
      formatWithArgs("Log file: {0}", context.logFilePath),
      formatWithArgs("Working directory: {0}", context.workingDirectory),
      formatWithArgs("URL: {0}", context.url),
      formatWithArgs("Database: {0}", context.dataBase),
      formatWithArgs("User: {0}", context.userName),
      formatWithArgs("Innovator version: {0}", version.fullString),
      formatWithArgs("Language pack: {0}", context.lpPath),
      formatWithArgs("Language pack name: {0}", context.lpPackage),
      formatWithArgs("DB updated nanifest file path: {0}", config.dbUpdatedManifestFilePath),
      formatWithArgs("DB pathes folder path: {0}", config.dbPatchesFolderPath),
      formatWithArgs("Tool name: {0}", config.toolName),
    ];
    log.writeLine(lines.map((line) => `${line}\r\n`).join(""));
  }

  /**
   * `LogTrace(text, message, logWriter)`: the text goes to the host on the message's channel and then to the log as one line.
   *
   * @spec DBP-004
   */
  async logTrace(text: string, message: Message, log: RunLog): Promise<void> {
    message.text = text;
    await message.execute();
    log.writeLine(text);
  }

  /**
   * `XmlToPrettyXml(xml)`: `XElement.Parse(xml).ToString()`. When the text does not parse, the exception goes to the log and the
   * text is returned as it is. The port writes the exception's type and message in place of .NET's `ToString()`, which has the stack
   * frames of the engine (a deviation the port cannot avoid, DBP-004).
   *
   * @spec DBP-004
   */
  xmlToPrettyXml(xml: string, log: RunLog): string {
    try {
      return xelementParseToString(xml);
    } catch (error) {
      if (!(error instanceof Error) || isRuntimeFault(error)) throw error;
      log.writeLine(`${exceptionTypeName(error)}: ${error.message}`);
      return xml;
    }
  }

  /** `ValidateInputParrameters(config)`: the manifest path is checked first, then the folder; only that they are given. */
  private validateInputParameters(config: DBUpdateConfig): void {
    if (isNullOrEmpty(config.dbUpdatedManifestFilePath)) {
      throw new ArgumentException(dbPatchMessage("DBUpdatedManifestFilePathNotSpecifiedCheckYourConfigFile"));
    }
    if (isNullOrEmpty(config.dbPatchesFolderPath)) {
      throw new ArgumentException(dbPatchMessage("DBPathesFolderPathNotSpecifiedCheckYourConfigFile"));
    }
  }

  /**
   * `CallAction(actionName, aml)`: the engine's raw SOAP call. The text is loaded into an `XmlDocument` first, so a malformed
   * one is an `XmlException` before anything is sent; IOM sends the root element with the action as its `SOAPAction` and writes
   * its own fault for every transport problem (WIRE-050), so the answer is always a document. The engine's step for an empty
   * answer, which makes an error item, cannot be reached with it.
   *
   * @spec DBP-012
   */
  async callAction(actionName: string, aml: string): Promise<ResponseDocument> {
    loadXml(aml, { preserveWhitespace: true });
    return this.itemHelper.inn.connection.callAction(actionName, aml);
  }

  /**
   * `ValidateRootUser`: four questions to the server, stopping at the first failure (DBP-011). The user must be an `admin` who
   * holds the Super User identity through its Alias, and the two identities must have the ids the engine knows. Every failure is a
   * plain `Exception`.
   */
  private async validateRootUser(): Promise<void> {
    const validated = await this.callAction("ValidateUser", "<Empty/>");
    if (validated.isError) throw new Exception(validated.errorString);
    const validatedDom = responseDom(validated);
    const id = selectSingleNode("//Result/id", validatedDom);
    const userType = selectSingleNode("//Result/user_type", validatedDom);
    if (id === null || userType === null) throw new NullReferenceException();
    const userTypeText = innerText(userType);
    if (userTypeText !== "admin") throw new Exception(dbPatchMessage("UserTypeIsNotAdminPossibleIssue", userTypeText));

    const alias = await this.callAction("GetItem", `<Item type='USER' id='${innerText(id)}' select='id' config_path='Alias' levels='1' />`);
    if (alias.isError) throw new Exception(alias.errorString);
    const identity = selectSingleNode("//Result/Item/Relationships/Item[@type='Alias']/related_id/Item", responseDom(alias));
    const identityId = identity === null ? null : ((identity as XmlElement).getAttribute("id") ?? "");
    if (identityId !== SUPER_USER_ID) {
      throw new Exception(dbPatchMessage("DidNotObtainExpectedRootSuperUserIdentityPossibleIssue", identityId));
    }

    await this.validateIdentity("Super User", SUPER_USER_ID);
    await this.validateIdentity("Innovator Admin", INNOVATOR_ADMIN_ID);
  }

  /** One identity by name: a fault is thrown with its text, a missing item is a null reference, a different id is refused. */
  private async validateIdentity(name: string, expectedId: string): Promise<void> {
    const response = await this.callAction("GetItem", `<Item type='Identity'><name>${name}</name></Item>`);
    if (response.isError) throw new Exception(response.errorString);
    const found = selectSingleNode("//Result/Item/@id", responseDom(response));
    if (found === null) throw new NullReferenceException();
    if (found.nodeValue !== expectedId) throw new Exception(dbPatchMessage("DidNotGetExpectedIdResultForIdentityPossibleIssue", name));
  }

  /**
   * Applies an item request: the request is sent to the host as `Request`, applied, and the answer is sent as `Response` on the
   * `status` channel, or on `warning` when it is a fault (DBP-030). The answer is returned.
   */
  private async applyLogged(aml: string, status: Message, log: RunLog): Promise<ResponseDocument> {
    await this.logTrace(dbPatchMessage("Request", this.xmlToPrettyXml(aml, log)), status, log);
    const response = await this.itemHelper.inn.applyItem(aml);
    const channel = response.isError ? this.messages.getWarningMessage() : status;
    await this.logTrace(dbPatchMessage("Response", this.xmlToPrettyXml(response.outerXml, log)), channel, log);
    return response;
  }

  /**
   * `CreateOrGetDatabaseUpgradeItemId(toolName, release)`: the id of the `DatabaseUpgrade` row named "Applied Updates" for the
   * release, with type 0. Without an ItemType `DatabaseUpgrade` the answer is null. A missing row (any fault) is added; a row that
   * exists is unlocked when locked and edited, and keeps its description. A fault on the final request is also null (DBP-030).
   *
   * @spec DBP-030 DBP-031
   */
  async createOrGetDatabaseUpgradeItemId(toolName: string | null, release: string, status: Message, log: RunLog): Promise<string | null> {
    const itemType = await this.applyLogged(
      itemXml([["type", "ItemType"], ["action", "get"], ["select", "id"]], [["name", "DatabaseUpgrade"]]),
      status,
      log,
    );
    if (itemType.isError) return null;

    const existing = await this.applyLogged(
      itemXml(
        [["type", "DatabaseUpgrade"], ["action", "get"], ["select", "id,locked_by_id"]],
        [["name", "Applied Updates"], ["target_release", release], ["type", "0"]],
      ),
      status,
      log,
    );
    let request: string;
    if (existing.isError) {
      request = itemXml(
        [["type", "DatabaseUpgrade"], ["action", "add"], ["id", this.newId()], ["select", "id"]],
        [
          ["name", "Applied Updates"],
          ["target_release", release],
          ["type", "0"],
          ["description", toolName ?? ""],
          ["is_latest", "1"],
          ["os_user", this.osUser()],
          ["upgrade_status", STATUS_STARTED],
          ["applied_on", "__now()"],
        ],
      );
    } else {
      const id = singleItemId(existing);
      const [row] = existing.items;
      if (row !== undefined && !isNullOrEmpty(getProperty(row, "locked_by_id"))) {
        await this.itemHelper.inn.applyItem(itemXml([["type", "DatabaseUpgrade"], ["action", "unlock"], ["id", id]]));
      }
      request = itemXml(
        [["type", "DatabaseUpgrade"], ["action", "edit"], ["select", "id"], ["id", id]],
        [["os_user", this.osUser()], ["upgrade_status", STATUS_STARTED], ["applied_on", "__now()"]],
      );
    }
    const applied = await this.applyLogged(request, status, log);
    return applied.isError ? null : singleItemId(applied);
  }

  /**
   * One entry of the manifest (DBP-040 to DBP-043). Returns false when the patch failed: a missing or unreadable file, a fault
   * from `ApplyUpdate`, or a fault from the `DatabaseUpgradePatch` link. The failure is an `error` message, and the run goes on
   * with the next entry (bug DBP-094).
   */
  private async applyPatch(update: UpdateNode, config: DBUpdateConfig, upgradeId: string | null, status: Message, log: RunLog): Promise<boolean> {
    const error = this.messages.getErrorMessage();
    await this.logTrace(dbPatchMessage("StartOfImportingDBPatch", update.name), status, log);
    await this.logTrace(dbPatchMessage("StartDateTime", this.timestamp()), status, log);

    const path = pathCombineAll(config.dbPatchesFolderPath, `${update.name ?? ""}.xml`);
    if (!fileExists(path, this.environment)) {
      await this.logTrace(dbPatchMessage("FileNotFound", path), error, log);
      return false;
    }
    let patch;
    try {
      patch = xmlDocumentLoad(path, this.environment);
    } catch (thrown) {
      if (!(thrown instanceof Error) || isRuntimeFault(thrown)) throw thrown;
      await this.logTrace(thrown.message, error, log);
      return false;
    }

    // DBP-041, DBP-093: every value goes in as it is; the patch is the whole content of the document, which has its XML
    // declaration, if it has one, in the middle of the request (bug DBP-092)
    const request = `<Item><Number>${update.upNumber ?? ""}</Number><Name>${update.name ?? ""}</Name><Generation>${update.generation ?? ""}</Generation>${outerXml(patch)}</Item>`;
    await this.logTrace(dbPatchMessage("Request", this.xmlToPrettyXml(request, log)), status, log);
    const response = await this.callAction("ApplyUpdate", request);
    if (response.isError) {
      return this.failPatch(dbPatchMessage("ErrorOfImportDBPatch", this.xmlToPrettyXml(response.outerXml, log)), error, status, log);
    }
    await this.logTrace(dbPatchMessage("Response", this.xmlToPrettyXml(response.outerXml, log)), status, log);
    // the branch for an empty answer that follows in the engine can never be taken (bug DBP-090)
    const updateId = singleItemId(response);

    if (!isNullOrEmpty(upgradeId)) {
      const link = itemXml(
        [["type", "DatabaseUpgradePatch"], ["action", "add"], ["id", this.newId()]],
        [["source_id", upgradeId as string], ["related_id", updateId]],
      );
      await this.logTrace(dbPatchMessage("Request", this.xmlToPrettyXml(link, log)), status, log);
      const linked = await this.itemHelper.inn.applyItem(link);
      if (linked.isError) {
        return this.failPatch(dbPatchMessage("ErrorOfImportDatabaseUpgradePatch", this.xmlToPrettyXml(linked.outerXml, log)), error, status, log);
      }
      await this.logTrace(dbPatchMessage("Response", this.xmlToPrettyXml(linked.outerXml, log)), status, log);
    }
    await this.logTrace(dbPatchMessage("DBPatchImportedSuccessfully"), status, log);
    await this.logTrace(dbPatchMessage("EndDateTime", this.timestamp()), status, log);
    return true;
  }

  /** A patch that failed after its start: the `error` message, then `End time` (DBP-042, DBP-043). */
  private async failPatch(text: string, error: Message, status: Message, log: RunLog): Promise<false> {
    await this.logTrace(text, error, log);
    await this.logTrace(dbPatchMessage("EndDateTime", this.timestamp()), status, log);
    return false;
  }

  /** The last request of a run with a row: the row's `upgrade_status` becomes 1, or 2 when any patch failed (DBP-044). Neither answer throws. */
  private async setUpgradeStatus(upgradeId: string, upgradeStatus: string, status: Message, log: RunLog): Promise<void> {
    const edit = itemXml([["type", "DatabaseUpgrade"], ["action", "edit"], ["id", upgradeId]], [["upgrade_status", upgradeStatus]]);
    await this.logTrace(dbPatchMessage("Request", this.xmlToPrettyXml(edit, log)), status, log);
    const response = await this.itemHelper.inn.applyItem(edit);
    if (response.isError) {
      await this.logTrace(dbPatchMessage("ErrorOfImportDatabaseUpgrade", this.xmlToPrettyXml(response.outerXml, log)), this.messages.getErrorMessage(), log);
      return;
    }
    await this.logTrace(dbPatchMessage("Response", this.xmlToPrettyXml(response.outerXml, log)), status, log);
  }
}
