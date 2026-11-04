import { describe, expect, it } from "vitest";
import type { BugFindingRun } from "../bug-finding/runs.js";
import { attachTriage, parseTriage, triageAuthor } from "../bug-finding/triage.js";

const ASSISTANT = "30000000-0000-4000-8000-000000000001";
const OTHER = "30000000-0000-4000-8000-000000000002";
const HEAD = "a".repeat(40);

function run(over: Partial<BugFindingRun>): BugFindingRun {
  return {
    id: "r", companyId: "c", issueId: "i", approvalRound: 0, run: 1, requestId: "q", machineJobId: null, machineId: null,
    headSha: HEAD, prUrl: "https://github.com/o/r/pull/87", state: "succeeded", verdict: "BLOCK", lanesDone: 7, lanesTotal: 7,
    findings: [], feedbackText: null, reportDocumentKey: null, costUsd: null, error: null,
    createdAt: "2026-11-04T01:00:00.000Z", startedAt: "2026-11-04T01:01:00.000Z", finishedAt: "2026-11-04T01:30:00.000Z",
    ...over,
  };
}

const TRIAGE = "crew-bf-triage run=1 batch=bf-fix-1 fix=F-01,F-02 ask=F-04 dismiss=F-05\nF-05: có từ trước PR, ngoài phạm vi (src/a.ts:3)\nF-04: quy tắc sản phẩm";

describe("parseTriage", () => {
  it("đọc dòng đầu và lý do từng finding", () => {
    expect(parseTriage(TRIAGE)).toEqual({
      run: 1, batch: 1, fix: ["F-01", "F-02"], ask: ["F-04"], dismiss: ["F-05"],
      reasons: { "F-05": "có từ trước PR, ngoài phạm vi (src/a.ts:3)", "F-04": "quy tắc sản phẩm" },
    });
  });

  it("nhóm rỗng ghi `-`; dòng đầu sai dạng thì không nhận", () => {
    expect(parseTriage("crew-bf-triage run=2 batch=bf-fix-3 fix=- ask=F-01 dismiss=-")).toMatchObject({ fix: [], ask: ["F-01"], dismiss: [] });
    expect(parseTriage("Trợ Lý: crew-bf-triage run=1 batch=bf-fix-1 fix=F-01 ask=- dismiss=-")).toBeNull();
    expect(parseTriage("crew-bf-triage run=0 batch=bf-fix-1 fix=F-01 ask=- dismiss=-")).toBeNull();
  });
});

describe("triageAuthor", () => {
  it("Trợ Lý là returnAssignee khi đang review, là assignee khi ticket về tay Trợ Lý", () => {
    const roles = { integratorId: "int", reviewerId: "rev" };
    expect(triageAuthor({ executionState: { returnAssignee: { type: "agent", agentId: ASSISTANT } }, assigneeAgentId: "rev" }, roles)).toBe(ASSISTANT);
    expect(triageAuthor({ executionState: null, assigneeAgentId: ASSISTANT }, roles)).toBe(ASSISTANT);
    expect(triageAuthor({ executionState: null, assigneeAgentId: "rev" }, roles)).toBeNull();
  });
});

describe("attachTriage", () => {
  const first = run({});
  const second = run({ id: "r2", run: 2, requestId: "q2", headSha: "b".repeat(40), state: "running", createdAt: "2026-11-04T03:00:00.000Z", finishedAt: null });

  it("ghép triage của Trợ Lý viết sau lượt xong và trước lượt kế; bỏ comment của người khác", () => {
    const comments = [
      { authorAgentId: OTHER, body: "crew-bf-triage run=1 batch=bf-fix-9 fix=F-09 ask=- dismiss=-", createdAt: "2026-11-04T01:40:00.000Z" },
      { authorAgentId: ASSISTANT, body: TRIAGE, createdAt: "2026-11-04T01:35:00.000Z" },
      { authorAgentId: ASSISTANT, body: "crew-bf-triage run=1 batch=bf-fix-1 fix=F-01 ask=- dismiss=-", createdAt: "2026-11-04T00:50:00.000Z" },
    ];
    const children = [
      { id: "c1", identifier: "TPS-651", status: "done", description: "crew-fix base=x\ncrew-bf finding=F-01 run=1", createdAt: "2026-11-04T01:36:00.000Z" },
      { id: "c2", identifier: "TPS-652", status: "in_review", description: "crew-bf finding=F-02,F-03 run=1", createdAt: "2026-11-04T01:37:00.000Z" },
      { id: "c3", identifier: "TPS-660", status: "todo", description: "crew-bf finding=F-01 run=1", createdAt: "2026-11-04T03:10:00.000Z" },
      { id: "c4", identifier: "TPS-640", status: "done", description: "việc chính", createdAt: "2026-11-04T00:10:00.000Z" },
    ];
    const [withSecond, withFirst] = attachTriage([second, first], comments, ASSISTANT, children);
    expect(withSecond?.triage).toBeNull();
    expect(withFirst?.triage).toMatchObject({ run: 1, batch: 1, fix: ["F-01", "F-02"], createdAt: "2026-11-04T01:35:00.000Z" });
    expect(withFirst?.triage?.fixIssues).toEqual({
      "F-01": [{ id: "c1", identifier: "TPS-651", status: "done" }],
      "F-02": [{ id: "c2", identifier: "TPS-652", status: "in_review" }],
      "F-03": [{ id: "c2", identifier: "TPS-652", status: "in_review" }],
    });
  });

  it("không biết Trợ Lý thì không ghép triage nào", () => {
    const [only] = attachTriage([first], [{ authorAgentId: ASSISTANT, body: TRIAGE, createdAt: "2026-11-04T01:35:00.000Z" }], null, []);
    expect(only?.triage).toBeNull();
  });
});
