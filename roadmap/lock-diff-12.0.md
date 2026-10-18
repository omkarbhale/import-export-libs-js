# 12.0 against 14.0.7: the lock diff, accounted for

Wayfinder ticket 46. `Libs.dll` 12.0.0.13341 is mapped in `spec/source-map.json` (215 reachable methods, `spec/reachable/12.0.json`). This record accounts for every reachable method whose REA lock differs between 14.0.7 and 12.0, and for every method only one of the builds has. Regenerate the numbers with `npm run rea-map -- diff oracle/native/14.0.7/Libs.dll oracle/native/12.0/Libs.dll` (needs `rea` and the 14.0.7 and 12.0 builds in the source map) and the comparison below.

## Why the lock diff alone does not decide

`rea-map diff` against 14.0.7 reports 279 of its 287 locks as broken. The cause is mostly not code. Of the 207 methods that both builds have (same name and signature), 140 have identical C# in ILSpy's output, and for 132 of those the normalised IL digest still differs, because IOM 12 and IOM 14 are different assemblies and the IL names their types and members by token. So the lock says "changed" for nearly everything, and the C# text of each method was compared instead. 140 methods are identical, 67 differ, 8 exist in 12.0 only and 80 in 14.0.7 only. The first group needs no variant: its rules say `[12.0] Same as 14.0.7.` The others are below.

## The 67 methods with different C#

Kinds: **behaviour** (a `[12.0]` variant that is not "same"), **message-differs** (a text differs; the variant says which), **message** (a literal moved into the catalogue, same text), **io** (file access moved behind `IOWrapper` in 14.0.7; the variant records any visible effect), **not-ported** (host-only or compiler plumbing), and **import** (owned by the import variants, ticket 47: the rule ids are copied from 14.0.7 and the variant comes with that ticket).

| Method | Kind | What differs | Accounted for in |
|---|---|---|---|
| `CExportItems::Export` | behaviour | `ac_PolicyAccessItemAttribute` row and its `dr_Relationship` step (R4), `ReplaceIdWithConfigId` extracted (same code), `dr_RelationshipFamily` routine without the re-indent (R10), `CdataFilterXmlInMacCondition` for `mp_MacPolicy` only (R9), file access without the wrapper (R16) | EXP-021, EXP-051, EXP-100, EXP-107, EXP-117, EXP-118, EXP-400, EXP-405, EXP-421, EXP-423 |
| `CItemHelper::GetCurrentUtilityVersion` | behaviour | three-argument `ArasVersion` | WIRE-022, WIRE-023 |
| `CItemHelper::GetInnovatorServerVersion` | behaviour | no `VersionBuild` and `VersionServiceUpdate` requests; `ArasVersion` of three members | WIRE-020, WIRE-021 |
| `CItemHelper::Login` | behaviour | exact-type login dispatch (R1); same gate with major 12 (R3); same texts | WIRE-017, WIRE-023, WIRE-024 |
| `CItemHelper::ProcessPropertiesOfTypeItem` | behaviour | recursion into `Relationships/Item` only, ends on a null lookup (R5) | EXP-116 |
| `CItemHelper::applyAML` | behaviour | `CItemException(item)`, no `Server error` text (R19) | WIRE-006, WIRE-051 |
| `ImportExportManager::ExportSolutions` | behaviour | no header, `GetSolutions2Xml` before the log opens (R17); the closing line of the error text; no path normalisation | EXP-504 to EXP-508, EXP-520 |
| `CExportItems::.ctor` | io | creates an `IOWrapper` (14.0.7 only) | EXP-421 |
| `CExportItems::ProcessForm` | message | literal moved into the catalogue; same text | EXP-050, EXP-111 |
| `CItemHelper::ApplyXsl` | message | literal moved into the catalogue; same text | EXP-201 |
| `CItemHelper::GetAssemblyInfo` | not-ported | host-only | n/a |
| `CItemHelper::GetConfigId` | message | same text | EXP-042 |
| `CItemHelper::GetCurrentIdByUniqueKey` | message | same texts | EXP-041 |
| `CItemHelper::GetCurrentIdOfVersion` | message | same text | EXP-011 |
| `CItemHelper::GetCustomFloatPropertiesOfTypeItem` | message-differs | the wrapped text lacks the closing quote | EXP-044 |
| `CItemHelper::GetManifestResourceStream` | not-ported | same texts; reads the embedded stylesheet | EXP-200 |
| `CItemHelper::GetRelatedItemConfigId` | message | same text | EXP-114, EXP-618 |
| `CItemHelper::GetSolutionNames` | not-ported | host-only | n/a |
| `CItemHelper::GetTypeAmlInner` | message | same texts | EXP-031, EXP-032 |
| `CItemHelper::GetUniqueProperties` | message | same text | EXP-041 |
| `CItemHelper::IsVersionable` | message | same text | EXP-010 |
| `CItemHelper::RemoveReferencesToAnotherPackages` | message | same texts | EXP-601 to EXP-617 |
| `CItemHelper::getDepencyLevel` | message-differs | the error text works in 12.0; empty in 14.0.7 (leading-space key) | EXP-043 |
| `CItemHelper::getSolutions` | message-differs | `Unable to get packages meta.` without the exception message | EXP-504, EXP-507 |
| `ImportExportManager::.ctor` | io | file tests without the wrapper; manifest read by `Load` (R15) | EXP-502, MAN-003 |
| `ImportExportManager::CreateOutputDir` | io | `Directory` calls without the wrapper (R16) | EXP-414, EXP-421 |
| `ImportExportManager::ExportProc` | message-differs | log line `type :` with one space; timestamps in the current culture (R17); texts otherwise equal | EXP-504, EXP-505, EXP-516, EXP-518 |
| `ImportExportManager::ExportReferencedElements` | message | same text | EXP-519 |
| `ImportExportManager::GenerateHashtableFromManifest` | io | `File.Exists` and `Load` on the raw path (R15, R16) | ticket 66 (MAN-003 for the reader) |
| `ImportExportManager::GetSolutionPath` | message | same texts | MAN-032 |
| `ImportExportManager::GetSolutions2Xml` | message-differs | the error text is the abort-question block; the second writer succeeds (no sharing bug) | EXP-507, EXP-541 |
| `ManifestFile::.ctor` | io | `Load(path)` (R15) / no wrapper | MAN-002, MAN-003 |
| `ManifestFile::.ctor` | io | `Load(path)` (R15) / no wrapper | MAN-002, MAN-003 |
| `ManifestFile::AddDependsOn` | message | same text | MAN-012 |
| `ManifestFile::GetDependsOn` | message | same text | MAN-015 |
| `ManifestFile::MoveToOrderedList` | message | same texts | MAN-022, MAN-023 |
| `ManifestFile::Save` | io | `Save(path)` without the wrapper | MAN-006 |
| `PackageDefinitionManager::FindReferencedElements` | message | same texts | EXP-053 |
| `PackageDefinitionManager::InitSolution` | message | same text | EXP-052 |
| `RemovedReference::get_Reason` | message | same texts | EXP-613 |
| `CImportItems::Import` | import | R13 (`RemoveSystemPropertyForPolyType`), messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::CheckDataSourceReferences` | import | messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::CheckGetItems` | import | messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::CheckPropertiesAndRelationshipTypes` | import | messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::CheckRelatedItems` | import | messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::CheckRelationshipItems` | import | R14 (DiscussionTemplate always `merge`) | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::DeleteSqlItems` | import | messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::DoChecking` | import | messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::DoesItemAlreadyExist` | import | messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::GetLabelOfItemType` | import | detail text without the final dot | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::GetPackageGroupIdOrCreateIfNotExists` | import | messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::Islocked` | import | messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::RecurseCheck` | import | messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::SetItemIdToLastGeneration` | import | messages | ticket 47 (rules as in 14.0.7) |
| `CItemHelper::WriteReleaseData` | import | `upgrade_status` formatting, message key | ticket 47 (rules as in 14.0.7) |
| `DelayedResolutionManager::ExecuteDelayedResolution` | import | messages | ticket 47 (rules as in 14.0.7) |
| `DelayedResolutionManager::ProcessForDelayedResolution` | import | messages | ticket 47 (rules as in 14.0.7) |
| `DelayedResolutionManager::ProcessRelatedItem` | import | messages | ticket 47 (rules as in 14.0.7) |
| `DelayedResolutionManager::ProcessRelatedRelationshipItem` | import | messages | ticket 47 (rules as in 14.0.7) |
| `DelayedResolutionManager::ProcessUnresolvedNode` | import | messages | ticket 47 (rules as in 14.0.7) |
| `ImportExportManager::ImportPackage` | import | timestamps, messages | ticket 47 (rules as in 14.0.7) |
| `ImportExportManager::ImportProc` | import | `Console.Write` vs `WriteLine`, no `tempFullName` line, R18 (Error message on every failure) | ticket 47 (rules as in 14.0.7) |
| `ImportExportManager::ImportSolutions` | import | no input-parameter header, error text, messages | ticket 47 (rules as in 14.0.7) |
| `ImportExportManager::LoadPackageDom` | import | `Load(path)` (R15), no `tempFullName` stamp, messages | ticket 47 (rules as in 14.0.7) |
| `ImportExportManager::LogError` | import | text | ticket 47 (rules as in 14.0.7) |
| `PackageDefinitionManager::AddElement2Group` | import | message (no `name=` part) | ticket 47 (rules as in 14.0.7) |
| `PackageDefinitionManager::AddReferencedElements` | import | message | ticket 47 (rules as in 14.0.7) |

## In 12.0 only

| Method | Accounted for |
|---|---|
| `Aras.Tools.CommonMethods::SaveToFile` | the item-file writer; the bytes of `IOWrapper.XmlDocumentSaveWithSettings` (EXP-423) |
| `ArasVersion::.ctor` | the three-argument constructor (WIRE-021) |
| `CExportItems::CdataFilterXmlInMacCondition` | the `mp_MacPolicy`-only, first-occurrence filter (EXP-405) |
| `CExportItems::ProcessDerivedRelationshipFamily` | the `dr_RelationshipFamily` routine without the re-indent (EXP-117) |
| `CItemHelper::.ctor` | the five-argument constructor of the GUI hosts: not ported |
| `CItemHelper::FillDatabaseList` | held, `roadmap/hold/getdb-list.md` |
| `CItemHelper::_getDBList` | held, `roadmap/hold/getdb-list.md` |
| `HttpConnectorExtension::.ctor` | the four-argument constructor (WIRE-002, WIRE-005) |

## In 14.0.7 only

| Methods | Count | Accounted for |
|---|---|---|
| `.ctor`, `<IsCertificateRequired>b__0`, `MoveNext` … | 24 | Client-certificate login (`CertificateUtils`, `HttpConnectorExtension.Login` and the certificate settings). Held by 14.0.7's `roadmap/hold/certificate-login.md`; 12.0 has none of it (WIRE-090). |
| `.ctor`, `get_Build`, `get_InnovatorVersionFullString` … | 4 | `Build`, `ServiceUpdate`, `InnovatorVersionFullString` and the five-argument constructor: 12.0 reads two fewer Variables (WIRE-020 to WIRE-022). |
| `CdataFilterXml`, `IncludeDrRelationshipAsValue`, `ReplaceIdWithConfigId` | 3 | Extracted or renamed export steps: `ReplaceIdWithConfigId` (the same code inline in 12.0, EXP-107), `IncludeDrRelationshipAsValue` (EXP-117, EXP-118), `CdataFilterXml` (EXP-405). |
| `RemoveSystemPropertyForPolyType` | 1 | `RemoveSystemPropertyForPolyType` (R13, import, ticket 47). |
| `.ctor` | 1 | The constructor taking a request and a response (WIRE-051). |
| `FormatWithArgs` | 1 | `FormatWithArgs` (the log header, EXP-506): absent. |
| `.ctor`, `DirectoryCreateDirectory`, `DirectoryDelete` … | 19 | The `IOWrapper` file facade and its path normalisation. 12.0 calls the file functions directly (EXP-421, MAN-004). |
| `LogInputParameters`, `get_iOWrapper` | 2 | `LogInputParameters` (EXP-506) and the `iOWrapper` property (EXP-502): absent. |
| `GetInnovatorServerPath`, `.ctor`, `CopyLanguagePack` … | 18 | Language-pack import. 12.0 has no `LanguagePackPreprocessor`, no `LPImport` action and no `LP*` settings; the `LP-` rules get no `[12.0]` variant (ticket 47). |
| `.ctor`, `GetMessage`, `GetMessage` … | 4 | The message catalogue (EXP-504): 12.0 uses literals. |
| `.ctor`, `get_FullName`, `get_Name` | 3 | `FileInfoWrapper`: 12.0 uses `FileInfo` directly (import loading, ticket 47). |

## Source map

Every 12.0 method has an owner in `spec/source-map.json`: the rules of its 14.0.7 twin (same name and signature) or of the rule that specifies it, or `not-ported` with a reason. The methods of the import side carry the rule ids of 14.0.7 and get their `[12.0]` variants from ticket 47. All stay `unmapped` (no TypeScript symbol yet), and the build is `inProgress`, until the 12.0 build tickets (49, 50).
