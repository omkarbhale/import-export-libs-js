import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Innovator } from "../../../src/client/innovator.js";
import { StubConnection, stubFault, stubResult } from "../../../src/client/stub-connection.js";
import { assertScratchImport, cleanup, createdItems, isScratch, isScratchItemName, preRun } from "./scratch.js";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "libsjs-scratch-test-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, ...path.split("/"));
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

describe("scratch names", () => {
  it("knows the three prefixes", () => {
    expect(isScratch("LIBSJS-SCRATCH-A")).toBe(true);
    expect(isScratch("libsjs-scratch-a")).toBe(false);
    expect(isScratchItemName("LIBSJS_SCRATCH_Type")).toBe(true);
    expect(isScratchItemName("xp-LIBSJS_SCRATCH_p")).toBe(true);
    expect(isScratchItemName("XP-libsjs_scratch_p")).toBe(true);
    expect(isScratchItemName("Part")).toBe(false);
    expect(isScratchItemName(null)).toBe(false);
  });
});

describe("assertScratchImport", () => {
  const item = (name: string) => `<AML><Item type="List" id="X" action="add"><name>${name}</name></Item></AML>`;

  it("accepts scratch packages with scratch files and names", () => {
    const dir = folder({ "LIBSJS-SCRATCH-P/Import/List/LIBSJS-SCRATCH-L.xml": item("LIBSJS-SCRATCH-L") });
    expect(() => assertScratchImport(["LIBSJS-SCRATCH-P"], dir)).not.toThrow();
  });

  it("refuses an empty list, a foreign package, a foreign file and a foreign name", () => {
    const dir = folder({
      "LIBSJS-SCRATCH-P/Import/List/other.xml": item("LIBSJS-SCRATCH-L"),
      "LIBSJS-SCRATCH-P/Import/List/LIBSJS-SCRATCH-M.xml": item("Stock"),
    });
    expect(() => assertScratchImport([], dir)).toThrow(/no packages/);
    expect(() => assertScratchImport(["com.aras.core"], dir)).toThrow(/package 'com.aras.core'/);
    expect(() => assertScratchImport(["LIBSJS-SCRATCH-P"], dir)).toThrow(/item 'Stock' in .*LIBSJS-SCRATCH-M\.xml, item file '.*other\.xml'/);
  });

  it("ignores files that are not item files", () => {
    const dir = folder({ "LIBSJS-SCRATCH-P/notes.xml": "<notes/>", "LIBSJS-SCRATCH-P/broken.xml": "<AML><" });
    expect(() => assertScratchImport(["LIBSJS-SCRATCH-P"], dir)).not.toThrow();
  });

  it("checks a language pack by the keyed name of every item", () => {
    const ok = folder({ "lp/xml/Forum.xml": `<export><Item type="Forum" id="1" keyed_name="LIBSJS-SCRATCH-F"/></export>` });
    const bad = folder({ "lp/xml/Forum.xml": `<export><Item type="Forum" id="1" keyed_name="General"/></export>` });
    expect(() => assertScratchImport(["LIBSJS-SCRATCH-LP"], ok, join(ok, "lp"))).not.toThrow();
    expect(() => assertScratchImport(["LIBSJS-SCRATCH-LP"], bad, join(bad, "lp"))).toThrow(/language pack item 'General'/);
  });
});

describe("createdItems", () => {
  const result = (inner: string) => stubResult(inner);

  it("takes the id of an add with none from the answer, by type", () => {
    const created = createdItems(
      `<AML><Item type="PackageDefinition" action="add"><name>n</name></Item><Item type="Method" id="M1" action="add"/></AML>`,
      result(`<Item type="PackageDefinition" id="P1"/><Item type="Method" id="M1"/>`),
    );
    expect(created).toEqual([
      { type: "PackageDefinition", id: "P1", unconfirmed: false },
      { type: "Method", id: "M1", unconfirmed: false },
    ]);
  });

  it("counts nothing for a fault, and an unconfirmed item for a failure of the transport", () => {
    expect(createdItems(`<Item type="List" id="L" action="add"/>`, stubFault("1", "no"))).toEqual([]);
    const transport =
      '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>1</faultcode><faultstring>t</faultstring><faultactor>HttpServerConnection</faultactor></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>';
    expect(createdItems(`<Item type="List" id="L" action="add"/>`, transport)).toEqual([{ type: "List", id: "L", unconfirmed: true }]);
  });

  it("counts a get and an edit as nothing", () => {
    expect(createdItems(`<Item type="List" id="L" action="get"/>`, result(`<Item type="List" id="L"/>`))).toEqual([]);
    expect(createdItems(`<Item type="List" id="L" action="edit"/>`, result(`<Item type="List" id="L"/>`))).toEqual([]);
  });
});

/** A server holding items by id, with the owner name the cleanup reads; it records the deletes. */
function server(items: Record<string, { type: string; name?: string; source?: { type: string; id: string }; refuseDeletes?: number }>) {
  const deleted: string[] = [];
  const refused = new Map<string, number>();
  const connection = new StubConnection((request) => {
    const id = /\bid="([^"]+)"/.exec(request)?.[1] ?? "";
    const action = /\baction="([^"]+)"/.exec(request)?.[1] ?? "";
    const found = items[id];
    if (action === "get") {
      if (found === undefined) return stubFault("0", "No items of type found.");
      const source = found.source === undefined ? "" : `<source_id type="${found.source.type}">${found.source.id}</source_id>`;
      return stubResult(`<Item type="${found.type}" id="${id}">${source}${found.name === undefined ? "" : `<name>${found.name}</name>`}</Item>`);
    }
    if (action === "delete") {
      const seen = refused.get(id) ?? 0;
      if (seen < (found?.refuseDeletes ?? 0)) {
        refused.set(id, seen + 1);
        return stubFault("1", "still referenced");
      }
      deleted.push(id);
      delete items[id];
      return stubResult(`<Item id="${id}"/>`);
    }
    return stubResult("");
  });
  return { inn: new Innovator(connection), deleted, requests: connection.requests };
}

describe("cleanup", () => {
  it("deletes newest first and reports what it did", async () => {
    const s = server({ A: { type: "List", name: "LIBSJS-SCRATCH-A" }, B: { type: "List", name: "LIBSJS-SCRATCH-B" } });
    const report = await cleanup(s.inn, [
      { type: "List", id: "A", unconfirmed: false },
      { type: "List", id: "B", unconfirmed: false },
    ]);
    expect(s.deleted).toEqual(["B", "A"]);
    expect(report.deleted.map((d) => d.id)).toEqual(["B", "A"]);
    expect(report.kept).toEqual([]);
  });

  it("deletes a relationship by its source's name, and keeps an item that is not scratch", async () => {
    const s = server({
      PG: { type: "PackageGroup", source: { type: "PackageDefinition", id: "PD" } },
      PD: { type: "PackageDefinition", name: "LIBSJS-SCRATCH-P" },
      STOCK: { type: "List", name: "Report Format Types" },
    });
    const report = await cleanup(s.inn, [
      { type: "PackageDefinition", id: "PD", unconfirmed: false },
      { type: "PackageGroup", id: "PG", unconfirmed: false },
      { type: "List", id: "STOCK", unconfirmed: false },
    ]);
    expect(s.deleted).toEqual(["PG", "PD"]);
    expect(report.kept).toEqual([{ type: "List", id: "STOCK", reason: "belongs to 'Report Format Types', not LIBSJS-SCRATCH-* or LIBSJS_SCRATCH_*" }]);
  });

  it("tries a refused delete again after the others, while a pass deletes something", async () => {
    const s = server({ A: { type: "List", name: "LIBSJS-SCRATCH-A", refuseDeletes: 1 }, B: { type: "List", name: "LIBSJS-SCRATCH-B" } });
    const report = await cleanup(s.inn, [
      { type: "List", id: "B", unconfirmed: false },
      { type: "List", id: "A", unconfirmed: false },
    ]);
    expect(s.deleted).toEqual(["B", "A"]);
    expect(report.kept).toEqual([]);
  });

  it("keeps an item whose delete is refused for good, and an item with no id", async () => {
    const s = server({ A: { type: "List", name: "LIBSJS-SCRATCH-A", refuseDeletes: 99 } });
    const report = await cleanup(s.inn, [
      { type: "List", id: "A", unconfirmed: false },
      { type: "List", id: "", unconfirmed: true },
    ]);
    expect(report.kept.map((k) => k.reason.split(":")[0])).toEqual(["its call failed in transport and the request names no id, so whether it was created is unknown".split(":")[0], "delete failed"]);
  });

  it("reports an unconfirmed item that is not there as unverified", async () => {
    const s = server({});
    const report = await cleanup(s.inn, [{ type: "List", id: "GONE", unconfirmed: true }]);
    expect(report.unverified).toEqual([{ type: "List", id: "GONE", unconfirmed: true }]);
  });
});

describe("preRun", () => {
  it("refuses to lock a row or version an item that is not scratch", async () => {
    const s = server({ X: { type: "List", name: "Report Format Types" } });
    await expect(preRun(s.inn, { lockRowsOf: ["com.aras.core"] })).rejects.toThrow(/non-scratch row/);
    await expect(preRun(s.inn, { versionBefore: [{ type: "List", id: "X" }] })).rejects.toThrow(/non-scratch item/);
    expect(s.requests.some((r) => r.includes('action="lock"') || r.includes('action="version"'))).toBe(false);
  });
});
