import type { Graph, GraphCall, GraphMethod, Root } from "./reachability.js";
import { type Metadata, T, parseToken } from "./metadata.js";
import { AssemblyNames, type MethodName } from "./names.js";

/**
 * Joins `rea inspect-managed-members` output with the metadata names: REA
 * supplies the identity, digests and call edges; the metadata reader supplies
 * names that stay the same across builds.
 */

/** The parts of REA's inspect-managed-members result this tool reads. */
export interface ReaMembers {
  artifact: { sha256: string };
  module: { mvid: string };
  types: { token: string }[];
  fields: { token: string; declaring_type_token: string }[];
  methods: {
    token: string;
    flags: number;
    signature: { raw_sha256: string };
    body: { status: string; il_sha256: string | null; normalized_il_sha256: string | null };
  }[];
  call_edges: { caller_token: string; opcode: string; target_token: string; target_kind: string }[];
  field_accesses: { method_token: string; field_token: string }[];
}

export interface InventoryMethod extends MethodName {
  hasBody: boolean;
  signatureSha256: string;
  ilSha256: string | null;
  bodySha256: string | null;
}

export interface Inventory {
  assemblyName: string;
  assemblyVersion: string;
  sha256: string;
  mvid: string;
  methods: InventoryMethod[];
  graph: Graph;
}

const VIRTUAL = 0x0040;
const NEW_SLOT = 0x0100;

export const shapeOf = (signature: string, name: string): string => signature.replace(` ${name}(`, "(");

export function buildInventory(members: ReaMembers, md: Metadata): Inventory {
  const names = new AssemblyNames(md);
  const assembly = md.row(T.Assembly, 1) ?? [];
  const reaMethods = new Map(members.methods.map((m) => [m.token, m]));

  const methods: InventoryMethod[] = names.methods().map((method) => {
    const rea = reaMethods.get(method.token);
    if (!rea) throw new Error(`REA reports no method ${method.token} (${method.fullName})`);
    return {
      ...method,
      hasBody: rea.body.status === "present",
      signatureSha256: rea.signature.raw_sha256,
      ilSha256: rea.body.normalized_il_sha256,
      bodySha256: rea.body.il_sha256,
    };
  });

  const graphMethods: GraphMethod[] = methods.map((m) => ({
    token: m.token,
    fullName: m.fullName,
    name: m.name,
    type: m.declaringType,
    shape: shapeOf(m.signature, m.name),
    virtual: (m.flags & VIRTUAL) !== 0,
    newSlot: (m.flags & NEW_SLOT) !== 0,
  }));
  const byToken = new Map(methods.map((m) => [m.token, m]));

  const resolve = (targetToken: string): GraphCall["target"] | undefined => {
    let [table, rid] = parseToken(targetToken);
    if (table === T.MethodSpec) [table, rid] = names.methodSpecTarget(rid);
    if (table === T.MethodDef) return { token: `0x${((T.MethodDef << 24) | rid).toString(16).padStart(8, "0")}` };
    if (table !== T.MemberRef) return undefined;
    const ref = names.memberRef(rid);
    if (!ref.signature) return undefined;
    const local = methods.find(
      (m) => m.declaringType === ref.parent && m.name === ref.name && m.signature === ref.signature,
    );
    if (local) return { token: local.token };
    return { external: ref.name, shape: shapeOf(ref.signature, ref.name) };
  };

  const calls = new Map<string, GraphCall[]>();
  for (const edge of members.call_edges) {
    const opcode = edge.opcode as GraphCall["opcode"];
    if (!["call", "callvirt", "newobj", "ldftn"].includes(opcode)) continue;
    const target = resolve(edge.target_token);
    if (!target) continue;
    const list = calls.get(edge.caller_token) ?? [];
    list.push({ opcode, target });
    calls.set(edge.caller_token, list);
  }

  const typeByToken = new Map<string, string>();
  members.types.forEach((type) => {
    const [, rid] = parseToken(type.token);
    typeByToken.set(type.token, names.typeDefName(rid));
  });
  const fieldType = new Map(members.fields.map((f) => [f.token, typeByToken.get(f.declaring_type_token) ?? ""]));
  const fieldTypes = new Map<string, string[]>();
  for (const access of members.field_accesses) {
    const type = fieldType.get(access.field_token);
    if (!type || !byToken.has(access.method_token)) continue;
    const list = fieldTypes.get(access.method_token) ?? [];
    if (!list.includes(type)) list.push(type);
    fieldTypes.set(access.method_token, list);
  }

  return {
    assemblyName: names.assemblyName(),
    assemblyVersion: assembly.slice(1, 5).join("."),
    sha256: members.artifact.sha256,
    mvid: members.module.mvid,
    methods,
    graph: { methods: graphMethods, calls, fieldTypes },
  };
}

/**
 * Roots from a host executable: every method of `assemblyName` it references,
 * and every type whose constructor it calls.
 */
export function hostRoots(host: Metadata, inventory: Inventory): Root[] {
  const names = new AssemblyNames(host);
  const roots: Root[] = [];
  host.rows(T.MemberRef).forEach((_, index) => {
    const ref = names.memberRef(index + 1);
    if (ref.assembly !== inventory.assemblyName || !ref.signature) return;
    const method = inventory.methods.find(
      (m) => m.declaringType === ref.parent && m.name === ref.name && m.signature === ref.signature,
    );
    if (!method) throw new Error(`host references ${ref.parent}::${ref.name} ${ref.signature}, which the build lacks`);
    roots.push({ token: method.token });
    if (ref.name === ".ctor") roots.push({ instantiates: ref.parent });
  });
  return roots;
}

/**
 * Roots from library entry points named `Type::Method` (the type with or
 * without its namespace): every method of that name on the type. A scoped
 * library API that no host executable calls, so the host walk would miss it.
 * An interface member resolves, in the walk, to the implementations of the
 * types it instantiates.
 */
export function entryRoots(inventory: Pick<Inventory, "methods">, entries: readonly string[]): Root[] {
  return entries.flatMap((entry) => {
    const [type, name, ...extra] = entry.split("::");
    if (!type || !name || extra.length > 0) throw new Error(`entry ${entry} is not Type::Method`);
    const found = inventory.methods.filter(
      (m) => m.name === name && (m.declaringType === type || m.declaringType.endsWith(`.${type}`) || m.declaringType.endsWith(`/${type}`)),
    );
    if (found.length === 0) throw new Error(`entry ${entry}: the build has no such method`);
    const types = new Set(found.map((m) => m.declaringType));
    if (types.size > 1) throw new Error(`entry ${entry} is ambiguous: ${[...types].sort().join(", ")}`);
    return found.map((m): Root => ({ token: m.token }));
  });
}
