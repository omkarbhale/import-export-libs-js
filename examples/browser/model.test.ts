import { describe, expect, it } from "vitest";
import {
  FormError,
  MANIFEST_EXPORT_FOLDER,
  connectFailureHint,
  connectOptionsOf,
  dbPatchOptionsOf,
  exportOptionsOf,
  importOptionsOf,
  importSettingsOf,
  itemsOf,
  languagePackOptionsOf,
  listOf,
  numberOf,
} from "./model.js";

/**
 * What the page's controls make of their values (HOST-280): the options of the browser API, and the one place the password is read
 * (HOST-281).
 *
 * @spec HOST-280 HOST-281
 */

describe("connectOptionsOf", () => {
  it("reads the connection and leaves out what is not given", () => {
    expect(connectOptionsOf({ url: " https://a/b ", database: "db", userName: "admin", password: " s3 ", engine: "auto" })).toEqual({
      url: "https://a/b",
      database: "db",
      userName: "admin",
      password: " s3 ",
      engine: "auto",
    });
  });

  it("takes the engine, the timeout, the time zone and the version check", () => {
    const options = connectOptionsOf({ url: "u", database: "d", userName: "n", password: "p", engine: "14.35", timeoutMs: "-1", timeZone: "UTC", skipVersionCheck: true });
    expect(options).toMatchObject({ engine: "14.35", timeoutMs: -1, timeZoneName: "UTC", skipVersionCheck: true });
  });

  it("refuses an engine that is not one, and a timeout that is not a number", () => {
    expect(() => connectOptionsOf({ engine: "13.0" })).toThrow(FormError);
    expect(() => connectOptionsOf({ engine: "auto", timeoutMs: "soon" })).toThrow(/whole number/);
  });
});

describe("the password is read by connectOptionsOf and nowhere else (HOST-281)", () => {
  const form = { url: "u", database: "d", userName: "n", password: "hunter2-secret", engine: "auto", selection: "packages", packages: "p", manifestPath: "/m", lpPackage: "x" };
  it("is in no other option set", () => {
    for (const options of [exportOptionsOf(form), importOptionsOf(form), languagePackOptionsOf(form), dbPatchOptionsOf(form), importSettingsOf(form)]) {
      expect(JSON.stringify(options)).not.toContain("hunter2");
    }
    expect(connectOptionsOf(form).password).toBe("hunter2-secret");
  });
});

describe("lists", () => {
  it("splits on commas and line breaks and drops empty names", () => {
    expect(listOf("a, b\n\n c ,")).toEqual(["a", "b", "c"]);
    expect(listOf("")).toEqual([]);
  });

  it("splits an item at the first colon, as the CLI does", () => {
    expect(itemsOf("Permission:012233\n  Method:a:b \n")).toEqual([
      { type: "Permission", id: "012233" },
      { type: "Method", id: "a:b" },
    ]);
    for (const bad of ["Permission", ":id", "Type:"]) expect(() => itemsOf(bad)).toThrow(FormError);
  });

  it("reads a whole number or nothing", () => {
    expect(numberOf({ n: " 12 " }, "n", "n")).toBe(12);
    expect(numberOf({ n: "" }, "n", "n")).toBeUndefined();
    expect(numberOf({}, "n", "n")).toBeUndefined();
    expect(() => numberOf({ n: "1.5" }, "n", "the n")).toThrow("the n is a whole number, not '1.5'");
  });
});

describe("exportOptionsOf", () => {
  it("selects packages by name", () => {
    expect(exportOptionsOf({ selection: "packages", packages: "a\nb, c", level: "2", exportReferenced: true, unknownReferences: "remove-silently" })).toEqual({
      packages: ["a", "b", "c"],
      level: "2",
      exportReferencedItems: true,
      unknownReferences: "remove-silently",
    });
  });

  it("selects items, every package, or a manifest", () => {
    expect(exportOptionsOf({ selection: "items", items: "Type:id" })).toEqual({ items: [{ type: "Type", id: "id" }] });
    expect(exportOptionsOf({ selection: "all-packages" })).toEqual({ allPackages: true });
    expect(exportOptionsOf({ selection: "from-manifest", manifest: "/m.mf" })).toEqual({
      manifest: "/m.mf",
      manifestMode: "from-manifest",
      workingDirectory: MANIFEST_EXPORT_FOLDER,
    });
    expect(exportOptionsOf({ selection: "use-import" })).toMatchObject({ manifest: "/imports.mf", manifestMode: "use-import" });
  });

  it("passes the 14.35 options, and leaves the engine's refusal to the library", () => {
    expect(exportOptionsOf({ selection: "packages", packages: "a", parallelism: "6", languageResources: "only", languages: "de", verbose: true, onItemError: "abort-package" })).toEqual({
      packages: ["a"],
      parallelism: 6,
      languageResources: "only",
      languages: "de",
      verbose: true,
      onItemError: "abort-package",
    });
  });
});

describe("importOptionsOf and its siblings", () => {
  it("reads the import settings", () => {
    expect(importOptionsOf({ packages: "a, b", merge: true, release: "R1", description: "d", languages: "de", manifestPath: "/x.mf", batch: true, batchMax: "5", collectErrors: true, maxErrors: "2" })).toEqual({
      packages: ["a", "b"],
      merge: true,
      release: "R1",
      description: "d",
      languages: "de",
      manifestPath: "/x.mf",
      batch: { maxSize: 5 },
      collectErrors: { maxCount: 2 },
    });
    expect(importOptionsOf({ batch: true, collectErrors: true })).toEqual({ batch: true, collectErrors: true });
    expect(importOptionsOf({})).toEqual({});
  });

  it("refuses a size or a limit with no mode, as the CLI does", () => {
    expect(() => importOptionsOf({ batchMax: "5" })).toThrow(/needs AML batch/);
    expect(() => importOptionsOf({ maxErrors: "5" })).toThrow(/needs collect errors/);
  });

  it("reads a language pack and DB patches", () => {
    expect(languagePackOptionsOf({ lpPackage: " lp ", lpPath: "/c.xml", lpDebug: true, merge: true })).toEqual({ lpPackage: "lp", lpPath: "/c.xml", lpDebug: true, merge: true });
    expect(dbPatchOptionsOf({ manifestPath: "/manifest.xml", patchesFolder: "/p", toolName: "tool", osUser: "root" })).toEqual({
      manifestPath: "/manifest.xml",
      patchesFolder: "/p",
      toolName: "tool",
      osUser: "root",
    });
  });

  it("refuses an empty field that has no default, before anything is sent", () => {
    expect(() => languagePackOptionsOf({ lpPackage: "  " })).toThrow(FormError);
    expect(() => dbPatchOptionsOf({ manifestPath: "" })).toThrow(FormError);
  });
});

describe("connectFailureHint", () => {
  it("names the prerequisites for the network-level failures of the SOAP endpoint and of the OAuth client", () => {
    for (const failure of ["Unable to connect to the remote server", "Failed login to Innovator; original error: <faultstring>An error occurred while sending the request.</faultstring>"]) {
      expect(connectFailureHint(failure)).toMatch(/allowedCorsOrigins.*12 SP9.*SOAP endpoint/);
    }
  });

  it("says nothing when the server answered", () => {
    expect(connectFailureHint("Failed login to Innovator; original error: Authentication failed for admin")).toBeUndefined();
    expect(connectFailureHint("The remote server returned an error: (500) Internal Server Error.")).toBeUndefined();
  });
});
