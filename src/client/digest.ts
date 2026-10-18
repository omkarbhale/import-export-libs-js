import { createHash } from "node:crypto";
import { DotNetException } from "./dotnet.js";

export type HashingMode = "MD5" | "SHA256";

const MD5_HASH = /^[0-9a-f]{32}$/i;
const SHA256_HASH = /^[0-9a-f]{64}$/i;

/** .NET's `Encoding.ASCII`: every code point above 0x7F, an astral one included, becomes one `?`. */
function asciiBytes(text: string): Buffer {
  return Buffer.from(Array.from(text, (c) => ((c.codePointAt(0) ?? 0x3f) < 0x80 ? c : "?")).join(""), "latin1");
}

/**
 * The password as the server receives it: a digest in the current hashing mode.
 * A password that already looks like a hash is used as it is.
 *
 * @spec WIRE-014 WIRE-055
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
      if (SHA256_HASH.test(this.password)) {
        throw new DotNetException("System.InvalidOperationException", "Parole already contains Sha256 hash.");
      }
      this.digest = MD5_HASH.test(this.password)
        ? this.password
        : createHash("md5").update(asciiBytes(this.password)).digest("hex");
      this.current = "MD5";
    } else if (mode === "SHA256") {
      if (MD5_HASH.test(this.password)) {
        throw new DotNetException("System.InvalidOperationException", "Parole already contains Md5 hash.");
      }
      this.digest = SHA256_HASH.test(this.password)
        ? this.password
        : createHash("sha256").update(asciiBytes(this.password)).digest("hex").toUpperCase();
      this.current = "SHA256";
    } else {
      throw new DotNetException("System.InvalidOperationException", "Unknown hashing mode.");
    }
  }
}
