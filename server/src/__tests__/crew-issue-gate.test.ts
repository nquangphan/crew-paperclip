import { describe, expect, it } from "vitest";
import { evaluateIssueGate, type IssueGateFacts } from "../crew/issue-gate.ts";
import {
  buildCrewPolicy,
  CREW_MAX_REVIEW_ROUNDS,
  parseDocsCheckEvidence,
  pickCrewRoles,
  policyGateFingerprint,
} from "../crew/issue-policy.ts";

const REVIEWER = "11111111-1111-4111-8111-111111111111";
const INTEGRATOR = "22222222-2222-4222-8222-222222222222";
const EXECUTOR = "33333333-3333-4333-8333-333333333333";
const roles = { reviewerAgentId: REVIEWER, integratorAgentId: INTEGRATOR };
const SHA_BASE = "a".repeat(40);
const SHA_HEAD = "b".repeat(40);

describe("pickCrewRoles", () => {
  it("cần đúng một agent không terminated cho mỗi vai trò", () => {
    const rows = [
      { id: REVIEWER, status: "idle", metadata: { crewRole: "reviewer" } },
      { id: INTEGRATOR, status: "idle", metadata: { crewRole: "integrator" } },
      { id: EXECUTOR, status: "idle", metadata: null },
    ];
    expect(pickCrewRoles(rows)).toEqual(roles);
    expect(pickCrewRoles([...rows, { id: EXECUTOR, status: "idle", metadata: { crewRole: "reviewer" } }])).toBeNull();
    expect(pickCrewRoles([rows[0]!, { ...rows[1]!, status: "terminated" }])).toBeNull();
  });
});

describe("buildCrewPolicy", () => {
  it("issue con chỉ có stage reviewer, 5 vòng", () => {
    const policy = buildCrewPolicy("child", roles);
    expect(policy.maxReviewRounds).toBe(CREW_MAX_REVIEW_ROUNDS);
    expect(policy.stages.map((s) => [s.type, s.participants.map((p) => p.agentId ?? p.userId)])).toEqual([
      ["review", [REVIEWER]],
    ]);
    expect(policy.stages[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("issue gốc có reviewer, integrator rồi owner", () => {
    const policy = buildCrewPolicy("root", roles, "owner-1");
    expect(policy.stages.map((s) => [s.type, s.participants.map((p) => p.agentId ?? p.userId)])).toEqual([
      ["review", [REVIEWER]],
      ["review", [INTEGRATOR]],
      ["approval", ["owner-1"]],
    ]);
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
const root = buildCrewPolicy("root", roles, "owner-1");
const [sReview, sIntegrator, sOwner] = root.stages.map((s) => s.id) as [string, string, string];
const executorPrincipal = { type: "agent", agentId: EXECUTOR, userId: null };

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
const docsOk = {
  evidence: { commit: SHA_HEAD, base: SHA_BASE, head: SHA_HEAD, exit: 0 as const },
  createdAt: new Date("2026-10-07T10:00:00Z"),
};
function facts(over: Partial<IssueGateFacts>): IssueGateFacts {
  return {
    locked: {
      status: "in_review",
      executionPolicy: root,
      executionState: pending(root, sReview, { type: "agent", agentId: REVIEWER, userId: null }),
    },
    patch: {},
    actor: { kind: "agent", agentId: EXECUTOR },
    roles,
    approvals: [],
    lastChangesRequestedAt: null,
    docsEvidence: null,
    ...over,
  };
}

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

  it("agent không được chuyển issue sang cancelled; board và hệ thống thì được", () => {
    expect(evaluateIssueGate(facts({ patch: { status: "cancelled" } }))).toEqual({
      kind: "block",
      code: "crew_gate_blocked",
      violations: ["agent_cancel_forbidden"],
    });
    expect(
      evaluateIssueGate(
        facts({
          locked: { status: "in_progress", executionPolicy: null, executionState: null },
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
          locked: { status: "cancelled", executionPolicy: root, executionState: null },
          patch: { status: "cancelled" },
        }),
      ),
    ).toEqual({ kind: "allow", notes: [] });
  });

  it("auto-skip: stage hoàn tất mà không có decision thì không tính", () => {
    const v = evaluateIssueGate(
      facts({
        locked: { status: "in_progress", executionPolicy: child, executionState: null },
        patch: { status: "done", executionState: completed([child.stages[0]!.id]) },
      }),
    );
    expect(v).toMatchObject({ kind: "block" });
  });

  it("decision duy nhất do executor ký thì không tính", () => {
    const v = evaluateIssueGate(
      facts({
        locked: { status: "in_review", executionPolicy: child, executionState: completed([child.stages[0]!.id]) },
        patch: { status: "done" },
        approvals: [{ stageId: child.stages[0]!.id, actorAgentId: EXECUTOR, actorUserId: null }],
      }),
    );
    expect(v).toMatchObject({ kind: "block" });
  });

  it("owner duyệt stage cuối trong chính request này: cho qua khi các stage trước có decision và docs đạt", () => {
    const v = evaluateIssueGate(
      facts({
        actor: { kind: "board", userId: "owner-1" },
        locked: {
          status: "in_review",
          executionPolicy: root,
          executionState: pending(root, sOwner, { type: "user", agentId: null, userId: "owner-1" }, [
            sReview,
            sIntegrator,
          ]),
        },
        patch: { status: "done", executionState: completed([sReview, sIntegrator, sOwner]) },
        approvals: [
          { stageId: sReview, actorAgentId: REVIEWER, actorUserId: null },
          { stageId: sIntegrator, actorAgentId: INTEGRATOR, actorUserId: null },
        ],
        docsEvidence: docsOk,
      }),
    );
    expect(v).toEqual({ kind: "allow", notes: [] });
  });

  it("integrator hoàn tất stage của mình: thiếu docs, docs lỗi, docs cũ thì chặn; exit 3 cho qua kèm ghi chú", () => {
    const base = {
      actor: { kind: "agent" as const, agentId: INTEGRATOR },
      locked: {
        status: "in_review",
        executionPolicy: root,
        executionState: pending(root, sIntegrator, { type: "agent", agentId: INTEGRATOR, userId: null }, [sReview]),
      },
      patch: {
        status: "in_review",
        executionState: {
          ...pending(root, sOwner, { type: "user", agentId: null, userId: "owner-1" }, [sReview, sIntegrator]),
          lastDecisionOutcome: "approved",
        },
      },
      approvals: [{ stageId: sReview, actorAgentId: REVIEWER, actorUserId: null }],
    };
    expect(evaluateIssueGate(facts(base))).toMatchObject({ kind: "block", violations: ["docs_missing"] });
    expect(
      evaluateIssueGate(facts({ ...base, docsEvidence: { ...docsOk, evidence: { ...docsOk.evidence, exit: 1 } } })),
    ).toMatchObject({ kind: "block", violations: ["docs_failed:1"] });
    expect(
      evaluateIssueGate(
        facts({ ...base, docsEvidence: docsOk, lastChangesRequestedAt: new Date("2026-10-07T11:00:00Z") }),
      ),
    ).toMatchObject({ kind: "block", violations: ["docs_stale"] });
    expect(
      evaluateIssueGate(facts({ ...base, docsEvidence: { ...docsOk, evidence: { ...docsOk.evidence, exit: 3 } } })),
    ).toEqual({ kind: "allow", notes: ["docs_uninitialized"] });
    expect(evaluateIssueGate(facts({ ...base, docsEvidence: docsOk }))).toEqual({ kind: "allow", notes: [] });
  });

  it("board ép done khi còn stage chờ: cho qua dưới dạng override", () => {
    const v = evaluateIssueGate(
      facts({ actor: { kind: "board", userId: "owner-1" }, patch: { status: "done", executionState: null } }),
    );
    expect(v.kind).toBe("override");
  });

  it("company chưa cấu hình vai trò: agent không done được", () => {
    expect(evaluateIssueGate(facts({ roles: null, patch: { status: "done" } }))).toMatchObject({
      kind: "block",
      violations: expect.arrayContaining(["roles_unconfigured"]),
    });
  });

  it("issue không có policy: agent không done được", () => {
    expect(
      evaluateIssueGate(
        facts({
          locked: { status: "in_progress", executionPolicy: null, executionState: null },
          patch: { status: "done" },
        }),
      ),
    ).toMatchObject({ kind: "block", violations: ["policy_missing"] });
  });
});
