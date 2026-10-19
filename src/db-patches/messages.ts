import { formatMessage } from "../io/dotnet-text.js";

/**
 * The templates of 14.35's message catalogue that the DB patch run sends (DBP-004). `\r\n` is literal in the engine's templates.
 * `CouldNotGetAppliedUpdateId` and `DBPatchImportFailed` are in the catalogue and nothing sends them (DBP-090), so they are not here.
 *
 * @spec DBP-004
 */
export const DB_PATCH_TEMPLATES: Readonly<Record<string, string>> = {
  StartOfImportingDBPackages: "Start of importing DB packages.",
  EndOfImportingDBPackages: "End of importing DB packages.",
  StartDateTime: "Start time: {0}",
  EndDateTime: "End time: {0}",
  LoginNameIsNotRootCheckYourConfigFile: "Login name is not root. It is '{0}'. Check your config file.",
  DBUpdatedManifestFilePathNotSpecifiedCheckYourConfigFile: "DB updated manifest file path was not specified. Check your config file.",
  DBPathesFolderPathNotSpecifiedCheckYourConfigFile: "DB patches folder path was not specified. Check your config file.",
  UserTypeIsNotAdminPossibleIssue: "User type is not admin. It is {0} Possible IR-005481 customer support issue",
  DidNotObtainExpectedRootSuperUserIdentityPossibleIssue:
    "Did not obtain expected root super user identity. Got {0} instead. Possible IR-005481 customer support issue",
  DidNotGetExpectedIdResultForIdentityPossibleIssue: "Did not get expected id result for {0} identity. Possible IR-005481 customer support issue",
  LoadedForUpgradeToRelease: "Loaded [{0}] for upgrade to release [{1}].",
  ThereAreUpdates: "There are {0} updates.",
  StartOfImportingDBPatch: "Start of importing '{0}' DB patch.",
  FileNotFound: "File not found : {0}.",
  ErrorOfImportDBPatch: "Error of import DB patch\r\n{0}",
  ErrorOfImportDatabaseUpgradePatch: "Error of import 'DatabaseUpgradePatch' item\r\n{0}",
  DBPatchImportedSuccessfully: "DB patch imported successfully.",
  ErrorOfImportDatabaseUpgrade: "Error of import 'DatabaseUpgrade' item\r\n{0}",
  Request: "Request (formatted):\r\n{0}",
  Response: "Response (formatted):\r\n{0}",
};

/** `ResourceManager.GetMessage(key, args)` over {@link DB_PATCH_TEMPLATES}: invariant formatting, a null argument as nothing. */
export function dbPatchMessage(key: string, ...args: (string | null | undefined)[]): string {
  const template = DB_PATCH_TEMPLATES[key];
  return template === undefined ? "" : formatMessage(template, ...args);
}
