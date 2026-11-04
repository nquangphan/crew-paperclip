import { describe, expect, it } from "vitest";
import { crewNodeKind } from "../handlers/map.js";
import { crewPolicyKind, docsStageAgents } from "../shared/policy.js";

const REVIEWER = "20000000-0000-4000-8000-000000000001";
const INTEGRATOR = "20000000-0000-4000-8000-000000000002";
const OWNER = "50000000-0000-4000-8000-000000000001";

const review = (agentId: string) => ({ type: "review", participants: [{ type: "agent", agentId }] });
const approval = (userId: string) => ({ type: "approval", participants: [{ type: "user", userId }] });
const policy = (stages: unknown[], maxReviewRounds = 5) => ({ maxReviewRounds, stages });

/** Template server `buildCrewPolicy`: gốc, gốc Bug Finding, research. */
const root = policy([review(REVIEWER), review(INTEGRATOR), approval(OWNER), review(INTEGRATOR)]);
const rootBf = policy([review(INTEGRATOR), review(REVIEWER), approval(OWNER), review(INTEGRATOR)]);
const research = policy([review(REVIEWER), approval(OWNER)]);

describe("crewPolicyKind", () => {
  it("crewPolicyKind nhận cả code cũ và code-bf", () => {
    expect(crewPolicyKind(root)).toBe("code");
    expect(crewPolicyKind(rootBf)).toBe("code-bf");
    expect(crewPolicyKind(research)).toBe("research");
  });

  it("một agent ở mọi stage review vẫn là code như trước", () => {
    expect(crewPolicyKind(policy([review(REVIEWER), review(REVIEWER), approval(OWNER), review(REVIEWER)]))).toBe("code");
  });

  it("code-bf cần stage 2 là approval user và stage 0, 3 cùng agent", () => {
    expect(crewPolicyKind(policy([review(INTEGRATOR), review(REVIEWER), review(OWNER), review(INTEGRATOR)]))).toBeNull();
    expect(crewPolicyKind(policy([review(INTEGRATOR), review(REVIEWER), approval(OWNER), review(OWNER)]))).toBeNull();
    expect(crewPolicyKind(policy([review(INTEGRATOR), approval(OWNER), approval(OWNER), review(INTEGRATOR)]))).toBeNull();
    expect(crewPolicyKind(policy(rootBf.stages, 3))).toBeNull();
  });
});

describe("docsStageAgents", () => {
  it("stage docs là integrator: stage 1 của code, stage 0 của code-bf; research không có", () => {
    expect(docsStageAgents(root)).toEqual([INTEGRATOR]);
    expect(docsStageAgents(rootBf)).toEqual([INTEGRATOR]);
    expect(docsStageAgents(research)).toEqual([]);
  });
});

describe("crewNodeKind", () => {
  it("node của bản đồ: fix trước, research, code-bf giữ riêng để giao diện đặt đúng tên giai đoạn, còn lại code", () => {
    expect(crewNodeKind("crew-fix base=" + "a".repeat(40), rootBf)).toBe("fix");
    expect(crewNodeKind(null, research)).toBe("research");
    expect(crewNodeKind(null, rootBf)).toBe("code-bf");
    expect(crewNodeKind(null, root)).toBe("code");
    expect(crewNodeKind(null, policy([review(REVIEWER)]))).toBe("code");
  });
});
