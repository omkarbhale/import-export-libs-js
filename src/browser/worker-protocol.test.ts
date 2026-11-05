import { describe, expect, it } from "vitest";
import * as browser from "../browser.js";
import { CItemException } from "../client/fault.js";
import { DotNetException } from "../client/dotnet.js";
import { TransportError } from "../client/transport.js";
import { ArasVersion, VersionRefusal } from "../client/version.js";
import { SelectionRefused } from "../cli/export-selection.js";
import { AggregateException } from "../export/parallel-for-each.js";
import { DirectoryNotFoundException, FileNotFoundException, IOException } from "../io/errors.js";
import { OptionError } from "./api-run.js";
import { CommitError } from "./fsa.js";
import { ZipError } from "./zip.js";
import {
  ForwardedAbort,
  TRANSPORTED_ERRORS,
  TransferBag,
  WORKER_PROTOCOL_VERSION,
  WorkerCrashedError,
  fromWorker,
  isEnvelope,
  rehydrateError,
  serializeError,
  toWorker,
} from "./worker-protocol.js";

/**
 * The protocol of the engine's Worker, without a Worker (HOST-274, HOST-275): the way an error crosses and comes back as an object of its
 * class, which buffers are transferred and which are copied, and the versioned envelope.
 *
 * @spec HOST-274 HOST-275
 */

/** What an error looks like after it crossed: serialised, cloned as a message is, rebuilt. */
const across = (error: unknown): unknown => rehydrateError(structuredClone(serializeError(error)));

describe("errors across the boundary (HOST-275)", () => {
  it("rebuilds an error as an object of its class, with the message, the name and the stack text it had", () => {
    const original = new CItemException(7, "the fault string", "the detail");
    const copy = across(original) as CItemException;
    expect(copy).toBeInstanceOf(CItemException);
    expect(copy).toBeInstanceOf(Error);
    expect(copy).not.toBe(original);
    expect(copy.message).toBe(original.message);
    expect(copy.name).toBe("CItemException");
    expect(copy.stack).toBe(original.stack);
    expect(copy.faultcode).toBe(7);
    expect(copy.faultstring).toBe("the fault string");
    expect(copy.faultdetail).toBe("the detail");
    expect(copy.bInnError).toBe(true);
    expect(Object.prototype.toString.call(copy)).toBe("[object Error]");
  });

  it("keeps a subclass a subclass, and its members: the version refusal's server version is an ArasVersion again", () => {
    const original = new VersionRefusal("12.0", new ArasVersion(14, 0, 0, 36073, 9));
    const copy = across(original) as VersionRefusal;
    expect(copy).toBeInstanceOf(VersionRefusal);
    expect(copy).toBeInstanceOf(CItemException);
    expect(copy.serverVersion).toBeInstanceOf(ArasVersion);
    expect(copy.serverVersion.fullString).toBe("14.0.9.36073");
    expect(copy.fittingEngines).toEqual(original.fittingEngines);
    expect(copy.hint).toBe(original.hint);
    expect(copy.engine).toBe("12.0");
  });

  it("keeps a DotNetException's type name and an IO error's file name, through the subclass the engine catches by", () => {
    const dot = across(new DotNetException("System.IO.IOException", "boom")) as DotNetException;
    expect(dot).toBeInstanceOf(DotNetException);
    expect(dot.typeName).toBe("System.IO.IOException");
    expect(dot.faultString).toBe("System.IO.IOException: boom");
    const missing = across(new FileNotFoundException("a.xml")) as FileNotFoundException;
    expect(missing).toBeInstanceOf(FileNotFoundException);
    expect(missing).toBeInstanceOf(IOException);
    expect(missing.fileName).toBe("a.xml");
    const folder = across(new DirectoryNotFoundException("/x")) as DirectoryNotFoundException;
    expect(folder).toBeInstanceOf(DirectoryNotFoundException);
    expect(folder).toBeInstanceOf(IOException);
    expect(across(new IOException("plain"))).not.toBeInstanceOf(FileNotFoundException);
  });

  it("rebuilds the errors an error holds: the inner exceptions of an aggregate, and a cause", () => {
    const original = new AggregateException([new OptionError("one"), new DotNetException("System.Xml.XmlException", "two"), "not an error"]);
    const copy = across(original) as AggregateException;
    expect(copy).toBeInstanceOf(AggregateException);
    expect(copy.innerExceptions[0]).toBeInstanceOf(OptionError);
    expect((copy.innerExceptions[0] as Error).message).toBe("one");
    expect(copy.innerExceptions[1]).toBeInstanceOf(DotNetException);
    expect(copy.innerExceptions[2]).toBe("not an error");
    const caused = new Error("outer", { cause: new TransportError("refused", "cannot connect", "dev.example") });
    const rebuilt = across(caused) as Error;
    expect(rebuilt.cause).toBeInstanceOf(TransportError);
    expect((rebuilt.cause as TransportError).host).toBe("dev.example");
    expect((rebuilt.cause as TransportError).failure).toBe("refused");
  });

  it("keeps the coded members the adapters and the lookups add", () => {
    const zip = across(new ZipError("ZIP_TOO_LARGE", "too big")) as ZipError;
    expect(zip).toBeInstanceOf(ZipError);
    expect(zip.code).toBe("ZIP_TOO_LARGE");
    const refused = across(new SelectionRefused(["[ERROR] no such package"], ["a"], ["b"], ["[WARN] w"])) as SelectionRefused;
    expect(refused).toBeInstanceOf(SelectionRefused);
    expect(refused.lines).toEqual(["[ERROR] no such package"]);
    expect(refused.noPackage).toEqual(["a"]);
    expect(refused.warnings).toEqual(["[WARN] w"]);
    const commit = across(new CommitError([{ path: "a", error: new Error("nope") }], { files: 1, directories: 0, stubs: 0, bytes: 3 }, false)) as CommitError;
    expect(commit).toBeInstanceOf(CommitError);
    expect(commit.failures[0]?.error).toBeInstanceOf(Error);
    expect(commit.written.files).toBe(1);
    const disk = across(Object.assign(new Error("ENOSPC: no space left"), { code: "ENOSPC", path: "/x" })) as Error & { code: string; path: string };
    expect(disk.code).toBe("ENOSPC");
    expect(disk.path).toBe("/x");
  });

  it("rebuilds the language's own errors, and an error of a class it does not know as an Error with the name it had", () => {
    expect(across(new TypeError("t"))).toBeInstanceOf(TypeError);
    expect(across(new RangeError("r"))).toBeInstanceOf(RangeError);
    class Strange extends Error {
      override name = "Strange";
      extra = { a: 1 };
    }
    const strange = across(new Strange("odd")) as Error & { extra: { a: number } };
    expect(strange).toBeInstanceOf(Error);
    expect(strange.name).toBe("Strange");
    expect(strange.message).toBe("odd");
    expect(strange.extra).toEqual({ a: 1 });
    const aborted = across(new DOMException("aborted", "AbortError"));
    expect(aborted).toBeInstanceOf(DOMException);
    expect(aborted).toMatchObject({ name: "AbortError", message: "aborted" });
  });

  it("sends what is not an error as the value, and leaves out what a message cannot carry", () => {
    expect(across("a string")).toBe("a string");
    expect(across(42)).toBe(42);
    expect(across(undefined)).toBeUndefined();
    expect(across({ a: [1, { b: 2 }] })).toEqual({ a: [1, { b: 2 }] });
    const error = Object.assign(new Error("e"), { callback: () => 1, symbol: Symbol("x"), kept: 3, instance: new (class Local {})() }) as Error & { kept: number };
    // the message must clone, whatever the error holds
    expect(() => structuredClone(serializeError(error))).not.toThrow();
    const copy = across(error) as Error & { kept: number; callback?: unknown };
    expect(copy.kept).toBe(3);
    expect(copy.callback).toBeUndefined();
  });

  it("does not follow a cycle for ever", () => {
    const error = new Error("loop") as Error & { self?: unknown };
    error.self = error;
    error.cause = error;
    expect(() => structuredClone(serializeError(error))).not.toThrow();
    expect((across(error) as Error).message).toBe("loop");
  });

  it("names a class before the class it extends, so that an instance is sent as the most specific", () => {
    const names = TRANSPORTED_ERRORS.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
    TRANSPORTED_ERRORS.forEach(([name, parent], index) => {
      for (const [later, child] of TRANSPORTED_ERRORS.slice(index + 1)) {
        expect(child.prototype instanceof parent, `${later} extends ${name} but comes after it`).toBe(false);
      }
    });
    expect((serializeError(new VersionRefusal("12.0", new ArasVersion(14, 0, 0, 1, 0))) as { type: string }).type).toBe("VersionRefusal");
  });

  it("has every error class that the browser entry exports", () => {
    const registered = new Set(TRANSPORTED_ERRORS.map(([, constructor]) => constructor as unknown));
    const missing = Object.entries(browser)
      .filter(([, value]) => typeof value === "function" && (value as { prototype?: unknown }).prototype instanceof Error)
      .map(([name]) => name)
      .filter((name) => !registered.has((browser as Record<string, unknown>)[name]));
    expect(missing, "add these to CLASSES in worker-protocol.ts, so that they keep their class across the Worker").toEqual([]);
  });

  it("marks the abort the client raised, which the client replaces with its own reason", () => {
    expect((serializeError(new ForwardedAbort()) as { type: string }).type).toBe("ForwardedAbort");
    expect(across(new WorkerCrashedError("x"))).toBeInstanceOf(WorkerCrashedError);
  });
});

describe("buffers across the boundary (HOST-275)", () => {
  it("transfers the buffer of a view that is the whole of it, once", () => {
    const bag = new TransferBag();
    const bytes = new Uint8Array([1, 2, 3]);
    expect(bag.take(bytes)).toBe(bytes);
    expect(bag.list).toEqual([bytes.buffer]);
  });

  it("copies a view into a larger buffer, a second view of a taken buffer, a buffer it was told to copy, and a shared buffer", () => {
    const bag = new TransferBag();
    const large = new Uint8Array(16).fill(5);
    const slice = large.subarray(4, 8);
    const copy = bag.take(slice);
    expect(copy).not.toBe(slice);
    expect([...copy]).toEqual([5, 5, 5, 5]);
    expect(copy.buffer).not.toBe(large.buffer);
    expect(bag.list).toEqual([]);

    const whole = new Uint8Array([9, 9]);
    expect(bag.take(whole)).toBe(whole);
    const again = new Uint8Array(whole.buffer);
    expect(bag.take(again)).not.toBe(again);
    expect(bag.list).toHaveLength(1);

    if (typeof SharedArrayBuffer !== "undefined") {
      const shared = new Uint8Array(new SharedArrayBuffer(4));
      expect(bag.take(shared)).not.toBe(shared);
      expect(bag.list).toHaveLength(1);
    }
  });

  it("leaves the transferred bytes whole in the sender until the message is posted", () => {
    const bag = new TransferBag();
    const bytes = new Uint8Array([1, 2, 3]);
    bag.take(bytes);
    expect(bytes.byteLength).toBe(3);
    const { port1, port2 } = new MessageChannel();
    port1.postMessage({ bytes }, bag.list);
    expect(bytes.byteLength).toBe(0);
    port1.close();
    port2.close();
  });
});

describe("the envelope (HOST-274)", () => {
  it("stamps the protocol version on every message, in both directions", () => {
    expect(toWorker({ kind: "dispose" })).toEqual({ v: WORKER_PROTOCOL_VERSION, kind: "dispose" });
    expect(fromWorker({ kind: "disposed" })).toEqual({ v: WORKER_PROTOCOL_VERSION, kind: "disposed" });
    expect(WORKER_PROTOCOL_VERSION).toBe(1);
  });

  it("tells a message of the protocol from anything else", () => {
    expect(isEnvelope({ v: 1, kind: "ready" })).toBe(true);
    expect(isEnvelope({ v: "1", kind: "ready" })).toBe(false);
    expect(isEnvelope({ v: 1 })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope("hello")).toBe(false);
  });
});
