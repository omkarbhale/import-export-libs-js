/**
 * Which methods the engine can run, starting from what its hosts call.
 *
 * A worklist walk over REA's call edges, with three additions a plain call
 * graph misses:
 * - virtual and interface calls dispatch, by name and signature, to the
 *   matching virtual methods of every type the walk has instantiated
 *   (explicit implementations, named `Ns.IFace.Member`, match too);
 * - touching a type (calling it, instantiating it, or accessing its fields)
 *   runs its static constructor;
 * - the runtime drives compiler-generated types (async and iterator state
 *   machines), so touching one makes all its virtual methods reachable, and
 *   so are framework overrides (virtual, not newslot) of instantiated types.
 */

export interface GraphMethod {
  token: string;
  fullName: string;
  name: string;
  /** Declaring type, `Outer/Inner` for nested types. */
  type: string;
  /** Signature without the member name: `Ret(Params)`. */
  shape: string;
  virtual: boolean;
  newSlot: boolean;
}

export type CallTarget = { token: string } | { external: string; shape: string };

export interface GraphCall {
  opcode: "call" | "callvirt" | "newobj" | "ldftn";
  target: CallTarget;
}

export interface Graph {
  methods: GraphMethod[];
  /** Calls made by each method, by caller token. */
  calls: Map<string, GraphCall[]>;
  /** Types whose fields each method accesses, by method token. */
  fieldTypes: Map<string, string[]>;
}

export interface Root {
  /** A method the host calls directly. */
  token?: string;
  /** A virtual call the host makes, e.g. through an interface. */
  virtualCall?: { name: string; shape: string };
  /** The host constructs this type. */
  instantiates?: string;
}

export function reachable(graph: Graph, roots: readonly Root[]): Set<string> {
  const byToken = new Map(graph.methods.map((m) => [m.token, m]));
  const byType = new Map<string, GraphMethod[]>();
  for (const method of graph.methods) {
    const list = byType.get(method.type) ?? [];
    list.push(method);
    byType.set(method.type, list);
  }

  const seen = new Set<string>();
  const touched = new Set<string>();
  const instantiated = new Set<string>();
  const virtualCalls = new Map<string, { name: string; shape: string }>();
  const queue: string[] = [];

  const mark = (token: string) => {
    if (seen.has(token) || !byToken.has(token)) return;
    seen.add(token);
    queue.push(token);
  };

  const isCompilerGenerated = (type: string) => (type.split("/").pop() ?? "").startsWith("<");
  const matches = (method: GraphMethod, call: { name: string; shape: string }) =>
    method.virtual && method.shape === call.shape && (method.name === call.name || method.name.endsWith(`.${call.name}`));

  const touch = (type: string) => {
    if (touched.has(type)) return;
    touched.add(type);
    for (const method of byType.get(type) ?? []) {
      if (method.name === ".cctor") mark(method.token);
      if (method.virtual && isCompilerGenerated(type)) mark(method.token);
    }
  };

  const instantiate = (type: string) => {
    touch(type);
    if (instantiated.has(type)) return;
    instantiated.add(type);
    for (const method of byType.get(type) ?? []) {
      if (method.virtual && !method.newSlot) mark(method.token);
      for (const call of virtualCalls.values()) if (matches(method, call)) mark(method.token);
    }
  };

  const callVirtual = (call: { name: string; shape: string }) => {
    const key = `${call.name}|${call.shape}`;
    if (virtualCalls.has(key)) return;
    virtualCalls.set(key, call);
    for (const type of instantiated) {
      for (const method of byType.get(type) ?? []) if (matches(method, call)) mark(method.token);
    }
  };

  for (const root of roots) {
    if (root.instantiates) instantiate(root.instantiates);
    if (root.virtualCall) callVirtual(root.virtualCall);
    if (root.token) {
      mark(root.token);
      const method = byToken.get(root.token);
      if (method?.virtual) callVirtual({ name: method.name, shape: method.shape });
    }
  }

  while (queue.length > 0) {
    const token = queue.shift() as string;
    const method = byToken.get(token);
    if (!method) continue;
    touch(method.type);
    for (const type of graph.fieldTypes.get(token) ?? []) touch(type);
    for (const call of graph.calls.get(token) ?? []) {
      if ("external" in call.target) {
        if (call.opcode === "callvirt") callVirtual({ name: call.target.external, shape: call.target.shape });
        continue;
      }
      const target = byToken.get(call.target.token);
      if (!target) continue;
      mark(target.token);
      touch(target.type);
      if (call.opcode === "newobj") instantiate(target.type);
      if (call.opcode === "callvirt" && target.virtual) callVirtual({ name: target.name, shape: target.shape });
    }
  }

  return seen;
}
