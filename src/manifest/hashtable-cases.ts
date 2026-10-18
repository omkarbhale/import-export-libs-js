/**
 * The probe cases that fix `NetfxHashtable` to the real .NET Framework (MAN-017): a deterministic generator and the
 * evaluator that runs them through the emulation. The same cases were run in 64-bit Windows PowerShell 5.1 by
 * `fixtures/manifest/14.0.7/hashtable/probe.ps1`; the digest of what the real engine printed is in
 * `fixtures/manifest/14.0.7/hashtable/README.md`, and `netfx-hashtable.test.ts` compares it with the emulation's.
 *
 * A line is `H <key>` (the hash of a key), `C <id> <operations>` (one table built by `S:` indexer-set, `A:` Add and
 * `R:` Remove operations) or `N <id> <package,item pairs>` (the host's nested table). Keys travel as base64 of the raw
 * UTF-16LE code units, so that lone surrogates and NULs survive.
 */
import { NetfxHashtable, netfxStringHash64 } from "./netfx-hashtable.js";

export const enc = (s: string): string => {
  const b = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) b.writeUInt16LE(s.charCodeAt(i), 2 * i);
  return b.toString("base64");
};
export const dec = (b64: string): string => {
  const b = Buffer.from(b64, "base64");
  let s = "";
  for (let i = 0; i < b.length; i += 2) s += String.fromCharCode(b.readUInt16LE(i));
  return s;
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The 1,200 table cases, 200 nested cases and every key's hash, as the probe generator wrote them for `seed`. */
export function generateCases(seed: number): string[] {
  const rnd = mulberry32(seed);
  const int = (n: number): number => Math.floor(rnd() * n);
  const pick = <T>(xs: T[]): T => xs[int(xs.length)]!;
  const hex = (n: number, upper: boolean): string => {
    let s = "";
    for (let i = 0; i < n; i++) s += "0123456789ABCDEF"[int(16)];
    return upper ? s : s.toLowerCase();
  };
  const word = (): string => {
    const n = 1 + int(12);
    let s = "";
    for (let i = 0; i < n; i++) s += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_ "[int(64)];
    return s;
  };
  const pkgName = (): string =>
    pick([
      () => `com.aras.innovator.${word().replace(/ /g, "")}`,
      () => `com.aras.innovator.solution.${word().replace(/ /g, "")}`,
      () => `${word()}.${word()}`,
      () => word(),
      () => `LIBSJS-SCRATCH-${hex(4, true)}`,
    ])();
  const exotic = (): string => {
    const n = int(20);
    let s = "";
    for (let i = 0; i < n; i++) {
      const r = rnd();
      if (r < 0.05) s += "\u0000";
      else if (r < 0.15) s += String.fromCharCode(0xd800 + int(0x800)); // lone surrogate
      else if (r < 0.25) s += String.fromCodePoint(0x10000 + int(0xfffff));
      else if (r < 0.5) s += String.fromCharCode(0x80 + int(0xff00));
      else s += String.fromCharCode(0x20 + int(0x5f));
    }
    return s;
  };
  const refKey = (): string =>
    `[${pkgName()}].[${pick(["ItemType", "Method", "Form", "Identity"])}].${word()}All items of type '${word()}'`;
  const key = (): string => {
    const r = rnd();
    if (r < 0.55) return hex(32, true);
    if (r < 0.6) return hex(32, false);
    if (r < 0.75) return pkgName();
    if (r < 0.82) return refKey();
    if (r < 0.98) return exotic();
    return "";
  };

  const lines: string[] = [];
  const allKeys = new Set<string>();
  for (let c = 0; c < 1200; c++) {
    const r = rnd();
    const n = r < 0.5 ? int(30) : r < 0.85 ? 30 + int(300) : 300 + int(3000);
    const withRemoves = rnd() < 0.25;
    const keys: string[] = [];
    const seen = new Set<string>();
    const ops: string[] = [];
    for (let i = 0; i < n; i++) {
      const roll = rnd();
      if (keys.length > 0 && roll < 0.08) {
        ops.push(`S:${enc(pick(keys))}`); // overwrite in place
      } else if (withRemoves && keys.length > 0 && roll < 0.3) {
        ops.push(`R:${enc(pick(keys))}`);
      } else {
        let k = key();
        while (seen.has(k)) k = key() + String(i);
        keys.push(k);
        seen.add(k);
        allKeys.add(k);
        ops.push(`${rnd() < 0.5 ? "S" : "A"}:${enc(k)}`);
      }
    }
    lines.push(`C\tr${c}\t${ops.join(" ")}`);
  }
  for (let c = 0; c < 200; c++) {
    const pkgs = Array.from({ length: 1 + int(rnd() < 0.8 ? 6 : 60) }, pkgName);
    const n = 1 + int(rnd() < 0.7 ? 40 : 800);
    const pairs: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = hex(32, true);
      allKeys.add(id);
      pairs.push(`${enc(pick(pkgs))},${enc(id)}`);
    }
    pkgs.forEach((p) => allKeys.add(p));
    lines.push(`N\tn${c}\t${pairs.join(" ")}`);
  }
  for (const k of allKeys) lines.push(`H\t${enc(k)}`);
  return lines;
}

// Two-char-block strings whose 64-bit hashes are identical: vary positions 0 and 2,
// fix 1 and 3, and pick char 2 so that hash1 lands on one target value.
/** Two cases whose keys all share one hash: 90 keys (reproducible) and every key found (past .NET's limit). */
export function collisionCases(): string[] {
  const h0 = (((5381 << 5) + 5381) | 0);
  const groups = new Map<number, number[]>();
  for (let c0 = 1; c0 < 0xd800; c0++) {
    const v = (((h0 ^ c0) << 5) + (h0 ^ c0)) | 0;
    const g = v >>> 16;
    groups.set(g, [...(groups.get(g) ?? []), c0]);
  }
  const [best] = [...groups.values()].sort((a, b) => b.length - a.length);
  const target = (((h0 ^ best![0]!) << 5) + (h0 ^ best![0]!)) | 0;
  const keys: string[] = [];
  for (const c0 of best!) {
    const v = (((h0 ^ c0) << 5) + (h0 ^ c0)) | 0;
    const c2 = (target ^ v) & 0xffff;
    if (c2 === 0) continue;
    keys.push(String.fromCharCode(c0, 0x41, c2, 0x42));
  }
  const hashes = new Set(keys.map(netfxStringHash64));
  if (hashes.size !== 1) throw new Error("collision construction failed");
  const lines = [`C\tcollide-90\t${keys.slice(0, 90).map((k) => `S:${enc(k)}`).join(" ")}`];
  lines.push(`C\tcollide-${keys.length}\t${keys.map((k) => `S:${enc(k)}`).join(" ")}`);
  for (const k of keys.slice(0, 3)) lines.push(`H\t${enc(k)}`);
  return lines;
}

function dump<V>(t: NetfxHashtable<V>): string {
  return [...t.entries()].map(([k, v]) => `${enc(k)}:${v instanceof NetfxHashtable ? "T" : String(v)}`).join(" ");
}

/** The probe's output for each case line, as the evaluator prints it. A case the emulation refuses prints `ERROR` and the message. */
export function* evaluateCases(lines: Iterable<string>): Generator<string> {
  for (const line of lines) {
    if (!line) continue;
    const [kind, id, body] = line.split("\t") as [string, string, string?];
    try {
      if (kind === "H") yield `H\t${id}\t${netfxStringHash64(dec(id))}`;
      else if (kind === "C") {
        const t = new NetfxHashtable<number>();
        let seq = 0;
        for (const op of (body as string).split(" ")) {
          if (!op) continue;
          const k = dec(op.slice(2));
          seq++;
          if (op[0] === "S") t.set(k, seq);
          else if (op[0] === "A") t.add(k, seq);
          else t.remove(k);
        }
        yield `C\t${id}\t${dump(t)}`;
      } else if (kind === "N") {
        const table = new NetfxHashtable<NetfxHashtable<number>>();
        let seq = 0;
        for (const pair of (body as string).split(" ")) {
          const [p, i] = pair.split(",") as [string, string];
          const pkg = dec(p);
          seq++;
          let inner = table.get(pkg);
          if (!inner) table.set(pkg, (inner = new NetfxHashtable<number>()));
          inner.set(dec(i), seq);
        }
        yield `N\t${id}\t${[...table.entries()].map(([k, v]) => `${enc(k)}=${dump(v)}`).join("|")}`;
      }
    } catch (error) {
      yield `${kind}\t${id}\tERROR ${(error as Error).message}`;
    }
  }
}
