import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { md5Hex, sha256Hex } from "./hash.js";

/** The differential corpus is seeded, so a failure reproduces. mulberry32. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function reference(algorithm: "md5" | "sha256", bytes: Uint8Array): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

/** How many buffers each differential test compared, summed and reported by the last test. */
const compared = { md5: 0, sha256: 0 };

function expectSame(bytes: Uint8Array, label: string): void {
  expect(md5Hex(bytes), `md5 ${label}`).toBe(reference("md5", bytes));
  expect(sha256Hex(bytes), `sha256 ${label}`).toBe(reference("sha256", bytes));
  compared.md5++;
  compared.sha256++;
}

describe("md5Hex: RFC 1321 appendix A.5 test suite (HOST-240)", () => {
  const vectors: [string, string][] = [
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "d174ab98d277d9f5a5611c2c9f419d9f"],
    ["12345678901234567890123456789012345678901234567890123456789012345678901234567890", "57edf4a22be3c955ac49da2e2107b67a"],
  ];
  it.each(vectors)("%j", (message, digest) => {
    expect(md5Hex(ascii(message))).toBe(digest);
  });
});

describe("sha256Hex: FIPS 180-4 and NIST examples (HOST-240)", () => {
  it("the empty message", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("abc (one block)", () => {
    expect(sha256Hex(ascii("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("the 448-bit message (two blocks)", () => {
    expect(sha256Hex(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("the 896-bit message", () => {
    expect(
      sha256Hex(ascii("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu")),
    ).toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
  });

  it("one million repetitions of a", () => {
    expect(sha256Hex(new Uint8Array(1_000_000).fill(0x61))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("the million-a message again, for MD5 (a known value)", () => {
    expect(md5Hex(new Uint8Array(1_000_000).fill(0x61))).toBe("7707d6ae4e027c70eea2a935c2296f21");
  });
});

describe("differential against node:crypto (HOST-240)", () => {
  it("every length from 0 to 300, with block-boundary lengths named", () => {
    const random = seeded(0x5eed);
    for (let length = 0; length <= 300; length++) {
      expectSame(Uint8Array.from({ length }, () => Math.floor(random() * 256)), `length ${length}`);
    }
    for (const length of [55, 56, 63, 64, 119, 120, 127, 128]) {
      expectSame(new Uint8Array(length).fill(0xff), `0xff x ${length}`);
      expectSame(new Uint8Array(length), `0x00 x ${length}`);
    }
  });

  it("all 256 single-byte inputs", () => {
    for (let byte = 0; byte < 256; byte++) expectSame(Uint8Array.of(byte), `byte ${byte}`);
  });

  it("2 000 seeded random buffers up to 4 096 bytes", () => {
    const random = seeded(0xc0ffee);
    for (let n = 0; n < 2000; n++) {
      const length = Math.floor(random() * 4097);
      expectSame(Uint8Array.from({ length }, () => Math.floor(random() * 256)), `buffer ${n} (${length} bytes)`);
    }
  });

  it("hashes a view into a larger buffer by its own bytes only", () => {
    const backing = Uint8Array.from({ length: 200 }, (_, i) => i);
    expectSame(backing.subarray(17, 143), "subarray");
  });

  it("does not modify its input", () => {
    const bytes = Uint8Array.from({ length: 100 }, (_, i) => i);
    const copy = bytes.slice();
    md5Hex(bytes);
    sha256Hex(bytes);
    expect(bytes).toEqual(copy);
  });

  it("compared at least 2 000 + 301 + 16 + 256 + 1 buffers with each algorithm", () => {
    expect(compared.md5).toBeGreaterThanOrEqual(2000 + 301 + 16 + 256 + 1);
    expect(compared.sha256).toBe(compared.md5);
    console.log(`hash differential: ${compared.md5} buffers compared with node:crypto, each with MD5 and SHA-256`);
  });
});

describe("throughput smoke bound (HOST-240)", () => {
  const bytes = new Uint8Array(64 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i += 4099) bytes[i] = i & 0xff;

  it.each([
    ["md5", md5Hex],
    ["sha256", sha256Hex],
  ] as const)("hashes a 64 MB buffer with %s in under 5 seconds, to the digest node:crypto gives", (algorithm, hash) => {
    // CPU time, not wall-clock: a full parallel run shares the machine with other test files.
    const started = process.cpuUsage();
    const digest = hash(bytes);
    const used = process.cpuUsage(started);
    expect((used.user + used.system) / 1e6).toBeLessThan(5);
    expect(digest).toBe(reference(algorithm, bytes));
  }, 30_000);
});
