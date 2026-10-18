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
  fsOdd,
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
}

/** What a step is expected to end with, so a recording that drifts is refused. */
export type StepOutcome =
  /** `ImportSolutions` returned 0. */
  | "success"
  /** `ImportSolutions` returned 1: the engine logged the error and gave up. */
  | "engine-failure";

export interface ImportStep {
  name: string;
  /** The manifest of this step, in this order. */
  packages: ScratchPackage[];
  /** Hand the engine only these packages, in this order (default: every package in the manifest, in manifest order). */
  only?: string[];
  options?: ImportOptions;
  expect: StepOutcome;
}

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
}

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
    steps: [step("import, cancelled", one(mini()), "success", { cancelAfterStatus: 4 })],
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
    exercises: "build.xsl selects mp_* items with any action in 14.x (12.0 drops this one), so the engine sends it; the policy does not exist, so the server's answer ends the package.",
    steps: [step("import", one(delPromote()), "engine-failure")],
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
];
