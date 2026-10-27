import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The servers the live test, the oracle and the parity script may contact (AGENTS.md "Live Aras"): the dev instance, or an
 * arashouse lease that `arashouse status --json` shows as `leased` right now. Anything else is refused, and so is anything whose
 * URL or database names olm or prod (`OLM_Local` included), before any lookup. A lease is never a free-form URL: its alias and
 * database must be the pair arashouse derives for one slot (`ah-<slot>`, `arashouse_<flavor>_<NN>`), on an address this machine
 * reaches the Windows host at. The lookup fails closed: a missing `arashouse`, a failing command or output that does not parse
 * refuses the lease.
 */

/** The dev instance as Windows (`localhost`) and WSL (172.19.0.1) reach it. */
export const DEV_URLS: ReadonlySet<string> = new Set(["http://localhost/12sp9", "http://172.19.0.1/12sp9"]);

export type LiveTarget = { kind: "dev" } | { kind: "lease"; slot: string; flavor: string };

export interface LiveTargetDeps {
  env?: NodeJS.ProcessEnv;
  /** Runs `<bin> status --json` and resolves to its stdout; rejects when the command is missing or fails. */
  runStatus?: (bin: string) => Promise<string>;
  /** The WSL default gateway, the address WSL reaches the Windows host at; undefined when there is none. */
  gateway?: () => string | undefined;
}

const DENIED = /olm|prod/i;
const LEASE_DATABASE = /^arashouse_([a-z0-9]+)_([0-9]{2})$/;
const STATUS_TIMEOUT_MS = 30_000;

function runStatus(bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ["status", "--json"], { timeout: STATUS_TIMEOUT_MS, maxBuffer: 4 << 20 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/** The gateway of `/proc/net/route`'s default route (little-endian hex), as `ip route show default` prints it. */
function defaultGateway(): string | undefined {
  try {
    for (const line of readFileSync("/proc/net/route", "utf8").split("\n").slice(1)) {
      const [, destination, gateway] = line.trim().split(/\s+/);
      if (destination !== "00000000" || gateway === undefined || !/^[0-9A-Fa-f]{8}$/.test(gateway)) continue;
      const n = Number.parseInt(gateway, 16);
      return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24].join(".");
    }
  } catch {
    // Not Linux, or no routing table: the gateway is not an allowed host then.
  }
  return undefined;
}

/** The addresses a lease's URL may use: loopback, the dev instance's hosts, the WSL gateway and `ARASHOUSE_HOST_ADDR`. */
function leaseHosts(env: NodeJS.ProcessEnv, gateway: () => string | undefined): Set<string> {
  const hosts = new Set(["localhost", "127.0.0.1", ...[...DEV_URLS].map((u) => new URL(u).host)]);
  const g = gateway();
  if (g !== undefined) hosts.add(g);
  const pinned = env["ARASHOUSE_HOST_ADDR"]?.trim().toLowerCase();
  if (pinned) hosts.add(pinned);
  return hosts;
}

/** Whether `arashouse status --json` shows `slot` of `flavor` as leased. */
function isLeased(statusJson: string, slot: string, flavor: string): boolean {
  const status = JSON.parse(statusJson) as unknown;
  if (typeof status !== "object" || status === null || !Array.isArray((status as { slots?: unknown }).slots)) return false;
  return ((status as { slots: unknown[] }).slots).some((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return r["slot"] === slot && r["flavor"] === flavor && r["status"] === "leased";
  });
}

/** What `url` and `database` are, or null when neither the dev instance nor a current lease. Trailing slashes are ignored. */
export async function resolveLiveTarget(url: string, database: string, deps: LiveTargetDeps = {}): Promise<LiveTarget | null> {
  if (DENIED.test(url) || DENIED.test(database)) return null;
  const trimmed = url.replace(/\/+$/, "");
  if (DEV_URLS.has(trimmed)) return { kind: "dev" };

  const db = LEASE_DATABASE.exec(database);
  if (db === null) return null;
  const flavor = db[1]!;
  const slot = `${flavor}-${db[2]!}`;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return null;
  if (parsed.pathname !== `/ah-${slot}`) return null;
  const env = deps.env ?? process.env;
  if (!leaseHosts(env, deps.gateway ?? defaultGateway).has(parsed.host)) return null;

  try {
    const stdout = await (deps.runStatus ?? runStatus)(env["ARASHOUSE_BIN"] || "arashouse");
    return isLeased(stdout, slot, flavor) ? { kind: "lease", slot, flavor } : null;
  } catch {
    return null;
  }
}

export async function isAllowedLiveTarget(url: string, database: string, deps: LiveTargetDeps = {}): Promise<boolean> {
  return (await resolveLiveTarget(url, database, deps)) !== null;
}

/** Throws unless `url` and `database` are the dev instance or a current arashouse lease. */
export async function assertLiveTarget(url: string, database: string, deps: LiveTargetDeps = {}): Promise<LiveTarget> {
  const target = await resolveLiveTarget(url, database, deps);
  if (target === null) {
    throw new Error(
      `refusing ${url} (database ${database}): the oracle talks only to the dev instance (${[...DEV_URLS].join(", ")}) or to a lease that \`arashouse status --json\` shows as leased`,
    );
  }
  return target;
}

/** The Aras major version the target's server reports: 12 for the dev instance and a `12sp9` lease, 14 for every other flavor. */
export function serverMajor(target: LiveTarget): number {
  return target.kind === "dev" || target.flavor === "12sp9" ? 12 : 14;
}

/** The same server as the oracle's Windows host reaches it: `localhost`, with the URL's port and path. */
export function windowsUrl(url: string): string {
  const parsed = new URL(url.replace(/\/+$/, ""));
  return `http://localhost${parsed.port === "" ? "" : `:${parsed.port}`}${parsed.pathname}`;
}
