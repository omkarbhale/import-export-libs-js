import type { HttpTransport, TransportRequest, TransportResponse } from "../client/transport.js";
import type { TokenProvider } from "../client/oauth.js";
import type { ArasVersion } from "../client/version.js";
import type { Engine } from "../engines.js";
import type { ExportOptions, ExportResult } from "./api-export.js";
import type { DbPatchesOptions, ImportLanguagePackOptions, ImportOptions } from "./api-import.js";
import { type ConnectOptions, SessionClosedError } from "./api-session.js";
import type { OperationResult, OnItemErrorOption } from "./api-run.js";
import { type DataTransferItemsLike, type FileLike, type Raw, takeEntries, walkEntries } from "./file-list.js";
import type { FsaDirectoryHandle } from "./fsa.js";
import type { VfsToZipOptions } from "./zip.js";
import {
  type CallbackName,
  type CallOp,
  type CallWants,
  type FromWorker,
  type ToWorkerBody,
  TransferBag,
  WORKER_PROTOCOL_VERSION,
  type WireError,
  type WireSession,
  type WireSource,
  type WireResult,
  WorkerCrashedError,
  WorkerDisposedError,
  type WorkerMountOptions,
  WorkerProtocolError,
  isEnvelope,
  rehydrateError,
  rehydrateVersion,
  serializeError,
  toWorker,
} from "./worker-protocol.js";

/**
 * The main thread's side of the engine's Worker (HOST-274, HOST-275): `createEngineWorker` starts the Worker and gives the same
 * operations as the browser API (HOST-270 to HOST-273) as calls that run there. The page keeps its thread, and a long export or import
 * costs it the messages and the buffers that cross and nothing else.
 *
 * Nothing of the engine runs here: this file holds the proxy for the calls, and the classes of the errors that come back, which are
 * the library's own, so that `instanceof` holds on the page.
 *
 * @spec HOST-274 HOST-275
 */

/** What the client needs of a `Worker` or a `MessagePort`: the messages out with a transfer list, the events in, and a way to stop it. */
export interface WorkerLike {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  /** `Worker.terminate()`; a `MessagePort`'s `close()` is used when this is absent. */
  terminate?(): void;
  close?(): void;
  start?(): void;
}

/** A file or blob that a page hands over: a `File` of an upload, the part of it the Worker reads. */
export interface BlobLike {
  readonly name?: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/**
 * Where the files of a call come from, each as a Worker can take it (HOST-275). The buffers of `zip` and `files` are **transferred**,
 * not copied: after the call starts the caller's `Uint8Array`s are empty, and a caller who keeps the bytes passes a copy. A `File`, a `Blob`, a
 * `FileSystemDirectoryHandle` is cloned by the browser, which reads the bytes in the Worker and not on the page. `dataTransfer` is the
 * item list of a `drop` event: start the call in the handler, before any `await`; its entries, which cannot be cloned, are walked on the
 * page, and the Worker reads the `File`s they give.
 */
export type WorkerSource =
  | { zip: Uint8Array | BlobLike; maxBytes?: number }
  | { files: Readonly<Record<string, Uint8Array | string>> | ReadonlyMap<string, Uint8Array | string> }
  | { fileList: Iterable<FileLike & BlobLike>; mount?: WorkerMountOptions }
  | { dataTransfer: DataTransferItemsLike; mount?: WorkerMountOptions }
  | { directory: FsaDirectoryHandle; mount?: Omit<WorkerMountOptions, "root"> };

/** What {@link EngineWorker.connect} takes: the options of `connect`, with the transport and the token provider staying on the page. */
export type WorkerConnectOptions = Omit<ConnectOptions, "transport" | "tokenProvider"> & {
  /**
   * An HTTP layer of the page's own. It runs on the main thread: the Worker sends it each request and takes its response. Without
   * one the Worker sends its own `fetch` requests, which is the default, since a page has no better place for them. The `body` of each response is transferred: the array it returns is empty afterwards, so a
   * transport that keeps a body returns a copy of it.
   */
  transport?: HttpTransport;
  /** Where the bearer tokens come from instead of the password grant (HOST-271); it runs on the main thread and is asked for each token. */
  tokenProvider?: TokenProvider;
};

/** What every call of the Worker takes besides its operation's own options (HOST-274). */
interface Streams {
  onMessage?: ExportOptions["onMessage"];
  onProgress?: ExportOptions["onProgress"];
  signal?: AbortSignal;
}

type Plain<T, Skip extends keyof T> = Omit<T, Skip | "vfs" | "signal" | "onMessage" | "onProgress" | "source">;

/** What {@link EngineWorker.exportPackages} takes: the options of `exportPackages` with no tree, and optionally the files the export reads. */
export interface WorkerExportOptions extends Plain<ExportOptions, never>, Streams {
  /** Files the export reads, such as a manifest; they are mounted at the root of the Worker's tree. */
  source?: WorkerSource;
  /** Also returns `zip`, the zip of the working directory (HOST-251): `true` for the defaults. */
  zip?: boolean | VfsToZipOptions;
  /** A function runs on the main thread and is asked per failed item (EXP-516). */
  onItemError?: OnItemErrorOption;
}

/** What {@link EngineWorker.exportPackages} resolves with: the result of `exportPackages` with the files and the zip as transferred buffers, and no tree. */
export interface WorkerExportResult extends Omit<ExportResult, "vfs"> {
  /** The zip of the working directory, when `zip` was asked for and the run made that folder. */
  zip?: Uint8Array;
}

export interface WorkerImportOptions extends Plain<ImportOptions, never>, Streams {
  source: WorkerSource;
}

export interface WorkerLanguagePackOptions extends Plain<ImportLanguagePackOptions, never>, Streams {
  source: WorkerSource;
}

export interface WorkerDbPatchesOptions extends Plain<DbPatchesOptions, never>, Streams {
  source: WorkerSource;
}

/** What an import, a language-pack import and a DB patch run resolve with: the log, the messages and the summary. A tree does not cross. */
export type WorkerOperationResult = Omit<OperationResult, "vfs">;

/** A session on the Worker's side: the data of `Session`, and the calls that act on it (HOST-274). */
export interface WorkerSession {
  readonly engine: Engine;
  readonly serverVersion: ArasVersion;
  readonly serverVersionText: string;
  readonly url: string;
  readonly database: string;
  readonly userName: string;
  readonly timeoutMs: number;
  readonly versionGate: { engine: Engine; server: ArasVersion; accepted: boolean; skipped: boolean; fittingEngines: Engine[] } | undefined;
  /** True once the session was closed here, or an operation closed it (the language-pack import does). */
  readonly closed: boolean;
  /** Sends the logoff (WIRE-040); a second call does nothing. */
  close(): Promise<void>;
}

export interface DisposeOptions {
  /** Stops the Worker at once, whatever it is doing; calls still running reject with `WorkerDisposedError`. For a Worker that does not answer. */
  force?: boolean;
  /** How long a graceful dispose waits for the Worker to finish and log off before it stops it anyway. Default 10 000 ms. */
  timeoutMs?: number;
}

/** The engine's Worker as the page sees it (HOST-274). */
export interface EngineWorker {
  connect(options: WorkerConnectOptions): Promise<WorkerSession>;
  exportPackages(session: WorkerSession, options: WorkerExportOptions): Promise<WorkerExportResult>;
  importPackages(session: WorkerSession, options: WorkerImportOptions): Promise<WorkerOperationResult>;
  importLanguagePack(session: WorkerSession, options: WorkerLanguagePackOptions): Promise<WorkerOperationResult>;
  applyDbPatches(session: WorkerSession, options: WorkerDbPatchesOptions): Promise<WorkerOperationResult>;
  /** Raises the abort of every operation that is running (each ends as the engine ends a cancelled run, HOST-272); `connect` and `close` are not operations. */
  abort(): void;
  /** Stops the Worker (HOST-274). Calls after it reject with `WorkerDisposedError`. A second call resolves when the first has. */
  dispose(options?: DisposeOptions): Promise<void>;
  /** True from the first `dispose` call. */
  readonly disposed: boolean;
}

export interface EngineWorkerOptions {
  /**
   * The Worker, or where to start it. Default `new Worker(new URL("./browser-worker.js", import.meta.url), {type: "module"})`, which
   * is `dist/browser-worker.js` next to the bundle and which bundlers resolve. A page whose bundler needs another form (a `?worker`
   * import, a Blob URL) passes the `Worker` it made, or the URL.
   */
  worker?: WorkerLike | URL | string;
}

// ----------------------------------------------------------------------------------------------------------------- the client

interface Pending {
  op: CallOp;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onMessage?: ExportOptions["onMessage"];
  onProgress?: ExportOptions["onProgress"];
  signal?: AbortSignal;
  /** The Worker said that the call left its session closed. */
  onSessionClosed?: () => void;
  release: () => void;
}

/** The callbacks of the caller's that the Worker may ask for, by the id of the call that registered them. */
interface Handlers {
  transport?: HttpTransport;
  tokenProvider?: TokenProvider;
  onItemError?: Exclude<OnItemErrorOption, string>;
}

/** The `Worker` constructor of the page; declared here because the project that has no DOM typings reads this file too. */
declare const Worker: new (url: URL | string, options?: { type?: "module" | "classic" }) => WorkerLike;

const abortError = (): Error => new DOMException("The operation was aborted.", "AbortError");

/** Bytes of a source as the wire takes them, and the buffers to transfer. */
function wireSource(source: WorkerSource, bag: TransferBag, walked: readonly Raw[]): WireSource {
  if ("zip" in source) {
    const zip = source.zip;
    return {
      kind: "zip",
      bytes: zip instanceof Uint8Array ? bag.take(zip) : zip,
      ...(source.maxBytes === undefined ? {} : { maxBytes: source.maxBytes }),
    };
  }
  if ("files" in source) {
    const entries = source.files instanceof Map ? [...source.files] : Object.entries(source.files);
    const files: Record<string, Uint8Array | string> = {};
    for (const [path, content] of entries) {
      files[path.startsWith("/") ? path : `/${path}`] = typeof content === "string" ? content : bag.take(content);
    }
    return { kind: "files", files };
  }
  if ("fileList" in source) {
    // a `File` that is cloned loses its `webkitRelativePath`, so the path goes beside it
    const entries = [...source.fileList].map((file) => ({ path: file.webkitRelativePath ?? "", file }));
    return { kind: "file-list", entries, options: source.mount ?? {} };
  }
  if ("dataTransfer" in source) {
    const entries = walked.map(({ path, file }) => (file === undefined ? { path } : { path, file }));
    return { kind: "drop", entries, options: source.mount ?? {} };
  }
  return { kind: "directory", handle: source.directory, options: source.mount ?? {} };
}

function describe(event: unknown): string {
  const text = (event as { message?: unknown }).message;
  return typeof text === "string" && text !== "" ? text : "no message";
}

/**
 * Starts the Worker and returns the page's handle on it (HOST-274). The Worker is started now; its first message tells the version of
 * the protocol it speaks, and a call made before that waits in the Worker's queue, which is what a Worker does with them.
 */
export function createEngineWorker(options: EngineWorkerOptions = {}): EngineWorker {
  const given = options.worker;
  const worker: WorkerLike =
    given !== undefined && typeof given === "object" && "postMessage" in given
      ? given
      : typeof given === "string" || given instanceof URL
        ? new Worker(given, { type: "module" })
        : new Worker(new URL("./browser-worker.js", import.meta.url), { type: "module" });

  const pending = new Map<number, Pending>();
  const handlers = new Map<number, Handlers>();
  const sessionIds = new WeakMap<object, number>();
  const walking = new Set<AbortController>();
  let nextId = 1;
  let disposing: Promise<void> | undefined;
  let stopped = false;
  let onDisposed: (() => void) | undefined;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (typeof worker.terminate === "function") worker.terminate();
    else worker.close?.();
    onDisposed?.();
  };

  /** Rejects every call that has not finished. */
  function failAll(error: Error): void {
    for (const [id, call] of [...pending]) {
      pending.delete(id);
      call.release();
      call.reject(error);
    }
    handlers.clear();
  }

  function post(message: ToWorkerBody, transfer: ArrayBuffer[] = []): void {
    worker.postMessage(toWorker(message), transfer);
  }

  /** The Worker asked for a callback: run the caller's function, and answer with its value or its error (HOST-274). */
  async function answer(callback: number, scope: number, name: CallbackName, args: unknown[]): Promise<void> {
    const bag = new TransferBag();
    try {
      const target = handlers.get(scope);
      let value: unknown;
      if (name === "transport") {
        if (target?.transport === undefined) throw new WorkerProtocolError("the Worker asked for a transport that this call has none of");
        const response: TransportResponse = await target.transport.send(args[0] as TransportRequest);
        value = { ...response, body: bag.take(response.body) };
      } else if (name === "tokenProvider") {
        if (target?.tokenProvider === undefined) throw new WorkerProtocolError("the Worker asked for a token provider that this call has none of");
        value = await target.tokenProvider.getAccessToken();
      } else {
        if (target?.onItemError === undefined) throw new WorkerProtocolError("the Worker asked for an answer to an item error that this call has none of");
        value = await target.onItemError(args[0] as { text: string });
      }
      post({ kind: "callback-result", callback, ok: true, value }, bag.list);
    } catch (error) {
      post({ kind: "callback-result", callback, ok: false, error: serializeError(error) });
    }
  }

  /** What a call rejects with, from what the Worker sent: the error's own class, and the caller's own reason for an abort that came from here. */
  function errorOf(call: Pending, wired: WireError): unknown {
    const error = rehydrateError(wired);
    if (wired.kind === "error" && wired.type === "ForwardedAbort") return call.signal?.aborted === true ? call.signal.reason : abortError();
    return error;
  }

  function receive(event: unknown): void {
    const data = (event as { data?: unknown }).data;
    if (!isEnvelope(data)) return;
    if (data.v !== WORKER_PROTOCOL_VERSION) {
      failAll(new WorkerProtocolError(`the Worker speaks protocol ${data.v}, this library speaks ${WORKER_PROTOCOL_VERSION}: the Worker file and the library are of different versions`));
      stop();
      return;
    }
    const message = data as FromWorker;
    switch (message.kind) {
      case "ready":
        return;
      case "event": {
        const call = pending.get(message.id);
        if (call === undefined) return;
        // the caller's callback may throw; that is the caller's error, and it must not break the stream of the Worker's events
        try {
          if (message.event.type === "message") call.onMessage?.(message.event.message);
          else call.onProgress?.(message.event.progress);
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
        return;
      }
      case "result": {
        const call = pending.get(message.id);
        if (call === undefined) return;
        pending.delete(message.id);
        call.release();
        if (message.sessionClosed === true) call.onSessionClosed?.();
        call.resolve(message.value);
        return;
      }
      case "error": {
        const call = pending.get(message.id);
        if (call === undefined) return;
        pending.delete(message.id);
        call.release();
        if (message.sessionClosed === true) call.onSessionClosed?.();
        call.reject(errorOf(call, message.error));
        return;
      }
      case "callback":
        void answer(message.callback, message.scope, message.name, message.args);
        return;
      case "disposed":
        onDisposed?.();
        return;
    }
  }

  worker.addEventListener("message", receive);
  // a Worker that fails to start (a missing file, a script error) or sends what cannot be read ends every call that waits for it
  const crash = (text: string): void => {
    failAll(new WorkerCrashedError(text));
    stop();
  };
  worker.addEventListener("error", (event) => crash(`the Worker failed: ${describe(event)}`));
  worker.addEventListener("messageerror", () => crash("the Worker sent a message that could not be read"));
  worker.start?.();

  /** Sends one call and returns what it resolves with. `build` makes the message's body and fills the transfer list. */
  function call<T>(op: CallOp, streams: Streams, build: (id: number, bag: TransferBag) => ToWorkerBody, registered?: Handlers, onSessionClosed?: () => void): Promise<T> {
    if (disposing !== undefined || stopped) return Promise.reject(new WorkerDisposedError("the Worker was disposed"));
    const { signal } = streams;
    if (signal?.aborted === true) return Promise.reject(signal.reason);
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        const entry = pending.get(id);
        if (entry === undefined) return;
        post({ kind: "abort", id });
      };
      signal?.addEventListener("abort", onAbort);
      const entry: Pending = {
        op,
        resolve: resolve as (value: unknown) => void,
        reject,
        ...(streams.onMessage === undefined ? {} : { onMessage: streams.onMessage }),
        ...(streams.onProgress === undefined ? {} : { onProgress: streams.onProgress }),
        ...(signal === undefined ? {} : { signal }),
        ...(onSessionClosed === undefined ? {} : { onSessionClosed }),
        release: () => {
          signal?.removeEventListener("abort", onAbort);
          if (registered !== undefined && op !== "connect") handlers.delete(id);
        },
      };
      if (registered !== undefined) handlers.set(id, registered);
      pending.set(id, entry);
      try {
        const bag = new TransferBag();
        const body = build(id, bag);
        post(body, bag.list);
      } catch (error) {
        // the message could not be sent (a member that cannot be cloned): nothing was sent, and the call fails here
        pending.delete(id);
        handlers.delete(id);
        entry.release();
        reject(error);
      }
    });
  }

  const idOf = (session: WorkerSession): number => {
    const id = sessionIds.get(session);
    if (id === undefined) throw new WorkerProtocolError("the session was not made by this Worker");
    return id;
  };

  function makeSession(id: number, wired: WireSession): WorkerSession {
    let closed = false;
    const serverVersion = rehydrateVersion(wired.serverVersion);
    const session: WorkerSession = {
      engine: wired.engine,
      serverVersion,
      serverVersionText: serverVersion.fullString,
      url: wired.url,
      database: wired.database,
      userName: wired.userName,
      timeoutMs: wired.timeoutMs,
      versionGate: wired.versionGate === undefined ? undefined : { ...wired.versionGate, server: rehydrateVersion(wired.versionGate.server) },
      get closed() {
        return closed;
      },
      async close() {
        if (closed) return;
        closed = true;
        await call<void>("close", {}, (callId) => ({ kind: "call", id: callId, op: "close", session: id }));
        handlers.delete(id);
      },
    };
    sessionIds.set(session, id);
    markClosed.set(session, () => {
      closed = true;
      handlers.delete(id);
    });
    return session;
  }
  const markClosed = new WeakMap<WorkerSession, () => void>();

  /** Takes a drop's entries before the first wait and walks them on the page; `abort()` and the caller's signal stop the walk. */
  async function walkDrop(items: DataTransferItemsLike, signal: AbortSignal | undefined): Promise<Raw[]> {
    const taken = takeEntries(items);
    const walk = new AbortController();
    walking.add(walk);
    try {
      return await walkEntries(taken, signal === undefined ? walk.signal : AbortSignal.any([signal, walk.signal]));
    } finally {
      walking.delete(walk);
    }
  }

  async function operation<T extends WireResult>(
    op: "export" | "import" | "language-pack" | "db-patches",
    session: WorkerSession,
    options: Streams & { source?: WorkerSource; onItemError?: OnItemErrorOption },
    rest: object,
  ): Promise<T> {
    const sessionId = idOf(session);
    // as the direct call: a closed session fails before anything is sent
    if (session.closed) throw new SessionClosedError();
    const walked = options.source !== undefined && "dataTransfer" in options.source ? await walkDrop(options.source.dataTransfer, options.signal) : [];
    const answerOf = typeof options.onItemError === "function" ? options.onItemError : undefined;
    const wants: CallWants = { message: options.onMessage !== undefined, progress: options.onProgress !== undefined, onItemError: answerOf !== undefined };
    return call<T>(
      op,
      options,
      (id, bag) => ({
        kind: "call",
        id,
        op,
        session: sessionId,
        options: typeof options.onItemError === "string" ? { ...rest, onItemError: options.onItemError } : rest,
        ...(options.source === undefined ? {} : { source: wireSource(options.source, bag, walked) }),
        wants,
      }),
      answerOf === undefined ? undefined : { onItemError: answerOf },
      markClosed.get(session),
    );
  }

  /** The options that cross: everything the caller gave but the functions, the signal and the source, which have their own paths. */
  const plain = <T extends object>(options: T): object => {
    const { onMessage: _message, onProgress: _progress, signal: _signal, source: _source, onItemError: _answer, vfs: _vfs, ...rest } = options as T & Record<string, unknown>;
    return rest;
  };

  const strip = (result: WireResult): WorkerOperationResult => ({ log: result.log, messages: result.messages, summary: result.summary });

  async function dispose(disposeOptions: DisposeOptions): Promise<void> {
    const error = new WorkerDisposedError("the Worker was disposed");
    if (disposeOptions.force === true || stopped) {
      failAll(error);
      stop();
      return;
    }
    // graceful: the engine's runs end as cancelled, the sessions are logged off, and the Worker says so; a Worker that does not is stopped
    const timeout = disposeOptions.timeoutMs ?? 10_000;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeout);
      onDisposed = () => {
        clearTimeout(timer);
        resolve();
      };
      for (const id of pending.keys()) post({ kind: "abort", id });
      post({ kind: "dispose" });
    });
    failAll(error);
    stop();
  }

  return {
    get disposed() {
      return disposing !== undefined;
    },

    async connect(connectOptions) {
      // the password is read here into the message and nowhere else: it is not kept by the client, nor by the session it returns (HOST-274)
      const { transport, tokenProvider, password, ...rest } = connectOptions;
      const registered: Handlers = { ...(transport === undefined ? {} : { transport }), ...(tokenProvider === undefined ? {} : { tokenProvider }) };
      let id = 0;
      const wired = await call<WireSession>(
        "connect",
        {},
        (callId) => {
          id = callId;
          return {
            kind: "call",
            id: callId,
            op: "connect",
            options: { ...rest, ...(password === undefined ? {} : { password }), transport: transport !== undefined, tokenProvider: tokenProvider !== undefined },
          };
        },
        registered,
      ).catch((error: unknown) => {
        handlers.delete(id);
        throw error;
      });
      return makeSession(id, wired);
    },

    exportPackages: async (session, exportOptions) => {
      const result = await operation<WireResult>("export", session, exportOptions, plain(exportOptions));
      return { ...strip(result), files: result.files ?? new Map<string, Uint8Array>(), ...(result.zip === undefined ? {} : { zip: result.zip }) };
    },
    importPackages: async (session, importOptions) => strip(await operation("import", session, importOptions, plain(importOptions))),
    importLanguagePack: async (session, languageOptions) => strip(await operation("language-pack", session, languageOptions, plain(languageOptions))),
    applyDbPatches: async (session, patchOptions) => strip(await operation("db-patches", session, patchOptions, plain(patchOptions))),

    abort() {
      for (const walk of walking) walk.abort(abortError());
      for (const [id, entry] of pending) {
        if (entry.op === "connect" || entry.op === "close") continue;
        post({ kind: "abort", id });
      }
    },

    dispose(disposeOptions = {}) {
      disposing ??= dispose(disposeOptions);
      if (disposeOptions.force === true) {
        // a forced dispose after a graceful one that is still waiting ends the wait
        failAll(new WorkerDisposedError("the Worker was disposed"));
        stop();
      }
      return disposing;
    },
  };
}
