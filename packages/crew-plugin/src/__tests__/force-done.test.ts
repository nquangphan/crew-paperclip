import { describe, expect, it, vi } from "vitest";
import type { PluginApiRequestInput, PluginContext } from "@paperclipai/plugin-sdk";
import manifest from "../manifest.js";
import { handleIssuesApi } from "../issues/force-done.js";

const CREW = "10000000-0000-4000-8000-00000000000a";
const OTHER = "10000000-0000-4000-8000-00000000000b";
const OWNER = "user-owner-1";
const ISSUE = "60000000-0000-4000-8000-000000000001";
const PARENT = "60000000-0000-4000-8000-000000000002";
const SIBLING = "60000000-0000-4000-8000-000000000003";
const GRANDCHILD = "60000000-0000-4000-8000-000000000004";
const ASSISTANT = "30000000-0000-4000-8000-000000000001";
const REASON = "Đã xong ngoài hệ thống, đóng tay";

type Row = Record<string, unknown> & { id: string; companyId: string; status: string };

const issueRow = (over: Partial<Row> = {}): Row => ({
  id: ISSUE, companyId: CREW, status: "in_review", parentId: null, assigneeAgentId: null, assigneeUserId: null,
  executionState: { status: "pending", currentStageId: "stage-review", currentStageType: "review", completedStageIds: [] },
  ...over,
});

function harness(rows: Row[] = [issueRow()]) {
  const store = new Map(rows.map((row) => [row.id, { ...row }]));
  const update = vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const row = store.get(id)!;
    Object.assign(row, patch, patch.status === "done" ? { executionState: null } : {});
    return { ...row };
  });
  const createComment = vi.fn(async (_id: string, body: string) => ({ id: "c1", body }));
  const requestWakeup = vi.fn(async () => ({ queued: true, runId: "run-1" }));
  const log = vi.fn(async () => undefined);
  const error = vi.fn();
  const warn = vi.fn();
  const ctx = {
    issues: {
      get: vi.fn(async (id: string, companyId: string) => {
        const row = store.get(id);
        return row && row.companyId === companyId ? { ...row } : null;
      }),
      update,
      createComment,
      requestWakeup,
      getSubtree: vi.fn(async (rootId: string, companyId: string, options?: { includeRoot?: boolean }) => {
        const issues = [...store.values()].filter((row) =>
          row.companyId === companyId && (row.id === rootId ? options?.includeRoot !== false : isDescendant(row, rootId)));
        return { rootIssueId: rootId, companyId, issueIds: issues.map((row) => row.id), issues };
      }),
    },
    activity: { log },
    logger: { info: vi.fn(), warn, error, debug: vi.fn() },
  } as unknown as PluginContext;
  function isDescendant(row: Row, rootId: string): boolean {
    let parent = row.parentId as string | null;
    while (parent) {
      if (parent === rootId) return true;
      parent = (store.get(parent)?.parentId as string | null) ?? null;
    }
    return false;
  }
  return { ctx, store, update, createComment, requestWakeup, log, error, warn };
}

function request(over: Partial<PluginApiRequestInput> = {}): PluginApiRequestInput {
  return {
    routeKey: "issues.force-done", method: "POST", path: `/issues/${ISSUE}/force-done`,
    params: { issueId: ISSUE }, query: {}, body: { companyId: CREW, reason: REASON },
    actor: { actorType: "user", actorId: OWNER, userId: OWNER }, companyId: CREW, headers: {},
    ...over,
  };
}

describe("manifest", () => {
  it("khai route ép done chỉ cho board, company lấy từ body, và hai capability mới", () => {
    expect(manifest.apiRoutes).toContainEqual({
      routeKey: "issues.force-done", method: "POST", path: "/issues/:issueId/force-done", auth: "board",
      capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" },
    });
    expect(manifest.capabilities).toEqual(expect.arrayContaining(["issue.comments.create_human_attributed", "issues.wakeup"]));
  });
});

describe("chặn trước khi ghi", () => {
  it("actor là agent → 403, không đọc hay ghi issue", async () => {
    const h = harness();
    const res = await handleIssuesApi(h.ctx, request({ actor: { actorType: "agent", actorId: ASSISTANT, agentId: ASSISTANT } }));
    expect(res.status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.ctx.issues.get).not.toHaveBeenCalled();
  });

  it.each([
    ["9 ký tự", "123456789"],
    ["1001 ký tự", "x".repeat(1001)],
    ["chỉ khoảng trắng", "            "],
    ["có NUL", "Lý do hợp lệ\x00 nhưng có NUL"],
    ["có ESC", "Lý do hợp lệ\x1b[31m đỏ"],
    ["không phải chuỗi", 1234567890123],
    ["thiếu", undefined],
  ])("lý do %s → 400 reason_invalid", async (_label, reason) => {
    const h = harness();
    const res = await handleIssuesApi(h.ctx, request({ body: { companyId: CREW, reason } }));
    expect(res).toEqual({ status: 400, body: { error: "reason_invalid" } });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("lý do 10 ký tự sau trim, có xuống dòng → nhận, lưu bản đã trim", async () => {
    const h = harness();
    const res = await handleIssuesApi(h.ctx, request({ body: { companyId: CREW, reason: "  dòng một\ndòng hai  " } }));
    expect(res.status).toBe(200);
    expect(h.createComment).toHaveBeenCalledWith(ISSUE, "**Ép Done** — dòng một\ndòng hai", CREW, { actorUserId: OWNER });
  });

  it("lý do đúng 1000 ký tự → nhận", async () => {
    const h = harness();
    expect((await handleIssuesApi(h.ctx, request({ body: { companyId: CREW, reason: "y".repeat(1000) } }))).status).toBe(200);
  });

  it.each([
    ["trường lạ", { companyId: CREW, reason: REASON, cancelChildren: true }],
    ["companyId khác company đã phân giải", { companyId: OTHER, reason: REASON }],
    ["body không phải object", [REASON]],
  ])("%s → 400 body_invalid", async (_label, body) => {
    const h = harness();
    expect(await handleIssuesApi(h.ctx, request({ body }))).toEqual({ status: 400, body: { error: "body_invalid" } });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("issue thuộc company khác → 404", async () => {
    const h = harness([issueRow({ companyId: OTHER })]);
    expect(await handleIssuesApi(h.ctx, request())).toEqual({ status: 404, body: { error: "issue_not_found" } });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("issueId không phải uuid → 404, không gọi host", async () => {
    const h = harness();
    const res = await handleIssuesApi(h.ctx, request({ params: { issueId: "abc" } }));
    expect(res).toEqual({ status: 404, body: { error: "issue_not_found" } });
    expect(h.ctx.issues.get).not.toHaveBeenCalled();
  });

  it.each(["done", "cancelled"])("issue %s → 409 issue_terminal", async (status) => {
    const h = harness([issueRow({ status })]);
    expect(await handleIssuesApi(h.ctx, request())).toEqual({ status: 409, body: { error: "issue_terminal", status } });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("routeKey lạ → 404", async () => {
    const h = harness();
    expect((await handleIssuesApi(h.ctx, request({ routeKey: "issues.other" }))).status).toBe(404);
  });
});

describe("ép done thành công", () => {
  it("ghi done một lần với actorUserId, comment đứng tên owner, activity có lý do và stage xuất phát", async () => {
    const h = harness();
    const res = await handleIssuesApi(h.ctx, request());
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledWith(ISSUE, { status: "done" }, CREW, { actorUserId: OWNER });
    expect(h.createComment).toHaveBeenCalledWith(ISSUE, `**Ép Done** — ${REASON}`, CREW, { actorUserId: OWNER });
    expect(h.log).toHaveBeenCalledWith({
      companyId: CREW, message: "crew.issue.force_done", entityType: "issue", entityId: ISSUE,
      metadata: {
        reason: REASON, fromStatus: "in_review", fromStageId: "stage-review", fromStageType: "review",
        violations: [], actorUserId: OWNER,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      issue: expect.objectContaining({ id: ISSUE, status: "done", executionState: null }),
      violations: [], warnings: ["violations_unread"],
    });
  });

  it("issue chưa vào stage → fromStageId/fromStageType null", async () => {
    const h = harness([issueRow({ status: "in_progress", executionState: null })]);
    await handleIssuesApi(h.ctx, request());
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ fromStatus: "in_progress", fromStageId: null, fromStageType: null }),
    }));
  });

  it("update lỗi → 500 update_failed, không comment, không lộ chi tiết", async () => {
    const h = harness();
    h.update.mockRejectedValueOnce(new Error("relation \"issues\" violates something"));
    const res = await handleIssuesApi(h.ctx, request());
    expect(res).toEqual({ status: 500, body: { error: "update_failed" } });
    expect(h.createComment).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
    expect(h.error).toHaveBeenCalled();
  });

  it("comment, activity lỗi → vẫn 200 kèm warnings", async () => {
    const h = harness();
    h.createComment.mockRejectedValueOnce(new Error("not a member"));
    h.log.mockRejectedValueOnce(new Error("db down"));
    const res = await handleIssuesApi(h.ctx, request());
    expect(res.status).toBe(200);
    expect((res.body as { warnings: string[] }).warnings).toEqual(["violations_unread", "comment_failed", "activity_failed"]);
  });
});

describe("báo Trợ Lý ở issue cha", () => {
  const parent = (over: Partial<Row> = {}) => issueRow({
    id: PARENT, status: "in_progress", assigneeAgentId: ASSISTANT, executionState: null, ...over,
  });
  const child = (over: Partial<Row> = {}) => issueRow({ parentId: PARENT, ...over });

  it("con cuối cùng (các con khác đã done/cancelled) → đánh thức cha đúng một lần", async () => {
    const h = harness([parent(), child(), issueRow({ id: SIBLING, parentId: PARENT, status: "cancelled" })]);
    const res = await handleIssuesApi(h.ctx, request());
    expect(h.requestWakeup).toHaveBeenCalledTimes(1);
    expect(h.requestWakeup).toHaveBeenCalledWith(PARENT, CREW, expect.objectContaining({
      reason: "issue_children_completed", idempotencyKey: `force-done:${ISSUE}`, actorUserId: OWNER,
    }));
    expect((res.body as { warnings: string[] }).warnings).toEqual(["violations_unread"]);
  });

  it("còn con khác đang mở → không đánh thức", async () => {
    const h = harness([parent(), child(), issueRow({ id: SIBLING, parentId: PARENT, status: "todo" })]);
    await handleIssuesApi(h.ctx, request());
    expect(h.requestWakeup).not.toHaveBeenCalled();
  });

  it("cháu đang mở không tính là con của cha", async () => {
    const h = harness([
      parent(), child(), issueRow({ id: SIBLING, parentId: PARENT, status: "done" }),
      issueRow({ id: GRANDCHILD, parentId: SIBLING, status: "todo" }),
    ]);
    await handleIssuesApi(h.ctx, request());
    expect(h.requestWakeup).toHaveBeenCalledTimes(1);
  });

  it("cha giao cho user → không đánh thức", async () => {
    const h = harness([parent({ assigneeAgentId: null, assigneeUserId: OWNER }), child()]);
    await handleIssuesApi(h.ctx, request());
    expect(h.requestWakeup).not.toHaveBeenCalled();
  });

  it.each(["done", "cancelled", "backlog"])("cha %s → không đánh thức", async (status) => {
    const h = harness([parent({ status }), child()]);
    await handleIssuesApi(h.ctx, request());
    expect(h.requestWakeup).not.toHaveBeenCalled();
  });

  it("issue gốc (không cha) → không đánh thức ai", async () => {
    const h = harness();
    await handleIssuesApi(h.ctx, request());
    expect(h.requestWakeup).not.toHaveBeenCalled();
    expect(h.ctx.issues.getSubtree).not.toHaveBeenCalled();
  });

  it("wakeup lỗi → 200 kèm wakeup_failed", async () => {
    const h = harness([parent(), child()]);
    h.requestWakeup.mockRejectedValueOnce(new Error("Issue is blocked by unresolved blockers"));
    const res = await handleIssuesApi(h.ctx, request());
    expect(res.status).toBe(200);
    expect((res.body as { warnings: string[] }).warnings).toEqual(["violations_unread", "wakeup_failed"]);
  });

  it("đọc con của cha lỗi → 200 kèm wakeup_failed", async () => {
    const h = harness([parent(), child()]);
    vi.mocked(h.ctx.issues.getSubtree).mockRejectedValueOnce(new Error("boom"));
    const res = await handleIssuesApi(h.ctx, request());
    expect((res.body as { warnings: string[] }).warnings).toEqual(["violations_unread", "wakeup_failed"]);
    expect(h.requestWakeup).not.toHaveBeenCalled();
  });
});
