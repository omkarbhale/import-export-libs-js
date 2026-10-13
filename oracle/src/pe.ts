/**
 * Reads a .NET assembly's module MVID straight from its PE metadata
 * (ECMA-335 §II.24), so the manifest can be checked on any OS before Windows
 * loads anything. Returns null for a file that is not a managed PE image.
 */
export function readModuleMvid(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const inRange = (at: number, length: number) => at >= 0 && at + length <= bytes.byteLength;

  if (!inRange(0, 0x40) || u16(0) !== 0x5a4d) return null; // "MZ"
  const pe = u32(0x3c);
  if (!inRange(pe, 24) || u32(pe) !== 0x00004550) return null; // "PE\0\0"
  const sectionCount = u16(pe + 6);
  const optionalSize = u16(pe + 20);
  const optional = pe + 24;
  if (!inRange(optional, 2)) return null;
  const magic = u16(optional);
  const directories = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : NaN);
  if (Number.isNaN(directories) || !inRange(directories + 14 * 8, 8)) return null;
  const cliRva = u32(directories + 14 * 8);
  if (cliRva === 0) return null;

  const sections = optional + optionalSize;
  const toOffset = (rva: number): number | null => {
    for (let i = 0; i < sectionCount; i++) {
      const s = sections + i * 40;
      if (!inRange(s, 40)) return null;
      const virtualSize = u32(s + 8);
      const virtualAddress = u32(s + 12);
      const rawSize = u32(s + 16);
      const rawPointer = u32(s + 20);
      if (rva >= virtualAddress && rva < virtualAddress + Math.max(virtualSize, rawSize)) {
        return rawPointer + (rva - virtualAddress);
      }
    }
    return null;
  };

  const cli = toOffset(cliRva);
  if (cli === null || !inRange(cli, 16)) return null;
  const root = toOffset(u32(cli + 8));
  if (root === null || !inRange(root, 16) || u32(root) !== 0x424a5342) return null; // "BSJB"
  const versionLength = u32(root + 12);
  let at = root + 16 + versionLength + 2;
  const streamCount = u16(at);
  at += 2;

  let tables: number | null = null;
  let guids: number | null = null;
  for (let i = 0; i < streamCount; i++) {
    if (!inRange(at, 8)) return null;
    const offset = root + u32(at);
    let name = "";
    let p = at + 8;
    while (inRange(p, 1) && bytes[p] !== 0) name += String.fromCharCode(bytes[p++]!);
    at = p + 1 + ((4 - ((name.length + 1) % 4)) % 4);
    if (name === "#~" || name === "#-") tables = offset;
    if (name === "#GUID") guids = offset;
  }
  if (tables === null || guids === null || !inRange(tables, 24)) return null;

  const heapSizes = bytes[tables + 6]!;
  const validLow = u32(tables + 8);
  if ((validLow & 1) === 0) return null; // no Module table
  let rowCounts = 0;
  for (let bit = 0; bit < 64; bit++) {
    const word = bit < 32 ? validLow : u32(tables + 12);
    if ((word >>> bit % 32) & 1) rowCounts++;
  }
  // The Module table is table 0, so its first row starts right after the row counts.
  const moduleRow = tables + 24 + rowCounts * 4;
  const stringIndex = heapSizes & 0x01 ? 4 : 2;
  const guidAt = moduleRow + 2 + stringIndex;
  if (!inRange(guidAt, 4)) return null;
  const guidIndex = heapSizes & 0x02 ? u32(guidAt) : u16(guidAt);
  if (guidIndex === 0) return null;
  const g = guids + (guidIndex - 1) * 16;
  if (!inRange(g, 16)) return null;
  return formatGuid(bytes.subarray(g, g + 16));
}

function formatGuid(b: Uint8Array): string {
  const hex = (from: number, to: number, reverse: boolean) => {
    const part = Array.from(b.subarray(from, to));
    if (reverse) part.reverse();
    return part.map((x) => x.toString(16).padStart(2, "0")).join("");
  };
  return [hex(0, 4, true), hex(4, 6, true), hex(6, 8, true), hex(8, 10, false), hex(10, 16, false)].join("-");
}
