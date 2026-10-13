import { BlobReader, type Metadata, T, token } from "./metadata.js";

/**
 * Stable, build-independent names for an assembly's types and methods.
 *
 * Tokens and raw signature digests are build-local; these names are what the
 * source map keys on across engines. Nested types are written `Outer/Inner`,
 * as Cecil and ILSpy write them; REA reports them bare.
 */

const PRIMITIVES: Record<number, string> = {
  0x01: "System.Void",
  0x02: "System.Boolean",
  0x03: "System.Char",
  0x04: "System.SByte",
  0x05: "System.Byte",
  0x06: "System.Int16",
  0x07: "System.UInt16",
  0x08: "System.Int32",
  0x09: "System.UInt32",
  0x0a: "System.Int64",
  0x0b: "System.UInt64",
  0x0c: "System.Single",
  0x0d: "System.Double",
  0x0e: "System.String",
  0x16: "System.TypedReference",
  0x18: "System.IntPtr",
  0x19: "System.UIntPtr",
  0x1c: "System.Object",
};

export interface MethodName {
  token: string;
  /** `Namespace.Type::Member`, with nested types as `Outer/Inner`. */
  fullName: string;
  /** `ReturnType Member(ParamType, ...)` with namespace-qualified type names. */
  signature: string;
  declaringType: string;
  name: string;
  flags: number;
  rva: number;
}

export class AssemblyNames {
  private readonly enclosing = new Map<number, number>();
  private readonly typeNames = new Map<number, string>();
  /** MethodDef rid → TypeDef rid. */
  private readonly owner: number[] = [];

  constructor(readonly md: Metadata) {
    for (const [nested, outer] of md.rows(T.NestedClass)) {
      if (nested !== undefined && outer !== undefined) this.enclosing.set(nested, outer);
    }
    const types = md.rows(T.TypeDef);
    const methodCount = md.rows(T.MethodDef).length;
    types.forEach((row, index) => {
      const first = row[5] ?? 1;
      const next = types[index + 1]?.[5] ?? methodCount + 1;
      for (let rid = first; rid < next; rid++) this.owner[rid] = index + 1;
    });
  }

  typeDefName(rid: number): string {
    const cached = this.typeNames.get(rid);
    if (cached !== undefined) return cached;
    const row = this.md.row(T.TypeDef, rid);
    if (!row) return `?TypeDef${rid}`;
    const name = this.md.string(row[1] ?? 0);
    const namespace = this.md.string(row[2] ?? 0);
    const outer = this.enclosing.get(rid);
    const full = outer !== undefined ? `${this.typeDefName(outer)}/${name}` : namespace ? `${namespace}.${name}` : name;
    this.typeNames.set(rid, full);
    return full;
  }

  typeRefName(rid: number): string {
    const row = this.md.row(T.TypeRef, rid);
    if (!row) return `?TypeRef${rid}`;
    const [scopeTable, scopeRid] = this.md.decode("ResolutionScope", row[0] ?? 0);
    const name = this.md.string(row[1] ?? 0);
    const namespace = this.md.string(row[2] ?? 0);
    if (scopeTable === T.TypeRef) return `${this.typeRefName(scopeRid)}/${name}`;
    return namespace ? `${namespace}.${name}` : name;
  }

  /** The assembly a TypeRef resolves to, or undefined when it is nested or local. */
  typeRefAssembly(rid: number): string | undefined {
    const row = this.md.row(T.TypeRef, rid);
    if (!row) return undefined;
    const [scopeTable, scopeRid] = this.md.decode("ResolutionScope", row[0] ?? 0);
    if (scopeTable === T.TypeRef) return this.typeRefAssembly(scopeRid);
    if (scopeTable !== T.AssemblyRef) return undefined;
    return this.md.string(this.md.row(T.AssemblyRef, scopeRid)?.[6] ?? 0);
  }

  typeDefOrRefName(coded: number): string {
    const [table, rid] = this.md.decode("TypeDefOrRef", coded);
    if (table === T.TypeDef) return this.typeDefName(rid);
    if (table === T.TypeRef) return this.typeRefName(rid);
    return this.typeSpecName(rid);
  }

  typeSpecName(rid: number): string {
    const blob = this.md.blob(this.md.row(T.TypeSpec, rid)?.[0] ?? 0);
    return this.readType(new BlobReader(blob));
  }

  readType(r: BlobReader): string {
    const element = r.byte();
    const primitive = PRIMITIVES[element];
    if (primitive) return primitive;
    switch (element) {
      case 0x0f:
        return `${this.readType(r)}*`;
      case 0x10:
        return `${this.readType(r)}&`;
      case 0x11:
      case 0x12:
        return this.typeDefOrRefName(r.uint());
      case 0x13:
        return `!${r.uint()}`;
      case 0x1e:
        return `!!${r.uint()}`;
      case 0x1d:
        return `${this.readType(r)}[]`;
      case 0x14: {
        const inner = this.readType(r);
        const rank = r.uint();
        const sizes = r.uint();
        for (let i = 0; i < sizes; i++) r.uint();
        const bounds = r.uint();
        for (let i = 0; i < bounds; i++) r.int();
        return `${inner}[${",".repeat(Math.max(rank - 1, 0))}]`;
      }
      case 0x15: {
        r.byte();
        const generic = this.typeDefOrRefName(r.uint());
        const count = r.uint();
        const args = Array.from({ length: count }, () => this.readType(r));
        return `${generic}<${args.join(",")}>`;
      }
      case 0x1b: {
        const sig = this.readMethodSig(r, "*");
        return `method ${sig}`;
      }
      case 0x1f:
      case 0x20: {
        const modifier = this.typeDefOrRefName(r.uint());
        const inner = this.readType(r);
        return `${inner} ${element === 0x1f ? "modreq" : "modopt"}(${modifier})`;
      }
      case 0x45:
        return `${this.readType(r)} pinned`;
      case 0x41:
        return "...";
      default:
        throw new Error(`unsupported signature element 0x${element.toString(16)}`);
    }
  }

  /** Decodes a MethodDefSig or MethodRefSig into `Ret Name(Params)`. */
  readMethodSig(r: BlobReader, name: string): string {
    const convention = r.byte();
    if (convention & 0x10) r.uint();
    const count = r.uint();
    const ret = this.readType(r);
    const params: string[] = [];
    for (let i = 0; i < count; i++) {
      const param = this.readType(r);
      params.push(param);
      if (param === "...") i--;
    }
    return `${ret} ${name}(${params.join(", ")})`;
  }

  methodSignature(blobIndex: number, name: string): string {
    return this.readMethodSig(new BlobReader(this.md.blob(blobIndex)), name);
  }

  method(rid: number): MethodName {
    const row = this.md.row(T.MethodDef, rid);
    if (!row) throw new Error(`no MethodDef ${rid}`);
    const name = this.md.string(row[3] ?? 0);
    const declaringType = this.typeDefName(this.owner[rid] ?? 0);
    return {
      token: token(T.MethodDef, rid),
      fullName: `${declaringType}::${name}`,
      signature: this.methodSignature(row[4] ?? 0, name),
      declaringType,
      name,
      flags: row[2] ?? 0,
      rva: row[0] ?? 0,
    };
  }

  methods(): MethodName[] {
    return this.md.rows(T.MethodDef).map((_, index) => this.method(index + 1));
  }

  /** A MemberRef's parent type name and assembly, and its own name and signature. */
  memberRef(rid: number): { parent: string; assembly: string | undefined; name: string; signature: string } {
    const row = this.md.row(T.MemberRef, rid);
    if (!row) throw new Error(`no MemberRef ${rid}`);
    const [table, parentRid] = this.md.decode("MemberRefParent", row[0] ?? 0);
    const name = this.md.string(row[1] ?? 0);
    let parent = "?";
    let assembly: string | undefined;
    if (table === T.TypeRef) {
      parent = this.typeRefName(parentRid);
      assembly = this.typeRefAssembly(parentRid);
    } else if (table === T.TypeDef) {
      parent = this.typeDefName(parentRid);
    } else if (table === T.TypeSpec) {
      const blob = this.md.blob(this.md.row(T.TypeSpec, parentRid)?.[0] ?? 0);
      parent = this.typeSpecName(parentRid).replace(/<.*$/, "");
      assembly = this.typeSpecAssembly(blob);
    }
    const blob = this.md.blob(row[2] ?? 0);
    const signature = blob[0] === 0x06 ? "" : this.readMethodSig(new BlobReader(blob), name);
    return { parent, assembly, name, signature };
  }

  private typeSpecAssembly(blob: Uint8Array): string | undefined {
    const r = new BlobReader(blob);
    if (r.byte() !== 0x15) return undefined;
    r.byte();
    const [table, rid] = this.md.decode("TypeDefOrRef", r.uint());
    return table === T.TypeRef ? this.typeRefAssembly(rid) : undefined;
  }

  /** The MethodDefOrRef a MethodSpec instantiates. */
  methodSpecTarget(rid: number): [number, number] {
    const row = this.md.row(T.MethodSpec, rid);
    return this.md.decode("MethodDefOrRef", row?.[0] ?? 0);
  }

  assemblyName(): string {
    return this.md.string(this.md.row(T.Assembly, 1)?.[7] ?? 0);
  }
}
