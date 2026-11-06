import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connect, exportPackages, importPackages } from "../browser.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { LOGIN } from "./api-test-support.js";
import { SYNTH_MANIFEST, SYNTH_PACKAGE, SYNTH_TEMPLATES, type SynthTemplates, synthFilePath, synthItemInfo, synthItemText, synthItems } from "./synth-package.js";
import { serverForm, synthExportServer, synthImportServer } from "./synth-server.js";

/**
 * The synthetic package of the size budget (HOST-277, HOST-278): deterministic, made of real item files with unique ids, and a package
 * of a few items goes through the engine, import and export, with the output equal to the input.
 *
 * @spec HOST-277 HOST-278
 */
const templates = Object.fromEntries(Object.entries(SYNTH_TEMPLATES).map(([kind, file]) => [kind, readFileSync(file, "utf8")])) as SynthTemplates;
const spec = { seed: 7 };
const WORLD = "A73B655731924CD0B027E4F4D5FCC0A9";

const idsOf = (text: string): string[] => [...text.matchAll(/<Item\b[^>]*\bid="([0-9A-F]{32})"/g)].map((match) => match[1] as string);

describe("HOST-277: the items are made from the recorded files, and the same every time", () => {
  it("make the same bytes for the same seed and other ids for another", () => {
    const a = synthItemText(spec, templates, 5).text;
    expect(synthItemText(spec, templates, 5).text).toBe(a);
    const other = synthItemText({ seed: 8 }, templates, 5).text;
    expect(other).not.toBe(a);
    expect(idsOf(other).some((id) => idsOf(a).includes(id))).toBe(false);
  });

  it("leave no id defined twice in a package, and keep the one a file only refers to", () => {
    const seen = new Set<string>();
    let methods = 0;
    for (let index = 0; index < 120; index += 1) {
      const { info, text } = synthItemText(spec, templates, index);
      expect(text.startsWith("﻿<AML>"), `${info.name} starts with the byte-order mark of the recorded files`).toBe(true);
      for (const id of idsOf(text)) {
        expect(seen.has(id), `${info.name}: ${id} is defined once`).toBe(false);
        seen.add(id);
      }
      expect(idsOf(text)[0], "the first id is the item's").toBe(info.id);
      expect(text).toContain(info.name);
      if (info.kind === "Method") {
        methods += 1;
        expect(text, "the identity the method refers to is kept").toContain(WORLD);
      }
    }
    expect(methods).toBeGreaterThan(0);
  });

  it("draw every kind, and scale lists, forms and methods", () => {
    const kinds = new Map<string, number>();
    let longest = 0;
    for (let index = 0; index < 300; index += 1) {
      const { info, text } = synthItemText(spec, templates, index);
      kinds.set(info.kind, (kinds.get(info.kind) ?? 0) + 1);
      longest = Math.max(longest, text.length);
    }
    expect([...kinds.keys()].sort()).toEqual(["Form", "List", "Method", "Sequence", "UserMessage", "Variable"]);
    expect(longest, "a few items are large").toBeGreaterThan(50_000);
  });

  it("know an item's kind, name and id without making its text", () => {
    const info = synthItemInfo(spec, 42);
    expect(info.name).toBe(`${SYNTH_PACKAGE}-${info.kind}-000042`);
    expect(synthItemText(spec, templates, 42).info).toEqual(info);
  });

  it("stop at the stated bytes", () => {
    let total = 0;
    let count = 0;
    let last = 0;
    for (const item of synthItems(spec, templates, 300_000)) {
      total += item.bytes.byteLength;
      last = item.bytes.byteLength;
      count += 1;
      expect(item.path).toBe(synthFilePath(item.info.kind, item.info.name));
    }
    expect(total).toBeGreaterThanOrEqual(300_000);
    expect(total - last, "the package stopped as soon as it was large enough").toBeLessThan(300_000);
    expect(count).toBeGreaterThan(5);
  });
});

describe("HOST-278: a package of a few items goes through the engine against the servers that say yes", () => {
  it("imports, every item added, with no error", async () => {
    const files: Record<string, Uint8Array | string> = { "/imports.mf": SYNTH_MANIFEST };
    let count = 0;
    for (const item of synthItems(spec, templates, 120_000)) {
      files[`/${item.path}`] = item.bytes;
      count += 1;
    }
    const vfs = new MemoryVfs();
    vfs.mount(files);
    const server = synthImportServer();
    const session = await connect({ ...LOGIN, engine: "14.0.7", transport: server.transport });
    const result = await importPackages(session, { source: vfs, osUser: "size" });
    expect(result.summary).toMatchObject({ operation: "import", result: "success", returnCode: 0 });
    expect(result.summary.messages.errors).toBe(0);
    expect(server.adds, "every item and the rows around it were added").toBeGreaterThanOrEqual(count);
  }, 60_000);

  it("warns, in the run's own messages, when the package is above the 50 MB that is known to complete", async () => {
    const files: Record<string, Uint8Array | string> = { "/imports.mf": SYNTH_MANIFEST, "/big.bin": new Uint8Array(51_000_000) };
    for (const item of synthItems(spec, templates, 20_000)) files[`/${item.path}`] = item.bytes;
    const vfs = new MemoryVfs();
    vfs.mount(files);
    const session = await connect({ ...LOGIN, engine: "14.0.7", transport: synthImportServer().transport });
    const result = await importPackages(session, { source: vfs, osUser: "size" });
    const warnings = result.messages.filter((message) => message.source === "host" && message.level === "warning");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.text).toMatch(/51 MB.*40 to 70 times.*50 MB is the largest.*command line tool/);
    expect(result.summary.messages.warnings).toBe(1);
    expect(result.summary.result).toBe("success");

    // a package of 50 MB or less is not warned about
    const small = new MemoryVfs();
    small.mount({ "/imports.mf": SYNTH_MANIFEST, ...Object.fromEntries([...synthItems(spec, templates, 20_000)].map((item) => [`/${item.path}`, item.bytes])) });
    const again = await importPackages(await connect({ ...LOGIN, engine: "14.0.7", transport: synthImportServer().transport }), { source: small, osUser: "size" });
    expect(again.messages.filter((message) => message.source === "host")).toEqual([]);
  }, 60_000);

  it("does not warn about a package of the measured 50 MB, which a little overshoots it", async () => {
    const vfs = new MemoryVfs();
    vfs.mount({ "/imports.mf": SYNTH_MANIFEST, "/big.bin": new Uint8Array(50_080_052), ...Object.fromEntries([...synthItems(spec, templates, 20_000)].map((item) => [`/${item.path}`, item.bytes])) });
    const session = await connect({ ...LOGIN, engine: "14.0.7", transport: synthImportServer().transport });
    const result = await importPackages(session, { source: vfs, osUser: "size" });
    expect(result.messages.filter((message) => message.source === "host")).toEqual([]);
  }, 60_000);

  it("exports the items it is served, and writes back the files they were made as", async () => {
    const count = 25;
    const server = synthExportServer(spec, templates, count);
    server.prepare();
    const session = await connect({ ...LOGIN, engine: "14.0.7", transport: server.transport });
    const result = await exportPackages(session, { packages: [server.packageName] });
    expect(result.summary).toMatchObject({ operation: "export", result: "success" });
    expect(server.itemsServed).toBe(count);
    for (let index = 0; index < count; index += 1) {
      const { info, text } = synthItemText(spec, templates, index);
      const path = `/export/${synthFilePath(info.kind, info.name)}`;
      expect(result.vfs.exists(path), `${info.name} is exported`).toBe(true);
      expect(Buffer.from(result.vfs.readFile(path)).toString("utf8"), `${info.name} is the file it was made as`).toBe(text);
    }
  }, 60_000);

  it("give an item as the server does: no action, the type's id and the system properties", () => {
    const { info, text } = synthItemText(spec, templates, 3);
    const served = serverForm(info.kind, info, text);
    expect(served).not.toContain('action="add"');
    expect(served).not.toContain("<AML>");
    expect(served).toMatch(new RegExp(`^\\s*<Item type="${info.kind}" typeId="[0-9A-F]{32}" id="${info.id}"><config_id`));
    expect(served).toContain("<created_by_id");
  });
});
