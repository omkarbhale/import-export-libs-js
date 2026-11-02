import { DotNetException } from "./dotnet.js";
import { md5Hex, sha256Hex } from "./hash.js";

export type HashingMode = "MD5" | "SHA256";

/** .NET's `$` also matches before a final line feed, so 32 hex characters plus `\n` count as an MD5 hash. */
const MD5_HASH = /^[0-9a-f]{32}\n?$/i;
const SHA256_HASH = /^[0-9a-f]{64}\n?$/i;

/** IOM's `Md5.IsHash`: 32 hex characters in either case. */
export function isMd5Hash(text: string): boolean {
  return MD5_HASH.test(text);
}

/** IOM's `Sha256.IsHash`: 64 hex characters in either case. */
export function isSha256Hash(text: string): boolean {
  return SHA256_HASH.test(text);
}

/** IOM's `Md5.ComputeHash`: the lowercase hex of MD5 over the ASCII bytes; a password that already is an MD5 hash is kept. */
export function md5Digest(password: string): string {
  return isMd5Hash(password) ? password : md5Hex(asciiBytes(password));
}

/** IOM's `Sha256.ComputeHash`: the uppercase hex of SHA-256 over the ASCII bytes; a password that already is one is kept. */
export function sha256Digest(password: string): string {
  return isSha256Hash(password) ? password : sha256Hex(asciiBytes(password)).toUpperCase();
}

/** .NET's `Encoding.ASCII`: every code point above 0x7F, an astral one included, becomes one `?`. */
function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(Array.from(text, (c) => {
    const code = c.codePointAt(0) ?? 0x3f;
    return code < 0x80 ? code : 0x3f;
  }));
}

/**
 * The password as the server receives it: a digest in the current hashing mode.
 * A password that already looks like a hash is used as it is.
 *
 * @spec WIRE-014 WIRE-055 HOST-240
 */
export class PasswordDigest {
  private current: HashingMode = "MD5";
  private digest = "";

  constructor(private readonly password: string) {
    try {
      this.switchTo("MD5");
    } catch {
      this.switchTo("SHA256");
    }
  }

  get mode(): HashingMode {
    return this.current;
  }

  get value(): string {
    return this.digest;
  }

  /** Switches the mode. A password that already is the other kind of hash cannot be switched. */
  switchTo(mode: string): void {
    if (mode === "MD5") {
      if (isSha256Hash(this.password)) {
        throw new DotNetException("System.InvalidOperationException", "Parole already contains Sha256 hash.");
      }
      this.digest = md5Digest(this.password);
      this.current = "MD5";
    } else if (mode === "SHA256") {
      if (isMd5Hash(this.password)) {
        throw new DotNetException("System.InvalidOperationException", "Parole already contains Md5 hash.");
      }
      this.digest = sha256Digest(this.password);
      this.current = "SHA256";
    } else {
      throw new DotNetException("System.InvalidOperationException", "Unknown hashing mode.");
    }
  }
}
