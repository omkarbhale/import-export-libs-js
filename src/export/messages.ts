import { DEFAULT_ENGINE, type Engine } from "../engines.js";
import { formatMessage } from "../io/dotnet-text.js";

/**
 * The templates of the engine's message catalogue that an export reaches (EXP-504, 14.0.7). `\r\n` and `\n` are literal in the
 * engine's templates, and the leading and inner spaces are part of them.
 *
 * @spec EXP-504 EXP-602 EXP-603 EXP-613 LP-010
 */
export const MESSAGE_TEMPLATES: Readonly<Record<string, string>> = {
  ExportingPackagePackageName: "Exporting package {0}",
  ExportingReferencedItemsFromPackageName: "Exporting referenced items from '{0}'",
  ItemIndexOfCountTypeNameKeyedName: "Item {0} of {1}: {2} - {3}",
  ErrorOfExportingItemIdKeyedNameType: "Error of exporting Item id :{0}  keyed_name : {1}    type : {2}",
  ItemIdKeyedNameTypeSuccessfullyExported: "Item id :{0}  keyed_name : {1}   type : {2} successfully exported",
  ExportWasCanceledByUser: "Export was canceled by user",
  Completed: "completed",
  ExportSolutionName: "         ****Export {0}****",
  StartOfExecutionDateTime: "start of execution : {0}",
  EndOfExecutionDateTime: "end of execution : {0}",
  ErrorMessageStringDetailCode:
    "      ******Error message******\r\nfaultstring: {0}\r\nfaultdetail: {1}\r\nfaultcode:   {2}\r\n     **********************",
  ErrorMessageStringDetailCodeAbortCurrentExportOfSolutionName:
    "          ****ErrorMessage****\r\nfaultstring: {0}\r\nfaultdetail :{1}\r\nfaultcode: {2}\r\n          *******************\r\n\r\n  Abort current export of {3} ?",
  ErrorMessageMessage: "          ****ErrorMessage****\r\n       {0}",
  TheDatabaseContainsNoPackageDefinitionsPleaseSelectAnotherDatabaseAndTryAgain:
    "The database contains no package definitions. Please select another database and try again",
  ThereAreReferencesToUnknownPackagesThatWereRemovedDuringTheExportOfThePackageSolutionNameSeeLogFileForMoreDetailsSearchForWordsRemovedRefError:
    "There are references to unknown packages that were removed during the export of the package '{0}'.\nSee log file for more details (search for words '{1}')",
  From: "From:\t{0}",
  To: "To:\t{0}",
  Reason: "Reason:\t{0}",
  UnableToGetPackagesMeta: "Unable to get packages meta.\r\n{0}",
  FailsToInitSolutionToPackageDefinitionPackageName: " Fails to init solution to PackageDefinition: {0}",
  FailedToFindReferencedElementsForPackagePackageName: " Failed to find referenced elements for package '{0}'",
  ErrorMessageFailedToFindReferencedElementsForPackageName: "{0}; Failed to find referenced elements for package '{1}'",
  ReferencedElementDoesnotHaveElementNameSet: "Referenced element doesn't have '{0}' set",
  EmptyDependencyPackageMessage: "Name of 'dependson' package can't be 'null' or empty",
  // The import's templates (IMP-470).
  ImportPackageName: "       ****Import   {0}****",
  ImportWithMergeOptionPackageName: "       ****Import with merge option {0}****",
  BuildingSolution: "Building  solution",
  AddingPackageDefinintionForPackageName: "Adding PackageDefinintion for {0}",
  WARNINGImportingPackageNamePackageWarn: "WARNING (importing '{0}' package): {1}",
  ItemOfTypeWithIdIsNotAddedAsAReferencedElementForPackageBecauseTheItemWasNotFoundInTheTargetDatabase:
    "Item of type '{0}' with id '{1}' is not added as a referenced element for package '{2}' because the item was not found in the target database",
  ProcessingActionKeyIdType: "Processing ({0}) {1}",
  FileFullNameFullName: "File full name '{0}'",
  ImportingKeyedNameTypeNumberOfCount: "Importing {0}  type {1}   {2}  of  {3}",
  PostActions: "Post actions",
  ItemSuccessfullySkippedKeyIdType: "Item successfully skipped {0}",
  DeleteSQLItemsOfThePackagePackageNameFromTheDatabase: "##### Delete SQL Items of the package '{0}' from the database #####",
  DoneDeletingSQLItemsOfThePackagePackageNameFromTheDatabase: "##### Done deleting SQL Items of the package '{0}' from the database #####",
  WarningTryToResolve: "          ****Warning! Import of an item failed. Trying to resolve the error... ****\r\n       {0}",
  ItemSuccessfullyAppliedActionKeyIdType: "Item successfully applied({0}) {1}",
  AddingItemIntoPackageDefinitionWthIdAndType: "Adding item into PackageDefinition with id = {0} and type = {1}",
  GettingConfigIdOfVersionableItemIdType: "Getting config_id  of versionable item  id  {0} type {1}",
  ItemSuccessfullyAddedInPackdefinitionIdType: "Item successfully added in packdefinition  id  {0} type {1}",
  ItemAlreadyExistInPackdefinitionIdType: "Item already exist in packdefinition  id  {0} type {1}",
  DelayedResolutionOfUnresolvedReferences: "Delayed resolution of unresolved references ...",
  ImportWasCanceledByUser: "Import was canceled by user",
  StartOfImportingPackages: "Start of importing packages",
  UpdatingPackageNamePackageToInprogressReleaseStatus: "Updating '{0}' package to 'inprogress' release status",
  UpdatingPackageNamePackageToSuccessReleaseStatus: "Updating '{0}' package to success release status",
  UpdatingPackageNamePackageToFailedReleaseStatus: "Updating '{0}' package to failed release status",
  ImportPackagePackageNameFailedWithMessageUpdatingPackageNameToFailedReleaseStatus:
    "Import package '{0}' failed with message:\n\n{1}\nUpdating {2} to failed release status",
  ErrorMessageMessageEnd: "\t\t****ErrorMessage****\r\n{0}\r\n\t\t********************",
  CanInitGroupInPackageDefinition: " Can init group in PackageDefinition.",
  UnableToGetLabelOfTypeItemType: " Unable to get label of {0} ItemType.",
  UnableToToCheckWhetheItemIsLocked: " Unable to to check whether item is locked.",
  ThePackageAlreadyContainsThePackageElementWithNameAndIdButOfDifferentTypeDBTypeGroupIdBeingImportedTypeGroupId:
    "The package '{0}' already contains the PackageElement with name='{1}' and id='{2}' but of different type: DB - type='{3}', group_id='{4}';   being imported - type='{5}', group_id='{6}'",
  ItemHasNoType: "Item has no type",
  TheFollowingItemHasNoType: "The following item has no type - {0}",
  ItemHasNoID: "Item has no ID",
  TheFollowingItemHaNoIdAndCannotBeDeleted: "The following item has no id and can't be deleted - {0}",
  // The language-pack import's (LP-010).
  FileNotFound: "File not found : {0}.",
  // `CannotAddInstanceOfDatabaseUpgradeItemType` is stored under a key with a leading space in the engine, so its lookup finds
  // nothing (IMP-453); it has no entry here on purpose.
  TypeOfRelationshipIsNotDefined: "Type of relationship is not defined",
  TypeOfRelationshipIsNotDefinedInTheAMLPortion: "Type of relationship is not defined in the AML portion: {0}",
  AllItemsOfTypeType: "all items of type [{0}]",
  RemovedReferenceTypeReason:
    "The item contains a reference to an item of type that belongs to an unknown package (i.e. neither a core package nor a package that the package depends on)",
  RemovedReferenceRelationshipReason:
    "The item contains a reference to an relationship item that belongs to an unknown package (i.e. neither a core package nor a package that the package depends on)",
  RemovedReferenceItemReason:
    "The item contains a reference to an item that belongs to an unknown package (i.e. neither a core package nor a package that the package depends on)",
};

/**
 * The templates of 14.35 that differ from {@link MESSAGE_TEMPLATES} (EXP-504, IMP-470): `ErrorMessageMessage` is two tabs, the
 * banner and the message on a line of its own, and the error block of a run has no leading spaces and a CRLF first. The key
 * `AddingPackageDefinintionForPackageName` keeps its misspelling, and its text is corrected. The six keys of the AML batch mode
 * are new (IMP-514); `TryToResolveAMLBatchCheckDependencies` has no place for the argument the engine passes. Every other template
 * is the same.
 *
 * @spec EXP-504 IMP-470 IMP-514
 */
export const MESSAGE_TEMPLATES_1435: Readonly<Record<string, string>> = {
  ...MESSAGE_TEMPLATES,
  AddingPackageDefinintionForPackageName: "Adding PackageDefinition for {0}",
  ErrorMessageMessage: "\t\t****ErrorMessage****\r\n{0}",
  ErrorMessageMessageEnd: "\r\n\t\t****ErrorMessage****\r\n{0}\r\n\t\t********************",
  TryToBatchAML: "Try to execute AMLs in AML batch mode...",
  TryToBatchAMLSuccess: "AML successfully applied in AML batch mode:\r\n   AML batch time: {0}\r\n   Resolve dependencies time: {1}",
  TryToBatchAMLFailed: "Error of import in AML batch mode:\r\n {0}",
  TryToExecuteAMLOneByOne: "Try to execute AML one by one...",
  AMLBatchCheckDependenciesWarning: "Error of check dependencies in AML batch mode:\r\n {0}",
  TryToResolveAMLBatchCheckDependencies: "Trying to resolve AML dependencies in AML batch mode...",
};

/** `GetMessage` over the catalogue of an engine (IMP-470). */
export type MessageCatalogue = (key: string, ...args: (string | null | undefined)[]) => string;

/**
 * The `GetMessage` of an engine's catalogue.
 *
 * @spec EXP-504 IMP-470
 */
export function catalogueOf(engine: Engine): MessageCatalogue {
  return (key, ...args) => getMessageFor(engine, key, ...args);
}

/**
 * The texts the 12.0 engine writes as literals where the template of {@link MESSAGE_TEMPLATES} differs (EXP-504), and the
 * two it writes in a place 14.0.7 shares: the abort block of `GetSolutions2Xml` without its question, and the first log line of a
 * failed item, which has one space before `type` (EXP-516). Every other text is the same.
 *
 * @spec EXP-504 EXP-507 EXP-516
 */
export const MESSAGE_TEMPLATES_12_0: Readonly<Record<string, string>> = {
  ...MESSAGE_TEMPLATES,
  ErrorMessageMessage: "          ****ErrorMessage****\r\n       {0}\r\n          *******************",
  ErrorMessageGetSolutions: "          ****ErrorMessage****\r\nfaultstring: {0}\r\nfaultdetail :{1}\r\nfaultcode: {2}\r\n          *******************",
  ErrorOfExportingItemIdKeyedNameTypeLog: "Error of exporting Item id :{0}  keyed_name : {1} type : {2}",
};

/**
 * `ResourceManager.GetMessage(key, args)`: the template of `key` formatted with the invariant culture and the arguments, a null
 * argument as the empty string. A key with no template gives the empty string and formats nothing. Without arguments the template
 * is returned as it is, so a `{0}` in it stays. The 12.0 engine has no catalogue and writes its texts as literals: the same
 * texts but for the few of {@link MESSAGE_TEMPLATES_12_0}.
 *
 * @spec EXP-504
 */
export function getMessage(key: string, ...args: (string | null | undefined)[]): string {
  return getMessageFor(DEFAULT_ENGINE, key, ...args);
}

/** {@link getMessage} with the catalogue of an engine. */
export function getMessageFor(engine: Engine, key: string, ...args: (string | null | undefined)[]): string {
  const template = (engine === "12.0" ? MESSAGE_TEMPLATES_12_0 : engine === "14.35" ? MESSAGE_TEMPLATES_1435 : MESSAGE_TEMPLATES)[key];
  if (template === undefined) return "";
  return args.length === 0 ? template : formatMessage(template, ...args);
}

/** The five ways the engine tells its host about progress (EXP-503). */
export type MessageChannel = "currentPackage" | "status" | "errorQuestion" | "warning" | "error";

/**
 * The engine's `Message`: a text, sent with `execute()`, which returns the host's answer. A message object is reused: each use
 * assigns a new text and executes again. The engine reads the answer of `errorQuestion` only.
 *
 * @spec EXP-503
 */
export abstract class Message {
  text = "";

  abstract execute(): Promise<boolean | null | undefined>;
}

/** The engine's `IMessagesFactory`. The engine calls each method where EXP-503 says. */
export interface MessagesFactory {
  getCurrentPackageMessage(): Message;
  getStatusMessage(): Message;
  getErrorMessageQuestion(): Message;
  getWarningMessage(): Message;
  getErrorMessage(): Message;
}

/** A message as the host gets it. */
export interface SentMessage {
  readonly channel: MessageChannel;
  readonly text: string;
}

/**
 * What the library does when a host sees a failed item (EXP-503): `continue` answers the error question with `false`, so the
 * package goes on with its next item (every shipped host does), and `abort-package` answers `true`, which ends the package and
 * not the export (EXP-516). The CLI exposes it as `--on-item-error`.
 */
export type OnItemError = "continue" | "abort-package";

export interface MessageOptions {
  /** Called for every message, in the order the engine sends them. */
  onMessage?: (message: SentMessage) => void | Promise<void>;
  /** The answer to the error question. The default is `continue`. 14.35 never reads the answer, so it refuses the option (EXP-571). */
  onItemError?: OnItemError;
  /** The engine the messages are for; the default is 14.0.7. */
  engine?: Engine;
}

/** An option that an engine has nothing to act on. */
export class OptionNotSupportedError extends Error {
  override name = "OptionNotSupportedError";

  constructor(
    readonly option: string,
    readonly engine: Engine,
    reason: string,
  ) {
    super(`${option} is not supported with engine ${engine}: ${reason}`);
  }
}

/**
 * The library's `--on-item-error` has nothing to act on in 14.35: the failed-item handler sends the abort question, never reads
 * the answer, and stops the whole export (EXP-555, EXP-571). Setting it for that engine is refused, rather than ignored.
 *
 * @spec EXP-571
 */
export function checkOnItemError(engine: Engine, onItemError: OnItemError | undefined): void {
  if (engine === "14.35" && onItemError !== undefined) {
    throw new OptionNotSupportedError("--on-item-error", engine, "the engine stops the whole export at the first failed item and does not read the answer");
  }
}

class ChannelMessage extends Message {
  constructor(
    private readonly channel: MessageChannel,
    private readonly options: MessageOptions,
  ) {
    super();
  }

  async execute(): Promise<boolean | null | undefined> {
    await this.options.onMessage?.({ channel: this.channel, text: this.text });
    return this.channel === "errorQuestion" ? this.options.onItemError === "abort-package" : null;
  }
}

/**
 * The messages factory of the library: every message goes to `onMessage`, and the error question is answered by `onItemError`.
 * For 14.35 the option is refused (EXP-571) and the question is answered `no`, which the engine does not read.
 *
 * @spec EXP-503 EXP-571
 */
export function createMessagesFactory(options: MessageOptions = {}): MessagesFactory {
  checkOnItemError(options.engine ?? DEFAULT_ENGINE, options.onItemError);
  const make = (channel: MessageChannel): Message => new ChannelMessage(channel, options);
  return {
    getCurrentPackageMessage: () => make("currentPackage"),
    getStatusMessage: () => make("status"),
    getErrorMessageQuestion: () => make("errorQuestion"),
    getWarningMessage: () => make("warning"),
    getErrorMessage: () => make("error"),
  };
}
