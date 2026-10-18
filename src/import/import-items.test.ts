import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DotNetException } from "../client/dotnet.js";
import { CITEM_EXCEPTION_TYPE, CItemException, ResponseDocument } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubFault, stubResult } from "../client/stub-connection.js";
import { documentElementOf } from "../xml/dom.js";
import type { XmlDocument, XmlElement } from "../xml/dom.js";
import { XPathException, XmlException } from "../xml/errors.js";
import { loadXml } from "../xml/parser.js";
import { outerXml } from "../xml/writer-legacy.js";
import { ImportItems, type MergeHelper } from "./import-items.js";
import { ImportLookups } from "./import-lookups.js";

/**
 * Replays the merge probe of engine 14.0.7 (`fixtures/import-merge/14.0.7-probe/results.json`, IMP-300 to IMP-352). The probe ran
 * the engine's own `CImportItems` against a scriptable helper that records its calls, and the engine's own `CItemHelper`
 * against a stub connection. Each scenario below is the probe's, with the same script, run against the port: the calls to the
 * helper, the requests, the exception and the document afterwards must be the engine's. The wording of an `XmlException` or an
 * `XPathException` is the framework's and is not reproduced (IMP-304): only its kind and the text the engine adds are compared.
 */
interface ProbeThrown {
  type: string;
  faultcode?: number;
  faultstringIsStack?: boolean;
  faultstring?: string;
  faultdetail?: string;
  inner?: string;
  message: string;
}

interface ProbeCase {
  calls?: string[];
  requests?: string[];
  actions?: string[];
  result?: boolean | null;
  thrown?: ProbeThrown | null;
  documentAfter?: string;
  itemExistById?: boolean | null;
  itemExistByIdThrown?: ProbeThrown | null;
  existRel?: boolean | null;
  existRelThrown?: ProbeThrown | null;
}

const probe = JSON.parse(readFileSync(new URL("../../fixtures/import-merge/14.0.7-probe/results.json", import.meta.url), "utf8")) as {
  engine: string;
  scenarios: Record<string, Record<string, ProbeCase>>;
};

const expected = (group: string, name: string): ProbeCase => {
  const found = probe.scenarios[group]?.[name];
  if (!found) throw new Error(`the probe has no scenario ${group}/${name}`);
  return found;
};

/** What the probe wrote down about an exception. */
function describeThrown(error: unknown): ProbeThrown {
  if (error instanceof CItemException) {
    const cause = error.cause ?? undefined;
    return {
      type: CITEM_EXCEPTION_TYPE,
      faultcode: error.faultcode,
      faultstringIsStack: cause !== undefined,
      ...(cause === undefined ? { faultstring: error.faultstring ?? "" } : {}),
      faultdetail: error.faultdetail ?? "",
      ...(cause === undefined ? {} : { inner: describeThrown(cause).type }),
      message: error.message,
    };
  }
  if (error instanceof DotNetException) return { type: error.typeName, message: error.message };
  if (error instanceof XmlException) return { type: "System.Xml.XmlException", message: error.message };
  if (error instanceof XPathException) return { type: "System.Xml.XPath.XPathException", message: error.message };
  throw error;
}

const clip = (text: string): string => text.slice(0, 300);

/** The sentence the engine appends to the message of the exception it wraps (IMP-304). */
const wrapTail = (text: string): string => text.slice(text.indexOf(" Can't merge item "));

function expectThrown(actual: unknown, probed: ProbeThrown | null | undefined, label: string): void {
  if (probed === null || probed === undefined) {
    expect(actual, `${label}: nothing is thrown`).toBeNull();
    return;
  }
  expect(actual, `${label}: the engine threw ${probed.type}`).not.toBeNull();
  const thrown = describeThrown(actual);
  expect(thrown.type, label).toBe(probed.type);
  if (probed.type === CITEM_EXCEPTION_TYPE) {
    expect(thrown.faultcode, label).toBe(probed.faultcode);
    expect(thrown.faultstringIsStack, label).toBe(probed.faultstringIsStack);
    if (!probed.faultstringIsStack) expect(clip(thrown.faultstring ?? ""), label).toBe(probed.faultstring);
    expect(thrown.inner, label).toBe(probed.inner);
    if (probed.inner === "System.Xml.XmlException" || probed.inner === "System.Xml.XPath.XPathException") {
      // the framework's sentence is not reproduced; the item the engine names is
      expect(wrapTail(thrown.faultdetail ?? ""), label).toBe(wrapTail(probed.faultdetail ?? ""));
      expect(thrown.message, label).toBe(thrown.faultdetail);
    } else {
      expect(clip(thrown.faultdetail ?? ""), label).toBe(probed.faultdetail);
      expect(clip(thrown.message), label).toBe(probed.message);
    }
  } else if (probed.type === "System.NullReferenceException") {
    expect(thrown.message, label).toBe(probed.message);
  }
}

const caught = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return null;
};

/** PowerShell's `-like` with `*` only: case-insensitive. */
const like = (text: string, pattern: string): boolean =>
  new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "is").test(text);

const envelope = stubResult;

/** The probe's `StubHelper`: a scriptable `ICItemHelper` that records every call and answers from tables. */
class StubHelper implements MergeHelper {
  readonly calls: string[] = [];
  onApply: ((aml: string) => string | null) | undefined;
  readonly versionable = new Map<string, boolean>();
  readonly latestId = new Map<string, string>();
  readonly relExists = new Map<string, boolean>();
  readonly relFault = new Map<string, number>();
  unlockFault: number | undefined;

  async applyAML(aml: string): Promise<ResponseDocument> {
    this.calls.push(`applyAML ${aml}`);
    // IOM parses the AML before sending it, so malformed text fails with XmlException
    loadXml(aml, { preserveWhitespace: false });
    let answer = this.onApply?.(aml) ?? null;
    if (answer === null || answer === "") {
      answer = aml.includes("action='get'") || aml.includes('action="get"') ? "FAULT:0" : envelope("");
    }
    if (answer.startsWith("FAULT:")) {
      const code = Number(answer.slice(6));
      throw new CItemException(code, `fault ${code}`, `fault ${code}`, null);
    }
    return ResponseDocument.parse(answer);
  }

  async isVersionable(typeName: string): Promise<boolean> {
    this.calls.push(`IsVersionable ${typeName}`);
    return this.versionable.get(typeName) ?? false;
  }

  async setItemIdToLastGeneration(item: XmlElement): Promise<void> {
    const id = item.getAttributeNode("id")?.value ?? "";
    this.calls.push(`SetItemIdToLastGeneration ${item.getAttributeNode("type")?.value ?? ""}|${id}`);
    const next = this.latestId.get(id);
    if (next !== undefined) item.setAttribute("id", next);
  }

  async unlock(id: string, type: string): Promise<void> {
    this.calls.push(`Unlock ${id}|${type}`);
    if (this.unlockFault !== undefined) throw new CItemException(this.unlockFault, "unlock fault", "unlock fault", null);
  }

  async existRelItemInCurVer(type: string, sourceId: string, relatedId: string): Promise<boolean> {
    const key = `${type}|${sourceId}|${relatedId}`;
    this.calls.push(`ExistRelItemInCurVer ${key}`);
    const fault = this.relFault.get(key);
    if (fault !== undefined) throw new CItemException(fault, "rel fault", "rel fault", null);
    return this.relExists.get(key) ?? false;
  }
}

type Setup = (helper: StubHelper) => void;

interface ImportScenario {
  group: string;
  name: string;
  merge: boolean;
  xml: string;
  setup?: Setup;
}

const scenarios: ImportScenario[] = [];
const add = (group: string, name: string, xml: string, merge: boolean, setup?: Setup): void => {
  scenarios.push({ group, name, merge, xml, ...(setup ? { setup } : {}) });
};

const partVersionable: Setup = (h) => h.versionable.set("Part", true);
const answerGet = (inner: string): Setup => (h) => {
  h.onApply = (aml) => (aml.includes("action='get'") ? envelope(inner) : envelope(""));
};
const faultAll = (code: number): Setup => (h) => {
  h.onApply = () => `FAULT:${code}`;
};
const onGet = (pattern: string, answer: string): Setup => (h) => {
  h.onApply = (aml) => (like(aml, pattern) ? answer : envelope(""));
};

// V: the type / id / where validation (IMP-301 to IMP-304)
const V = "V.validation";
add(V, "nestedWithoutType", `<Item type='Part' id='A' action='add'><Relationships><Item action='add' id='B' /></Relationships></Item>`, false);
add(V, "rootWithoutType", `<Item id='A' action='add' />`, false);
add(V, "rootEmptyType", `<Item type='' id='A' action='add' />`, false);
add(V, "plainAddNoId", `<Item type='Part' action='add' />`, false);
add(V, "plainEditNoId", `<Item type='Part' action='edit' />`, false);
add(V, "plainEditNoIdWithActionChild", `<Item type='Part' action='edit'><action>edit</action></Item>`, false);
add(V, "plainNoActionNoId", `<Item type='Part' />`, false);
add(V, "plainDeleteNoId", `<Item type='Part' action='delete' />`, false);
add(V, "plainAddWhereOnly", `<Item type='Part' where="name='x'" action='add' />`, false);
add(V, "plainAddEmptyId", `<Item type='Part' id='' action='add' />`, false);
add(V, "nestedAddNoId", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add' /></Relationships></Item>`, false);
add(V, "nestedEditNoId", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='edit' /></Relationships></Item>`, false);
add(V, "versionableNestedAddNoId", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add' /></Relationships></Item>`, false, partVersionable);
add(V, "versionableNestedAddSourceMatches", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'><source_id>A</source_id></Item></Relationships></Item>`, false, partVersionable);
add(V, "versionableNestedAddSourceOther", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'><source_id>Z</source_id></Item></Relationships></Item>`, false, partVersionable);
add(V, "versionableNestedAddSourceElementChild", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' action='add'><source_id><Item type='Part' id='A'/></source_id></Item></Relationships></Item>`, false, partVersionable);
add(V, "versionableRootWhere", `<Item type='Part' where="name='x'" action='edit'><Relationships><Item type='Part BOM' action='add'><source_id>Z</source_id></Item></Relationships></Item>`, false, partVersionable);
add(V, "versionableRootWhereEmptySource", `<Item type='Part' where="name='x'" action='edit'><Relationships><Item type='Part BOM' action='add'><source_id /></Item></Relationships></Item>`, false, partVersionable);
add(V, "versionableRootAddNoIdNoWhere", `<Item type='Part' action='add' />`, false, partVersionable);
add(V, "versionableApostropheId", `<Item type='Part' id="A'B" action='add' />`, false, partVersionable);
add(V, "nonVersionableApostropheId", `<Item type='Part' id="A'B" action='add' />`, false);
add(V, "versionableRootEditWithId", `<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' action='edit' /></Relationships></Item>`, false, partVersionable);

// F: the final send and the exception wrapping (IMP-340, IMP-304)
const F = "F.finalApply";
add(F, "plainSend", `<Item type='Part' id='A' action='add' doGetItem='0'><name>n</name></Item>`, false);
add(F, "sendFaultCode0", `<Item type='Part' id='A' action='add' />`, false, faultAll(0));
add(F, "sendFault999", `<Item type='Part' id='A' action='add' />`, false, faultAll(999));

// M: merge mode (IMP-310 to IMP-314, IMP-317)
const M = "M.merge";
const partA = `<Item type="Part" id="A"><id>A</id></Item>`;
const exists = answerGet(partA);
add(M, "notMerge", `<Item type='Part' id='A' action='add'><name>n</name></Item>`, false, exists);
add(M, "existsBecomesEdit", `<Item type='Part' id='A' action='add'><name>n</name></Item>`, true, exists);
add(M, "absentStaysAdd", `<Item type='Part' id='A' action='add'><name>n</name></Item>`, true);
add(M, "getFault999", `<Item type='Part' id='A' action='add'><name>n</name></Item>`, true, faultAll(999));
add(M, "addWithoutIdIgnored", `<Item type='Part' where="name='x'" action='add'><name>n</name></Item>`, true);
add(M, "editAndDeleteIgnored", `<Item type='Part' id='A' action='edit'><Relationships><Item type='Part BOM' id='B' action='delete' /></Relationships></Item>`, true);
add(M, "nestedAddsGroupedByType", `<Item type='Part' id='P1' action='add'><Relationships><Item type='Part BOM' id='R1' action='add' /><Item type='Part AML' id='R2' action='add' /><Item type='Part BOM' id='R3' action='add' /></Relationships></Item>`, true);
add(M, "typeOrderFollowsFirstAdd", `<Item type='B' id='B1' action='add'><Relationships><Item type='A' id='A1' action='add' /><Item type='B' id='B2' action='add' /><Item type='A' id='A2' action='add' /></Relationships></Item>`, true);
add(M, "typeWithoutIdFirst", `<Item type='B' action='add' where="name='x'"><Relationships><Item type='A' id='A1' action='add' /></Relationships></Item>`, true);
add(M, "sameIdTwiceSameType", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='R' action='add' /><Item type='Part BOM' id='R' action='add' /></Relationships></Item>`, true);
add(M, "typeIsCaseSensitive", `<Item type='Part' id='A' action='add'><Relationships><Item type='part' id='B' action='add' /></Relationships></Item>`, true);
add(M, "onlySomeExist", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='B' action='add' /></Relationships></Item>`, true, answerGet(`${partA}<Item type="Part" id="C"><id>C</id></Item>`));
add(M, "sameIdOtherType", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='A' action='add' /></Relationships></Item>`, true, (h) => {
  h.onApply = (aml) => (like(aml, "*type='Part' action='get'*") ? envelope(partA) : null);
});
add(M, "idCaseSensitive", `<Item type='Part' id='a' action='add' />`, true, answerGet(partA));
const lockedBy = (inner: string): string => `<Item type="Part" id="A"><id>A</id>${inner}</Item>`;
add(M, "locked", `<Item type='Part' id='A' action='add' />`, true, answerGet(lockedBy(`<locked_by_id keyed_name="x" type="User">U1</locked_by_id>`)));
add(M, "lockedEmpty", `<Item type='Part' id='A' action='add' />`, true, answerGet(lockedBy(`<locked_by_id />`)));
add(M, "lockedDuplicateId", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part' id='A' action='add' /></Relationships></Item>`, true, answerGet(lockedBy(`<locked_by_id>U1</locked_by_id>`)));
add(M, "unlockFails", `<Item type='Part' id='A' action='add' />`, true, (h) => {
  h.unlockFault = 999;
  answerGet(lockedBy(`<locked_by_id>U1</locked_by_id>`))(h);
});
const rawAnswer = (text: string): Setup => (h) => {
  h.onApply = (aml) => (aml.includes("action='get'") ? text : envelope(""));
};
add(M, "responseNoNamespaceEnvelope", `<Item type='Part' id='A' action='add' />`, true, rawAnswer(`<Envelope><Body><Result><Item type="Part" id="A"><id>A</id></Item></Result></Body></Envelope>`));
add(M, "responseOtherNamespace", `<Item type='Part' id='A' action='add' />`, true, rawAnswer(`<e:Envelope xmlns:e="urn:other"><e:Body><e:Result><Item type="Part" id="A"><id>A</id></Item></e:Result></e:Body></e:Envelope>`));
add(M, "responseItemInsideItems", `<Item type='Part' id='A' action='add' />`, true, answerGet(`<Items>${partA}</Items>`));
add(M, "apostropheInType", `<Item type="Pa'rt" id='A' action='add' />`, true);
add(M, "ampersandInId", `<Item type='Part' id='A&amp;B' action='add' />`, true);
add(M, "getRequestsKeepDuplicates", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part' id='A' action='add' /></Relationships></Item>`, true);

// G: versionable adds in merge mode (IMP-311)
const G = "G.versionableMerge";
const movesAToA2: Setup = (h) => {
  partVersionable(h);
  h.latestId.set("A", "A2");
};
add(G, "versionableAddCallsSetItemId", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='R' action='add' /></Relationships></Item>`, true, movesAToA2);
add(G, "versionableIdChangedThenExists", `<Item type='Part' id='A' action='add' />`, true, (h) => {
  movesAToA2(h);
  answerGet(`<Item type="Part" id="A2"><id>A2</id></Item>`)(h);
});
add(G, "nonVersionableNoCall", `<Item type='Part' id='A' action='add' />`, true);
add(G, "versionableCalledForNestedEditsNot", `<Item type='Part' id='A' action='edit'><Relationships><Item type='Part' id='B' action='add' /></Relationships></Item>`, true, partVersionable);
add(G, "versionableNoIdSkipsDictionary", `<Item type='Part' where="name='x'" action='add' />`, true, partVersionable);

// C: the Change Controlled Relationship property rule (IMP-315, IMP-316)
const C = "C.ccrProperty";
const propertyExists = onGet("*action='get'*", envelope(`<Item type="Property" id="P1"><id>P1</id></Item>`));
const ccrProperty = (name: string, keyed = `keyed_name='Change Controlled Relationship' type='ItemType'`): string =>
  `<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'>${name}<source_id ${keyed}>IT</source_id></Item></Relationships></Item>`;
// the probe's table ignores the case of its keys, so its entry `ccr.Related_Id` is the last write of `related_id` and `Related_Id`
for (const name of ["sort_order", "source_id", "name", "Related_Id"]) {
  add(C, `ccr.${name}`, ccrProperty(`<name>${name}</name>`), true, (h) => propertyExists(h));
}
add(C, "ccr.otherKeyedName", ccrProperty(`<name>related_id</name>`, `keyed_name='Part' type='ItemType'`), true, propertyExists);
add(C, "ccr.noKeyedName", `<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'><name>related_id</name><source_id>IT</source_id></Item></Relationships></Item>`, true, propertyExists);
add(C, "ccr.noName", `<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'><source_id keyed_name='Change Controlled Relationship'>IT</source_id></Item></Relationships></Item>`, true, propertyExists);
add(C, "ccr.notExisting", `<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'><name>related_id</name><source_id keyed_name='Change Controlled Relationship'>IT</source_id></Item></Relationships></Item>`, true);
add(C, "ccr.anyTypeWithTheShape", `<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Other' id='P1' action='add'><name>related_id</name><source_id keyed_name='Change Controlled Relationship'>IT</source_id></Item></Relationships></Item>`, true, onGet("*type='Other'*action='get'*", envelope(`<Item type="Other" id="P1"><id>P1</id></Item>`)));
add(C, "ccr.rootProperty", `<Item type='Property' id='P1' action='add'><name>related_id</name><source_id keyed_name='Change Controlled Relationship'>IT</source_id></Item>`, true, propertyExists);
add(C, "ccr.sameIdTwoNodes", `<Item type='ItemType' id='IT' action='add'><Relationships><Item type='Property' id='P1' action='add'><name>related_id</name><source_id keyed_name='Change Controlled Relationship'>IT</source_id></Item><Item type='Property' id='P1' action='add'><name>other</name></Item></Relationships></Item>`, true, propertyExists);

// P: ProcessVersionableItem (IMP-330 to IMP-333)
const P = "P.processVersionableItem";
const withRelation = (relationship: string, root = `<Item type='Part' id='A' action='edit'>`): string => `${root}<Relationships>${relationship}</Relationships></Item>`;
const relExists = (...keys: string[]): Setup => (h) => {
  partVersionable(h);
  for (const key of keys) h.relExists.set(key, true);
};
add(P, "plainRelationshipExists", withRelation(`<Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id>B</related_id></Item>`), false, relExists("Part BOM|A|B"));
add(P, "plainRelationshipMissing", withRelation(`<Item type='Part BOM' id='R1' action='edit' where="x='y'"><source_id>A</source_id><related_id>B</related_id></Item>`), false, partVersionable);
add(P, "relationshipWithoutSourceId", withRelation(`<Item type='Part BOM' id='R1' action='add'><related_id>B</related_id></Item>`), false, partVersionable);
add(P, "relationshipWithoutRelatedId", withRelation(`<Item type='Part BOM' id='R1' action='add'><source_id>A</source_id></Item>`), false, partVersionable);
add(P, "relatedIdWithItemAndId", withRelation(`<Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id><Item type='Part' id='B' action='add' /></related_id></Item>`), false, relExists("Part BOM|A|B"));
add(P, "relatedIdWithItemNoId", withRelation(`<Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id><Item type='Part' action='add' where="name='b'" /></related_id></Item>`), false, partVersionable);
add(P, "relatedIdTwoItemsSecondHasId", withRelation(`<Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id><Item type='Part' action='add' where="name='b'" /><Item type='Part' id='B2' action='add' /></related_id></Item>`), false, relExists("Part BOM|A|B2"));
add(P, "relatedIdTextWithWhitespaceChildren", withRelation(`<Item type='Part BOM' action='add'><source_id>A</source_id><related_id keyed_name='k' type='Part'>B</related_id></Item>`), false, relExists("Part BOM|A|B"));
add(P, "existFaultOther", withRelation(`<Item type='Part BOM' action='add'><source_id>A</source_id><related_id>B</related_id></Item>`), false, (h) => {
  partVersionable(h);
  h.relFault.set("Part BOM|A|B", 999);
});
add(P, "apostropheInRelated", withRelation(`<Item type='Part BOM' action='add'><source_id>A</source_id><related_id>B'C</related_id></Item>`), false, relExists("Part BOM|A|B'C"));
add(P, "sourceIdNotRootId", withRelation(`<Item type='Part BOM' action='add'><source_id>OTHER</source_id><related_id>B</related_id></Item>`), false, relExists("Part BOM|OTHER|B"));
add(P, "nonVersionableRootUntouched", withRelation(`<Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id>B</related_id></Item>`), false);
add(P, "relationshipsNotUnderRootIgnored", `<Item type='Part' id='A' action='edit'><Foo><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id>B</related_id></Item></Relationships></Foo></Item>`, false, partVersionable);
add(P, "deeperRelationshipsIgnored", withRelation(`<Item type='Part BOM' action='add'><source_id>A</source_id><Relationships><Item type='X' id='R9' action='add'><source_id>A</source_id><related_id>B</related_id></Item></Relationships></Item>`), false, partVersionable);
const macFound = (h: StubHelper): void => {
  partVersionable(h);
  onGet("*mp_MacCondition*action='get'*", envelope(`<Item type="mp_MacCondition" id="M1"><id>M1</id></Item>`))(h);
};
add(P, "mpMacFound", withRelation(`<Item type='mp_MacCondition' id='R1' action='add'><source_id>A</source_id><ref_id>RR</ref_id></Item>`), false, macFound);
add(P, "mpMacMissing", withRelation(`<Item type='mp_MacCondition' id='R1' where="z='1'" action='edit'><source_id>A</source_id><ref_id>RR</ref_id></Item>`), false, partVersionable);
add(P, "mpMacFault999", withRelation(`<Item type='mp_MacCondition' action='add'><source_id>A</source_id><ref_id>RR</ref_id></Item>`), false, (h) => {
  partVersionable(h);
  h.onApply = (aml) => (like(aml, "*mp_MacCondition*action='get'*") ? "FAULT:999" : envelope(""));
});
add(P, "mpMacNoRefId", withRelation(`<Item type='mp_MacCondition' action='add'><source_id>A</source_id></Item>`), false, partVersionable);
add(P, "mpMacNoSourceId", withRelation(`<Item type='mp_MacCondition' action='add'><ref_id>RR</ref_id></Item>`), false, partVersionable);
add(P, "mpMacWithRelatedIdIgnored", withRelation(`<Item type='mp_MacCondition' action='add'><source_id>A</source_id><ref_id>RR</ref_id><related_id>B</related_id></Item>`), false, partVersionable);
add(P, "mpMacApostrophe", withRelation(`<Item type='mp_MacCondition' action='add'><source_id>A</source_id><ref_id>R'R</ref_id></Item>`), false, partVersionable);
add(P, "mpMacTypeCaseSensitive", withRelation(`<Item type='MP_MacCondition' action='add'><source_id>A</source_id><ref_id>RR</ref_id><related_id>B</related_id></Item>`), false, partVersionable);
add(P, "mergeThenVersionable", `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id>B</related_id></Item></Relationships></Item>`, true, (h) => {
  movesAToA2(h);
  h.relExists.set("Part BOM|A|B", true);
});

describe("the related_id property of Change Controlled Relationship (IMP-315)", () => {
  // the probe's table ignores the case of its keys, so it holds no entry of its own for related_id: it goes the way of sort_order and source_id
  it("is removed like sort_order and source_id, and the document is the one the probe recorded for them", async () => {
    const probed = expected(C, "ccr.sort_order");
    const helper = new StubHelper();
    propertyExists(helper);
    const document = loadXml(ccrProperty("<name>related_id</name>"), { preserveWhitespace: false });
    await new ImportItems(helper).import(document, true);
    expect(helper.calls).toEqual(probed.calls);
    expect(outerXml(document)).toBe(probed.documentAfter);
    expect(outerXml(document)).not.toContain("related_id");
  });
});

describe("CImportItems.Import against the merge probe of 14.0.7 (IMP-300 to IMP-340)", () => {
  it("replays the 14.0.7 probe", () => {
    expect(probe.engine).toBe("14.0.7");
  });

  it.each(scenarios.map((scenario) => [`${scenario.group}/${scenario.name}`, scenario] as const))("%s", async (label, scenario) => {
    const probed = expected(scenario.group, scenario.name);
    const helper = new StubHelper();
    scenario.setup?.(helper);
    const document = loadXml(scenario.xml, { preserveWhitespace: false });
    const thrown = await caught(() => new ImportItems(helper).import(document, scenario.merge));
    expect(helper.calls, label).toEqual(probed.calls);
    expectThrown(thrown, probed.thrown, label);
    expect(outerXml(document), label).toBe(probed.documentAfter);
  });
});

/** The `Version-Script` of the probe: a stub connection that answers the lookups of a versionable type. */
type CurrentState = "current" | "old" | "missing" | "missingConfigFound" | "error" | "nocfg";
const noItemsFault = (text: string, code = "0"): string => stubFault(code, text);
function versionScript(versionable: boolean, state: CurrentState, latest = "LATEST"): (wire: string) => string | undefined {
  return (wire) => {
    if (like(wire, '*select="is_versionable"*')) {
      return envelope(`<Item type="ItemType" id="X"><is_versionable>${versionable ? "1" : "0"}</is_versionable></Item>`);
    }
    if (like(wire, '*select="config_id, is_current"*')) {
      if (state === "current") return envelope(`<Item type="Part" id="A"><config_id>CFG</config_id><is_current>1</is_current></Item>`);
      if (state === "old") return envelope(`<Item type="Part" id="A"><config_id>CFG</config_id><is_current>0</is_current></Item>`);
      if (state === "missing" || state === "missingConfigFound") return noItemsFault("No items of type Part found.");
      if (state === "error") return noItemsFault("boom", "999");
      if (state === "nocfg") return envelope(`<Item type="Part" id="A"><is_current>0</is_current></Item>`);
    }
    if (like(wire, '*select="id"*<config_id>*')) {
      if (state === "missing") return noItemsFault("No items of type Part found.");
      return envelope(`<Item type="Part" id="${latest}"><id>${latest}</id></Item>`);
    }
    if (like(wire, "*is_keyed*")) {
      return envelope(`<Item type="ItemType" id="IT"><Relationships><Item type="Property" id="P1"><name>item_number</name></Item></Relationships></Item>`);
    }
    if (like(wire, "*item_number*")) return envelope(`<Item type="Part" id="KEYID"><id>KEYID</id></Item>`);
    return undefined;
  };
}

const noKeyProps = (wire: string): string | undefined => {
  if (like(wire, '*select="is_versionable"*')) return envelope(`<Item type="ItemType" id="X"><is_versionable>1</is_versionable></Item>`);
  if (like(wire, '*select="config_id, is_current"*')) return noItemsFault("none");
  if (like(wire, '*select="id"*<config_id>*')) return noItemsFault("none");
  if (like(wire, "*is_keyed*")) return noItemsFault("none");
  return undefined;
};

const partXml = `<Item type='Part' id='A' action='add'><item_number>P1</item_number><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id></Item><Item type='Part BOM' id='R2' action='add'><source_id>OTHER</source_id><Relationships><Item type='X' action='add'><source_id>A</source_id></Item></Relationships></Item></Relationships></Item>`;

function lookupsOver(script: (wire: string) => string | undefined): { connection: StubConnection; lookups: ImportLookups } {
  const connection = new StubConnection((wire) => script(wire));
  return { connection, lookups: new ImportLookups(new CItemHelper(connection)) };
}

interface HelperScenario {
  name: string;
  xml: string;
  script: (wire: string) => string | undefined;
}

const setScenarios: HelperScenario[] = [
  { name: "noId", xml: `<Item type='Part' action='add'/>`, script: versionScript(true, "current") },
  { name: "noType", xml: `<Item id='A' action='add'/>`, script: versionScript(true, "current") },
  { name: "emptyId", xml: `<Item type='Part' id='' action='add'/>`, script: versionScript(true, "current") },
  { name: "notVersionable", xml: partXml, script: versionScript(false, "current") },
  { name: "alreadyCurrent", xml: partXml, script: versionScript(true, "current") },
  { name: "oldGeneration", xml: partXml, script: versionScript(true, "old", "LATEST") },
  { name: "oldGenerationSameIdAsLatest", xml: partXml, script: versionScript(true, "old", "A") },
  { name: "currentIdLookupMissingConfigFound", xml: partXml, script: versionScript(true, "missingConfigFound") },
  { name: "notFoundAnywhereFallsToUniqueKey", xml: partXml, script: versionScript(true, "missing") },
  { name: "currentIdLookupFaultOtherFallsToUniqueKey", xml: partXml, script: versionScript(true, "error") },
  { name: "currentIdNoConfigIsNotCaught", xml: partXml, script: versionScript(true, "nocfg") },
  { name: "uniqueKeyNoPropertiesLeavesIdAlone", xml: partXml, script: noKeyProps },
  { name: "uniqueKeyMissingPropertyThrows", xml: `<Item type='Part' id='A' action='add'><Relationships /></Item>`, script: versionScript(true, "missing") },
  {
    name: "relationshipsWithoutSourceId",
    xml: `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='R1' action='add'><related_id>B</related_id></Item></Relationships></Item>`,
    script: versionScript(true, "old", "LATEST"),
  },
  {
    name: "nestedInRelatedIdUntouched",
    xml: `<Item type='Part' id='A' action='add'><Relationships><Item type='Part BOM' id='R1' action='add'><source_id>A</source_id><related_id><Item type='Part' id='A'><Relationships><Item type='Y'><source_id>A</source_id></Item></Relationships></Item></related_id></Item></Relationships></Item>`,
    script: versionScript(true, "old", "LATEST"),
  },
];

describe("CItemHelper.SetItemIdToLastGeneration against the merge probe (IMP-320, IMP-321)", () => {
  it.each(setScenarios.map((scenario) => [scenario.name, scenario] as const))("%s", async (name, scenario) => {
    const probed = expected("S.setItemIdToLastGeneration", name);
    const { connection, lookups } = lookupsOver(scenario.script);
    const document: XmlDocument = loadXml(scenario.xml, { preserveWhitespace: false });
    const thrown = await caught(() => lookups.setItemIdToLastGeneration(documentElementOf(document) as XmlElement));
    expect(connection.requests, name).toEqual(probed.requests);
    expectThrown(thrown, probed.thrown, name);
    expect(outerXml(document), name).toBe(probed.documentAfter);
  });
});

const plainItem = `<Item type='List' id='L1' action='add'><name>n</name></Item>`;
const plainScript =
  (answer: string): ((wire: string) => string | undefined) =>
  (wire) =>
    like(wire, '*select="is_versionable"*') ? envelope(`<Item type="ItemType" id="X"><is_versionable>0</is_versionable></Item>`) : answer;

const existsScenarios: (HelperScenario & { result?: boolean })[] = [
  { name: "plainExists", xml: plainItem, script: plainScript(envelope(`<Item type="List" id="L1"><id>L1</id></Item>`)) },
  { name: "plainMissing", xml: plainItem, script: plainScript(noItemsFault("No items")) },
  { name: "plainServerError999IsNotExist", xml: plainItem, script: plainScript(noItemsFault("boom", "999")) },
  { name: "noIdAttribute", xml: `<Item type='List' action='add'/>`, script: () => undefined },
  { name: "noTypeAttribute", xml: `<Item id='L1' action='add'/>`, script: () => undefined },
  { name: "emptyIdAttribute", xml: `<Item type='List' id='' action='add'/>`, script: () => undefined },
  { name: "versionableCurrent", xml: partXml, script: versionScript(true, "current") },
  { name: "versionableOldGeneration", xml: partXml, script: versionScript(true, "old", "LATEST") },
  { name: "versionableConfigFoundByLookup", xml: partXml, script: versionScript(true, "missingConfigFound") },
  { name: "versionableNotFoundUniqueKeyFinds", xml: partXml, script: versionScript(true, "missing") },
  { name: "versionableNotFoundUniqueKeyNone", xml: partXml, script: noKeyProps },
  { name: "versionableLookupFault999FallsToUniqueKey", xml: partXml, script: versionScript(true, "error") },
  { name: "versionableNoConfigNotCaught", xml: partXml, script: versionScript(true, "nocfg") },
];

describe("CItemHelper.DoesItemAlreadyExist against the merge probe (IMP-350, IMP-351)", () => {
  it.each(existsScenarios.map((scenario) => [scenario.name, scenario] as const))("%s", async (name, scenario) => {
    const probed = expected("E.doesItemAlreadyExist", name);
    const { connection, lookups } = lookupsOver(scenario.script);
    const document = loadXml(scenario.xml, { preserveWhitespace: false });
    let result: boolean | null = null;
    const thrown = await caught(async () => {
      result = await lookups.doesItemAlreadyExist(documentElementOf(document) as XmlElement);
    });
    expect(result, name).toBe(probed.result);
    expect(connection.requests, name).toEqual(probed.requests);
    expectThrown(thrown, probed.thrown, name);
    expect(outerXml(document), name).toBe(probed.documentAfter);
  });

  it("does not offer the IdTypePair overload of the probe (idTypePairIsUsed): it is not reachable", () => {
    expect(probe.scenarios["E.doesItemAlreadyExist"]?.["idTypePairIsUsed"]).toBeDefined();
    expect(ImportLookups.prototype.doesItemAlreadyExist.length).toBe(1);
  });

  it.each([
    ["merge on never asks", true, `<Item type='List' id='L1' action='add'/>`, false],
    ["merge off asks about an add", false, `<Item type='List' id='L1' action='add'/>`, true],
    ["an item without action never skips", false, `<Item type='List' id='L1'/>`, false],
    ["an edit never skips", false, `<Item type='List' id='L1' action='edit'/>`, false],
  ])("the skip test of the import loop: %s", async (_name, merge, xml, asks) => {
    const { connection, lookups } = lookupsOver(plainScript(envelope(`<Item type="List" id="L1"><id>L1</id></Item>`)));
    const document = loadXml(xml, { preserveWhitespace: false });
    const skipped = await lookups.skipsExistingAdd(documentElementOf(document) as XmlElement, merge);
    expect(skipped).toBe(asks);
    expect(connection.requests.length > 0).toBe(asks);
  });
});

describe("CItemHelper.ItemExistById, ExistRelItemInCurVer and Unlock against the merge probe (IMP-322, IMP-334, IMP-352)", () => {
  const modes: Record<string, (wire: string) => string | undefined> = {
    found: () => envelope(`<Item type="Part" id="A"><id>A</id></Item>`),
    missing: () => noItemsFault("No items"),
    error999: () => noItemsFault("boom", "999"),
    xmlerror: () => "",
  };

  it.each(Object.keys(modes))("rel.%s", async (mode) => {
    const probed = expected("X.lookups", `rel.${mode}`);
    const { connection, lookups } = lookupsOver(modes[mode] as (wire: string) => string | undefined);
    let existById: boolean | null = null;
    const byIdThrown = await caught(async () => {
      existById = await lookups.itemExistById("A", "Part");
    });
    let existRel: boolean | null = null;
    const relThrown = await caught(async () => {
      existRel = await lookups.existRelItemInCurVer("Part BOM", "A", "B");
    });
    expect(existById).toBe(probed.itemExistById);
    expect(existRel).toBe(probed.existRel);
    expectThrown(byIdThrown, probed.itemExistByIdThrown, "itemExistById");
    expectThrown(relThrown, probed.existRelThrown, "existRelItemInCurVer");
    expect(connection.requests).toEqual(probed.requests);
    expect(connection.actions).toEqual(probed.actions);
  });

  it("unlock.ok sends one unlock", async () => {
    const probed = expected("X.lookups", "unlock.ok");
    const { connection, lookups } = lookupsOver(() => envelope(`<Item type="Part" id="A"/>`));
    await lookups.unlock("A", "Part");
    expect(connection.requests).toEqual(probed.requests);
    expect(connection.actions).toEqual(probed.actions);
  });

  it.each([
    ["unlock.fault", noItemsFault("cannot unlock", "999")],
    ["unlock.fault0", noItemsFault("No items")],
  ])("%s throws every fault, faultcode 0 included", async (name, fault) => {
    const probed = expected("X.lookups", name);
    const { connection, lookups } = lookupsOver(() => fault);
    const thrown = await caught(() => lookups.unlock("A", "Part"));
    expect(connection.requests).toEqual(probed.requests);
    expectThrown(thrown, probed.thrown, name);
  });

  it("rel.unescapedValues puts the ids into the request as they are, so an ampersand does not parse", async () => {
    const probed = expected("X.lookups", "rel.unescapedValues");
    const { connection, lookups } = lookupsOver(() => envelope(""));
    const thrown = await caught(() => lookups.existRelItemInCurVer("Part BOM", "A'B", "C&D"));
    expect(connection.requests).toEqual(probed.requests);
    expectThrown(thrown, probed.thrown, "rel.unescapedValues");
  });

  it("applyAML.emptyString sends nothing for an empty document", async () => {
    const probed = expected("X.lookups", "applyAML.emptyString");
    const connection = new StubConnection(() => envelope(""));
    const thrown = await caught(() => new CItemHelper(connection).applyAML(""));
    expect(connection.requests).toEqual(probed.requests);
    expectThrown(thrown, probed.thrown, "applyAML.emptyString");
  });
});

describe("the merge probe is replayed whole", () => {
  it("has a counterpart in this file for every scenario of the probe except the IdTypePair one", () => {
    const here = new Set<string>([
      ...scenarios.map((scenario) => `${scenario.group}/${scenario.name}`),
      ...setScenarios.map((scenario) => `S.setItemIdToLastGeneration/${scenario.name}`),
      ...existsScenarios.map((scenario) => `E.doesItemAlreadyExist/${scenario.name}`),
      ...["found", "missing", "error999", "xmlerror"].map((mode) => `X.lookups/rel.${mode}`),
      ...["unlock.ok", "unlock.fault", "unlock.fault0", "rel.unescapedValues", "applyAML.emptyString"].map((name) => `X.lookups/${name}`),
      "E.doesItemAlreadyExist/idTypePairIsUsed",
    ]);
    const probed = Object.entries(probe.scenarios).flatMap(([group, cases]) => Object.keys(cases).map((name) => `${group}/${name}`));
    expect(probed.filter((name) => !here.has(name))).toEqual([]);
  });
});
