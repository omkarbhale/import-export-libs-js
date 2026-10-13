/**
 * A minimal ECMA-335 metadata reader for what REA does not report: nested type
 * parents, type references by name, generic signatures, and the portable PDB
 * sequence points that tie each MethodDef to lines of ILSpy's output.
 *
 * It reads tables only; it never loads or executes the assembly.
 */

/** Table ids (ECMA-335 II.22 and the portable PDB tables). */
export const T = {
  Module: 0x00,
  TypeRef: 0x01,
  TypeDef: 0x02,
  FieldPtr: 0x03,
  Field: 0x04,
  MethodPtr: 0x05,
  MethodDef: 0x06,
  ParamPtr: 0x07,
  Param: 0x08,
  InterfaceImpl: 0x09,
  MemberRef: 0x0a,
  Constant: 0x0b,
  CustomAttribute: 0x0c,
  FieldMarshal: 0x0d,
  DeclSecurity: 0x0e,
  ClassLayout: 0x0f,
  FieldLayout: 0x10,
  StandAloneSig: 0x11,
  EventMap: 0x12,
  EventPtr: 0x13,
  Event: 0x14,
  PropertyMap: 0x15,
  PropertyPtr: 0x16,
  Property: 0x17,
  MethodSemantics: 0x18,
  MethodImpl: 0x19,
  ModuleRef: 0x1a,
  TypeSpec: 0x1b,
  ImplMap: 0x1c,
  FieldRVA: 0x1d,
  EncLog: 0x1e,
  EncMap: 0x1f,
  Assembly: 0x20,
  AssemblyProcessor: 0x21,
  AssemblyOS: 0x22,
  AssemblyRef: 0x23,
  AssemblyRefProcessor: 0x24,
  AssemblyRefOS: 0x25,
  File: 0x26,
  ExportedType: 0x27,
  ManifestResource: 0x28,
  NestedClass: 0x29,
  GenericParam: 0x2a,
  MethodSpec: 0x2b,
  GenericParamConstraint: 0x2c,
  Document: 0x30,
  MethodDebugInformation: 0x31,
  LocalScope: 0x32,
  LocalVariable: 0x33,
  LocalConstant: 0x34,
  ImportScope: 0x35,
  StateMachineMethod: 0x36,
  CustomDebugInformation: 0x37,
} as const;

/** Coded index families: the tables each tag selects, in tag order (-1 = unused tag). */
const CODED: Record<string, readonly number[]> = {
  TypeDefOrRef: [T.TypeDef, T.TypeRef, T.TypeSpec],
  HasConstant: [T.Field, T.Param, T.Property],
  HasCustomAttribute: [
    T.MethodDef, T.Field, T.TypeRef, T.TypeDef, T.Param, T.InterfaceImpl, T.MemberRef, T.Module, T.DeclSecurity,
    T.Property, T.Event, T.StandAloneSig, T.ModuleRef, T.TypeSpec, T.Assembly, T.AssemblyRef, T.File,
    T.ExportedType, T.ManifestResource, T.GenericParam, T.GenericParamConstraint, T.MethodSpec,
  ],
  HasFieldMarshal: [T.Field, T.Param],
  HasDeclSecurity: [T.TypeDef, T.MethodDef, T.Assembly],
  MemberRefParent: [T.TypeDef, T.TypeRef, T.ModuleRef, T.MethodDef, T.TypeSpec],
  HasSemantics: [T.Event, T.Property],
  MethodDefOrRef: [T.MethodDef, T.MemberRef],
  MemberForwarded: [T.Field, T.MethodDef],
  Implementation: [T.File, T.AssemblyRef, T.ExportedType],
  CustomAttributeType: [-1, -1, T.MethodDef, T.MemberRef, -1],
  ResolutionScope: [T.Module, T.ModuleRef, T.AssemblyRef, T.TypeRef],
  TypeOrMethodDef: [T.TypeDef, T.MethodDef],
  HasCustomDebugInformation: [
    T.MethodDef, T.Field, T.TypeRef, T.TypeDef, T.Param, T.InterfaceImpl, T.MemberRef, T.Module, T.DeclSecurity,
    T.Property, T.Event, T.StandAloneSig, T.ModuleRef, T.TypeSpec, T.Assembly, T.AssemblyRef, T.File,
    T.ExportedType, T.ManifestResource, T.GenericParam, T.GenericParamConstraint, T.MethodSpec, T.Document,
    T.LocalScope, T.LocalVariable, T.LocalConstant, T.ImportScope,
  ],
};

/** A column: fixed width, a heap index, a simple table index, or a coded index. */
type Column = 1 | 2 | 4 | "str" | "guid" | "blob" | { table: number } | { coded: string };

const t = (table: number): Column => ({ table });
const c = (coded: string): Column => ({ coded });

const SCHEMA: Record<number, Column[]> = {
  [T.Module]: [2, "str", "guid", "guid", "guid"],
  [T.TypeRef]: [c("ResolutionScope"), "str", "str"],
  [T.TypeDef]: [4, "str", "str", c("TypeDefOrRef"), t(T.Field), t(T.MethodDef)],
  [T.FieldPtr]: [t(T.Field)],
  [T.Field]: [2, "str", "blob"],
  [T.MethodPtr]: [t(T.MethodDef)],
  [T.MethodDef]: [4, 2, 2, "str", "blob", t(T.Param)],
  [T.ParamPtr]: [t(T.Param)],
  [T.Param]: [2, 2, "str"],
  [T.InterfaceImpl]: [t(T.TypeDef), c("TypeDefOrRef")],
  [T.MemberRef]: [c("MemberRefParent"), "str", "blob"],
  [T.Constant]: [2, c("HasConstant"), "blob"],
  [T.CustomAttribute]: [c("HasCustomAttribute"), c("CustomAttributeType"), "blob"],
  [T.FieldMarshal]: [c("HasFieldMarshal"), "blob"],
  [T.DeclSecurity]: [2, c("HasDeclSecurity"), "blob"],
  [T.ClassLayout]: [2, 4, t(T.TypeDef)],
  [T.FieldLayout]: [4, t(T.Field)],
  [T.StandAloneSig]: ["blob"],
  [T.EventMap]: [t(T.TypeDef), t(T.Event)],
  [T.EventPtr]: [t(T.Event)],
  [T.Event]: [2, "str", c("TypeDefOrRef")],
  [T.PropertyMap]: [t(T.TypeDef), t(T.Property)],
  [T.PropertyPtr]: [t(T.Property)],
  [T.Property]: [2, "str", "blob"],
  [T.MethodSemantics]: [2, t(T.MethodDef), c("HasSemantics")],
  [T.MethodImpl]: [t(T.TypeDef), c("MethodDefOrRef"), c("MethodDefOrRef")],
  [T.ModuleRef]: ["str"],
  [T.TypeSpec]: ["blob"],
  [T.ImplMap]: [2, c("MemberForwarded"), "str", t(T.ModuleRef)],
  [T.FieldRVA]: [4, t(T.Field)],
  [T.EncLog]: [4, 4],
  [T.EncMap]: [4],
  [T.Assembly]: [4, 2, 2, 2, 2, 4, "blob", "str", "str"],
  [T.AssemblyProcessor]: [4],
  [T.AssemblyOS]: [4, 4, 4],
  [T.AssemblyRef]: [2, 2, 2, 2, 4, "blob", "str", "str", "blob"],
  [T.AssemblyRefProcessor]: [4, t(T.AssemblyRef)],
  [T.AssemblyRefOS]: [4, 4, 4, t(T.AssemblyRef)],
  [T.File]: [4, "str", "blob"],
  [T.ExportedType]: [4, 4, "str", "str", c("Implementation")],
  [T.ManifestResource]: [4, 4, "str", c("Implementation")],
  [T.NestedClass]: [t(T.TypeDef), t(T.TypeDef)],
  [T.GenericParam]: [2, 2, c("TypeOrMethodDef"), "str"],
  [T.MethodSpec]: [c("MethodDefOrRef"), "blob"],
  [T.GenericParamConstraint]: [t(T.GenericParam), c("TypeDefOrRef")],
  [T.Document]: ["blob", "guid", "blob", "guid"],
  [T.MethodDebugInformation]: [t(T.Document), "blob"],
  [T.LocalScope]: [t(T.MethodDef), t(T.ImportScope), t(T.LocalVariable), t(T.LocalConstant), 4, 4],
  [T.LocalVariable]: [2, 2, "str"],
  [T.LocalConstant]: ["str", "blob"],
  [T.ImportScope]: [t(T.ImportScope), "blob"],
  [T.StateMachineMethod]: [t(T.MethodDef), t(T.MethodDef)],
  [T.CustomDebugInformation]: [c("HasCustomDebugInformation"), "guid", "blob"],
};

export type Row = number[];

/** A metadata root: heaps plus decoded table rows (1-based row ids map to index row-1). */
export class Metadata {
  readonly tables = new Map<number, Row[]>();
  readonly streams = new Map<string, Uint8Array>();
  /** Row counts of type-system tables a PDB refers to (from its #Pdb stream). */
  readonly external = new Map<number, number>();

  constructor(readonly bytes: Uint8Array, rootOffset: number) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(rootOffset, true) !== 0x424a5342) throw new Error("metadata root signature BSJB not found");
    const versionLength = view.getUint32(rootOffset + 12, true);
    let p = rootOffset + 16 + versionLength + 2;
    const streamCount = view.getUint16(p, true);
    p += 2;
    for (let i = 0; i < streamCount; i++) {
      const offset = view.getUint32(p, true);
      const size = view.getUint32(p + 4, true);
      p += 8;
      let end = p;
      while (bytes[end] !== 0) end++;
      const name = new TextDecoder().decode(bytes.subarray(p, end));
      p = (end + 4) & ~3;
      this.streams.set(name, bytes.subarray(rootOffset + offset, rootOffset + offset + size));
    }
    const pdb = this.streams.get("#Pdb");
    if (pdb) this.readPdbStream(pdb);
    const tables = this.streams.get("#~") ?? this.streams.get("#-");
    if (!tables) throw new Error("metadata has no table stream");
    this.readTables(tables);
  }

  private readPdbStream(pdb: Uint8Array) {
    const view = new DataView(pdb.buffer, pdb.byteOffset, pdb.byteLength);
    const mask = view.getBigUint64(24, true);
    let p = 32;
    for (let table = 0; table < 64; table++) {
      if ((mask >> BigInt(table)) & 1n) {
        this.external.set(table, view.getUint32(p, true));
        p += 4;
      }
    }
  }

  private readTables(stream: Uint8Array) {
    const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
    const heapSizes = stream[6] ?? 0;
    const valid = view.getBigUint64(8, true);
    let p = 24;
    const counts = new Map<number, number>(this.external);
    const present: number[] = [];
    for (let table = 0; table < 64; table++) {
      if ((valid >> BigInt(table)) & 1n) {
        counts.set(table, view.getUint32(p, true));
        present.push(table);
        p += 4;
      }
    }
    if (heapSizes & 0x40) p += 4;

    const rows = (table: number) => counts.get(table) ?? 0;
    const width = (column: Column): number => {
      if (typeof column === "number") return column;
      if (column === "str") return heapSizes & 0x01 ? 4 : 2;
      if (column === "guid") return heapSizes & 0x02 ? 4 : 2;
      if (column === "blob") return heapSizes & 0x04 ? 4 : 2;
      if ("table" in column) return rows(column.table) > 0xffff ? 4 : 2;
      const family = CODED[column.coded] ?? [];
      const tagBits = Math.ceil(Math.log2(family.length));
      const max = Math.max(...family.map((table) => (table < 0 ? 0 : rows(table))));
      return max < 1 << (16 - tagBits) ? 2 : 4;
    };

    for (const table of present) {
      const schema = SCHEMA[table];
      if (!schema) throw new Error(`metadata table 0x${table.toString(16)} is not supported`);
      const widths = schema.map(width);
      const list: Row[] = [];
      for (let r = 0; r < rows(table); r++) {
        const row: Row = [];
        for (const w of widths) {
          row.push(w === 1 ? (stream[p] ?? 0) : w === 2 ? view.getUint16(p, true) : view.getUint32(p, true));
          p += w;
        }
        list.push(row);
      }
      this.tables.set(table, list);
    }
  }

  rows(table: number): Row[] {
    return this.tables.get(table) ?? [];
  }

  row(table: number, rid: number): Row | undefined {
    return this.rows(table)[rid - 1];
  }

  string(index: number): string {
    const heap = this.streams.get("#Strings");
    if (!heap || index === 0) return "";
    let end = index;
    while (heap[end] !== 0 && end < heap.length) end++;
    return new TextDecoder().decode(heap.subarray(index, end));
  }

  blob(index: number): Uint8Array {
    const heap = this.streams.get("#Blob");
    if (!heap || index === 0) return new Uint8Array();
    const reader = new BlobReader(heap, index);
    const length = reader.uint();
    return heap.subarray(reader.pos, reader.pos + length);
  }

  guid(index: number): string {
    const heap = this.streams.get("#GUID");
    if (!heap || index === 0) return "";
    const b = heap.subarray((index - 1) * 16, index * 16);
    const hex = (from: number, to: number, reverse: boolean) => {
      const part = Array.from(b.subarray(from, to));
      if (reverse) part.reverse();
      return part.map((x) => x.toString(16).padStart(2, "0")).join("");
    };
    return `${hex(0, 4, true)}-${hex(4, 6, true)}-${hex(6, 8, true)}-${hex(8, 10, false)}-${hex(10, 16, false)}`;
  }

  /** Splits a coded index into [table, rid]. */
  decode(coded: string, value: number): [number, number] {
    const family = CODED[coded] ?? [];
    const tagBits = Math.ceil(Math.log2(family.length));
    return [family[value & ((1 << tagBits) - 1)] ?? -1, value >>> tagBits];
  }
}

/** Reads ECMA-335 compressed integers from a blob. */
export class BlobReader {
  constructor(readonly bytes: Uint8Array, public pos = 0) {}

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  byte(): number {
    const value = this.bytes[this.pos];
    if (value === undefined) throw new Error("blob read past its end");
    this.pos++;
    return value;
  }

  uint(): number {
    const b0 = this.byte();
    if ((b0 & 0x80) === 0) return b0;
    if ((b0 & 0xc0) === 0x80) return ((b0 & 0x3f) << 8) | this.byte();
    return (((b0 & 0x1f) << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
  }

  /** Signed compressed integer (II.23.2): rotated, sign in the low bit. */
  int(): number {
    const start = this.pos;
    const raw = this.uint();
    const length = this.pos - start;
    const negative = (raw & 1) !== 0;
    const value = raw >>> 1;
    if (!negative) return value;
    return value - (length === 1 ? 0x40 : length === 2 ? 0x2000 : 0x10000000);
  }
}

/** Opens the CLI metadata of a PE image. */
export function readAssembly(bytes: Uint8Array): Metadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pe = view.getUint32(0x3c, true);
  if (view.getUint32(pe, true) !== 0x00004550) throw new Error("not a PE image");
  const sections = view.getUint16(pe + 6, true);
  const optionalSize = view.getUint16(pe + 20, true);
  const optional = pe + 24;
  const magic = view.getUint16(optional, true);
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const cliRva = view.getUint32(directories + 14 * 8, true);
  if (cliRva === 0) throw new Error("PE image has no CLI header");

  const sectionTable = optional + optionalSize;
  const toOffset = (rva: number): number => {
    for (let i = 0; i < sections; i++) {
      const s = sectionTable + i * 40;
      const virtualSize = view.getUint32(s + 8, true);
      const virtualAddress = view.getUint32(s + 12, true);
      const rawSize = view.getUint32(s + 16, true);
      const rawPointer = view.getUint32(s + 20, true);
      if (rva >= virtualAddress && rva < virtualAddress + Math.max(virtualSize, rawSize)) {
        return rva - virtualAddress + rawPointer;
      }
    }
    throw new Error(`RVA 0x${rva.toString(16)} is in no section`);
  };
  const cli = toOffset(cliRva);
  return new Metadata(bytes, toOffset(view.getUint32(cli + 8, true)));
}

/** Opens a standalone portable PDB. */
export function readPortablePdb(bytes: Uint8Array): Metadata {
  return new Metadata(bytes, 0);
}

export const token = (table: number, rid: number): string =>
  `0x${((table << 24) | rid).toString(16).padStart(8, "0")}`;

export const parseToken = (value: string): [number, number] => {
  const n = Number.parseInt(value, 16);
  return [n >>> 24, n & 0xffffff];
};
