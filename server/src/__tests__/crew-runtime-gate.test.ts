import type { Db } from "@paperclipai/db";
import { describe, expect, it, vi } from "vitest";
import { type RuntimeGateDeps, evaluateRuntimeGate } from "../crew/runtime-gate.ts";
import type { BeforeClaimInput } from "../crew/load-gate.ts";

const CO = "company-1";
const AGENT = "agent-1";
const ISSUE = "issue-1";
const RUN = "run-1";
const ENV = "env-1";
const MACHINE = "machine-1";

type Run = BeforeClaimInput["run"];
const run = (over: Record<string, unknown> = {}) =>
  ({ id: RUN, companyId: CO, agentId: AGENT, status: "queued", contextSnapshot: { issueId: ISSUE }, ...over }) as unknown as Run;

function deps(over: Partial<RuntimeGateDeps> = {}): RuntimeGateDeps {
  return {
    loadAgent: async () => ({ adapterType: "codex_local", defaultEnvironmentId: ENV }),
    isCrewCompany: async () => true,
    cancelSuperseded: async () => false,
    resolveMachine: async () => MACHINE,
    switchOn: async () => true,
    hasWaitingMarker: async () => false,
    recordWaiting: vi.fn(async () => undefined),
    ...over,
  };
}

const db = {} as Db;

describe("evaluateRuntimeGate", () => {
  it("công tắc ON thì không giữ", async () => {
    const d = deps();
    expect(await evaluateRuntimeGate({ db, run: run() }, d)).toBe(false);
    expect(d.recordWaiting).not.toHaveBeenCalled();
  });

  it("đọc công tắc theo máy của agent", async () => {
    const seen: unknown[] = [];
    const d = deps({
      resolveMachine: async (input) => {
        seen.push(input);
        return MACHINE;
      },
      switchOn: async (input) => {
        seen.push(input);
        return true;
      },
    });
    await evaluateRuntimeGate({ db, run: run() }, d);
    expect(seen).toEqual([
      { companyId: CO, agentId: AGENT },
      { companyId: CO, machineId: MACHINE, runtime: "codex_local" },
    ]);
  });

  it("OFF thì giữ và ghi hàng chờ một lần", async () => {
    const d = deps({ switchOn: async () => false });
    expect(await evaluateRuntimeGate({ db, run: run() }, d)).toBe(true);
    expect(d.recordWaiting).toHaveBeenCalledWith(expect.objectContaining({ id: RUN }), {
      runtime: "codex_local",
      machineId: MACHINE,
      issueId: ISSUE,
    });
    const d2 = deps({ switchOn: async () => false, hasWaitingMarker: async () => true });
    expect(await evaluateRuntimeGate({ db, run: run() }, d2)).toBe(true);
    expect(d2.recordWaiting).not.toHaveBeenCalled();
  });

  it("máy không xác định: đọc công tắc với machineId null (mặc định), run không issue vẫn ghi hàng chờ", async () => {
    const switches: unknown[] = [];
    const d = deps({
      resolveMachine: async () => null,
      switchOn: async (input) => {
        switches.push(input);
        return false;
      },
    });
    expect(await evaluateRuntimeGate({ db, run: run({ contextSnapshot: {} }) }, d)).toBe(true);
    expect(switches).toEqual([{ companyId: CO, machineId: null, runtime: "codex_local" }]);
    expect(d.recordWaiting).toHaveBeenCalledWith(expect.anything(), { runtime: "codex_local", machineId: null, issueId: null });
  });

  it("ghi hàng chờ lỗi vẫn giữ run", async () => {
    const d = deps({ switchOn: async () => false, recordWaiting: async () => { throw new Error("db down"); } });
    expect(await evaluateRuntimeGate({ db, run: run() }, d)).toBe(true);
  });

  it.each([
    ["run không queued", { run: run({ status: "running" }) }],
    ["agent ngoài 3 runtime", { agent: { adapterType: "hermes", defaultEnvironmentId: ENV } }],
    ["agent process (không phải runtime Crew)", { agent: { adapterType: "process", defaultEnvironmentId: ENV } }],
    ["agent không còn", { agent: null }],
    ["company không phải Crew", { crew: false }],
  ] as const)("%s thì không giữ dù OFF", async (_name, c) => {
    const d = deps({
      switchOn: async () => false,
      ...("agent" in c ? { loadAgent: async () => c.agent } : {}),
      ...("crew" in c ? { isCrewCompany: async () => c.crew } : {}),
    });
    expect(await evaluateRuntimeGate({ db, run: "run" in c ? c.run : run() }, d)).toBe(false);
    expect(d.recordWaiting).not.toHaveBeenCalled();
  });

  it.each(["codex_local", "opencode_local"] as const)("agent %s không có environment: công tắc mặc định (máy null), giữ run", async (runtime) => {
    const switches: unknown[] = [];
    const resolveMachine = vi.fn(async () => MACHINE);
    const d = deps({
      loadAgent: async () => ({ adapterType: runtime, defaultEnvironmentId: null }),
      resolveMachine,
      switchOn: async (input) => {
        switches.push(input);
        return false;
      },
    });
    expect(await evaluateRuntimeGate({ db, run: run() }, d)).toBe(true);
    expect(resolveMachine).not.toHaveBeenCalled();
    expect(switches).toEqual([{ companyId: CO, machineId: null, runtime }]);
    expect(d.recordWaiting).toHaveBeenCalledWith(expect.anything(), { runtime, machineId: null, issueId: ISSUE });
  });

  it("agent claude_local không có environment: công tắc mặc định bật, không giữ", async () => {
    const d = deps({ loadAgent: async () => ({ adapterType: "claude_local", defaultEnvironmentId: null }), switchOn: async (input) => input.machineId === null });
    expect(await evaluateRuntimeGate({ db, run: run() }, d)).toBe(false);
    expect(d.recordWaiting).not.toHaveBeenCalled();
  });

  it("giữ cả claude_local khi board tắt Claude trên máy", async () => {
    const d = deps({ loadAgent: async () => ({ adapterType: "claude_local", defaultEnvironmentId: ENV }), switchOn: async () => false });
    expect(await evaluateRuntimeGate({ db, run: run() }, d)).toBe(true);
    expect(d.recordWaiting).toHaveBeenCalledWith(expect.anything(), { runtime: "claude_local", machineId: MACHINE, issueId: ISSUE });
  });

  it("deps ném lỗi thì không giữ (fail open cho công tắc)", async () => {
    expect(await evaluateRuntimeGate({ db, run: run() }, deps({ switchOn: async () => { throw new Error("x"); } }))).toBe(false);
    expect(await evaluateRuntimeGate({ db, run: run() }, deps({ loadAgent: async () => { throw new Error("x"); } }))).toBe(false);
    expect(await evaluateRuntimeGate({ db, run: run() }, deps({ resolveMachine: async () => { throw new Error("x"); } }))).toBe(false);
  });

  describe("run của agent đã bị chuyển đi", () => {
    it("hủy được thì giữ, không đọc công tắc", async () => {
      const switchOn = vi.fn(async () => true);
      const d = deps({ cancelSuperseded: async () => true, switchOn });
      expect(await evaluateRuntimeGate({ db, run: run() }, d)).toBe(true);
      expect(switchOn).not.toHaveBeenCalled();
    });

    it("áp cho mọi agent của company Crew, kể cả agent ngoài 3 runtime", async () => {
      const cancelSuperseded = vi.fn(async () => true);
      const d = deps({ loadAgent: async () => ({ adapterType: "process", defaultEnvironmentId: null }), cancelSuperseded });
      expect(await evaluateRuntimeGate({ db, run: run() }, d)).toBe(true);
      expect(cancelSuperseded).toHaveBeenCalledWith(expect.objectContaining({ id: RUN }));
    });

    it("không áp cho company ngoài Crew; lỗi khi kiểm thì đi tiếp tới công tắc", async () => {
      const cancelSuperseded = vi.fn(async () => true);
      expect(await evaluateRuntimeGate({ db, run: run() }, deps({ isCrewCompany: async () => false, cancelSuperseded }))).toBe(false);
      expect(cancelSuperseded).not.toHaveBeenCalled();
      const d = deps({ cancelSuperseded: async () => { throw new Error("db down"); }, switchOn: async () => false });
      expect(await evaluateRuntimeGate({ db, run: run() }, d)).toBe(true);
      expect(d.recordWaiting).toHaveBeenCalled();
    });
  });
});
