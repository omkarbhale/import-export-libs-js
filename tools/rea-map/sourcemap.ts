import { ENGINES } from "../../src/engines.js";

/**
 * The generated reachable set (`spec/reachable/<engine>.json`) and its merge
 * into the hand-maintained `spec/source-map.json`.
 */

export interface Lock {
  token: string;
  signatureSha256: string;
  ilSha256: string;
  bodySha256?: string;
  textSha256?: string;
}

export interface ReachableMethod {
  fullName: string;
  signature: string;
  lock: Lock;
  /** Where ILSpy's C# for this method sits under `.decomp/<engine>/`; absent when ILSpy maps no lines to it. */
  decomp?: { path: string; startLine: number; endLine: number };
}

export interface ReachableSet {
  $schema?: string;
  engine: string;
  assemblyVersion: string;
  sha256: string;
  mvid: string;
  generator: { rea: string; ilspycmd: string };
  /** The host executables whose references seeded the walk. */
  hosts: { file: string; sha256: string }[];
  /** Library entry points (`Type::Method`) that seeded the walk besides the hosts; absent when there were none. */
  entries?: string[];
  methods: ReachableMethod[];
}

export interface SourceMapMethod {
  fullName: string;
  signature: string;
  lock: Lock;
  status: "mapped" | "not-ported" | "unmapped";
  rules?: string[];
  symbols?: string[];
  reason?: string;
}

export interface SourceMapBuild {
  engine: string;
  assemblyVersion: string;
  sha256: string;
  mvid: string;
  inProgress?: boolean;
  methods: SourceMapMethod[];
}

export interface SourceMap {
  $schema?: string;
  builds: SourceMapBuild[];
}

export interface MergeReport {
  added: string[];
  removed: string[];
  /** Covered methods whose lock changed; they go back to `unmapped`, keeping their rules and symbols. */
  relocked: string[];
}

const key = (m: { fullName: string; signature: string }) => `${m.fullName} ${m.signature}`;

export const byName = (a: { fullName: string; signature: string }, b: { fullName: string; signature: string }) =>
  a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0;

/** The digests that decide whether a method is the same code in another build. */
export interface Code {
  signatureSha256: string;
  ilSha256: string | null;
}

/** Same code: the token may move between builds, the digests may not. */
const sameCode = (a: Code, b: Code) => a.signatureSha256 === b.signatureSha256 && a.ilSha256 === b.ilSha256;

export function mergeBuild(map: SourceMap, set: ReachableSet): MergeReport {
  const report: MergeReport = { added: [], removed: [], relocked: [] };
  const index = map.builds.findIndex((b) => b.engine === set.engine);
  const previous = index >= 0 ? map.builds[index] : undefined;
  const existing = new Map((previous?.methods ?? []).map((m) => [key(m), m]));

  const methods = set.methods.map((method): SourceMapMethod => {
    const old = existing.get(key(method));
    existing.delete(key(method));
    if (!old) {
      report.added.push(key(method));
      return { fullName: method.fullName, signature: method.signature, lock: method.lock, status: "unmapped" };
    }
    if (old.status !== "unmapped" && !sameCode(old.lock, method.lock)) {
      report.relocked.push(key(method));
      const { reason: _reason, ...rest } = old;
      return { ...rest, lock: method.lock, status: "unmapped" };
    }
    return { ...old, lock: method.lock };
  });
  report.removed.push(...existing.keys());

  const build: SourceMapBuild = {
    engine: set.engine,
    assemblyVersion: set.assemblyVersion,
    sha256: set.sha256,
    mvid: set.mvid,
    // A new build starts in progress; an existing one keeps whatever it says.
    ...(previous ? (previous.inProgress ? { inProgress: true } : {}) : { inProgress: true }),
    methods: methods.sort(byName),
  };
  if (index >= 0) map.builds[index] = build;
  else map.builds.push(build);
  const order = (engine: string) => (ENGINES as readonly string[]).indexOf(engine);
  map.builds.sort((a, b) => order(a.engine) - order(b.engine));
  return report;
}

export interface BrokenLock {
  status: "changed" | "removed";
  method: SourceMapMethod;
}

/**
 * The methods of `build` whose lock breaks in another build's `methods`,
 * matched by name and signature as `mergeBuild` matches them: changed when the
 * digests differ, removed when no method has that name and signature.
 */
export function brokenLocks(build: SourceMapBuild, methods: ({ fullName: string; signature: string } & Code)[]): BrokenLock[] {
  const next = new Map(methods.map((m) => [key(m), m]));
  return build.methods.flatMap((method): BrokenLock[] => {
    const other = next.get(key(method));
    if (!other) return [{ status: "removed", method }];
    return sameCode(method.lock, other) ? [] : [{ status: "changed", method }];
  });
}
