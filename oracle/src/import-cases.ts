import {
  batchGood,
  batchOneServerFailure,
  batchBadCheck,
  batchTwoServerFailures,
  cuiOrder,
  delayedDuplicate,
  delayedPropertyWhere,
  langOnItemElement,
  langPackage,
  strayBrokenFile,
} from "./import-packages-14.35.js";
import {
  BASE,
  INST,
  absentDependency,
  base,
  batchBadRelation,
  batchFatalRelType,
  batchServerFailure,
  collDistinct,
  collDuplicate,
  cycle,
  delMissing,
  delPackage,
  delPromote,
  delRefused,
  acActions,
  fsLatin1,
  fsOdd,
  fsUtf16NoBom,
  fsXmlDeclaration,
  instanceId,
  baseId,
  instances,
  mini,
  refDep,
  refPair,
  sqlAttr,
  sqlChild,
  unresDelayed,
  unresNestedGet,
  unresRelType,
  type ScratchPackage,
} from "./import-packages.js";
import { IMPORT_ENGINES, type ImportEngine } from "./case-engine.js";
import type { HostValue } from "./record.js";

/**
 * The 14.0.7 import fixture cases (ticket 25): ticket 05's scratch packages
 * S1 to S5, S8 and S9, its manifest and file-system cases, and its import
 * option matrix, as the input of `npm run oracle:import-cases`.
 *
 * A case is one or more runs ("steps") of the oracle's `import`, in order. Each
 * step has its own manifest and options, and is recorded like any oracle run.
 * Every step but the last keeps what it created, so the next step finds it on
 * the server (a re-import, or a delete of what an earlier step made); the
 * last step deletes everything the case created, and the recorder deletes it
 * again if a step fails half way. Every case therefore starts from, and ends
 * at, a dev instance without `LIBSJS-SCRATCH-*` data.
 */

export interface ImportOptions {
  merge?: true;
  fast?: true;
  vault?: true;
  verbose?: true;
  release?: string;
  description?: string;
  /** Press Cancel after this many status messages have been delivered. */
  cancelAfterStatus?: number;
  /** Lock the packages' scratch DatabaseUpgrade rows before the run (the engine's unlock path). */
  lockUpgradeRows?: true;
  /** Give these scratch items a new generation before the run (the merge's current-generation path). */
  versionBefore?: { type: string; id: string }[];
  /** 14.35: the `Languages` selection (`SolutionUpgradeContext.Languages`); unset leaves the property null. */
  languages?: string[];
  /** 14.35: `AmlBatchMode` with its `AmlBatchMaxSize`. */
  amlBatch?: { maxSize: number };
  /** 14.35: `CollectImportErrors` with its `CollectImportErrorsMaxCount`. */
  collectErrors?: { maxCount: number };
}

/** What a step is expected to end with, so a recording that drifts is refused. */
export type StepOutcome =
  /** `ImportSolutions` returned 0. */
  | "success"
  /** `ImportSolutions` returned 1: the engine logged the error and gave up. */
  | "engine-failure"
  /** 14.35, collected errors: `ImportSolutions` returned this count of collected errors (IMP-546). */
  | `returned:${number}`
  /** The `ImportExportManager` constructor threw (the language scan or check): the host ended with its exception and no return value. */
  | "refused";

export interface ImportStep {
  name: string;
  /** The manifest of this step, in this order. */
  packages: ScratchPackage[];
  /** Hand the engine only these packages, in this order (default: every package in the manifest, in manifest order). */
  only?: string[];
  options?: ImportOptions;
  expect: StepOutcome;
  /** Engines on which the step ends otherwise than `expect` says (a variant rule changes the outcome). */
  expectOn?: Partial<Record<ImportEngine, StepOutcome>>;
}

/** What a step must end with on an engine. */
export const expectedOutcome = (step: Pick<ImportStep, "expect" | "expectOn">, engine: ImportEngine): StepOutcome => step.expectOn?.[engine] ?? step.expect;

export interface ImportCase {
  /** The folder under fixtures/14.0.7/import/. */
  id: string;
  /** Ticket 05's labels (S1, an option-matrix row, a manifest case). */
  catalogue: string[];
  title: string;
  /** What the case pins, in terms of the spec areas. */
  exercises: string;
  steps: ImportStep[];
  /** What the case does not cover, or what it needs from dev. */
  note?: string;
  /** The engines the case is recorded on (default: every one); a case that pins a variant rule of one engine lists only that engine. */
  engines?: readonly ImportEngine[];
  /** How the case reads on an engine whose variant rule changes what it shows, where the default text does not fit. */
  exercisesOn?: Partial<Record<ImportEngine, string>>;
  /** The spec rules the case pins (shown in its README). */
  rules?: string[];
  /** The `Language` items dev must have for the case to give the same result (default: whatever it had, `en` only). */
  devLanguages?: readonly string[];
}

/** The cases an engine records, in list order. */
export const casesFor = (engine: ImportEngine): ImportCase[] => IMPORT_CASES.filter((c) => (c.engines ?? IMPORT_ENGINES).includes(engine));

/** Host parameters for a step's options; anything unset keeps the engine's default. */
export function hostOptions(options: ImportOptions | undefined, only?: readonly string[]): Record<string, HostValue> {
  const params: Record<string, HostValue> = {};
  if (options?.merge === true) params.Merge = true;
  if (options?.fast === true) params.Fast = true;
  if (options?.vault === true) params.Vault = true;
  if (options?.verbose === true) params.ContextVerbose = true;
  if (options?.release !== undefined) params.Release = options.release;
  if (options?.description !== undefined) params.Description = options.description;
  if (options?.cancelAfterStatus !== undefined) params.CancelAfterStatus = options.cancelAfterStatus;
  if (options?.lockUpgradeRows === true) params.LockUpgradeRows = true;
  if (options?.versionBefore !== undefined) params.VersionBefore = options.versionBefore.map((v) => `${v.type}\t${v.id}`);
  if (options?.languages !== undefined) params.Languages = [...options.languages];
  if (options?.amlBatch !== undefined) {
    params.AmlBatchMode = true;
    params.AmlBatchMaxSize = options.amlBatch.maxSize;
  }
  if (options?.collectErrors !== undefined) {
    params.CollectImportErrors = true;
    params.CollectImportErrorsMaxCount = options.collectErrors.maxCount;
  }
  if (only !== undefined) params.Packages = [...only];
  return params;
}

const step = (name: string, packages: ScratchPackage[], expect: StepOutcome, options?: ImportOptions, only?: string[]): ImportStep => ({
  name,
  packages,
  expect,
  ...(options === undefined ? {} : { options }),
  ...(only === undefined ? {} : { only }),
});

const one = (p: ScratchPackage): ScratchPackage[] => [p];

const R1 = { release: "LIBSJS-SCRATCH-R1", description: "scratch import run" } as const;

const batch = (maxSize: number): ImportOptions => ({ amlBatch: { maxSize } });
const collect = (maxCount: number): ImportOptions => ({ collectErrors: { maxCount } });

export const IMPORT_CASES: ImportCase[] = [
  // ---- Option matrix on the small package (S0 MINI) ----
  {
    id: "s0-mini-defaults",
    catalogue: ["S0", "release/description unset"],
    title: "Six small items, every option at the engine default",
    exercises:
      "Package registration (PackageDefinition, one PackageGroup per type label, one PackageElement per item named by its file), the DatabaseUpgrade row (in progress, then success) with a null Release and Description, the per-type definition checks and their cache, and the plain add path with merge off.",
    steps: [step("import", one(mini()), "success")],
  },
  {
    id: "s0-mini-merge",
    catalogue: ["S0", "merge on"],
    title: "The same package with merge on, when nothing exists yet",
    exercises: "Merge mode on a fresh server: the one-get-per-type idlist lookup that finds nothing, so every add stays an add.",
    steps: [step("import", one(mini()), "success", { merge: true })],
  },
  {
    id: "s0-mini-release-description",
    catalogue: ["S0", "release/description both set"],
    title: "Release and Description both set",
    exercises: "The DatabaseUpgrade row carries target_release and description; the in-progress and success writes.",
    steps: [step("import", one(mini()), "success", { ...R1 })],
  },
  {
    id: "s0-mini-release-only",
    catalogue: ["S0", "release only"],
    title: "Release set, Description left null",
    exercises: "A null Description is concatenated as an empty string into the DatabaseUpgrade AML.",
    steps: [step("import", one(mini()), "success", { release: R1.release })],
  },
  {
    id: "s0-mini-release-upsert",
    catalogue: ["S0", "DatabaseUpgrade upsert"],
    title: "The same release run twice, then a new release",
    exercises:
      "WriteReleaseData's upsert per (release, name, type 1): the second run finds the row, checks its lock and edits it; a third run with another release adds a row and edits the is_latest flag of the others. Merge is on, so the re-imports are edits.",
    steps: [
      step("release R1, description D1", one(mini()), "success", { merge: true, release: R1.release, description: "first" }),
      step("release R1, description D2", one(mini()), "success", { merge: true, release: R1.release, description: "second" }),
      step("release R2", one(mini()), "success", { merge: true, release: "LIBSJS-SCRATCH-R2", description: "third" }),
    ],
  },
  {
    id: "s0-mini-locked-row",
    catalogue: ["S0", "DatabaseUpgrade row locked"],
    title: "A re-import when the package's DatabaseUpgrade row is locked",
    exercises:
      "WriteReleaseData's unlock path: the lock check (`locked_by_id`), the unlock, then the edit. The host locks the row between the steps, outside the recording.",
    steps: [step("first import", one(mini()), "success", { merge: true }), step("import with the row locked", one(mini()), "success", { merge: true, lockUpgradeRows: true })],
  },
  {
    id: "s0-mini-fast-vault",
    catalogue: ["S0", "bFast", "bVault"],
    title: "Fast and Vault both set",
    exercises: "Neither option changes what the engine does (bFast always reads as false; bVault is never read), apart from the parameters it logs.",
    steps: [step("import", one(mini()), "success", { fast: true, vault: true })],
  },
  {
    id: "s0-mini-verbose",
    catalogue: ["S0", "Verbose"],
    title: "Verbose console output",
    exercises: "The engine's Verbose flag only changes its console lines (the host log); the requests are the same as in s0-mini-defaults.",
    steps: [step("import", one(mini()), "success", { verbose: true })],
  },
  {
    id: "s0-mini-cancel",
    catalogue: ["S0", "cancel"],
    title: "Cancel pressed after the fourth status message",
    exercises:
      "ImportExportManager.Cancel() during a package: the loop checks the flag before each item, writes the cancelled message and returns normally, so the package is recorded as success and the run returns 0. The host presses Cancel from inside the status message, which is where the GUI's button would act.",
    exercisesOn: {
      "14.35":
        "ImportExportManager.Cancel() during a package. 14.35 checks the flag before each item and ends the package with an OperationCanceledException, so the package row is written with status 2 (failed) and the run returns 1, where 14.0.7 recorded the package as a success and returned 0. The host presses Cancel from inside the status message, which is where the GUI's button would act.",
    },
    steps: [{ ...step("import, cancelled", one(mini()), "success", { cancelAfterStatus: 4 }), expectOn: { "14.35": "engine-failure" } }],
  },

  // ---- S1 BASE ----
  {
    id: "s1-base",
    catalogue: ["S1"],
    title: "One item per build.xsl bucket, fresh import",
    exercises:
      "build.xsl ordering of the first-group types, ItemTypes (non-polymorphic, then polymorphic), RelationshipTypes by dependencyLevel, the ItemType-follow-up View and Form deletes, and the per-type package registration. Item files are on disk in an order that differs from the import order.",
    steps: [step("import", one(base()), "success")],
  },
  {
    id: "s1-base-merge",
    catalogue: ["S1", "merge on"],
    title: "S1 with merge on, when nothing exists yet",
    exercises: "Merge mode over the whole document: SetItemIdToLastGeneration for the versionable types and the idlist get per type, none found.",
    steps: [step("import", one(base()), "success", { merge: true })],
  },
  {
    id: "s1-reimport",
    catalogue: ["S1", "merge off/on"],
    title: "S1 imported, then re-imported with merge off and with merge on",
    exercises:
      "Merge off: DoesItemAlreadyExist skips every add of an item that exists (and the package is still registered). Merge on: the existing adds become edits (add to edit), locked ones are unlocked first, nothing is deleted.",
    steps: [
      step("fresh import", one(base()), "success"),
      step("re-import, merge off", one(base()), "success"),
      step("re-import, merge on", one(base()), "success", { merge: true }),
    ],
  },
  {
    id: "s1-method-generation",
    catalogue: ["S1", "versionable"],
    title: "A versionable Method re-imported after it got a second generation",
    exercises:
      "SetItemIdToLastGeneration and GetCurrentIdOfVersion: the file carries the first generation's id, the server's current one is the second, so the merge asks for is_current and config_id, then for the id of the current generation. The host versions the Method between the steps, outside the recording.",
    steps: [
      step("fresh import", one(base()), "success", { merge: true }),
      step("re-import after versioning the Method", one(base()), "success", { merge: true, versionBefore: [{ type: "Method", id: baseId("Method_1") }] }),
    ],
  },
  {
    id: "s1-instances-versionable",
    catalogue: ["S1", "ProcessVersionableItem"],
    title: "Instances of a versionable ItemType with a relationship, re-imported",
    exercises:
      "ProcessVersionableItem: a versionable root with a relationship that has a related_id is matched by source and related id (ExistRelItemInCurVer) and becomes an edit with a `where`, or an add. The last step gives the root a second generation first, so the root and its relationship's source_id move to the current generation.",
    steps: [
      step("ItemTypes", one(base()), "success", { merge: true }),
      step("instances, fresh", one(instances()), "success"),
      step("instances, merge on", one(instances()), "success", { merge: true }),
      step(
        "instances, merge on, after versioning the root",
        one(instances()),
        "success",
        { merge: true, versionBefore: [{ type: BASE.itV, id: instanceId(INST.v1) }] },
      ),
    ],
  },

  // ---- S2 dependencies and referenced elements ----
  {
    id: "s2-ref-both",
    catalogue: ["S2"],
    title: "A package and the package it depends on, imported together",
    exercises:
      "Package ordering (the dependency is imported first although the manifest lists it second), PackageDependsOn, and the three kinds of referenced element: one in the dependency, a stock List, and an id that exists nowhere (the 'not added' warning).",
    steps: [step("import", refPair(), "success")],
  },
  {
    id: "s2-ref-only",
    catalogue: ["S2"],
    title: "A package imported without the package it depends on",
    exercises: "The dependency is neither imported nor on the server: the ordering warning, and every referenced element of it reported as not added.",
    steps: [step("import REF only", refPair(), "success", undefined, ["LIBSJS-SCRATCH-REF"])],
  },
  {
    id: "s2-ref-dep-present",
    catalogue: ["S2"],
    title: "A package imported after its dependency was imported earlier",
    exercises: "The dependency is on the server (a PackageDefinition) but not in this run: the database branch of the ordering, and the referenced scratch item now found.",
    steps: [
      step("import REFDEP", [refDep()], "success"),
      step("import REF", refPair(), "success", undefined, ["LIBSJS-SCRATCH-REF"]),
    ],
  },

  // ---- S3 unresolved references ----
  {
    id: "s3-unres-delayed",
    catalogue: ["S3"],
    title: "References that resolve once the package is imported",
    exercises:
      "Delayed resolution: a Property whose data_source ItemType is imported by a later file (code 10000) and a Member whose related Identity is imported later (code 10001). The nodes are rewritten before the import and queued; the queue runs at the end of the package.",
    steps: [step("import", one(unresDelayed()), "success")],
  },
  {
    id: "s3-unres-nested-get-code0",
    catalogue: ["S3"],
    title: "A nested get that finds nothing, under an unlisted parent",
    exercises: "CheckGetItems records code 0 (logged only, nothing is rewritten); the item is imported as it is, and the server then rejects the nested get, which fails the package.",
    steps: [step("import", one(unresNestedGet()), "engine-failure")],
  },
  {
    id: "s3-unres-reltype-nested",
    catalogue: ["S3"],
    title: "A RelationshipType whose source and related ItemTypes are nested gets that find nothing",
    exercises: "Codes 10002 and 10003 are logged only; nothing is queued, the item is imported as it is, and the server rejects it.",
    steps: [step("import", one(unresRelType()), "engine-failure")],
  },

  // ---- S4 delete actions ----
  {
    id: "s4-del",
    catalogue: ["S4"],
    title: "Delete actions against items an earlier import created",
    exercises:
      "The build.xsl drop bug: List, ItemType and Identity deletes are dropped silently (their types are listed, but only for adds and edits); Form delete (its own bucket), Field delete (any action) and Value delete (an unlisted type, last bucket) are kept. The plan the import prints is the engine's answer to which ones ran.",
    steps: [step("import BASE", one(base()), "success", { merge: true }), step("import DEL", one(delPackage()), "success", { merge: true })],
  },
  {
    id: "s4-del-missing",
    catalogue: ["S4"],
    title: "A delete of an item that does not exist",
    exercises: "The server answers a delete of an unknown id without an error, so the item counts as applied.",
    steps: [step("import", one(delMissing()), "success")],
  },
  {
    id: "s4-del-refused",
    catalogue: ["S4"],
    title: "A delete the server refuses",
    exercises:
      "The delete-only retry path: a delete is imported without the full reference check, so when its apply fails the engine warns, runs the full check and applies it again, and the second failure ends the package.",
    steps: [step("import BASE", one(base()), "success", { merge: true }), step("import DELREFUSED", one(delRefused()), "engine-failure", { merge: true })],
  },
  {
    id: "s4-mp-promote",
    catalogue: ["S4", "R12"],
    title: "An mp_PromoteItem action on an mp_MacPolicy",
    exercises:
      "build.xsl selects mp_* items with any action in 14.x, so the engine sends it; the policy does not exist, so the server's answer ends the package. 12.0 drops mp_PromoteItem (R12): nothing is sent and the package succeeds.",
    steps: [{ ...step("import", one(delPromote()), "engine-failure"), expectOn: { "12.0": "success" } }],
    note: "No mp_MacPolicy is created: the item names an id that exists nowhere.",
  },

  // ---- S5 SQL items ----
  {
    id: "s5-sql",
    catalogue: ["S5"],
    title: "A SQL item imported twice",
    exercises:
      "DeleteSqlItems runs before the first SQL item of a package is imported: it sends a delete for every SQL item in the package DOM (a first import deletes an id the server does not have), so a re-import deletes and re-adds the view. The cleanup drops the view with the item.",
    steps: [step("fresh import", one(sqlAttr()), "success"), step("re-import", one(sqlAttr()), "success")],
  },
  {
    id: "s5-sql-id-child",
    catalogue: ["S5"],
    title: "A SQL item whose id is only a child element",
    exercises: "DeleteSqlItems reads the id from the attribute only and sends id='' (the empty-id bug); the server's 'empty id or type' error ends the package before the item is added.",
    steps: [step("import", one(sqlChild()), "engine-failure")],
  },

  // ---- S8 same last dot-segment ----
  {
    id: "s8-coll-distinct",
    catalogue: ["S8"],
    title: "Two packages whose names end in the same segment",
    exercises: "Two packages with different items import side by side; each has its own PackageDefinition and element. Ticket 67 exports them to pin the shared last-segment folder.",
    steps: [step("import", collDistinct(), "success")],
  },
  {
    id: "s8-coll-duplicate",
    catalogue: ["S8"],
    title: "The same item in two packages",
    exercises: "PackageElement is looked up globally by element id: the second package finds the first one's element in another group and fails with the duplicate-element error (-2).",
    steps: [step("import", collDuplicate(), "engine-failure")],
  },

  // ---- S9 contrast ----
  {
    id: "s9-batch-bad-relation",
    catalogue: ["S9"],
    title: "The fourth of seven items fails the engine's own check",
    exercises: "On 14.0.7 the first failure stops the package: three items are imported and registered, the failing one raises 'Bad Relation type', the last three are never read. (14.35's batch and collected-errors modes differ; ticket 57 records them.)",
    steps: [step("import", one(batchBadRelation()), "engine-failure")],
  },
  {
    id: "s9-batch-server-failure",
    catalogue: ["S9"],
    title: "The fourth of seven items fails on the server",
    exercises: "A uniqueness error from the server ends the package at that item.",
    steps: [step("import", one(batchServerFailure()), "engine-failure")],
  },
  {
    id: "s9-batch-fatal-reltype",
    catalogue: ["S9"],
    title: "A RelationshipType whose source ItemType does not exist",
    exercises: "CheckRelationshipType treats a missing source_id as fatal (it is not queued for delayed resolution): the items before it are imported, the package fails.",
    steps: [step("import", one(batchFatalRelType()), "engine-failure")],
  },

  // ---- Manifest cases ----
  {
    id: "man-cycle",
    catalogue: ["manifest"],
    title: "Two packages that depend on each other",
    exercises: "GetPackageNamesInImportOrder: a dependency cycle through the starting package gives the circular-dependency warning, and both packages are still imported.",
    steps: [step("import", cycle(), "success")],
  },
  {
    id: "man-absent-dependency",
    catalogue: ["manifest", "P2"],
    title: "A dependency on a package that exists nowhere",
    exercises: "The ordering warning for a dependency that is neither imported nor on the server; the package is imported anyway.",
    steps: [step("import", one(absentDependency()), "success")],
  },
  {
    id: "man-duplicate-requested",
    catalogue: ["manifest"],
    title: "The same package requested twice",
    exercises: "The ordered dictionary in GetPackageNamesInImportOrder throws on a duplicate key; ImportSolutions logs it and returns 1 before any import.",
    steps: [step("import", one(mini()), "engine-failure", undefined, ["LIBSJS-SCRATCH-MINI", "LIBSJS-SCRATCH-MINI"])],
  },
  {
    id: "man-unknown-package",
    catalogue: ["manifest"],
    title: "A requested package that the manifest does not list",
    exercises: "What the ordering does with a name the manifest has no node for.",
    steps: [step("import", one(mini()), "engine-failure", undefined, ["LIBSJS-SCRATCH-NOTLISTED"])],
  },

  // ---- File-system cases ----
  {
    id: "fs-odd-files",
    catalogue: ["file system"],
    title: "Files the loader treats specially",
    exercises:
      "LoadPackageDom: a `.xmlbak` file is read (the `*.xml` pattern matches it), a file with no AML/Item is logged as skipped, a UTF-16 file with a BOM is read, a `.txt` file and a file one directory too deep are ignored.",
    steps: [step("import", one(fsOdd()), "success")],
  },
  {
    id: "fs-xml-declaration",
    catalogue: ["file system"],
    title: "An item file that starts with an XML declaration",
    exercises: "The files are concatenated through OuterXml, so the declaration lands inside the document: 'Unable to apply build.xsl'.",
    steps: [step("import", one(fsXmlDeclaration()), "engine-failure")],
  },

  // ---- 12.0 variant rules (ticket 48): cases that exist only for 12.0 ----
  {
    id: "r11-ac-attribute-actions",
    catalogue: ["R11"],
    engines: ["12.0"],
    title: "Delete and purge of an ac_PolicyAccessItemAttribute",
    exercises:
      "build.xsl for ac_PolicyAccessItemAttribute: 12.0 lists it in neither the edit list nor the unlisted-types list, so every action of it goes to the last bucket, after the Variable add. 14.0.7 would drop the delete and the purge. The ids exist nowhere.",
    steps: [step("import", one(acActions()), "success")],
  },
  {
    id: "r15-latin1-file",
    catalogue: ["R15"],
    engines: ["12.0"],
    title: "An item file in Latin-1 with no XML declaration",
    exercises: "XmlDocument.Load decodes the file itself: the invalid UTF-8 byte is an XmlException ('Invalid character in the given encoding'), where 14.0.7 would read U+FFFD and import the item.",
    steps: [step("import", one(fsLatin1()), "engine-failure")],
  },
  {
    id: "r15-utf16-no-bom",
    catalogue: ["R15"],
    engines: ["12.0"],
    title: "A UTF-16LE item file with no byte-order mark",
    exercises: "XmlDocument.Load recognises UTF-16 without a mark when the file starts with '<', so the item is imported; 14.0.7 fails the load.",
    steps: [step("import", one(fsUtf16NoBom()), "success")],
  },

  // ---- 14.35 only (tickets 53, 55 and 73): recorded by ticket 75 ----
  // ---- Ticket 53: build.xsl and the delayed resolution ----
  {
    id: "cui-order",
    engines: ["14.35"],
    catalogue: ["14.35", "build.xsl"],
    title: "cui_Control and cui_WindowSection items among others",
    exercises:
      "build.xsl groups G12a and G12b: the cui_Control adds, then the cui_WindowSection adds, come right after the Report group and before the Form (the plan printed in the log reads List, Variable, Report, the two controls, the two window sections, Form), where 14.0.7 imported them at the end sorted by type, after the Form. The files are in an order that differs from the import order. The window sections read a stock cui_Location (ItemView) and nothing else non-scratch; the controls are root ToolbarControls, because the server refuses a tab control without a tab container.",
    rules: ["IMP-021", "IMP-022", "IMP-029"],
    steps: [step("import", one(cuiOrder()), "success")],
  },
  {
    id: "delayed-duplicate",
    engines: ["14.35"],
    catalogue: ["14.35", "delayed"],
    title: "The same delayed entry from two files",
    exercises:
      "AddDelayedAmlItem drops an entry equal to a queued one: an Identity with a Member to an Identity that a later file adds is in two files, and with merge on the second is an edit, so the check queues the same entry twice and 14.35 keeps one (14.0.7 ran both).",
    rules: ["IMP-251"],
    steps: [step("import", one(delayedDuplicate()), "success", { merge: true })],
  },
  {
    id: "delayed-property-where",
    engines: ["14.35"],
    catalogue: ["14.35", "delayed"],
    title: "A Property with no id but a where, whose data_source resolves later",
    exercises:
      "The delayed edit of a Property is addressed by the Property's own where when it has no id (14.0.7 wrote id=''). The where is scoped to the scratch ItemType and the property name, so the edit can touch nothing else.",
    rules: ["IMP-220"],
    steps: [step("import", one(delayedPropertyWhere()), "success")],
  },

  // ---- Ticket 73: language selection (dev has only `en`) ----
  {
    id: "lang-unset",
    engines: ["14.35"],
    catalogue: ["14.35", "Languages unset"],
    title: "A package with en and de labels, Languages unset",
    exercises: "Languages is null: the constructor still scans the package (no Language request), nothing is deleted, and every label is sent.",
    rules: ["IMP-610", "IMP-635"],
    devLanguages: ["en"],
    steps: [step("import", one(langPackage(["en", "de"], { tag: "LangUnset" })), "success")],
  },
  {
    id: "lang-select-en",
    engines: ["14.35"],
    catalogue: ["14.35", "Languages one code"],
    title: "Languages = en over a package with en and de labels",
    exercises: "The skip set is de: the constructor checks that en is installed (one Language get), and each item is sent without its de labels.",
    rules: ["IMP-621", "IMP-630", "IMP-631"],
    devLanguages: ["en"],
    steps: [step("import", one(langPackage(["en", "de"], { tag: "LangEn" })), "success", { languages: ["en"] })],
  },
  {
    id: "lang-star-en-only",
    engines: ["14.35"],
    catalogue: ["14.35", "Languages *"],
    title: "Languages = * over a package that uses en only",
    exercises: "`*` is replaced by the languages the packages use (en), the installed check passes, and nothing is deleted.",
    rules: ["IMP-620", "IMP-621", "IMP-635"],
    devLanguages: ["en"],
    steps: [step("import", one(langPackage(["en"], { tag: "LangStarEn" })), "success", { languages: ["*"] })],
  },
  {
    id: "lang-not-installed",
    engines: ["14.35"],
    catalogue: ["14.35", "Languages not installed"],
    title: "Languages = xx, a code the server lacks",
    exercises:
      "ThrowIfNoSelectedLanguagesInDatabase: the Language get is sent twice (once for the check, once to write the message), and the constructor throws a CItemException naming xx. The host ends with that exception; no item is read.",
    rules: ["IMP-621", "IMP-622"],
    devLanguages: ["en"],
    steps: [step("import", one(langPackage(["en"], { tag: "LangXx" })), "refused", { languages: ["xx"] })],
  },
  {
    id: "lang-star-not-installed",
    engines: ["14.35"],
    catalogue: ["14.35", "Languages *", "Languages not installed"],
    title: "Languages = * over a package that uses a language the server lacks",
    exercises: "`*` expands to en and de, and the installed check refuses de.",
    rules: ["IMP-620", "IMP-621"],
    devLanguages: ["en"],
    steps: [step("import", one(langPackage(["en", "de"], { tag: "LangStarDe" })), "refused", { languages: ["*"] })],
  },
  {
    id: "lang-scan-stray-file",
    engines: ["14.35"],
    catalogue: ["14.35", "scan"],
    title: "A malformed file in the package folder, Languages unset",
    exercises:
      "The constructor scans every *.xml under the package folder, including the folder's own files that the import never reads: an AggregateException wrapping the XmlException ends the constructor, although 14.0.7 imports this package.",
    rules: ["IMP-610", "IMP-611", "IMP-612"],
    steps: [step("import", one(langPackage(["en"], { tag: "LangStray", extraFiles: [strayBrokenFile()] })), "refused")],
  },
  {
    id: "lang-apostrophe",
    engines: ["14.35"],
    catalogue: ["14.35", "bug"],
    title: "A used language code with an apostrophe",
    exercises: "The skip code goes into //node()[@xml:lang='…'] unescaped: the XPath is invalid and the package fails (IMP-633).",
    rules: ["IMP-633"],
    devLanguages: ["en"],
    steps: [step("import", one(langPackage(["en", "d'e"], { tag: "LangApos" })), "engine-failure", { languages: ["en"] })],
  },
  {
    id: "lang-on-item-element",
    engines: ["14.35"],
    catalogue: ["14.35", "bug"],
    title: "A skipped language on the Item element itself",
    exercises: "The selection also matches the root Item when it carries xml:lang of a skipped language, and removing it leaves an empty document (IMP-634).",
    rules: ["IMP-634"],
    devLanguages: ["en"],
    steps: [step("import", one(langOnItemElement()), "engine-failure", { languages: ["en"] })],
  },

  // ---- Ticket 73 with de and fr installed ----
  {
    id: "lang-select-de",
    engines: ["14.35"],
    catalogue: ["14.35", "Languages one code"],
    title: "Languages = de over a package with en, de and fr labels",
    exercises: "The skip set is en and fr (a selection only removes): each item is sent with its de labels only.",
    rules: ["IMP-621", "IMP-630", "IMP-631"],
    devLanguages: ["en", "de", "fr"],
    steps: [step("import", one(langPackage(["en", "de", "fr"], { tag: "LangDe" })), "success", { languages: ["de"] })],
  },
  {
    id: "lang-star-installed",
    engines: ["14.35"],
    catalogue: ["14.35", "Languages *"],
    title: "Languages = * over a package with en, de and fr labels",
    exercises: "`*` expands to de, en, fr (sorted by the host's culture); all are installed, so nothing is deleted.",
    rules: ["IMP-615", "IMP-620", "IMP-621", "IMP-635"],
    devLanguages: ["en", "de", "fr"],
    steps: [step("import", one(langPackage(["en", "de", "fr"], { tag: "LangStar" })), "success", { languages: ["*"] })],
  },
  {
    id: "lang-unset-installed",
    engines: ["14.35"],
    catalogue: ["14.35", "Languages unset"],
    title: "A package with en, de and fr labels, Languages unset, all installed",
    exercises: "Every label is sent, and the server stores the de and fr translations.",
    rules: ["IMP-635"],
    devLanguages: ["en", "de", "fr"],
    steps: [step("import", one(langPackage(["en", "de", "fr"], { tag: "LangAll" })), "success")],
  },
  {
    id: "lang-two-packages",
    engines: ["14.35"],
    catalogue: ["14.35", "Languages one code"],
    title: "Two packages cut with their own skip sets",
    exercises: "Languages = en, de over a package that uses en and de and one that uses en and fr: the first loses nothing, the second loses its fr labels (a package's skip set is its own used languages minus the selection).",
    rules: ["IMP-630"],
    devLanguages: ["en", "de", "fr"],
    steps: [
      step(
        "import",
        [langPackage(["en", "de"], { tag: "LangP1" }), langPackage(["en", "fr"], { tag: "LangP2" })],
        "success",
        { languages: ["en", "de"] },
      ),
    ],
  },
  {
    id: "lang-batch-select",
    engines: ["14.35"],
    catalogue: ["14.35", "Languages one code", "AML batch"],
    title: "Languages = de in AML batch mode",
    exercises: "The skipped labels are deleted before an item is queued, so the one <AML> holds de labels only.",
    rules: ["IMP-632"],
    devLanguages: ["en", "de", "fr"],
    steps: [step("import", one(langPackage(["en", "de", "fr"], { tag: "LangBatch" })), "success", { languages: ["de"], amlBatch: { maxSize: 2 } })],
  },

  // ---- Ticket 55: the AML batch mode ----
  {
    id: "batch-size-3",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "AML batch"],
    title: "Seven items in batches of three",
    exercises: "Items without Relationships are queued and sent in one <AML> when the queue holds three: seven items go out as three requests of 3, 3 and 1 items (the last by the forced flush after the final item), each followed by the registration of its items.",
    rules: ["IMP-511", "IMP-513"],
    steps: [step("import", one(batchGood()), "success", batch(3))],
  },
  {
    id: "batch-size-unset",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "AML batch"],
    title: "AML batch mode with AmlBatchMaxSize left at 0",
    exercises:
      "A maximum of 0 flushes after every item: one <AML> request per item, and then, because the last item was already sent by its own flush, the forced flush after the package sends an empty <AML></AML> (IMP-515). Aras accepts it and answers an empty Result, the answer ticket 55 left open.",
    rules: ["IMP-511", "IMP-515"],
    steps: [step("import", one(batchGood("BatchZero", "LIBSJS-SCRATCH-BATCHZERO")), "success", batch(0))],
  },
  {
    id: "batch-merge-reimport",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "AML batch"],
    title: "A batch re-imported with merge on",
    exercises: "The merge lookups of the items are sent at the flush, one group per item, before the <AML>; the existing adds are edits.",
    rules: ["IMP-512"],
    steps: [step("fresh import", one(batchGood("BatchMrg", "LIBSJS-SCRATCH-BATCHMRG")), "success", batch(3)), step("re-import, merge on", one(batchGood("BatchMrg", "LIBSJS-SCRATCH-BATCHMRG")), "success", { merge: true, ...batch(3) })],
  },
  {
    id: "batch-skip-existing",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "AML batch"],
    title: "A batch re-imported with merge off",
    exercises: "Existing items are skipped, and in batch mode a skipped item is not registered in the package definition (IMP-522).",
    rules: ["IMP-522"],
    steps: [step("fresh import", one(batchGood("BatchSkp", "LIBSJS-SCRATCH-BATCHSKP")), "success"), step("re-import, batch", one(batchGood("BatchSkp", "LIBSJS-SCRATCH-BATCHSKP")), "success", batch(3))],
  },
  {
    id: "batch-relationships",
    engines: ["14.35"],
    catalogue: ["S0", "14.35", "AML batch"],
    title: "Items with Relationships among items without",
    exercises: "An item with a Relationships child is imported alone after a forced flush of the queue (IMP-519).",
    rules: ["IMP-519"],
    steps: [step("import", one(mini()), "success", batch(4))],
  },
  {
    id: "batch-server-failure",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "AML batch"],
    title: "A batch the server refuses at the fourth item",
    exercises:
      "The <AML> of seven items fails on the server (the fourth repeats the first's name) and the server applies none of it (the first three items are then added without complaint, one by one); the fourth fails alone and ends the package, and the items after it are neither checked nor sent (IMP-517).",
    rules: ["IMP-516", "IMP-517", "IMP-523"],
    steps: [step("import", one(batchServerFailure()), "engine-failure", batch(10))],
  },
  {
    id: "batch-check-fails",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "AML batch"],
    title: "The fourth item fails the engine's own check in batch mode",
    exercises: "A failed check flushes the queue (the three waiting items go out in one <AML> and are registered), restores the item and checks it again; the second failure ends the package (IMP-518), and an empty <AML></AML> is sent too (IMP-515).",
    rules: ["IMP-518"],
    steps: [step("import", one(batchBadCheck()), "engine-failure", batch(3))],
  },
  {
    id: "batch-fatal-reltype",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "AML batch"],
    title: "A RelationshipType whose source ItemType does not exist, in batch mode",
    exercises: "The fatal check of IMP-160 in batch mode: the queued items are sent by the forced flush of IMP-518, then the package fails.",
    rules: ["IMP-518"],
    steps: [step("import", one(batchFatalRelType()), "engine-failure", batch(3))],
  },
  {
    id: "batch-cancel",
    engines: ["14.35"],
    catalogue: ["S0", "14.35", "AML batch"],
    title: "Cancel pressed with items waiting in the batch queue",
    exercises: "The cancel test returns from the loop without flushing: the queued items are never sent (IMP-524) and the run returns 1.",
    rules: ["IMP-524"],
    steps: [step("import, cancelled", one(mini()), "engine-failure", { cancelAfterStatus: 4, ...batch(10) })],
  },
  {
    id: "batch-delete-missing",
    engines: ["14.35"],
    catalogue: ["S4", "14.35", "AML batch"],
    title: "A delete of an item that does not exist, in batch mode",
    exercises: "A delete is suitable for batching and goes into the <AML> (IMP-526); the server answers a delete of an unknown id without an error.",
    rules: ["IMP-526"],
    steps: [step("import", one(delMissing()), "success", batch(3))],
  },

  // ---- Ticket 55: collected errors ----
  {
    id: "collect-server-failure",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "collected errors"],
    title: "One item the server refuses, errors collected up to 5",
    exercises:
      "The failure of the fourth item is collected (an error message, the log block), the loop goes on and the last three items are imported; the failed add is registered in the package definition (IMP-544); the package ends failed and the run returns the count, 1.",
    rules: ["IMP-541", "IMP-542", "IMP-544", "IMP-545", "IMP-546"],
    steps: [step("import", one(batchOneServerFailure("CollSrv", "LIBSJS-SCRATCH-COLLSRV")), "returned:1", collect(5))],
  },
  {
    id: "collect-max-unset",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "collected errors"],
    title: "Collected errors with the maximum left at 0",
    exercises: "A maximum of 0 trips on the first error: the AggregateException ends the package at once, before the failed item is registered, and the last items are never read.",
    rules: ["IMP-541", "IMP-544"],
    steps: [step("import", one(batchOneServerFailure("CollZero", "LIBSJS-SCRATCH-COLLZERO")), "returned:1", collect(0))],
  },
  {
    id: "collect-two-errors-max3",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "collected errors"],
    title: "Two failing items, maximum 3",
    exercises: "Both errors are collected and the rest of the package is imported; the run returns 2.",
    rules: ["IMP-541", "IMP-546"],
    steps: [step("import", one(batchTwoServerFailures()), "returned:2", collect(3))],
  },
  {
    id: "collect-two-errors-max2",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "collected errors"],
    title: "Two failing items, maximum 2",
    exercises: "The second error reaches the maximum (the test is >=) and ends the package; the items after the second failure are never read.",
    rules: ["IMP-541"],
    steps: [step("import", one(batchTwoServerFailures()), "returned:2", collect(2))],
  },
  {
    id: "collect-two-packages",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "collected errors"],
    title: "A failing package followed by a good one",
    exercises: "A package that collected an error ends failed, and the next package starts (IMP-545); the run reports the one error and returns 1.",
    rules: ["IMP-545", "IMP-546"],
    steps: [
      step("import", [batchOneServerFailure("CollPkgA", "LIBSJS-SCRATCH-COLLPKGA"), batchGood("CollPkgB", "LIBSJS-SCRATCH-COLLPKGB")], "returned:1", collect(5)),
    ],
  },
  {
    id: "collect-bad-check",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "collected errors"],
    title: "An item whose reference check fails",
    exercises:
      "The failed check is collected and the item is sent anyway (IMP-543); the server then refuses the item's Relationships, a second collected error, so the run returns 2.",
    rules: ["IMP-542", "IMP-543"],
    steps: [step("import", one(batchBadCheck()), "returned:2", collect(5))],
  },
  {
    id: "collect-cancel",
    engines: ["14.35"],
    catalogue: ["S0", "14.35", "collected errors"],
    title: "Cancel with collection on and nothing collected",
    exercises: "The cancel becomes an aggregate that is reported as an error, but the count is 0, so the run returns 0 (IMP-547).",
    rules: ["IMP-545", "IMP-547"],
    steps: [step("import, cancelled", one(mini()), "success", { cancelAfterStatus: 4, ...collect(5) })],
  },
  {
    id: "batch-collect-fallback",
    engines: ["14.35"],
    catalogue: ["S9", "14.35", "AML batch", "collected errors"],
    title: "A refused batch with collection on",
    exercises: "The fallback's failure at the fourth item is collected and the package ends with the items after it dropped (IMP-517, IMP-551).",
    rules: ["IMP-517", "IMP-551"],
    steps: [step("import", one(batchServerFailure()), "returned:1", { ...batch(10), ...collect(5) })],
  },
];
