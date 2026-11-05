import type { HttpTransport, TransportRequest, TransportResponse } from "../client/transport.js";
import { MemoryVfs } from "../host/memory-fs.js";
import type { ApiMessage, OnItemErrorOption, OperationResult, ProgressEvent } from "./api-run.js";
import {
  type ConnectOptions,
  Session,
  applyDbPatches,
  connect,
  exportPackages,
  importLanguagePack,
  importPackages,
} from "./api.js";
import { mountFileList } from "./file-list.js";
import { mountDirectory } from "./fsa.js";
import type { FsaDirectoryHandle } from "./fsa.js";
import type { FileLike } from "./file-list.js";
import type { MountInclude } from "./mount-options.js";
import { type VfsToZipOptions, vfsFromZip, vfsToZip } from "./zip.js";
import {
  type CallbackName,
  type FromWorkerBody,
  ForwardedAbort,
  type ToWorker,
  TransferBag,
  WORKER_PROTOCOL_VERSION,
  type WireBlob,
  type WireConnectOptions,
  type WireResult,
  type WireSession,
  type WireSource,
  WorkerProtocolError,
  type WorkerMountOptions,
  fromWorker,
  isEnvelope,
  rehydrateError,
  serializeError,
} from "./worker-protocol.js";

/**
 * The Worker's side of the engine (HOST-274): `serveEngine` answers the messages of {@link ./worker-client.ts} on a port, running the
 * browser API of HOST-270 to HOST-273 where the files, the XML and the engine's loops are, off the page's thread. `worker.ts` is the
 * Worker's entry and calls it with the Worker's global scope; a test calls it with one end of a `MessageChannel`.
 *
 * @spec HOST-274 HOST-275
 */

/** What the server needs of a Worker's global scope or of a `MessagePort`: the messages in, and the messages out with a transfer list. */
export interface ServerPort {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(type: "message", listener: (event: unknown) => void): void;
  /** A `MessagePort` delivers nothing to a listener added with `addEventListener` until it is started; a Worker's scope has no such method. */
  start?(): void;
}

export interface ServeOptions {
  /** Called once the server has stopped after a `dispose` message; the Worker's entry closes its scope here. */
  onDisposed?: () => void;
}

/** Drops the members that are `undefined`: an optional member of an options type may be absent but not `undefined` (`exactOptionalPropertyTypes`). */
function defined<T extends object>(members: { [K in keyof T]: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(members).filter(([, value]) => value !== undefined)) as T;
}

const asBytes = async (value: Uint8Array | WireBlob): Promise<Uint8Array> =>
  value instanceof Uint8Array ? value : new Uint8Array(await value.arrayBuffer());

/** A `File` that crossed the boundary has lost its `webkitRelativePath`; the client sent the path beside it. */
function fileLikeOf(path: string, file: WireBlob): FileLike {
  return { name: file.name ?? path.slice(path.lastIndexOf("/") + 1), size: file.size, webkitRelativePath: path, arrayBuffer: () => file.arrayBuffer(), slice: (start, end) => file.slice(start, end) };
}

const includeOf = (mount: WorkerMountOptions): { include?: MountInclude } => (mount.include === "all" ? { include: () => "content" } : {});

/** The tree a source stands for (HOST-275): the zip mounted with its one top-level folder taken off, the files as they are, a folder input or a directory handle read. */
async function treeOf(source: WireSource): Promise<MemoryVfs> {
  switch (source.kind) {
    case "zip":
      return vfsFromZip(await asBytes(source.bytes), { root: "auto", ...(source.maxBytes === undefined ? {} : { maxBytes: source.maxBytes }) });
    case "files": {
      return new MemoryVfs(source.files);
    }
    case "file-list":
      return mountFileList(
        source.entries.map(({ path, file }) => fileLikeOf(path, file)),
        { ...defined<{ root: "auto" | "keep"; maxBytes: number }>({ root: source.options.root, maxBytes: source.options.maxBytes }), ...includeOf(source.options), unzip: vfsFromZip },
      );
    case "directory":
      return mountDirectory(source.handle as FsaDirectoryHandle, {
        ...defined<{ maxBytes: number }>({ maxBytes: source.options.maxBytes }),
        ...includeOf(source.options),
      });
  }
}

/**
 * Starts answering on the port. It posts `ready` at once (the client checks the protocol version from it), then serves until a `dispose`
 * message: it keeps the sessions it made, one `AbortController` per running call, and the callbacks it has asked the main thread for.
 */
export function serveEngine(port: ServerPort, options: ServeOptions = {}): void {
  const sessions = new Map<number, Session>();
  const controllers = new Map<number, AbortController>();
  const asked = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  const running = new Set<Promise<void>>();
  let nextCallback = 1;
  let disposing = false;

  const post = (message: FromWorkerBody, transfer: ArrayBuffer[] = []): void => port.postMessage(fromWorker(message), transfer);

  /** Asks the main thread to run a callback of the caller's and waits for its answer (HOST-274). */
  function ask(scope: number, name: CallbackName, args: unknown[], transfer: ArrayBuffer[] = []): Promise<unknown> {
    const callback = nextCallback++;
    return new Promise((resolve, reject) => {
      asked.set(callback, { resolve, reject });
      post({ kind: "callback", callback, scope, name, args }, transfer);
    });
  }

  function sessionOf(id: number): Session {
    const session = sessions.get(id);
    if (session === undefined) throw new WorkerProtocolError(`the Worker has no session ${id}: it was made by another Worker, or this one was disposed`);
    return session;
  }

  async function connectCall(id: number, wire: WireConnectOptions): Promise<WireSession> {
    const transport: HttpTransport | undefined = wire.transport
      ? {
          send: async (request: TransportRequest) => {
            // the engine may still read its request after the send; the main thread gets a copy, and gives its response's buffer back
            const copy = { ...request, ...(request.body === undefined ? {} : { body: new Uint8Array(request.body) }) };
            return (await ask(id, "transport", [copy])) as TransportResponse;
          },
        }
      : undefined;
    const connectOptions: ConnectOptions = {
      ...defined<Partial<ConnectOptions>>({
        userName: wire.userName,
        password: wire.password,
        engine: wire.engine,
        skipVersionCheck: wire.skipVersionCheck,
        timeZoneName: wire.timeZoneName,
        locale: wire.locale,
        timeoutMs: wire.timeoutMs,
        transport,
        tokenProvider: wire.tokenProvider ? { getAccessToken: () => ask(id, "tokenProvider", []) as Promise<string> } : undefined,
      }),
      url: wire.url,
      database: wire.database,
    };
    const session = await connect(connectOptions);
    sessions.set(id, session);
    const gate = session.versionGate;
    return {
      engine: session.engine,
      serverVersion: session.serverVersion,
      url: session.url,
      database: session.database,
      userName: session.userName,
      timeoutMs: session.timeoutMs,
      versionGate: gate === undefined ? undefined : { engine: gate.engine, server: gate.server, accepted: gate.accepted, skipped: gate.skipped, fittingEngines: [...gate.fittingEngines] },
    };
  }

  /** Runs one operation and shapes its result for the wire: no tree, the files and the zip of an export with their buffers on the transfer list (HOST-275). */
  async function operate(message: Extract<ToWorker, { op: "export" | "import" | "language-pack" | "db-patches" }>): Promise<{ value: WireResult; transfer: ArrayBuffer[] }> {
    const session = sessionOf(message.session);
    const controller = new AbortController();
    controllers.set(message.id, controller);
    try {
      const run = {
        signal: controller.signal,
        ...(message.wants.message ? { onMessage: (line: ApiMessage) => post({ kind: "event", id: message.id, event: { type: "message", message: line } }) } : {}),
        ...(message.wants.progress ? { onProgress: (event: ProgressEvent) => post({ kind: "event", id: message.id, event: { type: "progress", progress: event } }) } : {}),
      };
      const tree = message.source === undefined ? undefined : await treeOf(message.source);
      const given = message.options as Record<string, unknown>;
      let result: OperationResult & { files?: Map<string, Uint8Array> };
      let zipOf: { folder: string; options: VfsToZipOptions } | undefined;
      switch (message.op) {
        case "export": {
          const onItemError: OnItemErrorOption | undefined = message.wants.onItemError
            ? async (question) => (await ask(message.id, "onItemError", [question])) as "continue" | "abort-package"
            : (given.onItemError as OnItemErrorOption | undefined);
          const { zip, ...rest } = given;
          if (zip === true || (typeof zip === "object" && zip !== null)) {
            zipOf = { folder: (given.workingDirectory as string | undefined) ?? "/export", options: zip === true ? {} : (zip as VfsToZipOptions) };
          }
          result = await exportPackages(session, { ...rest, ...run, ...(tree === undefined ? {} : { vfs: tree }), ...(onItemError === undefined ? {} : { onItemError }) } as never);
          break;
        }
        case "import":
          result = await importPackages(session, { ...given, ...run, source: tree as MemoryVfs } as never);
          break;
        case "language-pack":
          result = await importLanguagePack(session, { ...given, ...run, source: tree as MemoryVfs } as never);
          break;
        case "db-patches":
          result = await applyDbPatches(session, { ...given, ...run, source: tree as MemoryVfs } as never);
          break;
      }
      const bag = new TransferBag();
      const value: WireResult = { log: result.log, messages: result.messages, summary: result.summary };
      if (message.op === "export") {
        value.files = new Map([...(result.files ?? new Map<string, Uint8Array>())].map(([path, bytes]) => [path, bag.take(bytes)] as const));
        if (zipOf !== undefined && result.vfs.exists(zipOf.folder)) value.zip = bag.take(vfsToZip(result.vfs, zipOf.folder, zipOf.options));
      }
      return { value, transfer: bag.list };
    } finally {
      controllers.delete(message.id);
    }
  }

  async function perform(message: Extract<ToWorker, { kind: "call" }>): Promise<{ value: unknown; transfer: ArrayBuffer[] }> {
    if (message.op === "connect") return { value: await connectCall(message.id, message.options), transfer: [] };
    if (message.op === "close") {
      const session = sessionOf(message.session);
      await session.close();
      sessions.delete(message.session);
      return { value: undefined, transfer: [] };
    }
    return operate(message);
  }

  function call(message: Extract<ToWorker, { kind: "call" }>): void {
    const closedMark = (): { sessionClosed?: true } => ("session" in message && sessions.get(message.session)?.closed === true ? { sessionClosed: true } : {});
    const task = (async () => {
      try {
        if (disposing) throw new WorkerProtocolError("the Worker is being disposed");
        const { value, transfer } = await perform(message);
        post({ kind: "result", id: message.id, value, ...closedMark() }, transfer);
      } catch (error) {
        post({ kind: "error", id: message.id, error: serializeError(error), ...closedMark() });
      }
    })();
    running.add(task);
    void task.finally(() => running.delete(task));
  }

  async function dispose(): Promise<void> {
    disposing = true;
    for (const controller of controllers.values()) controller.abort(new ForwardedAbort());
    await Promise.allSettled([...running]);
    // the logoff of every session the caller left open; a failure is not a reason to keep the Worker
    await Promise.allSettled([...sessions.values()].map((session) => session.close()));
    sessions.clear();
    post({ kind: "disposed" });
    options.onDisposed?.();
  }

  function receive(event: unknown): void {
    const data = (event as { data?: unknown }).data;
    if (!isEnvelope(data)) return;
    const message = data as ToWorker;
    if (message.v !== WORKER_PROTOCOL_VERSION) {
      const id = (data as { id?: unknown }).id;
      if (typeof id === "number") {
        post({ kind: "error", id, error: serializeError(new WorkerProtocolError(`the Worker speaks protocol ${WORKER_PROTOCOL_VERSION}, the message is ${message.v}`)) });
      }
      return;
    }
    switch (message.kind) {
      case "call":
        call(message);
        return;
      case "abort":
        controllers.get(message.id)?.abort(new ForwardedAbort());
        return;
      case "callback-result": {
        const waiting = asked.get(message.callback);
        asked.delete(message.callback);
        if (message.ok) waiting?.resolve(message.value);
        else waiting?.reject(rehydrateError(message.error));
        return;
      }
      case "dispose":
        void dispose();
        return;
    }
  }

  port.addEventListener("message", receive);
  port.start?.();
  post({ kind: "ready" });
}
