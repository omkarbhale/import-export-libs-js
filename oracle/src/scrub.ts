import { createHash } from "node:crypto";

/**
 * Credential scrubbing for recorded oracle runs (AGENTS.md rule 6). The
 * engine never sends the password inside the AML it hands to `CallAction`
 * (IOM puts credentials in headers and the OAuth exchange, which the recorder
 * does not see), so what can reach a recording is a password hash in item
 * data, a token in an error text, or the run's own secret echoed by a host.
 */

export const SCRUBBED = "SCRUBBED";
export const SCRUBBED_TOKEN = "SCRUBBED_TOKEN";

interface Pattern {
  name: string;
  regex: RegExp;
  /** Replacement for scrubbing; also decides which matches are already clean. */
  replace: (match: string, ...groups: string[]) => string;
}

const PATTERNS: Pattern[] = [
  {
    // <password>…</password>, <old_password>, <password_salt>, <password_hash>; not <password_hash_algorithm>.
    name: "password element",
    regex: /<((?:\w+_)?password(?:_salt|_hash)?)(\s[^>]*)?>([^<]+)<\/\1>/gi,
    replace: (_m, tag, attrs = "") => `<${tag}${attrs}>${SCRUBBED}</${tag}>`,
  },
  {
    name: "password field",
    regex: /("password"\s*:\s*")((?:[^"\\]|\\.)+)(")/gi,
    replace: (_m, head, _v, tail) => `${head}${SCRUBBED}${tail}`,
  },
  {
    name: "password parameter",
    regex: /([?&;\s]password=)([^&\s"'<\\]+)/gi,
    replace: (_m, head) => `${head}${SCRUBBED}`,
  },
  {
    name: "Authorization header",
    regex: /(\bAuthorization\s*:\s*)([^\r\n"<\\]+)/gi,
    replace: (_m, head) => `${head}${SCRUBBED_TOKEN}`,
  },
  {
    name: "bearer token",
    regex: /(\bBearer\s+)([A-Za-z0-9\-._~+/]{16,}=*)/g,
    replace: (_m, head) => `${head}${SCRUBBED_TOKEN}`,
  },
  {
    name: "OAuth token field",
    regex: /(\b(?:access_token|refresh_token|id_token)(?:\\?")?\s*[:=]\s*(?:\\?")?)([^"&\s<,}\\]+)/gi,
    replace: (_m, head) => `${head}${SCRUBBED_TOKEN}`,
  },
  {
    name: "JWT",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: () => SCRUBBED_TOKEN,
  },
];

const CLEAN_VALUES = new Set([SCRUBBED, SCRUBBED_TOKEN]);

export interface SecretHit {
  pattern: string;
  index: number;
}

/**
 * Finds credential-shaped text: password values, `Authorization` headers,
 * bearer tokens, OAuth token fields and JWTs. Values already replaced by the
 * scrubber do not count.
 */
export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const value = pattern.name === "JWT" ? match[0] : (match[pattern.name === "password element" ? 3 : 2] ?? "");
      if (!CLEAN_VALUES.has(value.trim())) hits.push({ pattern: pattern.name, index: match.index });
    }
  }
  return hits;
}

/** The hash forms of a password that IOM and Aras store or send (MD5 and SHA-256 hex). */
export function secretForms(password: string): string[] {
  if (password === "") return [];
  const forms = new Set<string>();
  for (const algorithm of ["md5", "sha256"]) {
    const hex = createHash(algorithm).update(password, "utf8").digest("hex");
    forms.add(hex);
    forms.add(hex.toUpperCase());
  }
  return [...forms];
}

export interface ScrubResult {
  text: string;
  /** Replacements made, by pattern name. */
  counts: Record<string, number>;
}

/** An MD5 or SHA-256 hex digest: the only secret shape safe to replace wherever it occurs. */
const DIGEST = /^(?:[0-9a-f]{32}|[0-9a-f]{64})$/i;

/**
 * Replaces every credential-shaped value, and every exact occurrence of the
 * `secrets` that are hex digests (see `secretForms`). Any other secret, such
 * as a plain password, is ignored here: it can be a common word that also
 * occurs in AML, so it is scrubbed only where it sits in a credential
 * position (the patterns above). Text with nothing to scrub comes back
 * unchanged, so byte-exact engine output stays byte-exact.
 */
export function scrub(text: string, secrets: readonly string[] = []): ScrubResult {
  const counts: Record<string, number> = {};
  let out = text;
  for (const secret of secrets) {
    if (!DIGEST.test(secret) || !out.includes(secret)) continue;
    const parts = out.split(secret);
    counts["run secret"] = (counts["run secret"] ?? 0) + parts.length - 1;
    out = parts.join(SCRUBBED);
  }
  for (const pattern of PATTERNS) {
    out = out.replace(pattern.regex, (...args: unknown[]) => {
      const match = args[0] as string;
      const groups = args.slice(1, -2).map((g) => (typeof g === "string" ? g : ""));
      const replaced = pattern.replace(match, ...groups);
      if (replaced !== match) counts[pattern.name] = (counts[pattern.name] ?? 0) + 1;
      return replaced;
    });
  }
  return { text: out, counts };
}
