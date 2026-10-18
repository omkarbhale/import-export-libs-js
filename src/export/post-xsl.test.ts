import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ResponseDocument } from "../client/fault.js";
import type { ItemLookups } from "../client/item-lookups.js";
import { unescapeProbe } from "../manifest/probe-output.js";
import { encodeItemFile, loadXml, outerXml, removeChild } from "../xml/index.js";
import type { XmlDocument, XmlElement, XmlNode } from "../xml/index.js";
import {
  applyXsl,
  cdataFilterXml,
  removeEmptyRelationships,
  removeNamespaceNodes,
  removePermissionIdWhenItMatchesToDefaultPermission,
  replaceReferencesToPolyLists,
} from "./post-xsl.js";

/**
 * The offline probes of the vendored 14.0.7 `Libs.dll` (fixtures/export-write/probe-14.0.7.txt, EXP-401 to EXP-412): each case
 * is a document, the engine's step run on it, and the bytes the engine's item-file writer made of the result, or the exception.
 */
const PROBE = readFileSync(new URL("../../fixtures/export-write/probe-14.0.7.txt", import.meta.url), "utf8").split(/\r?\n/);

interface ProbeCase {
  id: string;
  input: string;
  /** The bytes after the byte-order mark, or the exception's message. */
  output?: string;
  exception?: { type: string; message: string };
}

const cases = (prefix: string): ProbeCase[] => {
  const found = new Map<string, ProbeCase>();
  for (const line of PROBE) {
    const input = new RegExp(`^(${prefix}\\d+) in : (.*)$`).exec(line);
    if (input) found.set(input[1] as string, { id: input[1] as string, input: unescapeProbe(input[2] as string) });
    const output = new RegExp(`^(${prefix}\\d+) out: \\[BOM\\]"(.*)"$`).exec(line);
    if (output) (found.get(output[1] as string) as ProbeCase).output = unescapeProbe(output[2] as string);
    const exception = new RegExp(`^(${prefix}\\d+) EXC: ([\\w.]+): (.*)$`).exec(line);
    const failing = exception && found.get(exception[1] as string);
    if (exception && failing) failing.exception = { type: exception[2] as string, message: unescapeProbe(exception[3] as string) };
  }
  return [...found.values()].filter((probe) => probe.output !== undefined || probe.exception !== undefined);
};

const fileText = (doc: XmlDocument): string => encodeItemFile(doc).subarray(3).toString("utf8");

/** The step runs; the case expects the file text or the exception of the probe. */
async function check(probe: ProbeCase, preserveWhitespace: boolean, step: (doc: XmlDocument) => Promise<XmlDocument | void> | XmlDocument | void): Promise<void> {
  const doc = loadXml(probe.input, { preserveWhitespace });
  if (probe.exception) {
    await expect(Promise.resolve().then(() => step(doc))).rejects.toThrow(probe.exception.message);
    return;
  }
  const result = await step(doc);
  expect(fileText(result ?? doc), probe.id).toBe(probe.output);
}

describe("RemoveEmptyRelationships (EXP-412)", () => {
  for (const probe of cases("REL")) {
    it(probe.id, () =>
      check(probe, probe.id !== "REL7", (doc) => {
        if (probe.id === "REL8") {
          const relationships = doc.getElementsByTagName("Relationships")[0] as XmlElement;
          removeChild(relationships, relationships.firstChild as XmlNode);
        }
        removeEmptyRelationships(doc);
      }),
    );
  }

  it("refuses a null document", () => {
    expect(() => removeEmptyRelationships(null)).toThrow("Value cannot be null.\r\nParameter name: doc");
  });
});

describe("RemoveNamespaceNodes (EXP-410, EXP-411)", () => {
  for (const probe of cases("RNN")) it(probe.id, () => check(probe, true, (doc) => removeNamespaceNodes(doc)));
});

describe("CdataFilterXml (EXP-405, EXP-406)", () => {
  for (const probe of cases("CDF")) {
    it(probe.id, () => check(probe, true, (doc) => cdataFilterXml(doc, probe.id === "CDF12" ? "implementation_query" : "condition_xml")));
  }

  it("rebuilds the child even when nothing is replaced, so an empty one stays empty (EXP-405)", () => {
    const doc = loadXml('<AML><Item><condition_xml/></Item></AML>', { preserveWhitespace: true });
    cdataFilterXml(doc, "condition_xml");
    expect(outerXml(doc)).toBe("<AML><Item><condition_xml /></Item></AML>");
  });
});

/** The names the probe gave the helper before it ran the poly-list step. */
const lookupsWithPolytypes = (names: string[]): ItemLookups => ({ getPolytypeNames: async () => names }) as unknown as ItemLookups;

describe("ReplaceReferencesToPolyLists (EXP-407)", () => {
  for (const probe of cases("RPL")) {
    it(probe.id, () => check(probe, true, async (doc) => replaceReferencesToPolyLists(doc, lookupsWithPolytypes(["Poly", "Other Poly"]))));
  }

  it("fetches the names for every document, even one without a list property (EXP-408)", async () => {
    let fetched = 0;
    const lookups = { getPolytypeNames: async () => (fetched += 1, []) } as unknown as ItemLookups;
    await replaceReferencesToPolyLists(loadXml("<AML><Item type='x'/></AML>", { preserveWhitespace: true }), lookups);
    expect(fetched).toBe(1);
  });
});

/** The answer of the default-permission lookup in the probe (`ItDoc`): the data of the type `TypeA`. */
const typeAnswer = (isRelationship: string | null, useSrcAccess: string | null, permission: string | null): string =>
  '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><Result><Item type="ItemType" id="IT1">' +
  (isRelationship === null ? "" : `<is_relationship>${isRelationship}</is_relationship>`) +
  (useSrcAccess === null ? "" : `<use_src_access>${useSrcAccess}</use_src_access>`) +
  (permission === null
    ? ""
    : `<Relationships><Item type="Allowed Permission" id="AP1"><related_id><Item type="Permission" id="${permission}"><id>${permission}</id></Item></related_id></Item></Relationships>`) +
  "</Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>";

/** The data the probe seeded for each case: is_relationship, use_src_access and the default permission of `TypeA`. */
const SEEDS: Record<string, [string | null, string | null, string | null]> = {
  RPM1: ["0", "0", "PERM1"],
  RPM2: ["0", "0", "PERM2"],
  RPM3: ["1", "1", "PERM2"],
  RPM4: ["1", "0", "PERM2"],
  RPM5: ["1", "1", null],
  RPM6: ["0", "0", null],
  RPM7: [null, "1", "PERM1"],
  RPM8: ["1", null, "PERM1"],
  RPM9: ["1", "1", null],
};

describe("RemovePermissionIdWhenItMatchesToDefaultPermission (EXP-403, EXP-404)", () => {
  for (const probe of cases("RPM")) {
    it(probe.id, () => {
      const [isRelationship, useSrcAccess, permission] = SEEDS[probe.id] ?? ["0", "0", "PERM1"];
      const asked: string[] = [];
      const lookups = {
        getItemTypeWithDefaultPermission: async (name: string) => (asked.push(name), ResponseDocument.parse(typeAnswer(isRelationship, useSrcAccess, permission))),
      } as unknown as ItemLookups;
      return check(probe, true, (doc) => removePermissionIdWhenItMatchesToDefaultPermission(doc, lookups));
    });
  }

  const lookupFailing = { getItemTypeWithDefaultPermission: async () => null } as unknown as ItemLookups;

  it("removes the permission of an item whose type cannot be looked up (EXP-403, step 2)", async () => {
    const doc = loadXml('<AML><Item type="T"><permission_id>P</permission_id></Item></AML>', { preserveWhitespace: false });
    await removePermissionIdWhenItMatchesToDefaultPermission(doc, lookupFailing);
    expect(outerXml(doc)).toBe('<AML><Item type="T"></Item></AML>');
  });

  it("asks for the type of an item with no type attribute by the empty name, once per item with a permission", async () => {
    const asked: string[] = [];
    const lookups = { getItemTypeWithDefaultPermission: async (name: string) => (asked.push(name), null) } as unknown as ItemLookups;
    const doc = loadXml('<AML><Item><permission_id>P</permission_id></Item><Item type="B"/><Item type="C"><permission_id>Q</permission_id></Item></AML>', {
      preserveWhitespace: false,
    });
    await removePermissionIdWhenItMatchesToDefaultPermission(doc, lookups);
    expect(asked).toEqual(["", "C"]);
  });
});

describe("ApplyXsl for export.xsl (EXP-401, EXP-402)", () => {
  for (const probe of cases("AX")) {
    it(probe.id, () => check(probe, true, (doc) => applyXsl(doc)));
  }

  it("refuses a null document (AX9)", () => {
    expect(() => applyXsl(null)).toThrow("Value cannot be null.\r\nParameter name: xmlDoc");
  });

  it("returns a document that preserves white space", () => {
    const reloaded = applyXsl(
      loadXml(
        '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><Result><Item type="Method" id="M1"><name>m</name></Item></Result></SOAP-ENV:Body></SOAP-ENV:Envelope>',
        { preserveWhitespace: true },
      ),
    );
    expect(outerXml(reloaded)).toBe('<AML><Item type="Method" id="M1" action="add"><name>m</name></Item></AML>');
  });
});
