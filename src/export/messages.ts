import { formatMessage } from "../io/dotnet-text.js";

/**
 * The templates of the engine's message catalogue that an export reaches (EXP-504, 14.0.7). `\r\n` and `\n` are literal in the
 * engine's templates, and the leading and inner spaces are part of them.
 *
 * @spec EXP-504
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
};

/**
 * `ResourceManager.GetMessage(key, args)`: the template of `key` formatted with the invariant culture and the arguments, a null
 * argument as the empty string. A key with no template gives the empty string and formats nothing. Without arguments the template
 * is returned as it is, so a `{0}` in it stays.
 *
 * @spec EXP-504
 */
export function getMessage(key: string, ...args: (string | null | undefined)[]): string {
  const template = MESSAGE_TEMPLATES[key];
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
  /** The answer to the error question. The default is `continue`. */
  onItemError?: OnItemError;
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
 *
 * @spec EXP-503
 */
export function createMessagesFactory(options: MessageOptions = {}): MessagesFactory {
  const make = (channel: MessageChannel): Message => new ChannelMessage(channel, options);
  return {
    getCurrentPackageMessage: () => make("currentPackage"),
    getStatusMessage: () => make("status"),
    getErrorMessageQuestion: () => make("errorQuestion"),
    getWarningMessage: () => make("warning"),
    getErrorMessage: () => make("error"),
  };
}
