import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { SolutionUpgradeContext } from "../export/export-context.js";
import { ImportExportManager } from "../export/import-export-manager.js";
import { createMessagesFactory } from "../export/messages.js";
import { SUImportContext } from "./import-context.js";

/**
 * The scenarios `b01` to `b16` (AML batch mode) and `c01` to `c12` (collected errors) of `fixtures/import-run/probe-14.35-batch.txt`,
 * run through the port. The probe ran the real 14.35 engine against a stub connection that answers from a small model of the
 * server (`fixtures/import-run/probe/probe.ps1`, `Model-Respond`); this file is that model and those scenarios in TypeScript. For
 * each one the port must send the same requests, send the same messages, write the same console text and the same log, and return
 * the same code as the recording (IMP-500 to IMP-551). The recorded dev runs (`import-run.replay.test.ts`) cover what a real server
 * answers; these cover the failure, cancel and edge paths that the dev runs do not reach.
 */

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const PROBE = new URL("../../fixtures/import-run/probe-14.35-batch.txt", import.meta.url).pathname;
const NOW = new Date(2026, 9, 19, 1, 2, 3);
/** The name the audit rows carry. The probe scrubbed its own user's to `<USERNAME>`, which would not parse as the text of an element. */
const OS_USER = "PROBE-OS-USER";

// ---------------------------------------------------------------------------------------------------------------------------
// The model of the server: `Model-Respond` of probe.ps1.
// ---------------------------------------------------------------------------------------------------------------------------

type Rule = (wire: string, count: number) => string | undefined;

interface World {
  /** The scenario's overrides, tried first. */
  rules: Rule[];
  /** The PackageDefinition names the server lists (`getSolutions`). */
  packages: { name: string; deps?: string[] }[];
  du: Map<string, { id: string; locked: boolean }>;
  duSequence: number;
  pkgdefs: Map<string, string>;
  groups: Map<string, string>;
  elements: Map<string, { source: string; type: string }>;
  /** Ids of items that exist (`ItemExistById`, `DoesItemAlreadyExist`). */
  existing: Set<string>;
  versionable: Set<string>;
  labels: Map<string, string>;
  deps: Map<string, string>;
}

function newWorld(): World {
  return {
    rules: [],
    packages: [],
    du: new Map(),
    duSequence: 0,
    pkgdefs: new Map(),
    groups: new Map(),
    elements: new Map(),
    existing: new Set(),
    versionable: new Set(),
    labels: new Map(),
    deps: new Map(),
  };
}

/** The attribute of the root `Item` of a request, or null. */
const attributeOfRoot = (wire: string, name: string): string | null => new RegExp(`^<Item[^>]*?\\b${name}="([^"]*)"`).exec(wire)?.[1] ?? null;
/** The text of the first child element of that name in a request, or null. */
const childOf = (wire: string, name: string): string | null => new RegExp(`<${name}>([^<]*)</${name}>`).exec(wire)?.[1] ?? null;

/** PowerShell's `-like` with `*` only: the whole text matches, letters compare without case. */
function like(wire: string, pattern: string): boolean {
  const regex = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\S]*");
  return new RegExp(`^${regex}$`, "i").test(wire);
}

function modelRespond(world: World, wire: string): string {
  const type = attributeOfRoot(wire, "type");
  const action = attributeOfRoot(wire, "action");
  if (wire.includes('select="name,generation"')) {
    if (world.packages.length === 0) return stubFault("0", "No items of type PackageDefinition found.");
    let inner = "";
    for (const pkg of world.packages) {
      inner += `<Item type="PackageDefinition" id="PD-${pkg.name}"><name>${pkg.name}</name>`;
      if (pkg.deps !== undefined) {
        inner += "<Relationships>";
        for (const dependency of pkg.deps) inner += `<Item type="PackageDependsOn"><name>${dependency}</name></Item>`;
        inner += "</Relationships>";
      }
      inner += "</Item>";
    }
    return stubResult(inner);
  }
  if (type === "PackageDefinition") {
    const name = childOf(wire, "name") ?? "";
    if (action === "get") {
      const id = world.pkgdefs.get(name);
      if (id !== undefined) return stubResult(`<Item type="PackageDefinition" id="${id}"><id>${id}</id><name>${name}</name></Item>`);
      return stubFault("0", "No items of type PackageDefinition found.");
    }
    if (action === "add") {
      const id = `PD-${name}`;
      world.pkgdefs.set(name, id);
      return stubResult(`<Item type="PackageDefinition" id="${id}"><id>${id}</id><name>${name}</name></Item>`);
    }
  }
  if (type === "DatabaseUpgrade") {
    if (wire.includes('select="locked_by_id"')) {
      const id = childOf(wire, "id") ?? "";
      const locked = [...world.du.values()].some((row) => row.id === id && row.locked);
      if (locked) return stubResult(`<Item type="DatabaseUpgrade" id="${id}"><id>${id}</id><locked_by_id keyed_name="admin">U1</locked_by_id></Item>`);
      return stubResult(`<Item type="DatabaseUpgrade" id="${id}"><id>${id}</id><locked_by_id/></Item>`);
    }
    if (action === "get") {
      const name = childOf(wire, "name") ?? "";
      const row = world.du.get(name);
      if (row !== undefined) return stubResult(`<Item type="DatabaseUpgrade" id="${row.id}"><name>${name}</name></Item>`);
      return stubFault("0", "No items of type DatabaseUpgrade found.");
    }
    if (action === "add") {
      world.duSequence += 1;
      const name = childOf(wire, "name") ?? "";
      const id = `DU${world.duSequence}`;
      world.du.set(name, { id, locked: false });
      return stubResult(`<Item type="DatabaseUpgrade" id="${id}"/>`);
    }
    if (action === "unlock" || action === "edit") return stubResult(`<Item type="DatabaseUpgrade" id="${attributeOfRoot(wire, "id")}"/>`);
  }
  if (type === "PackageDependsOn") {
    const name = childOf(wire, "name") ?? "";
    const key = `${childOf(wire, "source_id")}/${name}`;
    if (action === "get") {
      const id = world.deps.get(key);
      if (id !== undefined) return stubResult(`<Item type="PackageDependsOn" id="${id}"/>`);
      return stubFault("0", "No items of type PackageDependsOn found.");
    }
    if (action === "add") {
      world.deps.set(key, `DEP-${name}`);
      return stubResult(`<Item type="PackageDependsOn" id="DEP-${name}"/>`);
    }
  }
  if (type === "PackageReferencedElement") {
    if (action === "get") return stubFault("0", "No items of type PackageReferencedElement found.");
    if (action === "add") return stubResult('<Item type="PackageReferencedElement" id="PRE1"/>');
  }
  if (type === "PackageGroup") {
    const name = childOf(wire, "name") ?? "";
    if (action === "get") {
      const id = world.groups.get(name);
      if (id !== undefined) return stubResult(`<Item type="PackageGroup" id="${id}"/>`);
      return stubFault("0", "No items of type PackageGroup found.");
    }
    if (action === "add") {
      world.groups.set(name, `PG-${name}`);
      return stubResult(`<Item type="PackageGroup" id="PG-${name}"/>`);
    }
  }
  if (type === "PackageElement") {
    if (action === "get") {
      const element = world.elements.get(childOf(wire, "element_id") ?? "");
      if (element !== undefined) {
        return stubResult(`<Item type="PackageElement" id="PE1"><source_id>${element.source}</source_id><element_type>${element.type}</element_type></Item>`);
      }
      return stubFault("0", "No items of type PackageElement found.");
    }
    if (action === "add") return stubResult('<Item type="PackageElement" id="PE-new"/>');
  }
  if (type === "ItemType" && wire.includes('select="label"')) {
    const name = childOf(wire, "name") ?? "";
    const label = world.labels.get(name);
    if (label !== undefined) {
      return stubResult(`<Item type="ItemType" id="IT"><i18n:label xmlns:i18n="http://www.aras.com/I18N" xml:lang="en">${label}</i18n:label></Item>`);
    }
    return stubResult('<Item type="ItemType" id="IT"><name>x</name></Item>');
  }
  if (type === "ItemType" && wire.includes('select="is_versionable"')) {
    const name = childOf(wire, "name") ?? "";
    return stubResult(`<Item type="ItemType" id="IT"><is_versionable>${world.versionable.has(name) ? "1" : "0"}</is_versionable></Item>`);
  }
  if (wire.includes('select="config_id"')) {
    const id = childOf(wire, "id");
    return stubResult(`<Item type="${type}" id="${id}"><config_id>CFG-${id}</config_id></Item>`);
  }
  if (action === "get") {
    const id = childOf(wire, "id");
    if (id !== null && id !== "") {
      if (world.existing.has(id)) return stubResult(`<Item type="${type}" id="${id}"><id>${id}</id></Item>`);
      return stubFault("0", `No items of type ${type} found.`);
    }
  }
  return stubResult(`<Item type="${type}" id="GEN"/>`);
}

/** `Fault-On`: answers a request that matches the pattern with a fault, always or for the first `times` requests that match. */
function faultOn(pattern: string, code: number, text: string, times = 0): Rule {
  let left = times;
  return (wire) => {
    if (!like(wire, pattern)) return undefined;
    if (times > 0) {
      if (left <= 0) return undefined;
      left -= 1;
    }
    return stubFault(String(code), text);
  };
}

const ALL_RELATIONSHIPS =
  '<Relationships><Item type="RelationshipType" id="RT1"><name>Part BOM</name></Item><Item type="RelationshipType" id="RT2"><name>Property</name></Item>' +
  '<Item type="RelationshipType" id="RT3"><name>DiscussionTemplate</name></Item><Item type="RelationshipType" id="RT4"><name>FeedTemplate</name></Item>' +
  '<Item type="RelationshipType" id="RT5"><name>Relationship View</name></Item></Relationships>';

/** `Pad-Rule`: the definition of every ItemType carries the relationship types the checks look for. */
function padRule(world: World): void {
  const definition: Rule = (wire) =>
    like(wire, '<Item type="ItemType" action="get" select="id"><name>*</name><Relationships><Item type="Property" action="get" select="name" /><Item type="RelationshipType"*')
      ? stubResult(`<Item type="ItemType" id="IT-def">${ALL_RELATIONSHIPS}</Item>`)
      : undefined;
  world.rules = [definition, ...world.rules];
}

// ---------------------------------------------------------------------------------------------------------------------------
// The scenarios.
// ---------------------------------------------------------------------------------------------------------------------------

interface PackageFiles {
  files: { dir: string; name: string; xml: string }[];
}

interface Scenario {
  name: string;
  packages: Record<string, PackageFiles>;
  list: string[];
  world: World;
  merge?: boolean;
  batch?: boolean;
  batchMax?: number;
  collect?: boolean;
  collectMax?: number;
  again?: boolean;
  /** Called with each request before it is answered; true cancels the run, as the probe's `cancelOn`. */
  cancelOn?: (wire: string) => boolean;
}

const A = "LIBSJS-SCRATCH-A";
const B = "LIBSJS-SCRATCH-B";
const C = "LIBSJS-SCRATCH-C";
const file = (dir: string, name: string, xml: string) => ({ dir, name, xml });
const itemXml = (type: string, id: string, action: string, name: string): string => `<Item type="${type}" id="${id}" action="${action}"><name>${name}</name></Item>`;
const L1 = "L0000000000000000000000000000001";
const L2 = "L0000000000000000000000000000002";
const M1 = "M0000000000000000000000000000001";
const M2 = "M0000000000000000000000000000002";
const l1 = file("List", "Colors", itemXml("List", L1, "add", "LIBSJS-SCRATCH-Colors"));
const m1 = file("Method", "DoIt", itemXml("Method", M1, "add", "LIBSJS-SCRATCH-DoIt"));
const l2 = file("List", "Colors2", itemXml("List", L2, "add", "LIBSJS-SCRATCH-Colors2"));
const m2 = file("Method", "DoIt2", itemXml("Method", M2, "add", "LIBSJS-SCRATCH-DoIt2"));
const e1 = file("Method", "Edit1", itemXml("Method", "M0000000000000000000000000000003", "edit", "LIBSJS-SCRATCH-Edit1"));
const gone = file("View", "Gone", '<Item type="View" id="V0000000000000000000000000000009" action="delete"/>');
const part = (id: string, name: string, relationships: string) =>
  file("Part", `pt${name}`, `<Item type="Part" id="${id}" action="add"><name>${name}</name>${relationships}</Item>`);
const bom =
  '<Relationships><Item type="Part BOM" id="B0000000000000000000000000000001" action="add"><related_id keyed_name="k" type="Part">R0000000000000000000000000000001</related_id></Item></Relationships>';
const missingBom =
  '<Relationships><Item type="Part BOM" id="B0000000000000000000000000000001" action="add"><related_id keyed_name="k" type="Part">MISSING-PART</related_id></Item></Relationships>';
const P1 = "P0000000000000000000000000000001";
const P2 = "P0000000000000000000000000000002";
const prop = file(
  "Property",
  "pr1",
  '<Item type="Property" id="Y0000000000000000000000000000001" action="edit"><name>p1</name><data_type>list</data_type><data_source keyed_name="LST" type="List">LID1</data_source></Item>',
);

const mBoom = `<Item type="Method" id="${M1}" action="add"*`;
const lBoom2 = `<Item type="List" id="${L2}" action="add"*`;
const methodDefinition = '<Item type="ItemType" action="get" select="id"><name>Method</name>*';
const listDefinition = '<Item type="ItemType" action="get" select="id"><name>List</name>*';

/** A world of the package list `names`, with the rules the scenario adds. */
function world(names: string[], ...rules: Rule[]): World {
  const w = newWorld();
  w.packages = names.map((name) => ({ name }));
  w.rules.push(...rules);
  return w;
}

const filesOf = (...files: PackageFiles["files"]): PackageFiles => ({ files });

function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  const add = (scenario: Scenario): void => void out.push(scenario);
  const batch = { batch: true } as const;

  for (const max of [3, 2]) {
    add({ name: `b01-batch-size-${max}`, packages: { [A]: filesOf(l1, m1, l2) }, list: [A], world: world([A]), ...batch, batchMax: max });
  }
  add({ name: "b02-batch-size-unset", packages: { [A]: filesOf(l1, m1) }, list: [A], world: world([A]), ...batch });
  add({ name: "b02b-batch-size-one", packages: { [A]: filesOf(l1, m1) }, list: [A], world: world([A]), ...batch, batchMax: 1 });
  add({ name: "b02c-batch-size-negative", packages: { [A]: filesOf(l1, m1) }, list: [A], world: world([A]), ...batch, batchMax: -5 });
  add({
    name: "b03-batch-no-items",
    packages: { [A]: filesOf(file("Empty", "None", "<NoItem/>")) },
    list: [A],
    world: world([A]),
    ...batch,
    batchMax: 5,
  });
  add({
    name: "b04-batch-fails-fallback",
    packages: { [A]: filesOf(l1, l2, m1) },
    list: [A],
    world: world([A], faultOn("<AML>*", 5, "batch refused", 1)),
    ...batch,
    batchMax: 5,
  });
  add({
    name: "b05-fallback-item-fails",
    packages: { [A]: filesOf(l1, l2, m1) },
    list: [A],
    world: world([A], faultOn("<AML>*", 5, "batch refused", 1), faultOn(lBoom2, 6, "second list refused")),
    ...batch,
    batchMax: 5,
  });
  add({
    name: "b06-check-fails-once",
    packages: { [A]: filesOf(l1, l2, m1) },
    list: [A],
    world: world([A], faultOn(methodDefinition, 5, "check refused", 1)),
    ...batch,
    batchMax: 5,
  });
  add({
    name: "b06b-check-fails-always",
    packages: { [A]: filesOf(l1, l2, m1) },
    list: [A],
    world: world([A], faultOn(methodDefinition, 5, "check refused")),
    ...batch,
    batchMax: 5,
  });
  const existingList = world([A]);
  existingList.existing.add(L1);
  add({ name: "b07-skip-existing", packages: { [A]: filesOf(l1, m1) }, list: [A], world: existingList, ...batch, batchMax: 5 });
  const merged = world([A]);
  merged.existing.add(L1);
  add({ name: "b08-merge", packages: { [A]: filesOf(l1, m1) }, list: [A], world: merged, merge: true, ...batch, batchMax: 5 });

  const withBom = (...rules: Rule[]): World => {
    const w = world([A], ...rules);
    padRule(w);
    w.existing.add("R0000000000000000000000000000001");
    return w;
  };
  const p1 = part(P1, "one", bom);
  const p2 = part(P2, "two", "");
  add({ name: "b09-relationships-item", packages: { [A]: filesOf(l1, m1, p1, p2) }, list: [A], world: withBom(), ...batch, batchMax: 10 });
  add({
    name: "b09b-relationships-item-batch-fails",
    packages: { [A]: filesOf(l1, m1, p1, p2) },
    list: [A],
    world: withBom(faultOn("<AML>*", 5, "batch refused", 1)),
    ...batch,
    batchMax: 10,
  });
  const plainProperty = world([A]);
  padRule(plainProperty);
  plainProperty.rules.push(faultOn('<Item action="get" type="list" select="id"><id>LID1</id></Item>', 0, "No items of type list found."));
  add({ name: "b10-delayed-plain-item", packages: { [A]: filesOf(prop) }, list: [A], world: plainProperty, merge: true, ...batch, batchMax: 5 });
  const delayedPart = part(P1, "one", missingBom);
  const delayedOk = world([A]);
  padRule(delayedOk);
  add({ name: "b10b-delayed-unbatched-item-ok", packages: { [A]: filesOf(delayedPart, l1, m1) }, list: [A], world: delayedOk, merge: true, ...batch, batchMax: 10 });
  add({
    name: "b10c-delayed-unbatched-item",
    packages: { [A]: filesOf(l1, m1, delayedPart) },
    list: [A],
    world: withBom(faultOn("<AML>*", 5, "batch refused", 1)),
    merge: true,
    ...batch,
    batchMax: 10,
  });
  add({
    name: "b11-cancel-with-queue",
    packages: { [A]: filesOf(l1, l2, m1, m2), [B]: filesOf(l1) },
    list: [A, B],
    world: world([A, B]),
    ...batch,
    batchMax: 10,
    cancelOn: (wire) => wire === `<Item type="Method" action="get" select="id"><id>${M1}</id></Item>`,
  });
  add({ name: "b12-edit-delete", packages: { [A]: filesOf(l1, e1, gone) }, list: [A], world: world([A]), ...batch, batchMax: 10 });
  add({
    name: "b12b-delete-retry-in-fallback",
    packages: { [A]: filesOf(l1, gone) },
    list: [A],
    world: world(
      [A],
      faultOn("<AML>*", 5, "batch refused", 1),
      faultOn('<Item type="View" id="V0000000000000000000000000000009" action="delete"*', 5, "delete refused", 1),
    ),
    ...batch,
    batchMax: 10,
  });
  const stale = world([A]);
  stale.versionable.add("Part");
  stale.existing.add(P1);
  let currentIds = 0;
  stale.rules.push(
    faultOn("<AML>*", 5, "batch refused", 1),
    (wire) => {
      if (like(wire, '*select="config_id, is_current"*')) {
        return stubResult(`<Item type="Part" id="${P1}"><config_id>CFGP1</config_id><is_current>0</is_current></Item>`);
      }
      if (like(wire, "*<config_id>CFGP1</config_id>*")) {
        currentIds += 1;
        return stubResult(`<Item type="Part" id="PCUR${currentIds}"><id>PCUR${currentIds}</id></Item>`);
      }
      return undefined;
    },
  );
  add({ name: "b13-stale-item-node", packages: { [A]: filesOf(part(P1, "one", "")) }, list: [A], world: stale, merge: true, ...batch, batchMax: 5 });
  add({
    name: "b14-post-fails-after-apply",
    packages: { [A]: filesOf(l1, m1) },
    list: [A],
    world: world([A], faultOn('<Item type="PackageElement" action="add"*', 7, "element refused", 1)),
    ...batch,
    batchMax: 5,
  });
  add({
    name: "b15-check-fails-empty-queue",
    packages: { [A]: filesOf(l1, m1) },
    list: [A],
    world: world([A], faultOn(listDefinition, 5, "check refused", 1)),
    ...batch,
    batchMax: 5,
  });

  const recovery = world([A]);
  padRule(recovery);
  recovery.rules.unshift(faultOn('<Item type="ItemType" action="get" select="id"><name>Part</name>*', 5, "check refused", 1));
  add({
    name: "b16-check-recovery-queue",
    packages: { [A]: filesOf(part(P1, "one", missingBom), l1) },
    list: [A],
    world: recovery,
    merge: true,
    ...batch,
    batchMax: 10,
  });

  // collected errors
  const collect = { collect: true } as const;
  const rowOf = (...rules: Rule[]) => world([A], ...rules);
  add({ name: "c01-collect-basic", packages: { [A]: filesOf(l1, m1, m2) }, list: [A], world: rowOf(faultOn(mBoom, 5, "method refused")), ...collect, collectMax: 5 });
  add({ name: "c02-collect-max-unset", packages: { [A]: filesOf(l1, m1, m2) }, list: [A], world: rowOf(faultOn(mBoom, 5, "method refused")), ...collect });
  add({ name: "c02b-collect-max-one", packages: { [A]: filesOf(l1, m1, m2) }, list: [A], world: rowOf(faultOn(mBoom, 5, "method refused")), ...collect, collectMax: 1 });
  const anyMethodAdd = '<Item type="Method"*action="add"*';
  add({ name: "c03-collect-two-errors-max3", packages: { [A]: filesOf(l1, m1, m2) }, list: [A], world: rowOf(faultOn(anyMethodAdd, 5, "method refused")), ...collect, collectMax: 3 });
  add({ name: "c03b-collect-two-errors-max2", packages: { [A]: filesOf(l1, m1, m2) }, list: [A], world: rowOf(faultOn(anyMethodAdd, 5, "method refused")), ...collect, collectMax: 2 });
  add({
    name: "c04-collect-two-packages",
    packages: { [A]: filesOf(l1, m1), [B]: filesOf(l1), [C]: filesOf(l1) },
    list: [A, B, C],
    world: world([A, B, C], faultOn(mBoom, 5, "method refused", 1)),
    ...collect,
    collectMax: 5,
  });
  add({
    name: "c04b-collect-three-packages-fail",
    packages: { [A]: filesOf(l1, m1), [B]: filesOf(m1), [C]: filesOf(m1) },
    list: [A, B, C],
    world: world([A, B, C], faultOn(anyMethodAdd, 5, "method refused")),
    ...collect,
    collectMax: 2,
  });
  add({ name: "c05-collect-no-errors", packages: { [A]: filesOf(l1, m1) }, list: [A], world: world([A]), ...collect, collectMax: 5 });
  add({ name: "c06-collect-check-fails", packages: { [A]: filesOf(l1, m1) }, list: [A], world: rowOf(faultOn(methodDefinition, 5, "check refused", 1)), ...collect, collectMax: 5 });
  add({
    name: "c07-collect-post-fails",
    packages: { [A]: filesOf(l1, m1, m2) },
    list: [A],
    world: rowOf((wire) => (like(wire, '<Item type="PackageElement" action="add"*') && wire.includes(M1) ? stubFault("7", "element refused") : undefined)),
    ...collect,
    collectMax: 5,
  });
  add({
    name: "c08-collect-delayed-fails",
    packages: { [A]: filesOf(l1, part(P1, "one", missingBom)) },
    list: [A],
    world: withBom(faultOn(`<Item type="Part" id="${P1}" action="edit"*`, 5, "delayed refused")),
    merge: true,
    ...collect,
    collectMax: 5,
  });
  add({
    name: "c09-collect-cancel-no-error",
    packages: { [A]: filesOf(l1, m1), [B]: filesOf(l1) },
    list: [A, B],
    world: world([A, B]),
    ...collect,
    collectMax: 5,
    cancelOn: (wire) => like(wire, `<Item type="List" id="${L1}" action="add"*`),
  });
  add({
    name: "c09b-collect-cancel-after-error",
    packages: { [A]: filesOf(l1, m1, m2), [B]: filesOf(l1) },
    list: [A, B],
    world: world([A, B], faultOn(mBoom, 5, "method refused")),
    ...collect,
    collectMax: 5,
    cancelOn: (wire) => like(wire, `<Item type="Method" id="${M2}" action="add"*`),
  });
  add({
    name: "c10-collect-row-write-fails",
    packages: { [A]: filesOf(l1) },
    list: [A],
    world: rowOf(faultOn('*<Item type="DatabaseUpgrade" action="add"*', 7, "cannot add", 1)),
    ...collect,
    collectMax: 5,
  });
  add({
    name: "c10b-collect-failed-row-write-fails",
    packages: { [A]: filesOf(l1, m1) },
    list: [A],
    world: rowOf(faultOn(mBoom, 5, "method refused"), faultOn("*upgrade_status>2*", 9, "release write refused")),
    ...collect,
    collectMax: 5,
  });
  add({ name: "c10c-collect-unknown-package", packages: { [A]: filesOf(l1) }, list: ["LIBSJS-SCRATCH-Nope"], world: world([A]), ...collect, collectMax: 5 });
  add({
    name: "c10d-collect-success-write-fails",
    packages: { [A]: filesOf(l1) },
    list: [A],
    world: rowOf(faultOn("*upgrade_status>1*", 9, "success write refused")),
    ...collect,
    collectMax: 5,
  });
  add({
    name: "c10e-collect-row-write-fails-second-package",
    packages: { [A]: filesOf(l1, m1), [B]: filesOf(l1) },
    list: [A, B],
    world: world([A, B], faultOn(mBoom, 5, "method refused", 1), faultOn("*<Item type=\"DatabaseUpgrade\" action=\"add\"*LIBSJS-SCRATCH-B*", 7, "cannot add", 1)),
    ...collect,
    collectMax: 9,
  });
  add({
    name: "c11-collect-twice",
    packages: { [A]: filesOf(l1, m1) },
    list: [A],
    world: rowOf(faultOn(mBoom, 5, "method refused")),
    ...collect,
    collectMax: 5,
    again: true,
  });
  add({
    name: "c12-collect-fallback-item-fails",
    packages: { [A]: filesOf(l1, l2, m1) },
    list: [A],
    world: world([A], faultOn("<AML>*", 5, "batch refused", 1), faultOn(lBoom2, 6, "second list refused")),
    ...batch,
    batchMax: 5,
    ...collect,
    collectMax: 5,
  });
  add({
    name: "c12b-collect-batch-check-always-fails",
    packages: { [A]: filesOf(l1, l2, m1) },
    list: [A],
    world: world([A], faultOn(methodDefinition, 5, "check refused")),
    ...batch,
    batchMax: 5,
    ...collect,
    collectMax: 5,
  });
  add({
    name: "c12c-collect-batch-always-refused",
    packages: { [A]: filesOf(l1, m1) },
    list: [A],
    world: world([A], faultOn("<AML>*", 5, "batch refused")),
    ...batch,
    batchMax: 5,
    ...collect,
    collectMax: 9,
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// One run, and its text in the form of the probe's report.
// ---------------------------------------------------------------------------------------------------------------------------

const escape = (text: string): string => text.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");

interface Report {
  result: string;
  result2: string | null;
  requests: string[];
  messages: string[];
  console: string;
  log: string;
  /** What the console wrote while the highlight of IMP-550 was on. */
  highlighted: string;
}

async function run(scenario: Scenario): Promise<Report> {
  const root = mkdtempSync(join(tmpdir(), "libsjs-batch-probe-"));
  roots.push(root);
  const manifest = Object.keys(scenario.packages)
    .map((name) => `<package name="${name}" path="${name}\\Import"></package>`)
    .join("");
  writeFileSync(join(root, "imports.mf"), `<imports>${manifest}</imports>`);
  for (const [name, pkg] of Object.entries(scenario.packages)) {
    for (const { dir, name: fileName, xml } of pkg.files) {
      const target = join(root, name, "Import", dir, `${fileName}.xml`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `<AML>${xml}</AML>`);
    }
  }
  const logPath = join(root, "engine.log");
  const context = new SolutionUpgradeContext();
  context.action = "Import";
  context.url = "http://stub/";
  context.dataBase = "db";
  context.userName = "admin";
  context.manifestFile = join(root, "imports.mf");
  context.workingDirectory = root;
  context.logFilePath = logPath;

  const importContext = new SUImportContext();
  importContext.merge = scenario.merge === true;
  importContext.release = "R1";
  importContext.description = "D1";
  if (scenario.batch === true) {
    importContext.amlBatchMode = true;
    if (scenario.batchMax !== undefined) importContext.amlBatchMaxSize = scenario.batchMax;
  }
  if (scenario.collect === true) {
    importContext.collectImportErrors = true;
    if (scenario.collectMax !== undefined) importContext.collectImportErrorsMaxCount = scenario.collectMax;
  }

  let manager: ImportExportManager | undefined;
  let count = 0;
  const connection = new StubConnection((wire) => {
    count += 1;
    if (scenario.cancelOn?.(wire) === true) manager?.cancel();
    for (const rule of scenario.world.rules) {
      const answer = rule(wire, count);
      if (answer !== undefined) return answer;
    }
    return modelRespond(scenario.world, wire);
  });
  const helper = new CItemHelper(connection, { engine: "14.35" });
  helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
  const sent: string[] = [];
  const messages = createMessagesFactory({ onMessage: ({ channel, text }) => void sent.push(`${channel} | ${text}`) });
  let console = "";
  let highlighted = "";
  let highlight = false;
  const write = (text: string): void => {
    console += text;
    if (highlight) highlighted += text;
  };
  manager = new ImportExportManager(context, messages, helper, {
    cwd: root,
    now: () => NOW,
    osUser: OS_USER,
    console: {
      write,
      writeLine: (text = "") => write(`${text}\r\n`),
      setHighlight: (on) => {
        highlight = on;
      },
    },
  });
  const result = await manager.importSolutions(scenario.list, importContext);
  const result2 = scenario.again === true ? await manager.importSolutions(scenario.list, importContext) : null;

  const log = readFileSync(logPath, "utf8")
    .split(root)
    .join("<ROOT>")
    // the paths of the engine's host have backslashes
    .replace(/<ROOT>[^'\r\n]*/g, (path) => path.replace(/\//g, "\\"))
    .replace(/\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d/g, "<DATETIME>")
    .replace(/\d\d:\d\d:\d\d\.\d{7}/g, "<TIME>")
    .replaceAll(OS_USER, "<USERNAME>");
  return {
    result: String(result),
    result2: result2 === null ? null : String(result2),
    requests: connection.requests.map((wire, index) => {
      const action = connection.actions[index];
      return `${index + 1} ${action === "ApplyItem" ? "" : `[${action}] `}${escape(wire).replaceAll(OS_USER, "<USERNAME>")}`;
    }),
    messages: sent.map((message) => escape(message).replaceAll(OS_USER, "<USERNAME>")),
    console: escape(console),
    log: escape(log),
    highlighted: escape(highlighted),
  };
}

/** The sections of `probe-14.35-batch.txt`, by scenario name. */
function recorded(): Map<string, Report> {
  const text = readFileSync(PROBE, "utf8");
  const reports = new Map<string, Report>();
  for (const block of text.split(/^=== /m).slice(1)) {
    const lines = block.split(/\r?\n/);
    const name = lines[0] ?? "";
    const report: Report = { result: "", result2: null, requests: [], messages: [], console: "", log: "", highlighted: "" };
    let section: "requests" | "messages" | null = null;
    for (const line of lines.slice(1)) {
      if (line.startsWith("RESULT: ")) report.result = line.slice("RESULT: ".length);
      else if (line.startsWith("RESULT-2: ")) report.result2 = line.slice("RESULT-2: ".length);
      else if (line === "REQUESTS:") section = "requests";
      else if (line === "MESSAGES:") section = "messages";
      else if (line.startsWith("CONSOLE: ")) {
        report.console = line.slice("CONSOLE: ".length);
        section = null;
      } else if (line.startsWith("LOG: ")) {
        report.log = line.slice("LOG: ".length);
        section = null;
      } else if (section === "requests" && line.startsWith("  ")) report.requests.push(line.slice(2));
      else if (section === "messages" && line.startsWith("  ")) report.messages.push(line.slice(2));
    }
    reports.set(name, report);
  }
  return reports;
}

const RECORDED = recorded();

describe("the probe scenarios of the AML batch mode and the collected errors (IMP-500 to IMP-551)", () => {
  const all = scenarios();

  it("covers every recorded scenario", () => {
    expect(all.map((scenario) => scenario.name).sort()).toEqual([...RECORDED.keys()].sort());
  });

  it("highlights the console lines of the items that come after the first collected error (IMP-550)", async () => {
    // a scenario holds the state of its server, so each run of it gets a fresh one
    const byName = (name: string): Scenario => scenarios().find((scenario) => scenario.name === name) as Scenario;
    // c01: the Method add fails, and the Method that follows is the only item read with an error behind it
    expect((await run(byName("c01-collect-basic"))).highlighted).toBe(".");
    // nothing is collected: nothing is highlighted
    expect((await run(byName("c05-collect-no-errors"))).highlighted).toBe("");
    // c04: A collects one error; B and C each read one item after it
    expect((await run(byName("c04-collect-two-packages"))).highlighted).toBe("..");
  });

  it.for(all.map((scenario) => [scenario.name, scenario] as const))("%s", async ([name, scenario]) => {
    const expected = RECORDED.get(name);
    expect(expected, `${name} is in the probe file`).toBeDefined();
    const actual = await run(scenario);
    expect(actual.requests, `${name}: the requests`).toEqual(expected?.requests);
    expect(actual.messages, `${name}: the messages`).toEqual(expected?.messages);
    expect(actual.result, `${name}: the result`).toBe(expected?.result);
    expect(actual.result2, `${name}: the second result`).toBe(expected?.result2);
    expect(actual.console, `${name}: the console`).toBe(expected?.console);
    expect(actual.log, `${name}: the log`).toBe(expected?.log);
  });
});
