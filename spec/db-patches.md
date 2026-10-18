# DB patch application (14.35)

This document specifies `ImportExportManager.ApplyDBUpdateManifest`, the 14.35 operation that applies a set of database update patches to an Aras server and records them in the server's own bookkeeping items. It exists only in 14.35 among the three engines. The command that exposes it, `apply-db-patches <manifest>`, is built by ticket 63 and is valid only with `--engine 14.35`.

Sources:

- the 14.35 decompile of `Libs.dll` (`.decomp/14.35/`, regenerated locally and never committed): `ImportExportManager::ApplyDBUpdateManifest`, `ValidateRootUser`, `ValidateInputParrameters`, `CreateOrGetDatabaseUpgradeItemId`, `CallAction`, `LogTrace`, `LogInputParameters` and `XmlToPrettyXml`, the `DBPatches` types, and the message catalogue;
- IOM 14.35 (`IOM.dll`, same folder): `HttpServerConnection.CallAction`, `Item.isError`, `Item.isEmpty` and `Innovator.newError`;
- the server side of the `ApplyUpdate` action, read from the 12 SP9 server install on the dev machine (`Aras.Server.Core.dll`, decompiled locally, never committed). It is background for what a patch is (DBP-060 to DBP-062), not engine behaviour;
- Aras's own host of this operation, `Aras Update` (DBP-002).

Ticket 72 wired the oracle (`npm run oracle -- --engine 14.35 dbpatch`, `oracle/README.md`) and recorded `fixtures/14.35/dbpatch/` on the dev instance (12 SP9): the case `non-root` (the `admin` login) and the case `apply` (the committed no-op patch as `root`, and the same patch again). A rule marked *Observed* is shown by that fixture; one marked *Inferred from the code* is not, because the oracle applies no other patch (DBP-071). Where the fixture disagreed with the first reading of the code, the rule was corrected (DBP-011, DBP-042, DBP-060 and DBP-061).

## Entry and inputs

### DBP-001: ApplyDBUpdateManifest takes a `DBUpdateConfig` and returns nothing

[14.35] `IImportExportManager.ApplyDBUpdateManifest(DBUpdateConfig config)` is a public member of `ImportExportManager` and of its interface. It returns `void`. What a host can observe is the exceptions that escape, the messages sent on the channels of EXP-503, the log file, and the server's state. A patch that fails does not throw (DBP-040 to DBP-044), so a caller that wants to know must look at the `error` channel, as DBP-002's reference host does.

[12.0] [14.0.7] The member does not exist in these builds (their `Libs.dll` has no `DBPatches` namespace), so there is nothing to specify. The CLI refuses the command for them (ticket 63).

The manager is the one of EXP-502, built around a logged-in helper, a context and a message factory. `ApplyDBUpdateManifest` reads these context settings: `UserName` (DBP-010), `LogFilePath` (EXP-505), and for the log header (DBP-005) `Action`, `ManifestFile`, `WorkingDirectory`, `Url`, `DataBase`, `LPPath` and `LPPackage`. It never reads `Password`, `Timeout` (the constructor applied it, WIRE-031) or `Verbose`.

### DBP-002: The configuration has three settings, and the reference host's values are the library's defaults

[14.35] `DBUpdateConfig` is a plain class with three string properties and no validation of its own:

| Property | Engine default | Meaning |
|---|---|---|
| `DBUpdatedManifestFilePath` | null | the manifest that lists the patches (DBP-020) |
| `DBPatchesFolderPath` | null | the folder that holds one `<name>.xml` file per patch (DBP-040) |
| `ToolName` | `Libs` | stored as the `description` of a newly created "Applied Updates" `DatabaseUpgrade` row (DBP-030) |

Only `ToolName` has an engine default; the two paths must be given (DBP-003).

No 14.35 host calls the operation (ticket 71; `ConsoleUpgrade.exe` reaches only `ProcessExport`, `ProcessImport` and `ProcessExportImport`). One Aras host does: **Aras Update** (`ArasUpdate.exe` / `ArasUpdateCmd.exe`, found on the dev machine under `Aras\Aras Update`, with `ArasUpdateCore.dll`). It ships its own `Libs.dll`, build 14.0.18.39055, not one of the three engine builds. Its `ApplyDBUpdateManifest`, `ValidateRootUser` and `CreateOrGetDatabaseUpgradeItemId` have the same logic as 14.35's. For an `<import_db_patch file="…" updateFolder="…"/>` task, Aras Update builds the call this way:

- `DBUpdatedManifestFilePath` is the task's `file` attribute;
- `DBPatchesFolderPath` is the `updateFolder` attribute, or **the directory of the manifest file when the attribute is empty**;
- `ToolName` is **`Aras Update`**;
- the context has `Action = ImportDPPatch`, the dev profile's `Url`, `DataBase`, `UserName` and `Password`, a fresh `LogFilePath`, and no working directory or manifest. It logs in with `HttpConnectorExtension` and `CItemHelper.Login()` before it builds the manager (WIRE-002's pattern);
- it then reads the text of the `error` channel it was given: any text means failure, and it raises its own error.

[14.35] The port takes its defaults from that host, because it is the only observed caller:

- `DBUpdatedManifestFilePath` is the command's `<manifest>` argument;
- `DBPatchesFolderPath` is the manifest's own directory, overridable with `--patches-folder <dir>`;
- `ToolName` is **`Libs`**, the engine's own default. Aras Update's `Aras Update` names that tool, and the port is not Aras Update. `--tool-name <text>` overrides it. A different value changes only the `description` of the row the run creates; a row that already exists keeps its description (DBP-030);
- `Action` in the log header (DBP-005) is `ImportDPPatch`, as the reference host sets it;
- the exit status of the command is failure when any text was sent on the `error` channel or an exception escaped, as in the reference host. Ticket 63 builds that.

*Observed:* from the decompile of `ArasUpdateCore.dll`'s `ImportDBPatchType`; not run.

### DBP-003: Checks run in a fixed order, and most of them are inside the `try`

[14.35] `ApplyDBUpdateManifest` does these things in this order:

1. A null `config` throws `ArgumentNullException` (parameter `config`; message `Value cannot be null.\r\nParameter name: config`) before the log is opened.
2. It opens the log through `IOWrapper.NewStreamWriter(LogFilePath, append: true)` (EXP-505), then asks the factory for the `status` and `error` messages (EXP-503). A log that cannot be opened throws here, outside the `try`: no message is sent and nothing is logged.
3. Inside the `try`: the log header (DBP-005), then `status` "Start of importing DB packages." and `status` "Start time: {now}" (DBP-004).
4. The `root` check (DBP-010).
5. The input check: an empty or null `DBUpdatedManifestFilePath` throws `ArgumentException` with `DB updated manifest file path was not specified. Check your config file.`; then an empty or null `DBPatchesFolderPath` throws one with `DB patches folder path was not specified. Check your config file.` Neither path is checked for existence here.
6. `ValidateRootUser` (DBP-011): the first requests.
7. The manifest is read (DBP-020), and everything after it (DBP-021 to DBP-044).

Any exception in steps 3 to 7 is caught by one handler: it sends `error` with the exception's `Message`, writes the same text to the log, and rethrows. The `finally` always sends `status` "End of importing DB packages." and `status` "End time: {now}". The log writer is disposed after that, which flushes it. So a refused run (non-root, missing path) leaves a log with the header, the two start lines, the error text and the two end lines, and sends no request to the server.

The port keeps all of this order. Refusing a non-`root` user before sending anything (ticket 63) is therefore not a deviation: the engine sends nothing either, after the login the host did.

*Observed* for the refused run (fixture `non-root`): the log holds the header, `Start of importing DB packages.`, `Start time: …`, the refusal text, `End of importing DB packages.` and `End time: …`; the messages are `status`, `status`, `error`, `status`, `status` in that order; the only calls are the host's login (six: `ValidateUser`, the user's `ApplyItem`, four `ApplyAML` for the version). The rest of this order is *inferred from the code*.

### DBP-004: Messages and the log use one helper, and a fixed set of texts

[14.35] `LogTrace(text, message, logWriter)` sets `message.Text`, calls `message.Execute()` and then writes `text` as one line to the log. The message and the log line carry the same text; a text that holds `\r\n` keeps it. Texts come from the catalogue of EXP-504 (formatted with the invariant culture, null arguments formatted as empty). The database-patch templates are:

| Key | Template |
|---|---|
| `StartOfImportingDBPackages` | `Start of importing DB packages.` |
| `EndOfImportingDBPackages` | `End of importing DB packages.` |
| `StartDateTime` / `EndDateTime` | `Start time: {0}` / `End time: {0}` |
| `LoginNameIsNotRootCheckYourConfigFile` | `Login name is not root. It is '{0}'. Check your config file.` |
| `DBUpdatedManifestFilePathNotSpecifiedCheckYourConfigFile` | `DB updated manifest file path was not specified. Check your config file.` |
| `DBPathesFolderPathNotSpecifiedCheckYourConfigFile` | `DB patches folder path was not specified. Check your config file.` |
| `UserTypeIsNotAdminPossibleIssue` | `User type is not admin. It is {0} Possible IR-005481 customer support issue` |
| `DidNotObtainExpectedRootSuperUserIdentityPossibleIssue` | `Did not obtain expected root super user identity. Got {0} instead. Possible IR-005481 customer support issue` |
| `DidNotGetExpectedIdResultForIdentityPossibleIssue` | `Did not get expected id result for {0} identity. Possible IR-005481 customer support issue` |
| `LoadedForUpgradeToRelease` | `Loaded [{0}] for upgrade to release [{1}].` |
| `ThereAreUpdates` | `There are {0} updates.` |
| `StartOfImportingDBPatch` | `Start of importing '{0}' DB patch.` |
| `FileNotFound` | `File not found : {0}.` |
| `ErrorOfImportDBPatch` | `Error of import DB patch\r\n{0}` |
| `CouldNotGetAppliedUpdateId` | `Could not get applied update id.` (never sent, DBP-090) |
| `ErrorOfImportDatabaseUpgradePatch` | `Error of import 'DatabaseUpgradePatch' item\r\n{0}` |
| `DBPatchImportedSuccessfully` | `DB patch imported successfully.` |
| `ErrorOfImportDatabaseUpgrade` | `Error of import 'DatabaseUpgrade' item\r\n{0}` |
| `Request` / `Response` | `Request (formatted):\r\n{0}` / `Response (formatted):\r\n{0}` |

`DBPatchImportFailed` (`DB patch import failed.`) is in the catalogue and nothing sends it. A time is `DateTime.Now.ToString(CultureInfo.InvariantCulture)` (EXP-505); tests inject a clock.

`Request` and `Response` carry a pretty-printed XML text. The helper `XmlToPrettyXml(xml)` parses the text with LINQ to XML (`XElement.Parse`) and returns its `ToString()`: no XML declaration, two-space indentation, `\r\n` line ends on the engine's Windows host, an element with no content written `<x />`, whitespace-only text between elements dropped. When parsing fails, it writes the exception's `ToString()` (type, message and stack) to the log and returns the text unchanged. The port cannot reproduce stack frames; it writes `<exception type full name>: <message>` and the text. This is one of the unavoidable deviations (it is reachable only with a response that is not well-formed XML, which IOM does not produce). The LINQ to XML serializer belongs to the XML core (ticket 27); this rule is its first caller.

The `status` channel gets the progress texts and every `Request` and `Response`; the `error` channel gets exceptions' messages and the per-patch failures; the `warning` channel gets only the failures of DBP-031.

### DBP-005: The log opens with the DB patch header block

[14.35] Right after the log is opened, one `WriteLine` writes a block built with `AppendLine`, as EXP-506 does for an export, with `Label: value` lines in this order. The two optional contexts (`export`, `import`) are null, so their lines are absent:

```text
Tool version: 14.35.0.43890
Action: {Action}
Manifest file: {ManifestFile}
Log file: {LogFilePath}
Working directory: {WorkingDirectory}
URL: {Url}
Database: {DataBase}
User: {UserName}
Innovator version: {InnovatorVersionFullString}
Language pack: {LPPath}
Language pack name: {LPPackage}
DB updated nanifest file path: {DBUpdatedManifestFilePath}
DB pathes folder path: {DBPatchesFolderPath}
Tool name: {ToolName}
```

The words `nanifest` and `pathes` are misspelt in the engine and reproduced. The block ends with an empty line, as EXP-506's does. `Innovator version` is read from the helper's `InnovatorVersion`, set only by `Login()` (WIRE-021), so a helper that never logged in makes this step throw `NullReferenceException` with `Object reference not set to an instance of an object.`, caught by the handler of DBP-003 (the `error` message and log line are sent, the exception escapes). The library's client always logs in first.

*Observed* (fixture `non-root`, `engine.log`): the block is as above, with `Action: ImportDPPatch`, empty `Manifest file`, `Language pack` and `Language pack name`, the host's `Working directory`, and `Innovator version: 12.0 SP9 Build 24090` on dev. A `Log file`, `Working directory` and the two paths are the recording machine's. The `NullReferenceException` case is *inferred from the code*.

## The root user

### DBP-010: Only a login named `root` is accepted

[14.35] After the start lines, `_context.UserName != "root"` is compared as an ordinal string: `Root`, `ROOT` and `admin` are refused. The refusal is an `ArgumentException` whose message is `Login name is not root. It is '{UserName}'. Check your config file.`, and DBP-003's handler logs and rethrows it. A null `UserName` formats as empty. Nothing is sent to the server by this step.

This is a name check on what the host configured, not on what the server reports; DBP-011 then checks what the server says.

*Observed:* the `admin` login (same password as `root` on dev) is refused with `Login name is not root. It is 'admin'. Check your config file.` (fixture `non-root`): an `error` message, the `ArgumentException` out of the call, and no `ValidateUser`, `GetItem`, `ApplyItem` or `ApplyUpdate` call after the host's login. The case sensitivity is *inferred from the code*.

### DBP-011: ValidateRootUser asks the server four questions

[14.35] `ValidateRootUser` sends these requests through `CallAction` (DBP-012), in order, stopping at the first failure. Every failure is a plain `System.Exception`, not a `CItemException`, so it is caught by DBP-003's handler and escapes `ApplyDBUpdateManifest`.

1. `ValidateUser` with body `<Empty/>` (sent as `<Empty />`, WIRE-004). A fault throws with the response's `faultstring` as the message. Otherwise it reads `//Result/id` and `//Result/user_type`; a missing element is a `NullReferenceException` (`Object reference not set to an instance of an object.`). A `user_type` other than `admin` throws `User type is not admin. It is {user_type} Possible IR-005481 customer support issue`. The server writes `user_type` as `admin` when the user has the root or the Innovator Admin identity, so the user `admin` passes this step and fails the next ones.
2. `GetItem` with `<Item type='USER' id='{id}' select='id' config_path='Alias' levels='1' />`, the id from step 1 (unescaped). A fault throws with its `faultstring`. The expected answer is the first `Item[@type='Alias']/related_id/Item` under `//Result/Item/Relationships`, whose `id` attribute must be exactly `6B14D33C4A7D41C188CCF2BC15BD01A3` (the Super User identity, compared case-sensitively). Anything else, including no such node, throws `Did not obtain expected root super user identity. Got {id or empty} instead. Possible IR-005481 customer support issue`.
3. `GetItem` with `<Item type='Identity'><name>Super User</name></Item>`. A fault throws with its `faultstring` (a missing identity is the server's faultcode `0` fault, `No items of type Identity found.`). The first `//Result/Item/@id` must be `6B14D33C4A7D41C188CCF2BC15BD01A3`, else `Did not get expected id result for Super User identity. Possible IR-005481 customer support issue`. A response with no `Item` is a `NullReferenceException`.
4. The same with `<name>Innovator Admin</name>`, expecting `DBA5D86402BF43D5976854B8B48FCDD1`, else the message with `Innovator Admin`.

The request literals have single quotes in the engine's source, but `CallAction` loads each into an `XmlDocument` (DBP-012) and IOM serialises that document, so what the server gets, and what the recorder sees, is `<Item type="USER" id="{id}" select="id" config_path="Alias" levels="1" />` and `<Item type="Identity"><name>Super User</name></Item>` with double quotes. Their SOAP actions are the bare action names `ValidateUser` and `GetItem`.

*Observed* on the dev server through the engine (fixture `apply`, step 1, calls 7 to 10): as `root`, `ValidateUser` answers `user_type` `admin` and the user's id, the `GetItem` of the user returns its Alias relationship to the identity `Super User` `6B14D33C4A7D41C188CCF2BC15BD01A3`, and the identities `Super User` and `Innovator Admin` have the ids the engine expects. The failure texts are *inferred from the code*.

### DBP-012: CallAction is a raw SOAP call that returns the whole response as an item

[14.35] `CallAction(actionName, aml)` is the engine's own helper, used here for four actions (`ValidateUser`, `GetItem`, `ApplyUpdate`). It:

1. loads `aml` into a new `XmlDocument` with `LoadXml`. Malformed text throws `System.Xml.XmlException` before anything is sent (this matters for DBP-041);
2. calls IOM's `HttpServerConnection.CallAction(actionName, request, response)`: one POST of the bare root element as in WIRE-004, with `SOAPAction` set to the action name (WIRE-005), the response read into the second document. IOM writes its own fault into that document for every transport problem, as WIRE-050 says, and does not throw. For a `ValidateUser` action (case-insensitive) IOM also replaces the connection's locale and time zone from the response, as WIRE-005 describes for login. The 14.35 connection can also log in again and repeat the call after a session-timeout fault (`SOAP-ENV:Server.Authentication.SessionTimeout` or `…YouAreDisconnected`), and repeat it when the server challenges the password hash mode; the 14.35 wire rules (ticket 69) own those;
3. takes the response's outer XML. When it is empty it returns `Innovator.newError("")`, an error item with faultcode `1` and an empty `faultstring`. Otherwise it returns a new item loaded with that XML, so the item holds the whole response, envelope included.

`isError()` on the result is true when the document has `Envelope/Body/Fault` (WIRE-053). The caller reads results with the XPaths of DBP-011, which start with `//Result`, so they work on the unwrapped envelope.

*Observed:* the transcript of `apply` shows the four calls with the actions `ValidateUser` (request `<Empty />`), `GetItem`, `GetItem`, `GetItem` and `ApplyUpdate`, each answered with the whole envelope. The empty-response and `LoadXml` failure steps are *inferred from the code*.

## The manifest

### DBP-020: The manifest is read with ReadAllText and LoadXml

[14.35] `DBUpdatedManifestFilePath` is read by `IOWrapper.XmlDocumentLoad(path)`: the path through the normalisation of MAN-004, `File.ReadAllText`, and `LoadXml` on a new `XmlDocument` that does not preserve whitespace. The reading and parsing rules are those of MAN-003 and IMP-007. A missing file throws `FileNotFoundException` (`Could not find file '<full path>'.`), a malformed one `XmlException`; both reach DBP-003's handler. This is the first step after `ValidateRootUser`, so a bad manifest is found only after the four requests of DBP-011 were sent.

*Observed* for a good manifest (fixture `apply`: the `Loaded […]` status follows the four requests). The failures are *inferred from the code*.

### DBP-021: The target release comes from the first `software_version` element

[14.35] The engine selects the first `//software_version` element in document order, anywhere in the manifest, and takes its inner text, or `00` when there is none. The release string is the first two characters, a `.`, and the rest from the third character on: `3501` gives `35.01`, `00` gives `00.` (a missing element gives `00.`), `9999` gives `99.99`. It is sent as `status` `Loaded [{manifest path}] for upgrade to release [{release}].` with the path as given, not normalised.

A text shorter than two characters (an empty element, or a single character) makes `Substring` throw `ArgumentOutOfRangeException` with `Index and length must refer to a location within the string.\r\nParameter name: length`, reproduced as a bug (DBP-091).

The release names the "Applied Updates" `DatabaseUpgrade` row of DBP-030.

*Observed:* `software_version` `9999` gives `Loaded [<manifest path as given>] for upgrade to release [99.99].` The short-text failure is *inferred from the code*.

### DBP-022: Each `updates/update` element becomes one entry, and entries run in `order`

[14.35] The engine selects every element `update` whose parent is an element `updates`, at any depth (`//updates/update`), in document order. For each, `up_number`, `name`, `order`, `generation` and `software_version` are read from the **first child element of that exact name**, as its inner text (descendant text, concatenated). A missing child gives null for `up_number`, `name` and `generation`, `-1` for `order`, and `00` for `software_version`; the last is never used. An element with a different name, or a grandchild, is not seen.

- `order` is parsed with `int.Parse(text, CultureInfo.InvariantCulture)`: surrounding white space and a leading sign are accepted, anything else, an empty string or a value outside the 32-bit range is a `FormatException` (`Input string was not in a correct format.`) or `OverflowException` (`Value was either too large or too small for an Int32.`). The exception escapes DBP-003's handler before any patch is applied and before the `DatabaseUpgrade` row is created.
- All entries are read, and the count is sent as `status` `There are {n} updates.` before anything is created.
- The run order is ascending `order`; entries with the same `order` keep manifest order (LINQ `OrderBy` is stable).

An empty list is valid. The row of DBP-030 is still created, and DBP-044 sets its status to `1`.

*Observed* for one entry: `There are 1 updates.` precedes the first request of DBP-030. The other cases (order, errors, an empty list) are *inferred from the code*.

## The DatabaseUpgrade row

### DBP-030: The run finds or creates the "Applied Updates" row for the release

[14.35] `CreateOrGetDatabaseUpgradeItemId(toolName, release)` returns the id of one `DatabaseUpgrade` row, or null. Every request goes through `Item.apply()` (one `ApplyItem` call, WIRE-004) and is sent as `status` `Request (formatted):…` and its answer as `Response (formatted):…` (DBP-004), except that an error answer is sent as `warning`. The requests, as the item IOM builds (attribute order and bytes are pinned by the fixture):

1. `ItemType` `get`, `select="id"`, `<name>DatabaseUpgrade</name>`. A fault (including "no items") stops the step: the `Response` goes out as `warning` and the function returns null.
2. `DatabaseUpgrade` `get`, `select="id,locked_by_id"`, with `<name>Applied Updates</name>`, `<target_release>{release}</target_release>` and `<type>0</type>`.
   - **No row** (any fault, not only "no items"): the response goes out as `warning`, and an `add` is built with `select="id"` and `name` `Applied Updates`, `target_release` {release}, `type` `0`, `description` {toolName}, `is_latest` `1`, `os_user` `{Environment.UserDomainName}\{Environment.UserName}`, `upgrade_status` `0` and `applied_on` `__now()`.
   - **A row**: its response goes out as `status`. Its id is read with `getID()` (more than one row throws `Exception` `Not a single item`). When the row is locked (`locked_by_id` not empty) an `unlock` is applied first, and its result is ignored. An `edit` follows, with `select="id"`, the id, `os_user` as above, `upgrade_status` `0` and `applied_on` `__now()`. The `description` and `is_latest` of an existing row stay.
3. The built item is sent as `Request`, applied, and the result is the row's id. An error answer is sent as `warning` and the function returns null.

The recorded requests (fixture `apply`) show what the item carries besides the properties: every request is `<Item isNew="1" isTemp="1" type="…" action="…" …>`, the `add` has an `id` attribute (the engine gives the new row an id of its own, not the server) and `select="id"` after it, and the `edit` of an existing row has `select="id"` before its `id`. A first request, `ItemType` `get` with `select="id"` and `<name>DatabaseUpgrade</name>`, precedes the row lookup. A lookup that finds nothing is a fault with faultcode `0` (`No items of type DatabaseUpgrade found.`), sent as `warning`.

`os_user` is the host's domain and user name, so it differs by machine. The port builds it from the environment (`USERDOMAIN`, else the host name, then the user name) and fixtures scrub it.

On dev this creates one row per `(release, "Applied Updates", type 0)`, which is what the existing rows for releases `8.0` to `9.4`, `1.00`, `1.10` and `1.20` are. Re-running a release edits the row in place.

*Observed:* the `add` path (`apply`, step 1: lookup fault, `add`) and the `edit` path (step 2: the row found with `locked_by_id` null, so no `unlock`, then `edit` with `os_user`, `upgrade_status` `0` and `applied_on` `__now()`). The `unlock` and the `Not a single item` cases are *inferred from the code*.

### DBP-031: When the row cannot be created, patches are still applied but not recorded

[14.35] A null id (DBP-030 returned null) is not an error to the caller. The run goes on, applies every patch (DBP-040 to DBP-042), skips the `DatabaseUpgradePatch` item of DBP-043 and the final edit of DBP-044. The only trace is the `warning` messages of DBP-030. The server still records each applied patch in its "Applied Updates" items (DBP-061), but nothing links them to a `DatabaseUpgrade` row.

*Inferred from the code.*

## The patches

### DBP-040: Each patch is a file named for its entry, and a missing or unreadable one marks the run failed

[14.35] For each entry in run order (DBP-022) the engine sends `status` `Start of importing '{name}' DB patch.` and `status` `Start time: {now}`. The patch file is `Path.Combine(DBPatchesFolderPath, name + ".xml")` (a null name gives `.xml`; `Path.Combine` throws `ArgumentException` for characters invalid in a path). Then:

- **The file does not exist** (`IOWrapper.FileExists`, through MAN-004): `error` `File not found : {path}.`, and the run's status becomes `2`. The loop goes on.
- **It exists but `XmlDocumentLoad` throws** (DBP-020's reading): `error` with the exception's message, status `2`, the loop goes on.

Neither case sends an `End time` line for the entry.

The `propertyValue` that DBP-044 writes starts as `1` and is set to `2` by any failure and never reset; it is one value for the whole run.

*Observed* for a patch that exists: `Start of importing 'LIBSJS-SCRATCH-noop' DB patch.` and `Start time: …` precede the `ApplyUpdate` request. The missing and unreadable file cases are *inferred from the code*.

### DBP-041: The ApplyUpdate request interpolates the entry and the whole patch file

[14.35] For a readable patch the engine builds, with `string.Format` and the invariant culture, and no escaping (AGENTS.md rule 7):

```text
<Item><Number>{up_number}</Number><Name>{name}</Name><Generation>{generation}</Generation>{patch document InnerXml}</Item>
```

A null `up_number`, `name` or `generation` formats as empty. `{patch document InnerXml}` is the `InnerXml` of the patch file's `XmlDocument`, which is every child of the document: the root element, and also an XML declaration, a DOCTYPE, comments and processing instructions that come before it (DBP-092). The CDATA sections and whitespace-only text that `LoadXml` kept are written back as they were.

The text is sent as `status` `Request (formatted):…`, then `CallAction("ApplyUpdate", text)` runs (DBP-012), which loads it with `LoadXml`: text that is not well-formed throws `XmlException` out of the loop. The exception is not caught per patch, so it ends the run (DBP-050); the run's status row stays at `0`.

*Observed:* for the test patch the request is `<Item><Number>LIBSJS-SCRATCH-001</Number><Name>LIBSJS-SCRATCH-noop</Name><Generation>1</Generation><Update><Type>C#</Type><Body><![CDATA[return this;]]></Body><Data /></Update></Item>`. `InnerXml` wrote the patch's `<Data/>` as `<Data />`, and the CDATA section as it was. The malformed case is *inferred from the code*.

### DBP-042: An ApplyUpdate fault is logged and marks the run failed

[14.35] On a fault, `error` `Error of import DB patch\r\n{pretty response}` and `status` `End time: {now}` are sent, the status becomes `2`, and the loop goes on. No `DatabaseUpgradePatch` is written for it.

Otherwise (the answer is not a fault) `status` `Response (formatted):…` is sent with the response, and the item's `getID()` is read as the id of the applied update. The server answers with the "Applied Updates" item it created (DBP-061), so the id is that item's id. An answer without exactly one item makes `getID()` throw `Exception` `Not a single item`, which ends the run (DBP-050). The branch for `isEmpty()` that follows the fault test can never be taken (DBP-090).

When the update was **already applied** (an "Applied Updates" item with that `up_number` exists), the 12 SP9 server does not answer with the existing item. It answers with a fault, faultcode `SOAP-ENV:Server` and faultstring `The update with update number {Number} has already been applied to this database.` (DBP-061). So a second run of the same patch takes the fault path above: an `error` message, `End time`, status `2`, no `DatabaseUpgradePatch`.

*Observed* for both answers (fixture `apply`, step 1 the item, step 2 the already-applied fault). The `Not a single item` case is *inferred from the code*.

### DBP-043: Each applied patch is linked to the row by a DatabaseUpgradePatch item

[14.35] When the id of DBP-030 is not empty, the engine builds a `DatabaseUpgradePatch` `add` with `source_id` {the row's id} and `related_id` {the applied update's id}, sends it as `Request`, and applies it. A fault: `error` `Error of import 'DatabaseUpgradePatch' item\r\n{pretty response}`, `status` `End time: {now}`, status `2`, the loop goes on. Success: `status` `Response (formatted):…`.

Then (also when the id was empty) `status` `DB patch imported successfully.` and `status` `End time: {now}`. A patch is reported as imported even when its link was skipped for lack of a row, but not when the link failed.

`DatabaseUpgradePatch` is a relationship type from `DatabaseUpgrade` to "Applied Updates" (on dev, `source_id` is a `DatabaseUpgrade` and `related_id` an `Applied Updates` item).

*Observed* for a link that succeeds: `<Item isNew="1" isTemp="1" type="DatabaseUpgradePatch" action="add" id="{new id}"><source_id>{row id}</source_id><related_id>{update id}</related_id></Item>`, then `DB patch imported successfully.` and `End time: …` (fixture `apply`, step 1). The link fault and the missing-row case are *inferred from the code*.

### DBP-044: The row ends with status 1 or 2

[14.35] After the last patch, when the id of DBP-030 is not empty, the engine builds a `DatabaseUpgrade` `edit` with the id and `upgrade_status` `1` (every patch went through, DBP-040 to DBP-043) or `2` (any failure), sends it as `Request` and applies it. A fault is `error` `Error of import 'DatabaseUpgrade' item\r\n{pretty response}`; success is `status` `Response (formatted):…`. Neither throws.

The row therefore holds `0` between DBP-030 and here, and stays `0` when an exception ended the run before this step (DBP-050). `applied_on` is set at DBP-030, to the start of the run.

*Observed:* `<Item isNew="1" isTemp="1" type="DatabaseUpgrade" action="edit" id="{row id}"><upgrade_status>1</upgrade_status></Item>` after a good run, and `2` after the already-applied fault of the second run (fixture `apply`). The run does not throw in the second case: the host sees one `error` message.

### DBP-050: What escapes, and what a host sees

[14.35] Exceptions that leave `ApplyDBUpdateManifest` (after the `error` message and the log line of DBP-003):

| Cause | Exception | Rule |
|---|---|---|
| null `config` | `ArgumentNullException` | DBP-003 |
| log cannot be opened | `IOException`, `DirectoryNotFoundException`, `ArgumentException` | DBP-003 |
| no login (helper never logged in) | `NullReferenceException` | DBP-005 |
| `UserName` not `root` | `ArgumentException` | DBP-010 |
| a path not given | `ArgumentException` | DBP-003 |
| any of the four checks of `ValidateRootUser` | `Exception` | DBP-011 |
| manifest unreadable or malformed | `FileNotFoundException`, `DirectoryNotFoundException`, `XmlException` | DBP-020 |
| `software_version` shorter than two characters | `ArgumentOutOfRangeException` | DBP-021 |
| `order` not an integer | `FormatException`, `OverflowException` | DBP-022 |
| a patch name that is not a legal path | `ArgumentException` | DBP-040 |
| a request that is not well-formed XML | `XmlException` | DBP-041 |
| `ApplyUpdate` answers without one item | `Exception` (`Not a single item`) | DBP-042 |
| a `DatabaseUpgrade` lookup matches several rows | `Exception` (`Not a single item`) | DBP-030 |

A failed patch is not an exception: it is an `error` message and the run's status `2` (DBP-040 to DBP-044). The messages of the `error` channel are what a caller must check, and the library's command does (DBP-002).

The .NET messages are reproduced in English.

*Inferred from the code.*

## What a patch is (server side)

### DBP-060: A patch is an `Update` element with a type, a body and data

[14.35] The engine does not interpret a patch file; it hands the file's XML to the server in an `ApplyUpdate` request (DBP-041). This is what the server (12 SP9, dev) accepts. The patch file's root element is `Update`, so the request is:

```xml
<Item>
  <Number>…</Number><Name>…</Name><Generation>…</Generation>
  <Update><Type>C#</Type><Body>…server method code…</Body><Data>…</Data></Update>
</Item>
```

- `Number`, `Name` and `Generation` must be non-empty, else the server answers with its own faults (`ApplyUpdate_UpdateNumberEmpty`, `…NameEmpty`, `…GenerationEmpty`). The `Update`, its `Body` text and its `Data` element must exist, else an internal-error fault.
- `Body` is the code of a server method, compiled by the server with warnings treated as errors and run as the Super User. `Type` is `C#` (also `CS`, `CSHARP`) or a Visual Basic spelling. **A missing `Type`, or `VB`, is refused** with `Update syntax not support in Innovator 7.2 and above`, because the server's default type is `VB`.
- `Data` is copied into the method's input item: the method runs on `<Item><name>{Name}</name>{Data}</Item>`.
- An optional `Iterations` child of the `Item` (a range or a comma list) runs the update once per value with the number `{Number}_{value}`; the engine's request has no such element unless the patch file's root carries it, which it does not.
- The attribute `failIfAlreadyApplied="true"` on the `Item` is read by the handler, but the engine's request has none. What the server does with an already-applied number is DBP-061: on dev it answered with a fault.

*Observed:* read from the 12 SP9 server's `ApplyUpdate` handler on the dev machine, and confirmed by the engine's own request: the server accepted the test patch (`Type` `C#`, `Body` `return this;`, empty `Data`) and answered with the new "Applied Updates" item (fixture `apply`, step 1, call 14). The refusal of a missing or `VB` `Type` is from the handler's code, not run.

### DBP-061: The server records each applied patch as an "Applied Updates" item

[14.35] The server's `ApplyUpdate` first looks for an "Applied Updates" item whose `up_number` is `Number`. If one exists, the run is refused with the fault of DBP-042, `The update with update number {Number} has already been applied to this database.` (observed on dev with a request that has no `failIfAlreadyApplied`; the first reading of the handler had it skipping the update and answering with the existing item). Otherwise it runs the method (DBP-060); when that works it adds an item of type "Applied Updates" with `up_number` {Number}, `name` {Name}, `update_generation` {Generation} and `date_applied` `__now()`, and answers with it. Any fault from the method or the add is the answer, and nothing is recorded when the method fails.

The "Applied Updates" ItemType, on dev, holds items such as `IR-072068` (`up_number` `IR-072068`, `name` `IR-072068 Core-IoC Use IoC container in InternalMethodsFactory`, `update_generation` 1), each linked by a `DatabaseUpgradePatch` to a `DatabaseUpgrade` row. The server's other side effects are its own log lines for the update and a compiled method assembly in its temp folder.

*Observed:* from the server's code and the existing items on dev, and the engine's run (fixture `apply`: the answer of call 14 is the new item, `type="Applied Updates"`, `generation` 1, `date_applied` set; the already-applied fault is call 14 of step 2).

### DBP-062: Where patches come from

[14.35] No patch manifest or patch file was found on the dev machine (the install holds the `ApplyUpdate` handler, the Nash page that can send the action by hand, and Aras Update, which sends manifests it is given). Aras distributes patch sets with its releases and hotfixes; their layout is not in these sources. Everything above about the manifest (`software_version`, `updates/update`, the four child elements) and the patch files (`<name>.xml` with an `Update` root) comes from the engine's code and the server's handler, not from a sample. The test patch of DBP-070 is therefore written to that format, and its first run (ticket 72) confirmed it.

## The test patch

### DBP-070: A no-op patch is the only patch tests may apply

[14.35] The oracle (ticket 72) applies one patch, committed with the oracle, and refuses every other manifest or patch file. Its design:

- **Manifest** (`manifest.xml`):

  ```xml
  <updates_manifest>
    <software_version>9999</software_version>
    <updates>
      <update>
        <up_number>LIBSJS-SCRATCH-001</up_number>
        <name>LIBSJS-SCRATCH-noop</name>
        <order>1</order>
        <generation>1</generation>
      </update>
    </updates>
  </updates_manifest>
  ```

- **Patch** (`LIBSJS-SCRATCH-noop.xml`, no XML declaration, DBP-092):

  ```xml
  <Update><Type>C#</Type><Body><![CDATA[return this;]]></Body><Data/></Update>
  ```

- **What it does.** The method returns its own input and reads or writes nothing. The run adds exactly three items: a `DatabaseUpgrade` row (name `Applied Updates`, `target_release` `99.99`, type 0, description `Libs`), an "Applied Updates" item (`up_number` `LIBSJS-SCRATCH-001`) and the `DatabaseUpgradePatch` that links them. No existing item is edited or deleted, because no release `99.99` or number `LIBSJS-SCRATCH-001` exists (DBP-071 checks), so DBP-030 takes its `add` path. Release `99.99` is chosen because it matches none of the existing rows (`8.0` to `9.4`, `1.00` to `1.20`) and so the engine never edits one. The server adds its log lines and a compiled assembly in its temp folder, and that is all it keeps.
- **Why it is clearly non-destructive.** It changes no configuration, no data of any other item, no schema and no permission, and its three items are new, named `LIBSJS-SCRATCH-*` or the fixed release, and removable by id (DBP-071). If the server rejects the body (a compile fault), the run still adds only the `DatabaseUpgrade` row, which cleanup removes. Any other patch is not covered by this design and goes to the captain first.
- **The login.** DBP-010 and DBP-011 allow only the user `root`. The dev profile's own user is `root`, which is the oracle's default `--user` and the login of every earlier fixture, so the success run adds no credential: the password reaches the host through `ARAS_PASSWORD` only. The user `admin`, with the same password on dev, is refused at DBP-010, which is the non-root refusal case of the fixture.

*Design; confirmed by ticket 72's runs (fixture `apply`): the server compiled and ran the body, the run added exactly the three items, and the cleanup removed them.*

### DBP-071: Guard, preconditions and cleanup

[14.35] The oracle's `dbpatch` command (ticket 72):

1. **Guard.** It runs only when the manifest and the patch file are byte-identical to the committed ones (a digest check, like the vendored DLLs'), and `--tool-name` is `Libs`. Any other input is refused before a connection is made.
2. **Preconditions** (read-only, before the run, not recorded): no `DatabaseUpgrade` of type `0` with `target_release` `99.99`; no "Applied Updates" item with `up_number` `LIBSJS-SCRATCH-001`. If either exists, it stops and reports. This keeps DBP-030 on its `add` path and DBP-042 off the "already applied" path. A step that continues a run that kept its items (`--keep-created`, for the second run of `apply`) skips them, because the items are expected.
3. **Run.** The recording connection captures every `CallAction` and `ApplyItem`, including the raw `ValidateUser`/`GetItem`/`ApplyUpdate` calls (ticket 03), and the engine's log.
4. **Cleanup**, from the ids in the recorded calls (the `add` of the row and of the link, and the item `ApplyUpdate` answered with): delete the `DatabaseUpgradePatch` by id, then the "Applied Updates" item, then the `DatabaseUpgrade` row, newest first. An item goes only if it still matches the test patch (the row: name `Applied Updates`, release `99.99`, type `0`; the update: `up_number` `LIBSJS-SCRATCH-001`; a link: its update's `up_number`). A read-back then finds no "Applied Updates" item with the number and no row of the release; anything found is reported as kept and the run exits 1. It reports the ids it created and deleted. A run that fails midway still runs cleanup.
5. **Cases.** `non-root`: the `admin` login (DBP-010, no request after login). `apply`: the success run, and a second run of the same patch before the cleanup (the existing-row path of DBP-030 and the already-applied fault of DBP-042). A run whose patch is refused by the server is a failed run: the host exits 1 because a text went to the `error` channel, though no exception escaped (DBP-050).

*Design; built by ticket 72 (`oracle/src/dbpatch.ts`, the `dbpatch` command, `oracle/dbpatch/`).*

## Reproduced bugs

### DBP-090: A branch and a message that can never run (bug)

[14.35] After the fault test of DBP-042, the engine tests `item.isEmpty()`. `Item.isEmpty()` is true only for a *fault* whose faultcode is `0`, and a fault was already handled, so the branch (`Could not get applied update id.`) is dead. A success answer with no item does not reach it either; it throws `Not a single item` at `getID()` (DBP-042). The catalogue's `DBPatchImportFailed` is likewise never sent. Registered in `bugs.md`. *Inferred from the code.*

### DBP-091: A short `software_version` crashes the run (bug)

[14.35] The release string is built with `Substring(0, 2)` on the element's text without a length check (DBP-021), so `<software_version/>` or `<software_version>5</software_version>` throws `ArgumentOutOfRangeException`, after the four requests of `ValidateRootUser` and before anything is created. A correct engine would take what exists. Registered in `bugs.md`. *Inferred from the code.*

### DBP-092: A patch file with an XML declaration breaks the request (bug)

[14.35] The request embeds `XmlDocument.InnerXml` of the patch (DBP-041), and `InnerXml` of a document includes its XML declaration. Embedded in the middle of `<Item>`, the declaration makes `LoadXml` throw `XmlException` (`Unexpected XML declaration. The XML declaration must be the first node in the document, and no white space characters are allowed to appear before it. Line 1, position {n}.`) in `CallAction`, before the request is sent. The exception ends the run (DBP-050), after the `DatabaseUpgrade` row was created and before it is set to `1` or `2`, so it stays `0`. The test patch has no declaration for this reason. A correct engine would embed the root element only. A DOCTYPE fails the same way. Registered in `bugs.md`. *Inferred from the code. Ticket 72's guard refuses a copy of the test patch that adds a declaration (DBP-071), so the oracle does not show it.*

### DBP-093: Entry values and patch XML are interpolated unescaped (bug)

[14.35] `up_number`, `name` and `generation` from the manifest, and the patch file's XML, go into the `ApplyUpdate` request without escaping (DBP-041), and the server builds its own "Applied Updates" `add` and `get` by concatenating `Number`, `Name` and `Generation` into AML (DBP-061). A value with `<`, `&` or a quote makes the request malformed (`XmlException`, DBP-050) or changes what the server's AML selects. The library interpolates exactly as the engine does (AGENTS.md rule 7). Registered in `bugs.md`. *Inferred from the code.*

### DBP-094: One failed patch does not stop the later ones (bug)

[14.35] After a failed patch the loop goes on with the next entry (`continue`), though later patches can depend on the failed one. The run's status is `2` and no exception is thrown, so a host that does not read the `error` channel sees a success. The library reproduces the continuation and reports the failure through its exit status (DBP-002). Registered in `bugs.md`. *Inferred from the code.*
