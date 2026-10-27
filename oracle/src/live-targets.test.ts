import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assertLiveTarget, isAllowedLiveTarget, resolveLiveTarget, serverMajor, windowsUrl, type LiveTargetDeps } from "./live-targets.js";

const dir = mkdtempSync(join(tmpdir(), "live-targets-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function row(slot: string, flavor: string, status: string) {
  return {
    slot,
    flavor,
    status,
    holder: status === "leased" ? "libsjs-parity" : null,
    lease: status === "leased" ? "0123abcd" : null,
    leased_at: null,
    lease_age_seconds: null,
    last_reset_at: null,
    last_reset_ms: null,
    quarantine_reason: null,
  };
}

/** A stand-in `arashouse` that prints `status` for `status --json`, or exits `code`. */
function stubBin(name: string, status: unknown, code = 0): string {
  const json = join(dir, `${name}.json`);
  writeFileSync(json, JSON.stringify(status));
  const bin = join(dir, name);
  writeFileSync(bin, `#!/bin/sh\n[ "$1 $2" = "status --json" ] || exit 2\ncat '${json}'\nexit ${code}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const status = {
  generated_at: "2026-10-28T00:00:00Z",
  max_active: { limit: 4, in_use: 2 },
  max_resets: { limit: 1, in_use: 0 },
  slots: [row("12sp9-01", "12sp9", "leased"), row("12sp9-02", "12sp9", "free"), row("23-01", "23", "leased")],
  flavors: {},
  queue: [],
};
const leasesBin = stubBin("arashouse", status);
const deps = (bin: string | undefined, extra: NodeJS.ProcessEnv = {}): LiveTargetDeps => ({
  env: { ...(bin === undefined ? {} : { ARASHOUSE_BIN: bin }), ...extra },
  gateway: () => "172.20.0.1",
});

describe("live targets", () => {
  it("allows the dev instance as before, without asking arashouse", async () => {
    const none = deps(join(dir, "missing"));
    for (const url of ["http://localhost/12sp9", "http://172.19.0.1/12sp9", "http://localhost/12sp9/"]) {
      expect(await resolveLiveTarget(url, "12sp9", none)).toEqual({ kind: "dev" });
    }
  });

  it("allows a current lease at its own alias and database, on any address of the Windows host", async () => {
    for (const host of ["172.19.0.1", "localhost", "127.0.0.1", "172.20.0.1"]) {
      expect(await resolveLiveTarget(`http://${host}/ah-12sp9-01`, "arashouse_12sp9_01", deps(leasesBin))).toEqual({ kind: "lease", slot: "12sp9-01", flavor: "12sp9" });
    }
    expect(await isAllowedLiveTarget("http://172.19.0.1/ah-23-01/", "arashouse_23_01", deps(leasesBin))).toBe(true);
    expect(await isAllowedLiveTarget("http://win-host:8080/ah-23-01", "arashouse_23_01", deps(leasesBin, { ARASHOUSE_HOST_ADDR: "win-host:8080" }))).toBe(true);
  });

  it("refuses the same host with a different alias, or an alias and database of two slots", async () => {
    const d = deps(leasesBin);
    expect(await isAllowedLiveTarget("http://172.19.0.1/ah-12sp9-02", "arashouse_12sp9_01", d)).toBe(false);
    expect(await isAllowedLiveTarget("http://172.19.0.1/ah-12sp9-01", "arashouse_12sp9_02", d)).toBe(false);
    expect(await isAllowedLiveTarget("http://172.19.0.1/InnovatorServer23", "arashouse_23_01", d)).toBe(false);
    expect(await isAllowedLiveTarget("http://172.19.0.1/ah-23-01/Server", "arashouse_23_01", d)).toBe(false);
    expect(await isAllowedLiveTarget("http://172.19.0.1/12sp9", "arashouse_12sp9_01", d)).toBe(true); // the dev instance; its URL decides
  });

  it("refuses a free-form URL: another host, https, credentials or a query", async () => {
    const d = deps(leasesBin);
    for (const url of ["http://aras.example/ah-12sp9-01", "https://172.19.0.1/ah-12sp9-01", "http://root:x@172.19.0.1/ah-12sp9-01", "http://172.19.0.1/ah-12sp9-01?db=x", "not a url"]) {
      expect(await isAllowedLiveTarget(url, "arashouse_12sp9_01", d), url).toBe(false);
    }
  });

  it("refuses a stale lease: a slot that is free or not in the output", async () => {
    const d = deps(leasesBin);
    expect(await isAllowedLiveTarget("http://172.19.0.1/ah-12sp9-02", "arashouse_12sp9_02", d)).toBe(false);
    expect(await isAllowedLiveTarget("http://172.19.0.1/ah-35-01", "arashouse_35_01", d)).toBe(false);
  });

  it("refuses anything naming olm, prod or OLM_Local, whatever arashouse says", async () => {
    const all = stubBin("everything", { slots: [row("olm-01", "olm", "leased"), row("prod-01", "prod", "leased")] });
    for (const [url, db] of [
      ["http://localhost/OLM_Local", "OLM_Local"],
      ["http://localhost/12sp9", "OLM_Local"],
      ["http://olm.example/12sp9", "12sp9"],
      ["http://172.19.0.1/ah-olm-01", "arashouse_olm_01"],
      ["http://172.19.0.1/ah-prod-01", "arashouse_prod_01"],
    ] as const) {
      expect(await isAllowedLiveTarget(url, db, deps(all)), `${url} ${db}`).toBe(false);
    }
  });

  it("fails closed when arashouse is missing, fails or prints something else", async () => {
    const url = "http://172.19.0.1/ah-12sp9-01";
    const db = "arashouse_12sp9_01";
    expect(await isAllowedLiveTarget(url, db, deps(join(dir, "missing")))).toBe(false);
    expect(await isAllowedLiveTarget(url, db, deps(stubBin("failing", status, 6)))).toBe(false);
    const garbage = join(dir, "garbage");
    writeFileSync(garbage, "#!/bin/sh\necho 'slot 12sp9-01 leased'\n");
    chmodSync(garbage, 0o755);
    expect(await isAllowedLiveTarget(url, db, deps(garbage))).toBe(false);
    expect(await isAllowedLiveTarget(url, db, deps(stubBin("shapeless", { slots: "12sp9-01" })))).toBe(false);
    expect(await isAllowedLiveTarget(url, db, { ...deps(undefined, { PATH: dir }), runStatus: () => Promise.reject(new Error("ENOENT")) })).toBe(false);
  });

  it("names the targets in its refusal", async () => {
    await expect(assertLiveTarget("https://olm.example/innovator", "InnovatorSolutions", deps(leasesBin))).rejects.toThrow(/dev instance .* or to a lease/);
    await expect(assertLiveTarget("http://172.19.0.1/ah-23-01", "arashouse_23_01", deps(leasesBin))).resolves.toEqual({ kind: "lease", slot: "23-01", flavor: "23" });
  });

  it("knows each target's server major and its address from Windows", () => {
    expect(serverMajor({ kind: "dev" })).toBe(12);
    expect(serverMajor({ kind: "lease", slot: "12sp9-01", flavor: "12sp9" })).toBe(12);
    expect(serverMajor({ kind: "lease", slot: "23-01", flavor: "23" })).toBe(14);
    expect(serverMajor({ kind: "lease", slot: "35-01", flavor: "35" })).toBe(14);
    expect(windowsUrl("http://172.19.0.1/12sp9/")).toBe("http://localhost/12sp9");
    expect(windowsUrl("http://172.19.0.1/ah-23-01")).toBe("http://localhost/ah-23-01");
    expect(windowsUrl("http://win-host:8080/ah-23-01")).toBe("http://localhost:8080/ah-23-01");
  });
});
