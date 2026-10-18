import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CItemException } from "../client/fault.js";
import { IOException } from "../io/errors.js";
import { loadPackageDom } from "./load-package-dom.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((path: Parameters<typeof actual.readFileSync>[0], ...rest: unknown[]) => {
    if (String(path).endsWith("locked.xml")) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    return (actual.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync };
});

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("IMP-011: a file held open by another process", () => {
  it("is an IOException that the engine wraps with the path of the last file it reached", () => {
    const root = mkdtempSync(join(tmpdir(), "libsjs-locked-"));
    roots.push(root);
    mkdirSync(join(root, "d"));
    writeFileSync(join(root, "d", "a.xml"), "<AML><Item type='List' action='add' id='a'/></AML>");
    writeFileSync(join(root, "d", "locked.xml"), "<AML><Item type='List' action='add' id='b'/></AML>");
    const path = join(root, "d", "locked.xml");
    let error: unknown;
    try {
      loadPackageDom(root, { writeLine: () => undefined });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CItemException);
    const fault = error as CItemException;
    expect(fault.faultcode).toBe(-1);
    expect(fault.message).toBe(`The process cannot access the file '${resolve(path)}' because it is being used by another process. Unable to load ${path}`);
    expect(fault.cause).toBeInstanceOf(IOException);
  });
});
