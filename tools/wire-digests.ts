import { createHash } from "node:crypto";

/**
 * The password digests that the HTTP test server of the wire tests expects (HOST-234), computed with `node:crypto` and not with the
 * library's own `md5Digest` and `sha256Digest` (HOST-240), so that a test of the digest that the client sends does not check the
 * client's digest against itself. Test-only tooling: nothing in the shipped code imports it.
 *
 * @spec HOST-234
 */

/** The MD5 digest of an ASCII password, in lower-case hexadecimal (WIRE-014). */
export const md5Lower = (password: string): string => createHash("md5").update(password, "ascii").digest("hex");

/** The SHA-256 digest of an ASCII password, in upper-case hexadecimal (WIRE-014). */
export const sha256Upper = (password: string): string => createHash("sha256").update(password, "ascii").digest("hex").toUpperCase();
