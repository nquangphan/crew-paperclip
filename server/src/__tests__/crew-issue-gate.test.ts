import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { TASK_WATCHDOG_PRODUCT_BUG_ORIGIN_KIND } from "@paperclipai/shared";
import { crewBeforeIssueWrite, docsGateStages, evaluateIssueGate, pushGateStages, type IssueGateFacts } from "../crew/issue-gate.ts";
import { normalizeIssueExecutionPolicy } from "../services/issue-execution-policy.ts";
import { RECOVERY_ORIGIN_KINDS } from "../services/recovery/origins.ts";
import { TASK_WATCHDOG_ORIGIN_KIND } from "../services/task-watchdog-scope.ts";
import {
  buildCrewPolicy,
  CREW_MAX_REVIEW_ROUNDS,
  CREW_HOUSEKEEPING_ORIGIN_KINDS,
  CREW_POLICY_CONFIG_ENV,
  isCrewHousekeepingIssue,
  loadCrewCompanyConfig,
  reportCrewPolicyConfigAtStartup,
  parseCrewPolicyConfig,
  parseCrewMergeEvidence,
  parseDocsCheckEvidence,
  policyGateFingerprint,
} from "../crew/issue-policy.ts";

const REVIEWER = "11111111-1111-4111-8111-111111111111";
const INTEGRATOR = "22222222-2222-4222-8222-222222222222";
const EXECUTOR = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const COMPANY = "55555555-5555-4555-8555-555555555555";
const roles = { reviewerAgentId: REVIEWER, integratorAgentId: INTEGRATOR };
const SHA_BASE = "a".repeat(40);
const SHA_HEAD = "b".repeat(40);

const entry = { reviewerAgentId: REVIEWER, integratorAgentId: INTEGRATOR, ownerUserId: "owner-1" };

describe("crewBeforeIssueWrite override", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "crew-override-config-"));
  const file = path.join(dir, "crew-policy.json");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("chặn override của agent trước đường trả về sớm", async () => {
    writeFileSync(file, JSON.stringify({ companies: { [COMPANY]: entry } }));
    const previous = process.env[CREW_POLICY_CONFIG_ENV];
    process.env[CREW_POLICY_CONFIG_ENV] = file;
    try {
      const input = {
        tx: {} as never,
        issueId: "issue",
        existing: { companyId: COMPANY } as never,
        patch: { assigneeAdapterOverrides: { adapterConfig: { command: "/bin/sh" } } },
        actorAgentId: EXECUTOR,
        actorUserId: null,
      };
      await expect(crewBeforeIssueWrite(input)).rejects.toMatchObject({
        status: 422,
        details: { code: "crew_override_forbidden", violations: ["adapterConfig.command"] },
      });
    } finally {
      if (previous === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
      else process.env[CREW_POLICY_CONFIG_ENV] = previous;
    }
  });
});

describe("parseCrewPolicyConfig", () => {
  it("company có trong file và đủ trường thì trả vai trò và owner", () => {
    expect(parseCrewPolicyConfig(JSON.stringify({ companies: { [COMPANY]: entry } }), COMPANY)).toEqual({
      kind: "ok",
      roles,
      ownerUserId: "owner-1",
    });
  });

  it("company không có trong file thì absent (hành vi stock)", () => {
    expect(parseCrewPolicyConfig(JSON.stringify({ companies: {} }), COMPANY)).toEqual({ kind: "absent" });
  });

  it("company có mặt nhưng thiếu trường, sai uuid hoặc trùng agent thì invalid", () => {
    const bad = [
      { reviewerAgentId: REVIEWER, integratorAgentId: INTEGRATOR },
      { ...entry, reviewerAgentId: "not-a-uuid" },
      { ...entry, integratorAgentId: REVIEWER },
      { ...entry, ownerUserId: "  " },
      "reviewer",
    ];
    for (const value of bad) {
      expect(parseCrewPolicyConfig(JSON.stringify({ companies: { [COMPANY]: value } }), COMPANY)).toMatchObject({
        kind: "invalid",
      });
    }
  });

  it("key company so khớp không phân biệt hoa thường; hai key trùng khi bỏ hoa thường thì invalid", () => {
    const lower = "abcdef12-3456-4789-8abc-def123456789";
    const upper = lower.toUpperCase();
    expect(parseCrewPolicyConfig(JSON.stringify({ companies: { [upper]: entry } }), lower)).toMatchObject({
      kind: "ok",
      roles,
    });
    expect(parseCrewPolicyConfig(JSON.stringify({ companies: { [lower]: entry } }), upper)).toMatchObject({
      kind: "ok",
    });
    expect(
      parseCrewPolicyConfig(JSON.stringify({ companies: { [lower]: entry, [upper]: entry } }), lower),
    ).toMatchObject({ kind: "invalid" });
  });

  it("file lỗi cú pháp hoặc sai khung thì invalid cho mọi company", () => {
    expect(parseCrewPolicyConfig("{", COMPANY)).toMatchObject({ kind: "invalid" });
    expect(parseCrewPolicyConfig(JSON.stringify({ companies: [] }), COMPANY)).toMatchObject({ kind: "invalid" });
    expect(parseCrewPolicyConfig("null", COMPANY)).toMatchObject({ kind: "invalid" });
  });
});

describe("loadCrewCompanyConfig", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "crew-policy-config-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("không đặt env thì absent", async () => {
    await expect(loadCrewCompanyConfig(COMPANY, {})).resolves.toEqual({ kind: "absent" });
    await expect(loadCrewCompanyConfig(COMPANY, { [CREW_POLICY_CONFIG_ENV]: "  " })).resolves.toEqual({
      kind: "absent",
    });
  });

  it("đọc lại file ở mỗi lần gọi", async () => {
    const file = path.join(dir, "crew-policy.json");
    writeFileSync(file, JSON.stringify({ companies: {} }));
    const env = { [CREW_POLICY_CONFIG_ENV]: file };
    await expect(loadCrewCompanyConfig(COMPANY, env)).resolves.toEqual({ kind: "absent" });
    writeFileSync(file, JSON.stringify({ companies: { [COMPANY]: entry } }));
    await expect(loadCrewCompanyConfig(COMPANY, env)).resolves.toMatchObject({ kind: "ok", roles });
  });

  it("env trỏ tới file không đọc được thì invalid (fail closed)", async () => {
    await expect(
      loadCrewCompanyConfig(COMPANY, { [CREW_POLICY_CONFIG_ENV]: path.join(dir, "missing.json") }),
    ).resolves.toMatchObject({ kind: "invalid" });
  });
});

describe("reportCrewPolicyConfigAtStartup", () => {
  it("không đặt env thì warn rằng gate Crew tắt; có env thì không warn", () => {
    const log = { warn: vi.fn(), info: vi.fn() };
    expect(reportCrewPolicyConfigAtStartup({}, log)).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(String(log.warn.mock.calls[0]![1])).toContain(CREW_POLICY_CONFIG_ENV);
    const quiet = { warn: vi.fn(), info: vi.fn() };
    expect(reportCrewPolicyConfigAtStartup({ [CREW_POLICY_CONFIG_ENV]: "/etc/crew-policy.json" }, quiet)).toBe(true);
    expect(quiet.warn).not.toHaveBeenCalled();
  });
});

describe("isCrewHousekeepingIssue", () => {
  it("issue watchdog/recovery do hệ thống tạo là việc nội bộ; routine, manual hay có người tạo thì không", () => {
    expect([...CREW_HOUSEKEEPING_ORIGIN_KINDS].sort()).toEqual(
      [...Object.values(RECOVERY_ORIGIN_KINDS), TASK_WATCHDOG_ORIGIN_KIND, TASK_WATCHDOG_PRODUCT_BUG_ORIGIN_KIND].sort(),
    );
    for (const originKind of CREW_HOUSEKEEPING_ORIGIN_KINDS) {
      expect(isCrewHousekeepingIssue({ originKind, createdByAgentId: null, createdByUserId: null })).toBe(true);
      expect(isCrewHousekeepingIssue({ originKind, createdByAgentId: EXECUTOR, createdByUserId: null })).toBe(false);
      expect(isCrewHousekeepingIssue({ originKind, createdByAgentId: null, createdByUserId: "owner-1" })).toBe(false);
    }
    for (const originKind of ["routine_execution", "manual", "chat_channel", "plugin:x", null]) {
      expect(isCrewHousekeepingIssue({ originKind, createdByAgentId: null, createdByUserId: null })).toBe(false);
    }
  });
});

describe("buildCrewPolicy", () => {
  it("research qua reviewer rồi owner, không có gate docs hay push", () => {
    const policy = buildCrewPolicy("research", roles, "owner-1");
    expect(policy.stages.map((stage) => [stage.type, stage.participants.map((p) => p.agentId ?? p.userId)])).toEqual([
      ["review", [REVIEWER]],
      ["approval", ["owner-1"]],
    ]);
    expect(policy.maxReviewRounds).toBe(CREW_MAX_REVIEW_ROUNDS);
    expect(docsGateStages(policy)).toEqual([]);
    expect(pushGateStages(policy)).toEqual([]);
  });

  it("research cần owner", () => {
    expect(() => buildCrewPolicy("research", roles)).toThrow(/owner/);
  });
  it("issue con chỉ có stage reviewer, 5 vòng", () => {
    const policy = buildCrewPolicy("child", roles);
    expect(policy.maxReviewRounds).toBe(CREW_MAX_REVIEW_ROUNDS);
    expect(policy.stages.map((s) => [s.type, s.participants.map((p) => p.agentId ?? p.userId)])).toEqual([
      ["review", [REVIEWER]],
    ]);
    expect(policy.stages[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("issue gốc có reviewer, integrator (merge + docs), owner rồi integrator (push), 5 vòng", () => {
    const policy = buildCrewPolicy("root", roles, "owner-1");
    expect(policy.maxReviewRounds).toBe(CREW_MAX_REVIEW_ROUNDS);
    expect(policy.stages.map((s) => [s.type, s.participants.map((p) => p.agentId ?? p.userId)])).toEqual([
      ["review", [REVIEWER]],
      ["review", [INTEGRATOR]],
      ["approval", ["owner-1"]],
      ["review", [INTEGRATOR]],
    ]);
    expect(new Set(policy.stages.map((s) => s.id)).size).toBe(4);
  });

  it("issue gốc thiếu owner thì báo lỗi", () => {
    expect(() => buildCrewPolicy("root", roles, null)).toThrow(/owner/);
  });
});

describe("policyGateFingerprint", () => {
  it("bỏ qua id participant và monitor, bắt thay đổi stage", () => {
    const base = buildCrewPolicy("child", roles);
    const sameWithMonitor = {
      ...base,
      stages: base.stages.map((s) => ({ ...s, participants: s.participants.map((p) => ({ ...p, id: "x" })) })),
      monitor: { nextCheckAt: "2026-10-07T10:00:00.000Z" },
    };
    expect(policyGateFingerprint(sameWithMonitor)).toBe(policyGateFingerprint(base));
    expect(policyGateFingerprint({ ...base, stages: [] })).toBe("none");
    expect(policyGateFingerprint(null)).toBe("none");
    const swapped = { ...base, stages: [{ ...base.stages[0]!, participants: [{ type: "agent", agentId: EXECUTOR }] }] };
    expect(policyGateFingerprint(swapped)).not.toBe(policyGateFingerprint(base));
  });
});

describe("parseCrewMergeEvidence", () => {
  it("chỉ nhận dòng đầu pushed=yes", () => {
    expect(parseCrewMergeEvidence(`crew-merge sha=${SHA_HEAD} branch=main pushed=yes\nlog`)).toEqual({ sha: SHA_HEAD, branch: "main" });
    expect(parseCrewMergeEvidence(`crew-merge sha=${SHA_HEAD} branch=main pushed=no`)).toBeNull();
    expect(parseCrewMergeEvidence(`ghi chú\ncrew-merge sha=${SHA_HEAD} branch=main pushed=yes`)).toBeNull();
    expect(parseCrewMergeEvidence(`crew-merge sha=${SHA_HEAD.slice(1)} branch=main pushed=yes`)).toBeNull();
  });
});

describe("parseDocsCheckEvidence", () => {
  it("đọc dòng đầu đúng định dạng", () => {
    const body = `crew-docs-check commit=${SHA_HEAD} range=${SHA_BASE}..${SHA_HEAD} exit=0\n\n\`\`\`\nok\n\`\`\``;
    expect(parseDocsCheckEvidence(body)).toEqual({ commit: SHA_HEAD, base: SHA_BASE, head: SHA_HEAD, exit: 0 });
  });

  it("từ chối commit khác đầu range, chữ hoa, hoặc dòng không phải dòng đầu", () => {
    expect(parseDocsCheckEvidence(`crew-docs-check commit=${SHA_BASE} range=${SHA_BASE}..${SHA_HEAD} exit=0`)).toBeNull();
    expect(
      parseDocsCheckEvidence(`crew-docs-check commit=${SHA_HEAD.toUpperCase()} range=${SHA_BASE}..${SHA_HEAD} exit=0`),
    ).toBeNull();
    expect(
      parseDocsCheckEvidence(`ghi chú\ncrew-docs-check commit=${SHA_HEAD} range=${SHA_BASE}..${SHA_HEAD} exit=0`),
    ).toBeNull();
  });
});

const child = buildCrewPolicy("child", roles);
// Template gốc 3 stage của issue tạo trước khi có stage push: vẫn phải chạy như cũ.
const root = normalizeIssueExecutionPolicy({
  stages: [
    { type: "review", participants: [{ type: "agent", agentId: REVIEWER }] },
    { type: "review", participants: [{ type: "agent", agentId: INTEGRATOR }] },
    { type: "approval", participants: [{ type: "user", userId: "owner-1" }] },
  ],
  maxReviewRounds: 5,
})!;
const [sReview, sIntegrator, sOwner] = root.stages.map((s) => s.id) as [string, string, string];
const root4 = buildCrewPolicy("root", roles, "owner-1");
const [r4Review, r4Integrator, r4Owner, r4Push] = root4.stages.map((s) => s.id) as [string, string, string, string];
const executorPrincipal = { type: "agent", agentId: EXECUTOR, userId: null };
const T0 = new Date("2026-10-07T09:00:00Z");
const T1 = new Date("2026-10-07T10:00:00Z");
const T2 = new Date("2026-10-07T11:00:00Z");

function pending(policy: typeof root, stageId: string, participant: object, completed: string[] = []) {
  const index = policy.stages.findIndex((s) => s.id === stageId);
  return {
    status: "pending",
    currentStageId: stageId,
    currentStageIndex: index,
    currentStageType: policy.stages[index]!.type,
    currentParticipant: participant,
    returnAssignee: executorPrincipal,
    reviewRequest: null,
    completedStageIds: completed,
    lastDecisionId: null,
    lastDecisionOutcome: null,
    changesRequestedCount: 0,
  };
}
function completed(ids: string[]) {
  return {
    status: "completed",
    currentStageId: null,
    currentStageIndex: null,
    currentStageType: null,
    currentParticipant: null,
    returnAssignee: executorPrincipal,
    reviewRequest: null,
    completedStageIds: ids,
    lastDecisionId: null,
    lastDecisionOutcome: "approved",
    changesRequestedCount: 0,
  };
}
function approval(stageId: string, actorAgentId: string | null, createdAt = T1, actorUserId: string | null = null) {
  return { stageId, actorAgentId, actorUserId, createdAt };
}
const docsOk = {
  evidence: { commit: SHA_HEAD, base: SHA_BASE, head: SHA_HEAD, exit: 0 as const },
  createdAt: T1,
};
const reviewerParticipant = { type: "agent", agentId: REVIEWER, userId: null };
function facts(over: Partial<IssueGateFacts>): IssueGateFacts {
  return {
    locked: {
      status: "in_review",
      executionPolicy: root,
      executionState: pending(root, sReview, reviewerParticipant),
      assigneeAgentId: REVIEWER,
      assigneeUserId: null,
    },
    patch: {},
    actor: { kind: "agent", agentId: EXECUTOR },
    roles,
    approvals: [],
    cycleStartedAt: null,
    lastChangesRequestedAt: null,
    docsEvidence: null,
    pushEvidence: null,
    ...over,
  };
}
const integratorPending = {
  status: "in_review",
  executionPolicy: root,
  executionState: pending(root, sIntegrator, { type: "agent", agentId: INTEGRATOR, userId: null }, [sReview]),
  assigneeAgentId: INTEGRATOR,
  assigneeUserId: null,
};
const integratorApproves = {
  status: "in_review",
  executionState: {
    ...pending(root, sOwner, { type: "user", agentId: null, userId: "owner-1" }, [sReview, sIntegrator]),
    lastDecisionOutcome: "approved",
  },
};

describe("evaluateIssueGate", () => {
  it("chặn agent đổi stage hoặc xóa policy", () => {
    const shrunk = { ...root, stages: root.stages.slice(0, 1) };
    expect(evaluateIssueGate(facts({ patch: { executionPolicy: shrunk } }))).toMatchObject({
      kind: "block",
      code: "crew_policy_locked",
    });
    expect(evaluateIssueGate(facts({ patch: { executionPolicy: null } }))).toMatchObject({
      kind: "block",
      code: "crew_policy_locked",
    });
  });

  it("chặn agent nâng maxReviewRounds nhưng cho bỏ nó (về mặc định 3, chặt hơn)", () => {
    expect(evaluateIssueGate(facts({ patch: { executionPolicy: { ...root, maxReviewRounds: 50 } } }))).toMatchObject({
      kind: "block",
    });
    const { maxReviewRounds: _drop, ...noRounds } = root;
    expect(evaluateIssueGate(facts({ patch: { executionPolicy: noRounds } }))).toEqual({ kind: "allow", notes: [] });
  });

  it("monitor: agent chỉ đổi monitor thì được", () => {
    const withMonitor = {
      ...root,
      monitor: { nextCheckAt: "2026-10-07T12:00:00.000Z", notes: null, scheduledBy: "assignee" },
    };
    expect(evaluateIssueGate(facts({ patch: { executionPolicy: withMonitor } }))).toEqual({ kind: "allow", notes: [] });
  });

  it("board đổi policy thì được", () => {
    expect(
      evaluateIssueGate(facts({ actor: { kind: "board", userId: "owner-1" }, patch: { executionPolicy: null } })),
    ).toEqual({ kind: "allow", notes: [] });
  });

  it("system done: chặn khi stage reviewer còn chờ", () => {
    const v = evaluateIssueGate(facts({ actor: { kind: "system" }, patch: { status: "done" } }));
    expect(v).toMatchObject({ kind: "block", code: "crew_gate_blocked" });
    expect(v.kind === "block" && v.violations).toContain(`stage_unapproved:${sReview}`);
  });

  it("system ghi blocked không bị đụng", () => {
    expect(evaluateIssueGate(facts({ actor: { kind: "system" }, patch: { status: "blocked" } }))).toEqual({
      kind: "allow",
      notes: [],
    });
  });

  it("system ghi trên issue không có policy Crew thì giữ hành vi stock", () => {
    const noPolicy = { status: "in_progress", executionPolicy: null, executionState: null, assigneeAgentId: null, assigneeUserId: null };
    expect(evaluateIssueGate(facts({ actor: { kind: "system" }, locked: noPolicy, patch: { status: "done" } }))).toEqual({
      kind: "allow",
      notes: [],
    });
    expect(
      evaluateIssueGate(facts({ actor: { kind: "system" }, locked: noPolicy, roles: null, patch: { status: "done" } })),
    ).toEqual({ kind: "allow", notes: [] });
  });

  it("agent không được chuyển issue sang cancelled; board và hệ thống thì được", () => {
    expect(evaluateIssueGate(facts({ patch: { status: "cancelled" } }))).toEqual({
      kind: "block",
      code: "crew_gate_blocked",
      violations: ["agent_cancel_forbidden"],
    });
    expect(
      evaluateIssueGate(
        facts({
          locked: { status: "in_progress", executionPolicy: null, executionState: null, assigneeAgentId: EXECUTOR, assigneeUserId: null },
          roles: null,
          patch: { status: "cancelled" },
        }),
      ),
    ).toMatchObject({ kind: "block", violations: ["agent_cancel_forbidden"] });
    expect(
      evaluateIssueGate(facts({ actor: { kind: "board", userId: "owner-1" }, patch: { status: "cancelled" } })),
    ).toEqual({ kind: "allow", notes: [] });
    expect(evaluateIssueGate(facts({ actor: { kind: "system" }, patch: { status: "cancelled" } }))).toEqual({
      kind: "allow",
      notes: [],
    });
  });

  it("agent ghi lại cancelled trên issue đã cancelled thì không bị chặn", () => {
    expect(
      evaluateIssueGate(
        facts({
          locked: { status: "cancelled", executionPolicy: root, executionState: null, assigneeAgentId: EXECUTOR, assigneeUserId: null },
          patch: { status: "cancelled" },
        }),
      ),
    ).toEqual({ kind: "allow", notes: [] });
  });

  it("agent giao issue cho reviewer/integrator bị chặn; workflow giao cho participant stage thì được", () => {
    const executing = { status: "in_progress", executionPolicy: child, executionState: null, assigneeAgentId: EXECUTOR, assigneeUserId: null };
    for (const target of [REVIEWER, INTEGRATOR]) {
      expect(evaluateIssueGate(facts({ locked: executing, patch: { assigneeAgentId: target } }))).toEqual({
        kind: "block",
        code: "crew_role_assignee",
        violations: ["role_assignee"],
      });
    }
    const handoff = {
      status: "in_review",
      assigneeAgentId: REVIEWER,
      executionState: pending(child, child.stages[0]!.id, reviewerParticipant),
    };
    expect(evaluateIssueGate(facts({ locked: executing, patch: handoff }))).toEqual({ kind: "allow", notes: [] });
    expect(
      evaluateIssueGate(facts({ locked: executing, actor: { kind: "board", userId: "owner-1" }, patch: { assigneeAgentId: REVIEWER } })),
    ).toEqual({ kind: "allow", notes: [] });
    expect(evaluateIssueGate(facts({ locked: executing, patch: { assigneeAgentId: OTHER } }))).toEqual({
      kind: "allow",
      notes: [],
    });
  });

  it("auto-skip: stage hoàn tất mà không có decision thì không tính", () => {
    const v = evaluateIssueGate(
      facts({
        locked: { status: "in_progress", executionPolicy: child, executionState: null, assigneeAgentId: EXECUTOR, assigneeUserId: null },
        patch: { status: "done", executionState: completed([child.stages[0]!.id]) },
      }),
    );
    expect(v).toMatchObject({ kind: "block" });
  });

  it("decision duy nhất do executor ký thì không tính", () => {
    const v = evaluateIssueGate(
      facts({
        locked: { status: "in_review", executionPolicy: child, executionState: completed([child.stages[0]!.id]), assigneeAgentId: REVIEWER, assigneeUserId: null },
        patch: { status: "done" },
        approvals: [approval(child.stages[0]!.id, EXECUTOR)],
      }),
    );
    expect(v).toMatchObject({ kind: "block" });
  });

  it("approval của chính assignee hiện tại không tính (reviewer mở lại rồi tự done)", () => {
    const v = evaluateIssueGate(
      facts({
        actor: { kind: "agent", agentId: REVIEWER },
        locked: { status: "in_progress", executionPolicy: child, executionState: null, assigneeAgentId: REVIEWER, assigneeUserId: null },
        patch: { status: "done" },
        approvals: [approval(child.stages[0]!.id, REVIEWER)],
      }),
    );
    expect(v).toMatchObject({ kind: "block", violations: [`stage_unapproved:${child.stages[0]!.id}`] });
  });

  it("approval cũ hơn mốc mở lại không tính", () => {
    const reopened = { status: "in_progress", executionPolicy: child, executionState: completed([child.stages[0]!.id]), assigneeAgentId: EXECUTOR, assigneeUserId: null };
    const stageId = child.stages[0]!.id;
    expect(
      evaluateIssueGate(facts({ locked: reopened, patch: { status: "done" }, approvals: [approval(stageId, REVIEWER, T1)], cycleStartedAt: T2 })),
    ).toMatchObject({ kind: "block", violations: [`stage_unapproved:${stageId}`] });
    expect(
      evaluateIssueGate(facts({ locked: reopened, patch: { status: "done" }, approvals: [approval(stageId, REVIEWER, T2)], cycleStartedAt: T1 })),
    ).toEqual({ kind: "allow", notes: [] });
  });

  it("owner duyệt stage cuối trong chính request này: cho qua khi các stage trước có decision và docs đạt", () => {
    const v = evaluateIssueGate(
      facts({
        actor: { kind: "board", userId: "owner-1" },
        locked: {
          status: "in_review",
          executionPolicy: root,
          executionState: pending(root, sOwner, { type: "user", agentId: null, userId: "owner-1" }, [sReview, sIntegrator]),
          assigneeAgentId: null,
          assigneeUserId: "owner-1",
        },
        patch: { status: "done", executionState: completed([sReview, sIntegrator, sOwner]) },
        approvals: [approval(sReview, REVIEWER), approval(sIntegrator, INTEGRATOR)],
        docsEvidence: docsOk,
      }),
    );
    expect(v).toEqual({ kind: "allow", notes: [] });
  });

  it("integrator hoàn tất stage của mình: thiếu docs, docs lỗi, docs cũ thì chặn; exit 3 cho qua kèm ghi chú", () => {
    const base = {
      actor: { kind: "agent" as const, agentId: INTEGRATOR },
      locked: integratorPending,
      patch: integratorApproves,
      approvals: [approval(sReview, REVIEWER)],
    };
    expect(evaluateIssueGate(facts(base))).toMatchObject({ kind: "block", violations: ["docs_missing"] });
    expect(
      evaluateIssueGate(facts({ ...base, docsEvidence: { ...docsOk, evidence: { ...docsOk.evidence, exit: 1 } } })),
    ).toMatchObject({ kind: "block", violations: ["docs_failed:1"] });
    expect(evaluateIssueGate(facts({ ...base, docsEvidence: docsOk, lastChangesRequestedAt: T2 }))).toMatchObject({
      kind: "block",
      violations: ["docs_stale"],
    });
    expect(
      evaluateIssueGate(facts({ ...base, docsEvidence: { ...docsOk, evidence: { ...docsOk.evidence, exit: 3 } } })),
    ).toEqual({ kind: "allow", notes: ["docs_uninitialized"] });
    expect(evaluateIssueGate(facts({ ...base, docsEvidence: docsOk }))).toEqual({ kind: "allow", notes: [] });
  });

  it("docs cũ hơn mốc mở lại thì stale", () => {
    expect(
      evaluateIssueGate(
        facts({
          actor: { kind: "agent", agentId: INTEGRATOR },
          locked: integratorPending,
          patch: integratorApproves,
          approvals: [approval(sReview, REVIEWER, T2)],
          cycleStartedAt: new Date("2026-10-07T10:30:00Z"),
          docsEvidence: docsOk,
        }),
      ),
    ).toMatchObject({ kind: "block", violations: ["docs_stale"] });
  });

  it("stage integrator xác định theo policy đã ghim, không theo vai trò hiện tại", () => {
    expect(
      evaluateIssueGate(
        facts({
          actor: { kind: "agent", agentId: INTEGRATOR },
          roles: { reviewerAgentId: REVIEWER, integratorAgentId: OTHER },
          locked: integratorPending,
          patch: integratorApproves,
          approvals: [approval(sReview, REVIEWER)],
        }),
      ),
    ).toMatchObject({ kind: "block", violations: ["docs_missing"] });
  });

  describe("template gốc 4 stage", () => {
    const integratorP = { type: "agent", agentId: INTEGRATOR, userId: null };
    const atPush = {
      status: "in_review",
      executionPolicy: root4,
      executionState: pending(root4, r4Push, integratorP, [r4Review, r4Integrator, r4Owner]),
      assigneeAgentId: INTEGRATOR,
      assigneeUserId: null,
    };
    const pushWrite = { status: "done", executionState: completed([r4Review, r4Integrator, r4Owner, r4Push]) };
    const stored = [
      approval(r4Review, REVIEWER, T0),
      approval(r4Integrator, INTEGRATOR, T0),
      approval(r4Owner, null, T1, "owner-1"),
    ];
    const base = {
      actor: { kind: "agent" as const, agentId: INTEGRATOR },
      locked: atPush,
      patch: pushWrite,
      approvals: stored,
      docsEvidence: { ...docsOk, createdAt: T0 },
    };
    const push = (createdAt: Date, sha = SHA_HEAD) => ({ sha, branch: "main", createdAt });

    it("integrator hoàn tất stage push với crew-merge mới hơn owner và đúng sha: done", () => {
      expect(evaluateIssueGate(facts({ ...base, pushEvidence: push(T2) }))).toEqual({ kind: "allow", notes: [] });
    });

    it("thiếu, cũ hơn quyết định owner, hoặc lệch sha bằng chứng docs: 422", () => {
      expect(evaluateIssueGate(facts(base))).toMatchObject({ kind: "block", code: "crew_gate_blocked", violations: ["push_missing"] });
      expect(evaluateIssueGate(facts({ ...base, pushEvidence: push(T0) }))).toMatchObject({ violations: ["push_stale"] });
      expect(evaluateIssueGate(facts({ ...base, pushEvidence: push(T2, SHA_BASE) }))).toMatchObject({
        violations: ["push_sha_mismatch"],
      });
    });

    it("stage 2 vẫn cần bằng chứng docs; stage push không đòi docs riêng khi stage 2 chưa xong", () => {
      expect(
        evaluateIssueGate(
          facts({
            actor: { kind: "agent", agentId: INTEGRATOR },
            locked: {
              status: "in_review",
              executionPolicy: root4,
              executionState: pending(root4, r4Integrator, integratorP, [r4Review]),
              assigneeAgentId: INTEGRATOR,
              assigneeUserId: null,
            },
            patch: {
              status: "in_review",
              executionState: { ...pending(root4, r4Owner, { type: "user", agentId: null, userId: "owner-1" }, [r4Review, r4Integrator]), lastDecisionOutcome: "approved" },
            },
            approvals: [approval(r4Review, REVIEWER, T0)],
          }),
        ),
      ).toMatchObject({ kind: "block", violations: ["docs_missing"] });
    });

    it("owner duyệt stage 3 không phải done và không đòi crew-merge", () => {
      expect(
        evaluateIssueGate(
          facts({
            actor: { kind: "board", userId: "owner-1" },
            locked: {
              status: "in_review",
              executionPolicy: root4,
              executionState: pending(root4, r4Owner, { type: "user", agentId: null, userId: "owner-1" }, [r4Review, r4Integrator]),
              assigneeAgentId: null,
              assigneeUserId: "owner-1",
            },
            patch: {
              status: "in_review",
              assigneeAgentId: INTEGRATOR,
              executionState: { ...pending(root4, r4Push, integratorP, [r4Review, r4Integrator, r4Owner]), lastDecisionOutcome: "approved" },
            },
            approvals: [approval(r4Review, REVIEWER, T0), approval(r4Integrator, INTEGRATOR, T0)],
          }),
        ),
      ).toEqual({ kind: "allow", notes: [] });
    });

    it("executor không ký thay được: approval do executor ký và executor tự done đều bị chặn", () => {
      expect(
        evaluateIssueGate(
          facts({
            ...base,
            actor: { kind: "agent", agentId: EXECUTOR },
            approvals: [...stored, approval(r4Push, EXECUTOR, T2)],
            patch: { status: "done" },
            pushEvidence: push(T2),
          }),
        ),
      ).toMatchObject({ kind: "block", violations: [`stage_unapproved:${r4Push}`] });
    });
  });

  it("board ép done khi còn stage chờ: cho qua dưới dạng override", () => {
    const v = evaluateIssueGate(
      facts({ actor: { kind: "board", userId: "owner-1" }, patch: { status: "done", executionState: null } }),
    );
    expect(v.kind).toBe("override");
  });

  it("cấu hình company lỗi: agent không done được", () => {
    expect(evaluateIssueGate(facts({ roles: null, patch: { status: "done" } }))).toMatchObject({
      kind: "block",
      violations: expect.arrayContaining(["roles_unconfigured"]),
    });
  });

  it("issue watchdog/recovery của hệ thống không có policy: agent done được, vẫn không được cancel", () => {
    const housekeeping = {
      status: "in_progress",
      executionPolicy: null,
      executionState: null,
      assigneeAgentId: EXECUTOR,
      assigneeUserId: null,
      housekeeping: true,
    };
    expect(evaluateIssueGate(facts({ locked: housekeeping, patch: { status: "done" } }))).toEqual({ kind: "allow", notes: [] });
    expect(evaluateIssueGate(facts({ locked: housekeeping, patch: { status: "cancelled" } }))).toMatchObject({
      kind: "block",
      violations: ["agent_cancel_forbidden"],
    });
    expect(
      evaluateIssueGate(facts({ locked: { ...housekeeping, executionPolicy: child }, patch: { status: "done" } })),
    ).toMatchObject({ kind: "block" });
  });

  it("issue không có policy: agent không done được", () => {
    expect(
      evaluateIssueGate(
        facts({
          locked: { status: "in_progress", executionPolicy: null, executionState: null, assigneeAgentId: EXECUTOR, assigneeUserId: null },
          patch: { status: "done" },
        }),
      ),
    ).toMatchObject({ kind: "block", violations: ["policy_missing"] });
  });
});
