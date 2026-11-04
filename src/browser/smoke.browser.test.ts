import { describe, expect, it } from "vitest";
import * as bundle from "../browser.js";
import { md5Digest, PasswordDigest, sha256Digest } from "../client/digest.js";
import { parseXml } from "../client/mini-xml.js";
import { MemoryVfs } from "../host/memory-fs.js";
import { xmlDocumentSave } from "../xml/save.js";
import { loadXml } from "../xml/index.js";
import { Buffer as ShimBuffer } from "./buffer-shim.js";
import { loadFixtureTree, readFixtureText } from "./test-support.browser.js";

/**
 * The smoke test of the browser project (HOST-263): in each browser, the bundle's entry imports, the browser host is made, the
 * digests are computed, XML is parsed and an item file is saved through the environment's file system. It is what proves that the
 * harness itself works (the module replacement, the `Buffer`, the fixture commands) before any replay depends on it.
 *
 * @spec HOST-263 HOST-260 HOST-243 HOST-240 HOST-215
 */
describe("HOST-263: the browser project's smoke test", () => {
  it("runs in a page of the browser the report names", () => {
    expect(typeof document).toBe("object");
    expect(typeof process).toBe("undefined");
    expect(navigator.userAgent).toMatch(/Chrome|Chromium|Firefox|AppleWebKit|Safari/);
  });

  it("has the buffer package as its Buffer, defined by the setup file (HOST-262)", () => {
    expect(Buffer).toBe(ShimBuffer);
    expect(Buffer.from("é", "utf8").toString("hex")).toBe("c3a9");
    expect(Buffer.from("A\u{1F600}", "utf16le").swap16().toString("hex")).toBe("0041d83dde00");
  });

  it("imports the bundle's entry with the browser host's default and no Node API (HOST-260)", () => {
    expect(typeof bundle.createBrowserHost).toBe("function");
    expect(typeof bundle.createFetchTransport).toBe("function");
    expect(typeof bundle.ImportExportManager).toBe("function");
    expect(bundle.LIBRARY_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect("nodeTransport" in bundle).toBe(false);
  });

  it("makes the browser host with the platform of a browser, and a clock that moves (HOST-243)", () => {
    const fs = new MemoryVfs();
    const host = bundle.createBrowserHost({ fs });
    expect(host.env.platform).toBe("browser");
    expect(host.env.cwd()).toBe("/");
    expect(host.env.randomBytes(16)).toHaveLength(16);
    expect(host.env.randomUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const before = host.env.monotonicNs();
    expect(host.env.monotonicNs() >= before).toBe(true);
    expect(host.fs).toBe(fs);
  });

  it("computes the digests of the wire protocol in process (HOST-240)", () => {
    expect(md5Digest("x")).toBe("9dd4e461268c8034f5c8564e155c67a6");
    // the engine writes the hash in upper case (WIRE-014)
    expect(sha256Digest("x")).toBe("2D711642B726B04401627CA9FBAC32F5C8530FB1903CC4DB02258717921A4881");
    const digest = new PasswordDigest("x");
    expect(digest.mode).toBe("MD5");
    expect(digest.value).toBe("9dd4e461268c8034f5c8564e155c67a6");
  });

  it("parses XML with the client's reader and the XML core's loader", () => {
    const doc = parseXml('<Item type="Part" id="1"><name>é</name></Item>');
    expect(doc.root.name).toBe("Item");
    expect(doc.root.attributes.find((attribute) => attribute.name === "type")?.value).toBe("Part");
    expect(loadXml("<AML><Item/></AML>", { preserveWhitespace: false })).toBeDefined();
  });

  it("saves an item file through the environment's file system, with the engine's bytes", () => {
    const fs = new MemoryVfs();
    fs.mkdir("/out");
    const environment = { fs, host: bundle.createBrowserHost({ fs }).env };
    xmlDocumentSave(loadXml("<AML><Item type='Part'/></AML>", { preserveWhitespace: false }), "/out/a.xml", environment);
    const bytes = fs.readFile("/out/a.xml");
    // no byte-order mark from `Save`; the text is the document's
    expect(new TextDecoder().decode(bytes)).toContain("<Item type=\"Part\"");
  });

  it("reads a recorded fixture through the vitest server, and refuses a path outside fixtures/", async () => {
    const files = await loadFixtureTree("fixtures/14.0.7/import/s0-mini-defaults");
    expect(files.length).toBeGreaterThan(3);
    expect(files.map((file) => file.path)).toEqual([...files.map((file) => file.path)].sort());
    expect(files.every((file) => file.bytes instanceof Uint8Array)).toBe(true);
    expect(JSON.parse(await readFixtureText("fixtures/14.0.7/import/s0-mini-defaults/step-1/run.json"))).toBeTypeOf("object");
    await expect(readFixtureText("fixtures/../package.json")).rejects.toThrow(/HOST-263/);
    await expect(readFixtureText("package.json")).rejects.toThrow(/HOST-263/);
  });
});
