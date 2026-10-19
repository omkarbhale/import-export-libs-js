import { existsSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Engine } from "../engines.js";
import { IMPORT_RUN_ENGINES } from "../import/import-run.js";
import { planPackage } from "../import/plan.js";
import type { ImportPlan, PlanItem } from "../import/plan.js";
import { directoryGetParentFullName } from "../io/host-path.js";
import { MANIFEST_ENGINES, ManifestFile } from "../manifest/index.js";
import { getSolutionPath } from "../manifest/solution-path.js";
import { escapeText, loadXml } from "../xml/index.js";
import type { XmlDocument } from "../xml/index.js";
import { EXIT } from "./exit.js";
import type { CliIo } from "./io.js";
import { flagOf, listOf, parseOptions, requireEngine, resolveEngine } from "./options.js";
import { type Summary, printSummary } from "./summary.js";
import { PLAN_USAGE, UsageError } from "./usage.js";

/** One package of the plan: where its folder is, and what the import would do with it. */
interface PlannedPackage {
  name: string;
  folder: string;
  plan: ImportPlan;
}

function describeItem(item: PlanItem): string {
  return `${item.type ?? "(no type)"} ${item.action ?? "(no action)"}${item.id === null ? "" : ` id=${item.id}`}`;
}

/** A source file as the text shows it: relative to the manifest's folder when it lies below it. */
function shown(manifest: string, file: string): string {
  const path = relative(dirname(resolve(manifest)), file);
  return path.startsWith("..") ? file : path;
}

function planText(
  engine: Engine,
  manifest: string,
  order: readonly string[],
  warnings: readonly string[],
  packages: readonly PlannedPackage[],
  failure: string | undefined,
): string {
  const lines = [`engine: ${engine}`, `manifest: ${manifest}`, `import order: ${order.join(", ") || "(none)"}`];
  for (const warning of warnings) lines.push(`warning: ${warning}`);
  for (const [index, { name, folder, plan }] of packages.entries()) {
    lines.push("", `package ${index + 1} of ${order.length}: ${name}`, `  folder: ${folder}`);
    lines.push(`  sequence (${plan.sequence.length} items):`);
    for (const entry of plan.sequence) {
      const place = `${shown(manifest, entry.source.file)} #${entry.source.itemIndex}`;
      lines.push(`    ${String(entry.position).padStart(4)}  ${entry.group.padEnd(11)} ${describeItem(entry)}  (${place})`);
    }
    lines.push(`  repeats (${plan.repeats.length}):`);
    for (const repeat of plan.repeats) {
      const where = repeat.position === undefined ? `inside entry ${repeat.insideEntry ?? "?"}` : `at ${repeat.position}`;
      const carrier = repeat.carriedBy.position === undefined ? "a nested add" : `the add at ${repeat.carriedBy.position}`;
      lines.push(`    ${describeItem(repeat)} ${where}, carried by ${carrier}`);
    }
    lines.push(`  dropped (${plan.dropped.length}):`);
    for (const drop of plan.dropped) lines.push(`    ${describeItem(drop)}: ${drop.reason}  (${shown(manifest, drop.source.file)} #${drop.source.itemIndex})`);
    if (plan.skipped.length > 0) {
      lines.push(`  skipped files (${plan.skipped.length}):`);
      for (const skipped of plan.skipped) lines.push(`    ${shown(manifest, skipped.file)}: ${skipped.warning}`);
    }
    for (const warning of plan.warnings) lines.push(`  warning: ${warning}`);
  }
  if (failure !== undefined) lines.push("", `failed: ${failure}`);
  return `${lines.join("\n")}\n`;
}

/**
 * The database document the ordering consults for a dependency that is not among the packages: offline, every dependency is taken
 * to exist there, so only a circular dependency warns (MAN-022, MAN-023).
 */
function assumedDatabase(manifest: ManifestFile, names: readonly string[]): XmlDocument {
  const dependencies = new Set(names.flatMap((name) => manifest.getAllDependsOnNames(manifest.getPackageNode(name))));
  const items = [...dependencies].map((name) => `<Item type="PackageDefinition"><name>${escapeText(name)}</name></Item>`);
  return loadXml(`<AML>${items.join("")}</AML>`, { preserveWhitespace: false });
}

/**
 * `plan import <manifest> [--package …]`: the order the import follows and, per package, the sequence `build.xsl` leaves, the
 * repeats and the dropped items, all offline. It stops at the first package whose folder cannot be loaded, as the import does
 * (IMP-033).
 *
 * @spec IMP-033 MAN-032
 */
export async function planCommand(args: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseOptions(args, {
    engine: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    package: { type: "string", multiple: true },
  });
  if (flagOf(values, "help")) {
    io.stdout.write(PLAN_USAGE);
    return EXIT.ok;
  }
  const engine = resolveEngine(values, io);
  const [subcommand, manifestPath, ...extra] = positionals;
  if (subcommand !== "import") throw new UsageError("plan needs a subject: aras-pkg plan import <manifest>");
  if (manifestPath === undefined) throw new UsageError("plan import needs the manifest: aras-pkg plan import <manifest>");
  if (extra.length > 0) throw new UsageError(`unexpected argument '${extra[0]}'`);
  requireEngine(engine, IMPORT_RUN_ENGINES.filter((supported) => MANIFEST_ENGINES.includes(supported)));
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) throw new UsageError(`the manifest '${manifestPath}' does not exist`);

  const manifest = new ManifestFile(manifestPath, { engine });
  const known = manifest.getAllPackageNames();
  const requested = listOf(values, "package");
  const unknown = requested.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new UsageError(`the manifest has no package ${unknown.map((name) => `'${name}'`).join(", ")}; it has ${known.join(", ") || "none"}`);
  }
  const names = requested.length > 0 ? requested : known;

  const orderWarnings: string[] = [];
  const order = manifest.getPackageNamesInImportOrder(names, assumedDatabase(manifest, names), orderWarnings);
  const manifestFolder = directoryGetParentFullName(manifestPath, {});
  const packages: PlannedPackage[] = [];
  let failure: string | undefined;
  for (const name of order) {
    try {
      const folder = getSolutionPath(name, manifestFolder, manifest);
      packages.push({ name, folder, plan: planPackage(folder, { engine }) });
    } catch (error) {
      failure = `package ${name}: ${(error as Error).message}`;
      break;
    }
  }

  const exitCode = failure === undefined ? EXIT.ok : EXIT.failed;
  const summary: Summary = {
    command: "plan import",
    engine,
    result: failure === undefined ? "success" : "failed",
    exitCode,
    manifest: manifestPath,
    order,
    warnings: orderWarnings,
    packages: packages.map(({ name, folder, plan }) => ({ name, folder, ...plan }) as unknown as Summary),
    error: failure,
  };
  printSummary(io, flagOf(values, "json"), summary, planText(engine, manifestPath, order, orderWarnings, packages, failure));
  if (failure !== undefined) io.stderr.write(`[ERROR] ${failure}\n`);
  return exitCode;
}
