import { CItemException } from "../client/fault.js";
import { DotNetException } from "../client/dotnet.js";
import { EngineNotSupportedError } from "../client/engine-support.js";
import { DiscoveryNotFound, OAuthServerError } from "../client/oauth.js";
import { UnmappedTimeZoneError } from "../client/timezone.js";
import { TransportError } from "../client/transport.js";
import { ArasVersion, VersionRefusal } from "../client/version.js";
import { SelectionRefused } from "../cli/export-selection.js";
import { DbPatchesNotInEngineError } from "../db-patches/engines.js";
import type { Engine } from "../engines.js";
import { OptionNotSupportedError } from "../export/messages.js";
import { AggregateException } from "../export/parallel-for-each.js";
import { WrongFormatOfTheAmlException } from "../import/delayed-resolution.js";
import { TypeNameOutsideRepertoireError } from "../import/nls-word-sort.js";
import {
  ArgumentNullException,
  DirectoryNotFoundException,
  Exception,
  FileNotFoundException,
  IOException,
  InvalidOperationException,
  KeyNotFoundException,
  NullReferenceException,
  OperationCanceledException,
  PathNotUsableError,
  PathTooLongException,
  UnauthorizedAccessException,
} from "../io/errors.js";
import { DuplicateKeyError, RandomizedHashingError } from "../manifest/netfx-hashtable.js";
import { StackOverflowException } from "../recursion-limit.js";
import { ArgumentException, NotSupportedException, XPathException, XmlException } from "../xml/errors.js";
import { OptionError, RunAbortedError } from "./api-run.js";
import type { ApiMessage, OperationResult, ProgressEvent } from "./api-run.js";
import { SessionBusyError, SessionClosedError } from "./api-session.js";
import { CommitError } from "./fsa.js";
import { ZipError } from "./zip.js";

/**
 * What the main thread and the engine's Worker say to each other (HOST-274, HOST-275): the protocol's version, the messages in
 * both directions, the way an error object crosses the boundary and is rebuilt with the class it had, and the rule for which
 * buffers are transferred and which are copied. It names no global of a page or a Worker, so the same module serves the client, the
 * Worker's side and the tests under Node.
 *
 * @spec HOST-274 HOST-275
 */

/** The version of the messages (HOST-274). A side that receives another version refuses it by name instead of misreading it. */
export const WORKER_PROTOCOL_VERSION = 1;

// ------------------------------------------------------------------------------------------------------------------- errors

/** What a call of the Worker's client rejects with when the Worker was stopped before the call could finish (HOST-274). */
export class WorkerDisposedError extends Error {
  override name = "WorkerDisposedError";
}

/** What a call rejects with when the Worker failed to start, raised an uncaught error, or sent what the client cannot read (HOST-274). */
export class WorkerCrashedError extends Error {
  override name = "WorkerCrashedError";
}

/** The two sides speak different versions of the protocol, or one sent a message the other does not know (HOST-274). */
export class WorkerProtocolError extends Error {
  override name = "WorkerProtocolError";
}

/** The reason the Worker gives the engine's `AbortSignal` when the client's signal (or `abort()`) was raised; the client puts its own reason back (HOST-274). */
export class ForwardedAbort extends Error {
  override name = "ForwardedAbort";

  constructor() {
    super("The operation was aborted.");
  }
}

// ------------------------------------------------------------------------------------------------------------------ the wire

/** A message of the wire has the protocol version in `v` (HOST-274). */
interface Versioned {
  v: number;
}

/** What the caller's call listens to, so that the Worker streams only that (HOST-274): the two event streams, and the question of a failed item. */
export interface CallWants {
  message: boolean;
  progress: boolean;
  onItemError: boolean;
}

/** Where a source of files is mounted from, as a Worker can mount it; the callbacks of `MountOptions` stay behind (HOST-275). */
export interface WorkerMountOptions {
  /** As the adapters' `root` (HOST-254): `"keep"` (default) or `"auto"`. */
  root?: "auto" | "keep";
  /** The most bytes of content to read (HOST-254). Default unlimited for a folder, the zip adapter's for a zip. */
  maxBytes?: number;
  /** `"default"` (the adapters' `defaultInclude`: large files the engine does not read are stubs) or `"all"` (every file is read). */
  include?: "default" | "all";
}

/** A source of files as it crosses the boundary (HOST-275). */
export type WireSource =
  | { kind: "zip"; bytes: Uint8Array | WireBlob; maxBytes?: number }
  | { kind: "files"; files: Record<string, Uint8Array | string> }
  | { kind: "file-list"; entries: Array<{ path: string; file: WireBlob }>; options: WorkerMountOptions }
  | { kind: "drop"; entries: Array<{ path: string; file?: WireBlob }>; options: WorkerMountOptions }
  | { kind: "directory"; handle: unknown; options: Omit<WorkerMountOptions, "root"> };

/** The part of a `Blob` or `File` the Worker reads. */
export interface WireBlob {
  readonly name?: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/** The options of a call as they cross: the caller's, with every function, signal and tree replaced by what the wire can carry. */
export interface WireConnectOptions {
  url: string;
  database: string;
  userName?: string;
  password?: string;
  engine?: Engine | "auto";
  skipVersionCheck?: boolean;
  timeZoneName?: string;
  locale?: string;
  timeoutMs?: number;
  /** True when the caller's `transport` serves the Worker's requests: they are sent to the main thread (HOST-274). */
  transport: boolean;
  /** True when the caller's `tokenProvider` is asked for each token (HOST-274). */
  tokenProvider: boolean;
}

/** The kinds of call (HOST-274). */
export type CallOp = "connect" | "close" | "export" | "import" | "language-pack" | "db-patches";

/** An `ArasVersion` as a structured clone leaves it: its fields, without the class's getters. */
export type WireVersion = Pick<ArasVersion, "major" | "minor" | "servicePack" | "build" | "serviceUpdate">;

/** Builds the `ArasVersion` again from what crossed. */
export function rehydrateVersion({ major, minor, servicePack, build, serviceUpdate }: WireVersion): ArasVersion {
  return new ArasVersion(major, minor, servicePack, build, serviceUpdate);
}

/** The session a call returns, with the fields of `Session` that are data (HOST-274). */
export interface WireSession {
  engine: Engine;
  serverVersion: WireVersion;
  url: string;
  database: string;
  userName: string;
  timeoutMs: number;
  versionGate: { engine: Engine; server: WireVersion; accepted: boolean; skipped: boolean; fittingEngines: Engine[] } | undefined;
}

/** What an operation returns across the boundary: `OperationResult` with no tree, and the files of an export (HOST-275). */
export interface WireResult extends Omit<OperationResult, "vfs"> {
  /** An export's files, by path relative to its working directory. */
  files?: Map<string, Uint8Array>;
  /** The zip of the working directory, when the call asked for it. */
  zip?: Uint8Array;
}

/** The names of the callbacks the Worker asks the main thread for (HOST-274). */
export type CallbackName = "transport" | "tokenProvider" | "onItemError";

type WithVersion<T> = T extends unknown ? T & Versioned : never;

/** A message from the main thread to the Worker, without the version that {@link toWorker} adds. */
export type ToWorkerBody =
  | { kind: "call"; id: number; op: "connect"; options: WireConnectOptions }
  | { kind: "call"; id: number; op: "close"; session: number }
  | { kind: "call"; id: number; op: "export" | "import" | "language-pack" | "db-patches"; session: number; options: object; source?: WireSource; wants: CallWants }
  | { kind: "abort"; id: number }
  | { kind: "callback-result"; callback: number; ok: true; value: unknown }
  | { kind: "callback-result"; callback: number; ok: false; error: WireError }
  | { kind: "dispose" };

/** A message from the Worker to the main thread, without the version that {@link fromWorker} adds. */
export type FromWorkerBody =
  | { kind: "ready" }
  | { kind: "result"; id: number; value: unknown; sessionClosed?: true }
  | { kind: "error"; id: number; error: WireError; sessionClosed?: true }
  | { kind: "event"; id: number; event: { type: "message"; message: ApiMessage } | { type: "progress"; progress: ProgressEvent } }
  | { kind: "callback"; callback: number; scope: number; name: CallbackName; args: unknown[] }
  | { kind: "disposed" };

export type ToWorker = WithVersion<ToWorkerBody>;
export type FromWorker = WithVersion<FromWorkerBody>;

/** Wraps a message to the Worker with the version. */
export function toWorker(message: ToWorkerBody): ToWorker {
  return { v: WORKER_PROTOCOL_VERSION, ...message } as ToWorker;
}

/** Wraps a message to the main thread with the version. */
export function fromWorker(message: FromWorkerBody): FromWorker {
  return { v: WORKER_PROTOCOL_VERSION, ...message } as FromWorker;
}

/** True when the value is a message of this protocol: an object with the version and a kind. */
export function isEnvelope(data: unknown): data is Versioned & { kind: string } {
  return typeof data === "object" && data !== null && typeof (data as { v?: unknown }).v === "number" && typeof (data as { kind?: unknown }).kind === "string";
}

// ------------------------------------------------------------------------------------------------------------------ the errors

/** Every class of error the library throws that a caller can test for, subclasses before the classes they extend. */
const CLASSES: ReadonlyArray<readonly [string, abstract new (...args: never[]) => Error]> = [
  ["ForwardedAbort", ForwardedAbort],
  ["VersionRefusal", VersionRefusal],
  ["CItemException", CItemException],
  ["WrongFormatOfTheAmlException", WrongFormatOfTheAmlException],
  ["DotNetException", DotNetException],
  ["FileNotFoundException", FileNotFoundException],
  ["DirectoryNotFoundException", DirectoryNotFoundException],
  ["PathTooLongException", PathTooLongException],
  ["IOException", IOException],
  ["ArgumentNullException", ArgumentNullException],
  ["NullReferenceException", NullReferenceException],
  ["KeyNotFoundException", KeyNotFoundException],
  ["UnauthorizedAccessException", UnauthorizedAccessException],
  ["Exception", Exception],
  ["InvalidOperationException", InvalidOperationException],
  ["OperationCanceledException", OperationCanceledException],
  ["PathNotUsableError", PathNotUsableError],
  ["XmlException", XmlException],
  ["XPathException", XPathException],
  ["ArgumentException", ArgumentException],
  ["NotSupportedException", NotSupportedException],
  ["AggregateException", AggregateException],
  ["OptionNotSupportedError", OptionNotSupportedError],
  ["DbPatchesNotInEngineError", DbPatchesNotInEngineError],
  ["EngineNotSupportedError", EngineNotSupportedError],
  ["SelectionRefused", SelectionRefused],
  ["TypeNameOutsideRepertoireError", TypeNameOutsideRepertoireError],
  ["DuplicateKeyError", DuplicateKeyError],
  ["RandomizedHashingError", RandomizedHashingError],
  ["StackOverflowException", StackOverflowException],
  ["OAuthServerError", OAuthServerError],
  ["DiscoveryNotFound", DiscoveryNotFound],
  ["TransportError", TransportError],
  ["UnmappedTimeZoneError", UnmappedTimeZoneError],
  ["SessionClosedError", SessionClosedError],
  ["SessionBusyError", SessionBusyError],
  ["RunAbortedError", RunAbortedError],
  ["OptionError", OptionError],
  ["CommitError", CommitError],
  ["ZipError", ZipError],
  ["WorkerDisposedError", WorkerDisposedError],
  ["WorkerCrashedError", WorkerCrashedError],
  ["WorkerProtocolError", WorkerProtocolError],
  // the language's own, last: every class above extends `Error`
  ["TypeError", TypeError],
  ["RangeError", RangeError],
  ["SyntaxError", SyntaxError],
  ["ReferenceError", ReferenceError],
  ["EvalError", EvalError],
  ["URIError", URIError],
];

const BY_NAME = new Map(CLASSES);

/** The classes whose objects keep their class across the boundary, by the name they are sent under, in the order they are tried. */
export const TRANSPORTED_ERRORS: ReadonlyArray<readonly [string, abstract new (...args: never[]) => Error]> = CLASSES;

/** An error as it crosses (HOST-275): the type, the text the language keeps, and the members the class added. */
export type WireError =
  | { kind: "error"; type: string; name: string; message: string; stack: string | undefined; props: Record<string, unknown>; cause?: WireError }
  | { kind: "value"; value: unknown };

const MAX_DEPTH = 8;

/** The enumerable members of a plain object or class instance, each through {@link wireValue}. */
function ownMembers(value: object, depth: number, skip: readonly string[] = []): Record<string, unknown> {
  const members: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (skip.includes(key)) continue;
    const wired = wireValue(member, depth + 1);
    if (wired !== undefined) members[key] = wired;
  }
  return members;
}

/**
 * A value that can cross: what structured clone carries as it is, an error (as {@link WireError}), the version objects of the engine
 * (as `{$class: "ArasVersion"}`), and plain objects and arrays of these. A function, a symbol or an instance of any other class is
 * left out, so that an error's member that holds one never makes the whole message fail to clone (HOST-275).
 */
function wireValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (typeof value !== "object") return value;
  if (depth > MAX_DEPTH) return undefined;
  if (value instanceof Error) return { $error: serializeError(value, depth + 1) };
  if (value instanceof ArasVersion) return { $class: "ArasVersion", props: ownMembers(value, depth) };
  if (Array.isArray(value)) return value.map((entry) => wireValue(entry, depth + 1));
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date || value instanceof Map || value instanceof Set) return value;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) return { $plain: ownMembers(value, depth) };
  return undefined;
}

function unwireValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(unwireValue);
  const tagged = value as { $error?: WireError; $class?: string; $plain?: Record<string, unknown>; props?: Record<string, unknown> };
  if (tagged.$error !== undefined) return rehydrateError(tagged.$error);
  if (tagged.$class === "ArasVersion" && tagged.props !== undefined) {
    return rehydrateVersion(unwireMembers(tagged.props) as unknown as WireVersion);
  }
  if (tagged.$plain !== undefined) return unwireMembers(tagged.$plain);
  return value;
}

function unwireMembers(props: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).map(([key, member]) => [key, unwireValue(member)]));
}

/**
 * Turns what was thrown into a {@link WireError} (HOST-275): the registered class it is an instance of (the first of the list, so
 * that a subclass is named before its parent), its `name`, `message` and `stack` text, its own enumerable members (a `CItemException`'s
 * `faultcode`, a `TransportError`'s `host`, an `AggregateException`'s `innerExceptions`, which are errors in turn), and its `cause`.
 * A `DOMException` is sent as one; a value that is not an `Error` is sent as the value.
 */
export function serializeError(error: unknown, depth = 0): WireError {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return { kind: "error", type: "DOMException", name: error.name, message: error.message, stack: error.stack, props: {} };
  }
  if (!(error instanceof Error)) return { kind: "value", value: wireValue(error, depth) };
  const type = CLASSES.find(([, constructor]) => error instanceof constructor)?.[0] ?? "Error";
  const wired: WireError = {
    kind: "error",
    type,
    name: error.name,
    message: error.message,
    stack: error.stack,
    props: ownMembers(error, depth, ["name", "message", "stack", "cause"]),
  };
  if (error.cause !== undefined && depth < MAX_DEPTH) wired.cause = serializeError(error.cause, depth + 1);
  return wired;
}

/**
 * Builds the error again, as an object of the class it had (HOST-275): `instanceof` holds on this side as it did on the other. The
 * constructor is not run (the classes take different arguments); the object is made as `Error` makes one, with the class's prototype,
 * and given the message, the stack text and the members that were sent. A type this side does not know is a plain `Error` that has
 * the sent `name`.
 */
export function rehydrateError(wired: WireError): unknown {
  if (wired.kind === "value") return unwireValue(wired.value);
  if (wired.type === "DOMException" && typeof DOMException !== "undefined") return new DOMException(wired.message, wired.name);
  const constructor = BY_NAME.get(wired.type) ?? Error;
  const error = Reflect.construct(Error, [wired.message], constructor) as Error;
  Object.defineProperty(error, "name", { value: wired.name, writable: true, enumerable: false, configurable: true });
  if (wired.stack !== undefined) Object.defineProperty(error, "stack", { value: wired.stack, writable: true, enumerable: false, configurable: true });
  Object.assign(error, unwireMembers(wired.props));
  if (wired.cause !== undefined) Object.defineProperty(error, "cause", { value: rehydrateError(wired.cause), writable: true, enumerable: false, configurable: true });
  return error;
}

// ------------------------------------------------------------------------------------------------------------------ the buffers

/** True when the view is the whole of an `ArrayBuffer` of its own, so that transferring the buffer moves these bytes and no others. */
function ownsItsBuffer(bytes: Uint8Array): boolean {
  const buffer = bytes.buffer;
  return Object.prototype.toString.call(buffer) === "[object ArrayBuffer]" && bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength;
}

/**
 * The transfer list of one message (HOST-275). {@link TransferBag.take} gives the bytes to put in the message: the same view when it is
 * the whole of a buffer of its own that the message does not carry already (that buffer is then transferred, and the sender's view
 * is empty afterwards), and a copy otherwise (a view into a larger buffer, such as a pooled `Buffer`, a shared buffer, or a second
 * view of a buffer already taken), so that a transfer never moves bytes the sender still uses and never lists a buffer twice.
 */
export class TransferBag {
  readonly list: ArrayBuffer[] = [];
  private readonly taken = new Set<ArrayBuffer>();

  take(bytes: Uint8Array): Uint8Array {
    if (!ownsItsBuffer(bytes) || this.taken.has(bytes.buffer as ArrayBuffer)) return new Uint8Array(bytes);
    this.taken.add(bytes.buffer as ArrayBuffer);
    this.list.push(bytes.buffer as ArrayBuffer);
    return bytes;
  }
}
