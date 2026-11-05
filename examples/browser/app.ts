import {
  type ApiMessage,
  type ExportResult,
  type FsaDirectoryHandle,
  type HttpTransport,
  type MountProgress,
  type OperationResult,
  type ProgressEvent,
  describeFailure,
} from "../../src/browser.js";
import { ENGINES } from "../../src/engines.js";
import { field, h, sizeText, uniqueId } from "./dom.js";
import { type EngineClient, type EngineSession, createDirectEngine } from "./engine-client.js";
import {
  FormError,
  MANIFEST_EXPORT_FOLDER,
  SELECTIONS,
  type Selection,
  type Values,
  connectOptionsOf,
  dbPatchOptionsOf,
  exportOptionsOf,
  importOptionsOf,
  languagePackOptionsOf,
  selectionNeedsSource,
} from "./model.js";
import { MODES, type Mode, type OptionSpec, RUN_OPTIONS, optionsOf } from "./options.js";
import { type SaveFile, downloadFile, stampedName, writeToFolder, zipOf } from "./sinks.js";
import { type MountedSource, PACKAGE_BUDGET, canPickDirectory, mountDrop, mountFiles, mountHandle, pickDirectory } from "./sources.js";

/**
 * The reference page (HOST-280, HOST-281): plain DOM over the browser API. `mountApp` draws the page into an element; everything the
 * page asks of the browser that a test may need to replace comes in through {@link AppDeps}, so that the same page runs under the
 * static server and in the browser tests.
 *
 * @spec HOST-280 HOST-281
 */

/** What the page asks of its surroundings. Every member is optional; the default is the real browser. */
export interface AppDeps {
  /** Where the engine runs. Default: this thread. */
  engine?: EngineClient;
  /** The HTTP layer handed to `connect`. Default: the browser's `fetch` transport. */
  transport?: HttpTransport;
  /** Hands a downloaded file to the person. Default: an anchor on a Blob URL. */
  saveFile?: SaveFile;
  /** Opens the folder picker. Default: `showDirectoryPicker`. */
  pickDirectory?: (mode: "read" | "readwrite") => Promise<FsaDirectoryHandle>;
  /** Whether the folder picker is offered. Default: whether the browser has `showDirectoryPicker`. */
  canPickDirectory?: boolean;
  /** The page's location, for the banner of HOST-281. Default `window.location`. */
  location?: Pick<Location, "protocol" | "hostname">;
}

export interface App {
  /** Removes the page from its element and aborts a run in progress. */
  destroy(): void;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const LOG_LINES = 5000;

/** The control of an option. */
function controlOf(spec: OptionSpec, controls: Map<string, Control>, panel: string): HTMLElement {
  let control: Control;
  if (spec.kind === "flag") {
    control = h("input", { type: "checkbox" });
  } else if (spec.kind === "choice") {
    control = h("select", {}, ...(spec.choices ?? []).map((choice) => h("option", { value: choice }, choice === "" ? "(default)" : choice)));
  } else {
    control = h("input", { type: "text", autocomplete: "off", spellcheck: "false", ...(spec.kind === "number" ? { inputmode: "numeric" } : {}), ...(spec.placeholder === undefined ? {} : { placeholder: spec.placeholder }) });
  }
  control.dataset.key = spec.key;
  control.dataset.flag = spec.flag;
  controls.set(`${panel}:${spec.key}`, control);
  const tag = spec.engines === undefined ? null : h("span", { class: "tag" }, spec.engines.join(", "));
  const id = uniqueId("o");
  control.id = id;
  const note = h("small", { id: `${id}-help`, class: "help" }, `${spec.flag}: ${spec.help}`);
  control.setAttribute("aria-describedby", note.id);
  const label = h("label", { for: id }, spec.label, tag);
  const wrapper = h("div", { class: spec.kind === "flag" ? "field flag" : "field" });
  if (spec.kind === "flag") wrapper.append(control, label, note);
  else wrapper.append(label, control, note);
  return wrapper;
}

/** The banner of HOST-281: shown when the page is served over `http:`. */
function banner(location: Pick<Location, "protocol" | "hostname">): HTMLElement | null {
  if (location.protocol !== "http:") return null;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  return h(
    "div",
    { class: "banner", role: "note" },
    h("strong", {}, "This page is served over http:. "),
    local
      ? "On localhost a browser still treats it as a secure context, and that is the only reason to go on: the password and the packages cross the network as the address of your Aras server says, in clear text if it is http: too."
      : "The password and the packages can be read on the way, and a page served over http: cannot be trusted with a password. Serve it over https:. Over https:, Firefox and WebKit will not reach an http: Aras server.",
  );
}

/** A loaded package: the widget that takes a zip, a folder or a drop, and the tree it mounted. */
interface SourceWidget {
  element: HTMLElement;
  get(): MountedSource | undefined;
}

function sourceWidget(label: string, canPick: boolean, pick: NonNullable<AppDeps["pickDirectory"]>, busy: () => boolean): SourceWidget {
  let mounted: MountedSource | undefined;
  let version = 0;
  const status = h("p", { class: "status", role: "status" }, "Nothing loaded.");
  const zip = h("input", { type: "file", accept: ".zip,application/zip", "data-source": "zip" });
  const folder = h("input", { type: "file", webkitdirectory: true, "data-source": "folder" });
  const drop = h("div", { class: "drop", tabindex: "0", "data-source": "drop" }, "Drop a zip or a folder here");

  const take = (loading: (onProgress: (progress: MountProgress) => void) => Promise<MountedSource>): void => {
    const mine = ++version;
    mounted = undefined;
    status.className = "status";
    status.textContent = "Reading…";
    loading((progress) => {
      if (mine === version) status.textContent = `Reading… ${progress.files} files, ${sizeText(progress.bytes)}`;
    }).then(
      (source) => {
        if (mine !== version) return;
        mounted = source;
        const stubs = source.tree.stubs().length;
        status.textContent = `${source.label}: ${sizeText(source.tree.size)} in memory${stubs > 0 ? `, ${stubs} large files kept as names only` : ""} (budget ${sizeText(PACKAGE_BUDGET)}).`;
      },
      (error: unknown) => {
        if (mine !== version) return;
        status.className = "status error";
        status.textContent = `Could not read it: ${describeFailure(error)}`;
      },
    );
  };

  zip.addEventListener("change", () => {
    if (zip.files !== null && zip.files.length > 0) {
      const files = zip.files;
      take((progress) => mountFiles(files, progress));
    }
  });
  folder.addEventListener("change", () => {
    if (folder.files !== null && folder.files.length > 0) {
      const files = folder.files;
      take((progress) => mountFiles(files, progress));
    }
  });
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("over");
    // the adapter takes the entries before its first await, which is why it is called here and not later (HOST-255)
    const transfer = event.dataTransfer;
    if (transfer !== null) take((progress) => mountDrop(transfer, progress));
  });

  const row = h("div", { class: "row" }, field("Zip file", zip), field("Folder", folder));
  if (canPick) {
    const button = h("button", { type: "button", "data-source": "picker" }, "Pick a folder (File System Access)…");
    button.addEventListener("click", () => {
      if (busy()) return;
      pick("read").then(
        (handle) => take(() => mountHandle(handle)),
        (error: unknown) => {
          if ((error as { name?: string } | null)?.name === "AbortError") return;
          status.className = "status error";
          status.textContent = `Could not open the folder: ${describeFailure(error)}`;
        },
      );
    });
    row.append(h("div", { class: "field" }, h("span", { class: "label" }, "Folder picker"), button));
  }
  return { element: h("fieldset", { class: "source" }, h("legend", {}, label), drop, row, status), get: () => mounted };
}

/** An element that shows the messages and the progress of a run. */
class RunView {
  readonly element: HTMLElement;
  private readonly progressList = h("ol", { class: "progress", "aria-label": "Progress" });
  private readonly logPane = h("pre", { class: "log", role: "log", tabindex: "0", "aria-label": "Messages" });
  private readonly status = h("p", { class: "status", role: "status" });
  private readonly failure = h("div", { class: "error", role: "alert", hidden: true });
  private readonly summary = h("dl", { class: "summary" });
  private current: { item: HTMLLIElement; bar: HTMLProgressElement; text: HTMLElement } | undefined;
  private lines = 0;

  constructor() {
    this.element = h(
      "section",
      { class: "run-view", "aria-label": "Run" },
      this.status,
      this.failure,
      h("h3", {}, "Progress"),
      this.progressList,
      h("h3", {}, "Messages"),
      this.logPane,
      this.summary,
    );
  }

  reset(): void {
    this.progressList.replaceChildren();
    this.logPane.replaceChildren();
    this.summary.replaceChildren();
    this.failure.hidden = true;
    this.failure.textContent = "";
    this.current = undefined;
    this.lines = 0;
  }

  say(text: string): void {
    this.status.textContent = text;
  }

  message(message: ApiMessage): void {
    this.lines += 1;
    if (this.lines === LOG_LINES + 1) {
      this.logPane.append(h("span", { class: "line info" }, `… the page shows the first ${LOG_LINES} lines; the run log has all of them\n`));
    }
    if (this.lines > LOG_LINES) return;
    const prefix = message.source === "engine" && message.channel !== undefined ? `[${message.channel}] ` : "";
    this.logPane.append(h("span", { class: `line ${message.level}` }, `${prefix}${message.text}\n`));
    this.logPane.scrollTop = this.logPane.scrollHeight;
  }

  progress(event: ProgressEvent): void {
    if (event.phase === "package") {
      const bar = h("progress", { max: "1", value: "0" });
      const text = h("span", { class: "item" }, "starting");
      const item = h("li", {}, h("strong", {}, event.package ?? ""), " ", bar, " ", text);
      this.progressList.append(item);
      this.current = { item, bar, text };
    } else if (event.phase === "item" && this.current !== undefined && event.total !== undefined && event.index !== undefined) {
      this.current.bar.max = event.total;
      this.current.bar.value = event.index;
      this.current.text.textContent = `item ${event.index} of ${event.total}: ${event.item?.type ?? ""} ${event.item?.name ?? ""}`;
    } else if (this.current !== undefined) {
      this.current.text.textContent = event.phase === "completed" ? "completed" : event.phase;
      if (event.phase === "completed") this.current.bar.value = this.current.bar.max;
    }
  }

  fail(error: unknown): void {
    const name = error instanceof Error ? error.name : "Error";
    this.failure.hidden = false;
    this.failure.textContent = `${name}: ${describeFailure(error)}`;
  }

  showSummary(result: OperationResult): void {
    const { summary } = result;
    const rows: Array<[string, string]> = [
      ["Result", summary.result],
      ["Engine", summary.engine],
      ["Server", summary.server ?? ""],
      ["Return code", String(summary.returnCode)],
      ["Messages", `${summary.messages.info} info, ${summary.messages.warnings} warnings, ${summary.messages.errors} errors`],
      ["Packages", summary.packages.map((entry) => (entry.items === undefined ? entry.name : `${entry.name} (${entry.items} items)`)).join(", ")],
    ];
    this.summary.replaceChildren(...rows.flatMap(([term, value]) => [h("dt", {}, term), h("dd", {}, value)]));
  }
}

/** Draws the page into `root`. */
export function mountApp(root: HTMLElement, deps: AppDeps = {}): App {
  const engine = deps.engine ?? createDirectEngine();
  const save = deps.saveFile ?? downloadFile;
  const pick = deps.pickDirectory ?? pickDirectory;
  const canPick = deps.canPickDirectory ?? canPickDirectory();
  const location = deps.location ?? window.location;

  const controls = new Map<string, Control>();
  const connection = new Map<string, Control>();
  const view = new RunView();
  let mode: Mode = "export";
  let running: AbortController | undefined;
  let lastLog: string | undefined;
  let lastZip: { name: string; bytes: Uint8Array } | undefined;
  let sinkHandle: FsaDirectoryHandle | undefined;

  const isBusy = (): boolean => running !== undefined;

  // ------------------------------------------------------------------------------------------------------ connection

  const connectionField = (key: string, label: string, control: Control, help?: string): HTMLElement => {
    control.dataset.key = key;
    connection.set(key, control);
    return field(label, control, help);
  };
  const password = h("input", { type: "password", autocomplete: "off", spellcheck: "false" });
  const engineSelect = h("select", {}, h("option", { value: "auto" }, "auto (follow the server)"), ...ENGINES.map((name) => h("option", { value: name }, name)));
  const runOptions = RUN_OPTIONS.map((spec) => controlOf(spec, controls, "run"));
  const connectionBox = h(
    "fieldset",
    { class: "connection" },
    h("legend", {}, "Aras server"),
    h(
      "div",
      { class: "row" },
      connectionField("url", "URL", h("input", { type: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://aras.example.com/InnovatorServer" }), "The address of the server, as the CLI's --url takes it."),
      connectionField("database", "Database", h("input", { type: "text", autocomplete: "off", spellcheck: "false" })),
      connectionField("userName", "User", h("input", { type: "text", autocomplete: "off", spellcheck: "false" })),
      connectionField("password", "Password", password, "Kept in memory for the run; never stored, never in the URL."),
      connectionField("engine", "Engine", engineSelect, "Which build of the engine to reproduce."),
    ),
    h("details", {}, h("summary", {}, "Run options"), h("div", { class: "row" }, ...runOptions)),
    h(
      "details",
      {},
      h("summary", {}, "What the server needs"),
      h(
        "p",
        { class: "help" },
        "A page that is not served by the Aras server itself is a cross-origin client. The server's administrator has to list the page's origin in the OAuth server's allowedCorsOrigins (OAuth.config) on every flavour, and, on 12 SP9, add the CORS headers to the SOAP endpoint (Server/web.config). A page embedded in the Aras client needs neither. See roadmap/browser-cors-poc.md.",
      ),
    ),
  );

  // ------------------------------------------------------------------------------------------------------- panels

  const panels = new Map<Mode, HTMLElement>();
  const sources = new Map<Mode, SourceWidget>();
  const sourceOf = (which: Mode, label = "Package"): SourceWidget => {
    const widget = sourceWidget(label, canPick, pick, isBusy);
    sources.set(which, widget);
    return widget;
  };
  const optionControls = (which: Mode): HTMLElement[] => optionsOf(which).map((spec) => controlOf(spec, controls, which));
  const textInput = (panel: Mode, key: string, placeholder?: string, value?: string): HTMLInputElement => {
    const input = h("input", { type: "text", autocomplete: "off", spellcheck: "false", "data-key": key, ...(placeholder === undefined ? {} : { placeholder }), ...(value === undefined ? {} : { value }) });
    controls.set(`${panel}:${key}`, input);
    return input;
  };

  // export
  const selection = h("select", { "data-key": "selection" }, ...SELECTIONS.map((value) => h("option", { value }, selectionLabel(value))));
  controls.set("export:selection", selection);
  const packagesBox = h("textarea", { rows: "3", "data-key": "packages", spellcheck: "false", placeholder: "com.example.package" });
  const itemsBox = h("textarea", { rows: "3", "data-key": "items", spellcheck: "false", placeholder: "Permission:012233DFCF4F434484D720F8598FF2D4" });
  controls.set("export:packages", packagesBox);
  controls.set("export:items", itemsBox);
  const packagesField = field("Packages", packagesBox, "Every element of the named packages, one name per line (--package).");
  const itemsField = field("Items", itemsBox, "One Type:id per line; each item's package is found on the server.");
  const manifestField = field("Manifest in the package", textInput("export", "manifest", "/imports.mf", "/imports.mf"), "The path of the manifest in the package below (--from-manifest, --use-import).");
  const exportSource = sourceOf("export", "Package with the manifest");
  const sinkDownload = h("input", { type: "radio", name: "sink", value: "download", checked: true, "data-key": "sink-download" });
  const sinkFolder = h("input", { type: "radio", name: "sink", value: "folder", "data-key": "sink-folder" });
  const sinkName = h("span", { class: "status" }, "no folder chosen");
  const sinkButton = h("button", { type: "button", "data-key": "sink-pick" }, "Choose a folder…");
  sinkButton.addEventListener("click", () => {
    pick("readwrite").then(
      (handle) => {
        sinkHandle = handle;
        sinkName.textContent = handle.name;
        sinkFolder.checked = true;
      },
      (error: unknown) => {
        if ((error as { name?: string } | null)?.name !== "AbortError") sinkName.textContent = `could not open it: ${describeFailure(error)}`;
      },
    );
  });
  const sinkBox = h(
    "fieldset",
    { class: "sink" },
    h("legend", {}, "Result"),
    h("label", { class: "choice" }, sinkDownload, " Download as a zip"),
    canPick ? h("div", { class: "choice" }, h("label", {}, sinkFolder, " Write into a folder "), sinkButton, " ", sinkName) : null,
  );
  const syncSelection = (): void => {
    const chosen = selection.value as Selection;
    packagesField.hidden = chosen !== "packages";
    itemsField.hidden = chosen !== "items";
    manifestField.hidden = exportSource.element.hidden = !selectionNeedsSource(chosen);
  };
  selection.addEventListener("change", syncSelection);
  panels.set(
    "export",
    h(
      "div",
      { class: "panel", role: "tabpanel", "data-panel": "export" },
      field("What to export", selection, "Exactly one: package names, items, every package, or the packages of a manifest."),
      packagesField,
      itemsField,
      manifestField,
      exportSource.element,
      sinkBox,
      h("div", { class: "row" }, ...optionControls("export")),
    ),
  );
  syncSelection();

  // import
  const importSource = sourceOf("import");
  panels.set(
    "import",
    h(
      "div",
      { class: "panel", role: "tabpanel", "data-panel": "import" },
      importSource.element,
      field("Manifest in the package", textInput("import", "manifestPath", "/imports.mf"), "Default /imports.mf: the folder you give is the root, whether it is zipped, picked or dropped."),
      h("div", { class: "row" }, ...optionControls("import")),
    ),
  );

  // language pack
  const lpSource = sourceOf("language-pack", "Language pack");
  panels.set(
    "language-pack",
    h(
      "div",
      { class: "panel", role: "tabpanel", "data-panel": "language-pack" },
      lpSource.element,
      field("Configuration file in the pack", textInput("language-pack", "lpPath", "/ImportConfig.xml"), "The path of ImportConfig.xml in the pack (the CLI's <lppath>). Not on 12.0."),
      h("div", { class: "row" }, ...optionControls("language-pack")),
    ),
  );

  // DB patches
  const patchSource = sourceOf("db-patches", "Patches");
  panels.set(
    "db-patches",
    h(
      "div",
      { class: "panel", role: "tabpanel", "data-panel": "db-patches" },
      patchSource.element,
      field("Manifest in the package", textInput("db-patches", "manifestPath", "/manifest.xml"), "The manifest that lists the patches (the CLI's <manifest>). Engine 14.35 only, and the login root."),
      h("div", { class: "row" }, ...optionControls("db-patches")),
    ),
  );

  // ------------------------------------------------------------------------------------------------------ tabs

  const tabs = h("div", { role: "tablist", class: "tabs", "aria-label": "Operation" });
  const tabButtons = new Map<Mode, HTMLButtonElement>();
  for (const entry of MODES) {
    const button = h("button", { type: "button", role: "tab", "data-mode": entry.mode, "aria-selected": "false" }, entry.label);
    button.addEventListener("click", () => select(entry.mode));
    tabButtons.set(entry.mode, button);
    tabs.append(button);
  }
  const select = (next: Mode): void => {
    mode = next;
    for (const [which, button] of tabButtons) button.setAttribute("aria-selected", String(which === next));
    for (const [which, panel] of panels) panel.hidden = which !== next;
  };
  select("export");

  // --------------------------------------------------------------------------------------------------------- run

  const runButton = h("button", { type: "button", class: "primary", "data-key": "run" }, "Run");
  const abortButton = h("button", { type: "button", "data-key": "abort", disabled: true }, "Abort");
  const logButton = h("button", { type: "button", "data-key": "download-log", hidden: true }, "Download the run log");
  const zipButton = h("button", { type: "button", "data-key": "download-zip", hidden: true }, "Download the zip again");
  const formError = h("p", { class: "error", role: "alert", hidden: true });

  const values = (): Values => {
    const all: Values = {};
    for (const [key, control] of connection) all[key] = control instanceof HTMLInputElement && control.type === "checkbox" ? control.checked : control.value;
    for (const [id, control] of controls) {
      const [panel, key] = id.split(":") as [string, string];
      if (panel !== "run" && panel !== mode) continue;
      all[key] = control instanceof HTMLInputElement && control.type === "checkbox" ? control.checked : control.value;
    }
    return all;
  };

  const setBusy = (busy: boolean): void => {
    runButton.disabled = busy;
    abortButton.disabled = !busy;
    for (const button of tabButtons.values()) button.disabled = busy;
  };

  /** What a run does, worked out from the form before anything is sent: a form that cannot run is refused here, before the login. */
  interface Plan {
    execute(session: EngineSession, callbacks: Callbacks): Promise<OperationResult>;
    /** Hands the result to the person. */
    deliver(result: OperationResult): Promise<void>;
  }
  interface Callbacks {
    signal: AbortSignal;
    onMessage: (message: ApiMessage) => void;
    onProgress: (event: ProgressEvent) => void;
  }

  const planOf = (form: Values): Plan => {
    if (mode === "export") {
      const options = exportOptionsOf(form);
      const needsSource = options.manifest !== undefined;
      const source = exportSource.get();
      if (needsSource && source === undefined) throw new FormError("load the package that holds the manifest first");
      if (sinkFolder.checked && sinkHandle === undefined) throw new FormError("choose the folder to write into first");
      const folder = options.workingDirectory ?? "/export";
      return {
        execute: (session, callbacks) => {
          if (needsSource && source !== undefined) resetRunFolders(source);
          return session.exportPackages({ ...options, ...(source !== undefined && needsSource ? { vfs: source.tree } : {}), ...callbacks });
        },
        async deliver(result) {
          const exported = result as ExportResult;
          if (sinkFolder.checked && sinkHandle !== undefined) {
            const written = await writeToFolder(exported.vfs, sinkHandle, folder);
            view.say(`Wrote ${written.files} files (${sizeText(written.bytes)}) into ${sinkHandle.name}.`);
          } else {
            const bytes = zipOf(exported.vfs, folder);
            lastZip = { name: stampedName("export", "zip"), bytes };
            zipButton.hidden = false;
            save(lastZip.name, lastZip.bytes, "application/zip");
            view.say(`Exported ${exported.files.size} files; the zip is ${sizeText(bytes.length)}.`);
          }
        },
      };
    }
    const source = sources.get(mode)?.get();
    if (source === undefined) throw new FormError("load the package first: a zip, a folder or a drop");
    const done = (result: OperationResult): Promise<void> => {
      view.say(`Done: ${result.summary.result}.`);
      return Promise.resolve();
    };
    if (mode === "import") {
      const options = importOptionsOf(form);
      return { execute: (session, callbacks) => (resetRunFolders(source), session.importPackages({ ...options, source: source.tree, ...callbacks })), deliver: done };
    }
    if (mode === "language-pack") {
      const options = languagePackOptionsOf(form);
      return { execute: (session, callbacks) => (resetRunFolders(source), session.importLanguagePack({ ...options, source: source.tree, ...callbacks })), deliver: done };
    }
    const options = dbPatchOptionsOf(form);
    return { execute: (session, callbacks) => (resetRunFolders(source), session.applyDbPatches({ ...options, source: source.tree, ...callbacks })), deliver: done };
  };

  const run = async (): Promise<void> => {
    if (isBusy()) return;
    formError.hidden = true;
    const controller = new AbortController();
    running = controller;
    setBusy(true);
    view.reset();
    logButton.hidden = true;
    zipButton.hidden = true;
    lastLog = undefined;
    lastZip = undefined;
    let session: EngineSession | undefined;
    try {
      const form = values();
      const connect = connectOptionsOf(form);
      const plan = planOf(form);
      // the password leaves the field and goes to the connection; the field is emptied at once (HOST-281)
      password.value = "";
      view.say("Connecting…");
      session = await engine.connect({ ...connect, ...(deps.transport === undefined ? {} : { transport: deps.transport }) });
      view.say(`Connected to ${session.serverVersion}, engine ${session.engine}. Running…`);
      const result = await plan.execute(session, {
        signal: controller.signal,
        onMessage: (message) => view.message(message),
        onProgress: (event) => view.progress(event),
      });
      await plan.deliver(result);
      view.showSummary(result);
      lastLog = result.log;
      logButton.hidden = result.log === "";
    } catch (error) {
      if (error instanceof FormError) {
        formError.hidden = false;
        formError.textContent = error.message;
        view.say("");
      } else {
        view.fail(error);
        view.say("The run failed.");
      }
    } finally {
      password.value = "";
      if (session !== undefined) await session.close().catch(() => undefined);
      running = undefined;
      setBusy(false);
    }
  };
  runButton.addEventListener("click", () => void run());
  abortButton.addEventListener("click", () => {
    running?.abort();
    view.say("Aborting…");
  });
  logButton.addEventListener("click", () => {
    if (lastLog !== undefined) save(stampedName("run-log", "log"), new TextEncoder().encode(lastLog), "text/plain");
  });
  zipButton.addEventListener("click", () => {
    if (lastZip !== undefined) save(lastZip.name, lastZip.bytes, "application/zip");
  });

  // ---------------------------------------------------------------------------------------------------- the page

  const shell = h(
    "main",
    { class: "app" },
    h("header", {}, h("h1", {}, "Aras package import and export"), h("p", { class: "lede" }, "The browser build of import-export-libs-js: the engine runs in this tab, and nothing leaves it but the requests to your Aras server.")),
    banner(location),
    connectionBox,
    tabs,
    ...panels.values(),
    h("div", { class: "actions" }, runButton, abortButton, logButton, zipButton),
    formError,
    view.element,
  );
  root.append(shell);

  return {
    destroy(): void {
      running?.abort();
      shell.remove();
    },
  };
}

function selectionLabel(selection: Selection): string {
  switch (selection) {
    case "packages":
      return "Packages, by name";
    case "items":
      return "Items, by type and id";
    case "all-packages":
      return "Every package of the database";
    case "from-manifest":
      return "The packages of a manifest (--from-manifest)";
    case "use-import":
      return "The items an import manifest would add (--use-import)";
  }
}

/** A run leaves its log (and an export its output) in the tree it ran on; a second run starts without them. */
function resetRunFolders(source: MountedSource): void {
  for (const folder of ["/aras-pkg-logs", MANIFEST_EXPORT_FOLDER]) {
    if (source.tree.exists(folder)) source.tree.rm(folder, { recursive: true });
  }
}
