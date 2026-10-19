import { describe, expect, it } from "vitest";
import { ResponseDocument } from "../client/fault.js";
import { CItemHelper } from "../client/item-helper.js";
import { StubConnection, stubResult } from "../client/stub-connection.js";
import { ArasVersion } from "../client/version.js";
import { ArgumentNullException } from "../io/errors.js";
import { documentElementOf } from "../xml/dom.js";
import type { XmlDocument, XmlElement } from "../xml/dom.js";
import { loadXml, loadXmlInto } from "../xml/parser.js";
import { outerXml } from "../xml/writer-legacy.js";
import { DelayedResolutionManager } from "./delayed-resolution.js";
import { CollectedErrors } from "./collected-errors.js";
import { SUImportContext } from "./import-context.js";
import { ImportItems, type MergeHelper } from "./import-items.js";
import { ImportLookups } from "./import-lookups.js";
import { formatTimeSpan } from "./import-run.js";
import { ImportWorkItem } from "./import-work-item.js";

/**
 * The parts of the AML batch mode and the collected errors (IMP-500 to IMP-551) that the recorded runs and the probe scenarios
 * (`import-run.replay.test.ts`, `batch-errors-probe.test.ts`) reach only through a whole run: the settings, the work item's restore and
 * Relationships test, the `Import` that prepares an item without sending it, the hand-over of delayed entries and the time spans.
 */

const parse = (xml: string): XmlDocument => loadXml(xml, { preserveWhitespace: false });
const rootOf = (doc: XmlDocument): XmlElement => documentElementOf(doc) as XmlElement;

describe("SUImportContext: the four settings of 14.35 (IMP-500)", () => {
  it("are off by default, with a size and a limit of 0", () => {
    const context = new SUImportContext();
    expect([context.amlBatchMode, context.amlBatchMaxSize, context.collectImportErrors, context.collectImportErrorsMaxCount]).toEqual([false, 0, false, 0]);
  });

  it("are plain properties, with no validation", () => {
    const context = new SUImportContext();
    context.amlBatchMode = true;
    context.amlBatchMaxSize = -5;
    context.collectImportErrors = true;
    context.collectImportErrorsMaxCount = 2_147_483_647;
    expect([context.amlBatchMode, context.amlBatchMaxSize, context.collectImportErrors, context.collectImportErrorsMaxCount]).toEqual([true, -5, true, 2_147_483_647]);
  });

  it("do not touch the five settings every engine has", () => {
    const context = new SUImportContext();
    context.amlBatchMode = true;
    expect([context.merge, context.release, context.description, context.vault, context.fast]).toEqual([false, null, null, false, false]);
  });
});

describe("CollectedErrors: the three fields of the manager (IMP-540)", () => {
  it("starts with no package list, no collected packages and a count of 0", () => {
    const collected = new CollectedErrors();
    expect(collected.packageExceptions).toBeNull();
    expect(collected.exceptions).toEqual([]);
    expect(collected.count).toBe(0);
  });
});

describe("ImportWorkItem: the restore and the Relationships test (IMP-510, IMP-525)", () => {
  const item = (inner = ""): XmlDocument => parse(`<Item type="Part" id="P1" action="add" tempKeyName="k" tempFullName="f"><name>n</name>${inner}</Item>`);

  it("keeps the text of the item as the constructor leaves it: doGetItem set, tempKeyName and tempFullName gone", () => {
    const work = new ImportWorkItem(item(), new SUImportContext(), "14.35");
    expect(work.originalOuterXml).toBe('<Item type="Part" id="P1" action="add" doGetItem="0"><name>n</name></Item>');
  });

  it("restores that text, discarding every change, into a new root element", () => {
    const work = new ImportWorkItem(item(), new SUImportContext(), "14.35");
    const before = rootOf(work.item);
    before.setAttribute("id", "CHANGED");
    before.appendChild(work.item.createElement("extra"));
    work.restoreOriginalXml();
    const after = rootOf(work.item);
    expect(outerXml(work.item)).toBe(work.originalOuterXml);
    expect(after).not.toBe(before);
  });

  it("leaves itemNode on the old element, which keeps what it had when the restore happened (bug IMP-525)", () => {
    const work = new ImportWorkItem(item(), new SUImportContext(), "14.35");
    rootOf(work.item).setAttribute("id", "FIRST-ATTEMPT");
    work.restoreOriginalXml();
    expect(work.itemNode.getAttribute("id")).toBe("FIRST-ATTEMPT");
    expect(rootOf(work.item).getAttribute("id")).toBe("P1");
    expect(work.itemNode.parentNode).toBeNull();
  });

  it("is suitable for batching when the item has no Relationships child", () => {
    expect(new ImportWorkItem(item(), new SUImportContext(), "14.35").isSuitableForBatching()).toBe(true);
    expect(new ImportWorkItem(item("<Relationships/>"), new SUImportContext(), "14.35").isSuitableForBatching()).toBe(false);
  });

  it("looks at the direct children only: a deeper Relationships does not count, and neither does a similar name", () => {
    const deeper = item("<holder><Relationships><Item type='x'/></Relationships></holder><relationships/>");
    expect(new ImportWorkItem(deeper, new SUImportContext(), "14.35").isSuitableForBatching()).toBe(true);
  });

  it("reads the element the work item was made with, not the current root", () => {
    const work = new ImportWorkItem(item(), new SUImportContext(), "14.35");
    loadXmlInto(work.item, '<Item type="Part" id="P1" action="add"><Relationships/></Item>');
    expect(work.isSuitableForBatching()).toBe(true);
  });

  it("14.0.7 keeps no text to restore", () => {
    expect(new ImportWorkItem(item(), new SUImportContext(), "14.0.7").originalOuterXml).toBe("");
  });
});

describe("loadXmlInto: XmlDocument.LoadXml on a document that has content (IMP-510)", () => {
  it("drops the old children and the declaration, and loads the text in their place", () => {
    const doc = loadXml('<?xml version="1.0" encoding="utf-8"?><!--c--><old/>', { preserveWhitespace: false });
    loadXmlInto(doc, "<new a='1'><b/></new>");
    expect(outerXml(doc)).toBe('<new a="1"><b /></new>');
    expect(doc.childNodes.length).toBe(1);
  });

  it("uses the PreserveWhitespace of the document", () => {
    const keep = loadXml("<a/>", { preserveWhitespace: true });
    loadXmlInto(keep, "<a> <b/> </a>");
    expect(rootOf(keep).childNodes.length).toBe(3);
    const drop = loadXml("<a/>", { preserveWhitespace: false });
    loadXmlInto(drop, "<a> <b/> </a>");
    expect(rootOf(drop).childNodes.length).toBe(1);
  });
});

describe("Import in the batch mode: the item is prepared and not sent (IMP-512)", () => {
  /** A helper that records its calls; every answer is empty. */
  function recordingHelper(): { helper: MergeHelper; sent: string[] } {
    const sent: string[] = [];
    const helper: MergeHelper = {
      applyAML: async (aml) => {
        sent.push(aml);
        return ResponseDocument.parse(stubResult(""));
      },
      isVersionable: async () => false,
      setItemIdToLastGeneration: async () => undefined,
      unlock: async () => undefined,
      existRelItemInCurVer: async () => false,
    };
    return { helper, sent };
  }

  it("sends the item when the batch flag is off, and sends nothing when it is on", async () => {
    const plain = recordingHelper();
    await new ImportItems(plain.helper, "14.35").import(parse('<Item type="List" id="L1" action="add"/>'), false);
    expect(plain.sent).toEqual(['<Item type="List" id="L1" action="add" />']);

    const batch = recordingHelper();
    const doc = parse('<Item type="List" id="L1" action="add"/>');
    await new ImportItems(batch.helper, "14.35").import(doc, false, true);
    expect(batch.sent).toEqual([]);
    expect(outerXml(doc)).toBe('<Item type="List" id="L1" action="add" />');
  });

  it("still validates the item, and a failure is the same exception", async () => {
    const batch = recordingHelper();
    await expect(new ImportItems(batch.helper, "14.35").import(parse('<Item action="add"/>'), false, true)).rejects.toMatchObject({
      name: "CItemException",
      faultcode: -1,
      faultstring: "Items must have 'type' set",
    });
  });

  it("still does the merge preparation: a lookup is sent, and an existing add becomes an edit in the document", async () => {
    const sent: string[] = [];
    const helper: MergeHelper = {
      applyAML: async (aml) => {
        sent.push(aml);
        return ResponseDocument.parse(
          stubResult(aml.includes("idlist") ? '<Item type="List" id="L1"><id>L1</id><locked_by_id/></Item>' : ""),
        );
      },
      isVersionable: async () => false,
      setItemIdToLastGeneration: async () => undefined,
      unlock: async () => undefined,
      existRelItemInCurVer: async () => false,
    };
    const doc = parse('<Item type="List" id="L1" action="add"/>');
    await new ImportItems(helper, "14.35").import(doc, true, true);
    expect(sent).toEqual(["<Item type='List' action='get' idlist='L1' select='id, locked_by_id' />"]);
    expect(rootOf(doc).getAttribute("action")).toBe("edit");
  });
});

describe("ImportLookups.doImport and doImportInContext (IMP-300, IMP-512)", () => {
  function lookups(): { lookups: ImportLookups; requests: string[] } {
    const connection = new StubConnection((wire) =>
      wire.includes('select="is_versionable"') ? stubResult('<Item type="ItemType"><is_versionable>0</is_versionable></Item>') : stubResult(""),
    );
    const helper = new CItemHelper(connection, { engine: "14.35" });
    // a logged-in helper has read the server's version, which 14.35's CImportItems reads when it is made (LP-040)
    helper.innovatorVersion = new ArasVersion(12, 0, 9, 24090, 0);
    return { lookups: new ImportLookups(helper), requests: connection.requests };
  }
  const doc = () => parse('<Item type="List" id="L1" action="add"/>');

  it("doImport(item, merge) sends the item, and refuses a null document", async () => {
    const { lookups: subject, requests } = lookups();
    await subject.doImport(doc(), false);
    expect(requests.at(-1)).toBe('<Item type="List" id="L1" action="add" />');
    expect(() => subject.doImport(null, false)).toThrow(ArgumentNullException);
  });

  it("doImportInContext(item, context) sends nothing when the context has the batch mode on", async () => {
    const { lookups: subject, requests } = lookups();
    const context = new SUImportContext();
    context.amlBatchMode = true;
    await subject.doImportInContext(doc(), context);
    expect(requests.filter((request) => request.includes('action="add"'))).toEqual([]);
    context.amlBatchMode = false;
    await subject.doImportInContext(doc(), context);
    expect(requests.at(-1)).toBe('<Item type="List" id="L1" action="add" />');
  });

  it("14.35's CImportItems reads the server version when it is made, so a helper that has not logged in is a null reference (LP-040)", () => {
    const helper = new CItemHelper(new StubConnection(() => stubResult("")), { engine: "14.35" });
    expect(() => new ImportLookups(helper).doImport(doc(), false)).toThrow(expect.objectContaining({ typeName: "System.NullReferenceException" }));
  });

  it("refuses a null document first and then a null context, naming the parameter", () => {
    const { lookups: subject } = lookups();
    expect(() => subject.doImportInContext(null, null)).toThrow(expect.objectContaining({ paramName: "itemInXml" }));
    expect(() => subject.doImportInContext(doc(), null)).toThrow(expect.objectContaining({ paramName: "importContext" }));
  });
});

describe("DelayedResolutionManager: the hand-over of the batch queue (IMP-520)", () => {
  const entry = (id: string) => `<Item type='Part' id='${id}' action='edit' doGetItem='0'/>`;

  /** A manager with entries queued the way a check does: through `processForDelayedResolution`, which is private, so by the hand-over. */
  function managerWith(engine: "14.0.7" | "14.35", ...entries: string[]): DelayedResolutionManager {
    const manager = new DelayedResolutionManager(engine);
    manager.addDelayedAmls(entries);
    return manager;
  }

  it("getDelayedAmls is the queue", () => {
    const manager = managerWith("14.35", entry("A"), entry("B"));
    expect(manager.getDelayedAmls()).toEqual([entry("A"), entry("B")]);
  });

  it("addDelayedAmls adds each entry in order, through AddDelayedAmlItem", () => {
    const manager = managerWith("14.35", entry("A"));
    manager.addDelayedAmls(managerWith("14.35", entry("B"), entry("C")).getDelayedAmls());
    expect(manager.queue).toEqual([entry("A"), entry("B"), entry("C")]);
  });

  it("drops an entry equal to one the queue holds in 14.35, and keeps both in 14.0.7 (IMP-251)", () => {
    expect(managerWith("14.35", entry("A"), entry("A"), entry("B"), entry("A")).queue).toEqual([entry("A"), entry("B")]);
    expect(managerWith("14.0.7", entry("A"), entry("A")).queue).toEqual([entry("A"), entry("A")]);
  });

  it("compares ordinally: a different case is another entry", () => {
    expect(managerWith("14.35", entry("a"), entry("A")).queue).toHaveLength(2);
  });
});

describe("formatTimeSpan: TimeSpan.ToString() (IMP-514)", () => {
  it.for([
    [0n, "00:00:00"],
    [1n, "00:00:00.0000001"],
    [231_501n, "00:00:00.0231501"],
    [10_000_000n, "00:00:01"],
    [15_164_070n, "00:00:01.5164070"],
    [600_000_000n, "00:01:00"],
    [36_000_000_000n, "01:00:00"],
    [864_000_000_000n, "1.00:00:00"],
    [864_000_000_001n, "1.00:00:00.0000001"],
    [2_000_000_000_000n, "2.07:33:20"],
  ] as const)("%s ticks is %s", ([ticks, text]) => {
    expect(formatTimeSpan(ticks)).toBe(text);
  });
});
