import type { Issue, PluginApiRequestInput, PluginApiResponse, PluginContext } from "@paperclipai/plugin-sdk";
import { sanitizeJobError } from "../jobs/sanitize.js";
import { unknownKeyError } from "../jobs/validate.js";
import { UUID } from "../shared/db.js";
import { bridgeStage, bugFindingRoles, enqueueBugFinding, latestCrewPr } from "./enqueue.js";
import { attachTriage, triageAuthor } from "./triage.js";
import {
  announceRun, approvalRound, BROKEN_RUN_STATES, type BugFindingFinding, type BugFindingRun, type BugFindingRunState,
  type BugFindingVerdict, batchesUsed, cut, errText, FINDING_KEYS, getRunByRequest, listRuns, MAX_BATCHES, runsTable, VERDICTS,
} from "./runs.js";

type Ctx = Pick<PluginContext, "db" | "issues" | "logger">;
const ROUTE_KEYS = ["bug-finding.request", "bug-finding.results", "bug-finding.get", "bug-finding.skip"];
const ERROR = "Không đọc/ghi được lượt Bug Finding";
/** Báo cáo `.md` tối đa 2 MB (2P Crew đã cắt trước khi gửi). */
export const REPORT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_FINDINGS = 500;
const FIELD_MAX = 4000;
const REPORTED_STATES: readonly BugFindingRunState[] = ["queued", "running", "succeeded", "failed", "cancelled"];
const FINAL_STATES: readonly BugFindingRunState[] = ["succeeded", "failed", "cancelled"];
const HEAD = /^[0-9a-f]{40}$/;

const fail = (status: number, error: string): PluginApiResponse => ({ status, body: { error } });
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const count = (value: unknown) => value === undefined || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10_000);

/**
 * Route của lượt Bug Finding cho ticket tổng `code-bf` (flow `bug-finding`):
 * - `POST /bug-finding/request` (agent reviewer của stage cầu nối): xếp lượt cho head PR hiện tại, xếp lại khi lượt của head
 *   đó hỏng; cùng vòng + head thì trả lượt đã có;
 * - `POST /bug-finding/results` (board key của máy được giao): tiến độ và kết quả từ 2P Crew;
 * - `GET /issues/:issueId/bug-finding`: mọi lượt, số lô sửa đã dùng trong vòng, head PR hiện tại;
 * - `POST /bug-finding/skip` (agent reviewer): owner đã chấp nhận thẻ xác nhận bỏ qua thì đổi lượt hỏng của head hiện tại
 *   thành `skipped`, để gate stage cầu nối cho qua.
 * Lỗi DB trả câu cố định, chi tiết vào log.
 */
export async function handleBugFindingApi(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  if (!ROUTE_KEYS.includes(input.routeKey)) return fail(404, "Route không tồn tại");
  if (!uuid(input.companyId)) return fail(400, "companyId phải là uuid");
  try {
    switch (input.routeKey) {
      case "bug-finding.request": return await requestRoute(ctx, input);
      case "bug-finding.results": return await resultsRoute(ctx, input);
      case "bug-finding.get": return await getRoute(ctx, input);
      default: return await skipRoute(ctx, input);
    }
  } catch (error) {
    ctx.logger.error("crew bug finding request failed", { routeKey: input.routeKey, companyId: input.companyId, err: errText(error) });
    return fail(500, ERROR);
  }
}

/** Issue của body `{issueId}` mà agent reviewer của stage cầu nối gọi; hoặc response lỗi. */
async function reviewerIssue(ctx: Ctx, input: PluginApiRequestInput): Promise<{ issue: Issue } | PluginApiResponse> {
  if (input.actor.actorType !== "agent" || !input.actor.agentId) return fail(403, "agent_only");
  if (!isObject(input.body)) return fail(400, "body phải là object");
  const unknown = unknownKeyError(input.body, ["issueId", "companyId"]);
  if (unknown) return fail(400, unknown);
  if (!uuid(input.body.issueId)) return fail(400, "issueId phải là uuid");
  const issue = await ctx.issues.get(input.body.issueId.toLowerCase(), input.companyId);
  if (!issue || issue.companyId !== input.companyId) return fail(404, "issue_not_found");
  const roles = bugFindingRoles(issue);
  if (!roles) return fail(409, "not_bug_finding_root");
  if (input.actor.agentId !== roles.reviewerId) return fail(403, "reviewer_only");
  if (!bridgeStage(issue)) return fail(409, "not_at_bridge_stage");
  return { issue };
}

async function requestRoute(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  const checked = await reviewerIssue(ctx, input);
  if (!("issue" in checked)) return checked;
  const outcome = await enqueueBugFinding(ctx, checked.issue, { retry: true });
  if (!outcome.run) return fail(409, outcome.reason);
  return { status: outcome.created ? 201 : 200, body: { run: outcome.run } };
}

async function getRoute(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  const issueId = input.params.issueId;
  if (!uuid(issueId)) return fail(404, "issue_not_found");
  const issue = await ctx.issues.get(issueId.toLowerCase(), input.companyId);
  if (!issue || issue.companyId !== input.companyId) return fail(404, "issue_not_found");
  const roles = bugFindingRoles(issue);
  const [runs, round] = await Promise.all([listRuns(ctx, input.companyId, issue.id), approvalRound(ctx, input.companyId, issue.id)]);
  const comments = roles ? await ctx.issues.listComments(issue.id, input.companyId) : [];
  const currentHead = roles ? latestCrewPr(comments, roles.integratorId)?.sha ?? null : null;
  // Kế hoạch của Trợ Lý (`crew-bf-triage`) và việc con sửa của lô: web chia finding của lượt thành ba nhóm.
  const children = roles && runs.some((run) => run.state === "succeeded") ? await childIssues(ctx, input.companyId, issue.id) : [];
  const withTriage = attachTriage(runs, comments, roles ? triageAuthor(issue, roles) : null, children);
  return {
    status: 200,
    body: { runs: withTriage, batchesUsed: batchesUsed(runs, round), maxBatches: MAX_BATCHES, currentHead, approvalRound: round },
  };
}

async function childIssues(ctx: Ctx, companyId: string, issueId: string) {
  const rows = await ctx.db.query<{ id: string; identifier: string | null; status: string; description: string | null; created_at: string | Date }>(
    `SELECT id::text AS id, identifier, status, description, created_at FROM public.issues WHERE company_id = $1 AND parent_id = $2`,
    [companyId, issueId]);
  return rows.map((row) => ({ id: row.id, identifier: row.identifier, status: row.status, description: row.description, createdAt: row.created_at }));
}

async function skipRoute(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  const checked = await reviewerIssue(ctx, input);
  if (!("issue" in checked)) return checked;
  const { issue } = checked;
  const roles = bugFindingRoles(issue)!;
  const head = latestCrewPr(await ctx.issues.listComments(issue.id, issue.companyId), roles.integratorId)?.sha;
  if (!head) return fail(409, "pr_missing");
  const round = await approvalRound(ctx, issue.companyId, issue.id);
  const target = (await listRuns(ctx, issue.companyId, issue.id)).find((run) => run.approvalRound === round && run.headSha === head);
  if (!target || !BROKEN_RUN_STATES.includes(target.state)) return fail(409, "no_broken_run");
  // Thẻ `request_confirmation` của reviewer (khóa `crew-bf-skip:<issueId>:…`) mà owner của stage duyệt đã chấp nhận sau lượt hỏng.
  const confirmed = (await ctx.issues.listInteractions(issue.id, issue.companyId)).some((card) =>
    card.kind === "request_confirmation" && card.status === "accepted"
    && typeof card.idempotencyKey === "string" && card.idempotencyKey.startsWith(`crew-bf-skip:${issue.id}`)
    && !!roles.ownerUserId && card.resolvedByUserId === roles.ownerUserId
    && !!card.resolvedAt && new Date(card.resolvedAt).getTime() >= new Date(target.createdAt).getTime());
  if (!confirmed) return fail(409, "skip_not_confirmed");
  const { rowCount } = await ctx.db.execute(`UPDATE ${runsTable(ctx)} SET state = 'skipped', updated_at = now()
    WHERE company_id = $1 AND request_id = $2 AND state = $3`, [issue.companyId, target.requestId, target.state]);
  if (rowCount !== 1) return fail(409, "no_broken_run");
  const run = (await getRunByRequest(ctx, issue.companyId, target.requestId))!;
  ctx.logger.info("crew bug finding skipped", { issueId: issue.id, requestId: run.requestId, ownerUserId: roles.ownerUserId });
  await announceRun(ctx, issue, run, {
    wake: false, note: `Owner cho bỏ qua Bug Finding cho head PR ${run.headSha.slice(0, 12)} (lượt ${run.run} ${target.state}).`,
  });
  return { status: 200, body: { run } };
}

type Report = {
  machineId: string; requestId: string; state: BugFindingRunState; headSha: string; lanesDone?: number; lanesTotal?: number;
  verdict?: BugFindingVerdict; costUsd?: number; error?: string; findings?: BugFindingFinding[]; reportMarkdown?: string;
};

const text = (value: unknown, max = FIELD_MAX): string | null =>
  typeof value === "string" ? cut(value.replace(/\u0000/g, ""), max) : null;

/** Finding chỉ giữ đúng 12 trường; trường bắt buộc (`id`, `title`, `severity`, `status`) phải là chuỗi. */
function parseFinding(value: unknown): BugFindingFinding | null {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.title !== "string"
    || typeof value.severity !== "string" || typeof value.status !== "string") return null;
  return Object.fromEntries(FINDING_KEYS.map((key) => [key, text(value[key])])) as unknown as BugFindingFinding;
}

function parseReport(body: unknown, companyId: string): Report | string {
  if (!isObject(body)) return "body phải là object";
  const unknown = unknownKeyError(body, ["companyId", "machineId", "requestId", "state", "round", "headSha", "lanesDone", "lanesTotal",
    "verdict", "costUsd", "error", "findings", "reportMarkdown"]);
  if (unknown) return unknown;
  if (typeof body.companyId !== "string" || body.companyId.toLowerCase() !== companyId.toLowerCase()) return "companyId không hợp lệ";
  if (!uuid(body.machineId)) return "machineId phải là uuid";
  if (!uuid(body.requestId)) return "requestId phải là uuid";
  if (!REPORTED_STATES.includes(body.state as BugFindingRunState)) return "state không hợp lệ";
  if (typeof body.headSha !== "string" || !HEAD.test(body.headSha)) return "headSha phải là 40 ký tự hex";
  if (body.round !== undefined && !(Number.isInteger(body.round) && (body.round as number) >= 0)) return "round phải là số nguyên không âm";
  if (!count(body.lanesDone) || !count(body.lanesTotal)) return "lanesDone/lanesTotal phải là số nguyên không âm";
  if (body.verdict !== undefined && !VERDICTS.includes(body.verdict as BugFindingVerdict)) return "verdict không hợp lệ";
  if (body.costUsd !== undefined && !(typeof body.costUsd === "number" && Number.isFinite(body.costUsd) && body.costUsd >= 0 && body.costUsd < 1e6)) {
    return "costUsd không hợp lệ";
  }
  if (body.error !== undefined && typeof body.error !== "string") return "error phải là chuỗi";
  if (body.reportMarkdown !== undefined && (typeof body.reportMarkdown !== "string" || Buffer.byteLength(body.reportMarkdown) > REPORT_MAX_BYTES)) {
    return "reportMarkdown phải là chuỗi tối đa 2 MB";
  }
  let findings: BugFindingFinding[] | undefined;
  if (body.findings !== undefined) {
    if (!Array.isArray(body.findings) || body.findings.length > MAX_FINDINGS) return `findings phải là mảng tối đa ${MAX_FINDINGS} phần tử`;
    findings = [];
    for (const item of body.findings) {
      const finding = parseFinding(item);
      if (!finding) return "finding thiếu id, title, severity hoặc status";
      findings.push(finding);
    }
  }
  if (body.state === "succeeded" && (body.verdict === undefined || findings === undefined)) return "succeeded cần verdict và findings";
  return {
    machineId: body.machineId.toLowerCase(), requestId: body.requestId.toLowerCase(), state: body.state as BugFindingRunState,
    headSha: body.headSha, lanesDone: body.lanesDone as number | undefined, lanesTotal: body.lanesTotal as number | undefined,
    verdict: body.verdict as BugFindingVerdict | undefined, costUsd: body.costUsd as number | undefined,
    error: typeof body.error === "string" ? body.error : undefined, findings, reportMarkdown: body.reportMarkdown as string | undefined,
  };
}

/**
 * Tiến độ và kết quả từ 2P Crew. Chỉ máy được giao gửi được (403), head phải khớp lượt (422 `head_mismatch`), lượt đã kết thúc
 * thì không ghi lại (409). Kết quả cuối: lưu, ghi báo cáo `.md` thành document của ticket tổng, comment hệ thống, đánh
 * thức reviewer.
 */
async function resultsRoute(ctx: Ctx, input: PluginApiRequestInput): Promise<PluginApiResponse> {
  if (input.actor.actorType !== "user") return fail(403, "board_only");
  const report = parseReport(input.body, input.companyId);
  if (typeof report === "string") return fail(400, report);
  const companyId = input.companyId.toLowerCase();
  const run = await getRunByRequest(ctx, companyId, report.requestId);
  if (!run) return fail(404, "run_not_found");
  if (run.machineId !== report.machineId) return fail(403, "machine_mismatch");
  if (run.headSha !== report.headSha) return fail(422, "head_mismatch");
  if (!["requested", "queued", "running"].includes(run.state)) return fail(409, "run_finished");

  const final = FINAL_STATES.includes(report.state);
  const error = report.error === undefined ? null : sanitizeJobError(report.error);
  const { rowCount } = await ctx.db.execute(`UPDATE ${runsTable(ctx)} SET state = $4,
      lanes_done = COALESCE($5::int, lanes_done), lanes_total = COALESCE($6::int, lanes_total),
      verdict = COALESCE($7::text, verdict), cost_usd = COALESCE($8::numeric, cost_usd), error = COALESCE($9::text, error),
      findings = COALESCE($10::text::jsonb, findings),
      started_at = CASE WHEN $4 IN ('running','succeeded') THEN COALESCE(started_at, now()) ELSE started_at END,
      finished_at = CASE WHEN $11::boolean THEN now() ELSE finished_at END, updated_at = now()
    WHERE company_id = $1 AND request_id = $2 AND state = $3`,
  [companyId, run.requestId, run.state, report.state, report.lanesDone ?? null, report.lanesTotal ?? null, report.verdict ?? null,
    report.costUsd ?? null, error === "" ? null : error, report.findings ? JSON.stringify(report.findings) : null, final]);
  if (rowCount !== 1) return fail(409, "run_changed");
  if (final) await finishRun(ctx, companyId, (await getRunByRequest(ctx, companyId, run.requestId))!, report.reportMarkdown);
  return { status: 200, body: { run: await getRunByRequest(ctx, companyId, run.requestId) } };
}

async function finishRun(ctx: Ctx, companyId: string, run: BugFindingRun, reportMarkdown: string | undefined): Promise<void> {
  const issue = await ctx.issues.get(run.issueId, companyId);
  if (!issue) return;
  if (reportMarkdown) {
    // Báo cáo thành document của issue (một key cho mỗi vòng + lượt): agent đọc qua API documents, web hiện trong issue.
    const key = `bug-finding-round-${run.approvalRound}-run-${run.run}`;
    try {
      await ctx.issues.documents.upsert({
        issueId: issue.id, companyId, key, title: `Bug Finding ${issue.identifier ?? issue.id} lượt ${run.run} (${run.verdict ?? run.state})`,
        format: "markdown", body: reportMarkdown, changeSummary: `Bug Finding lượt ${run.run}, head ${run.headSha.slice(0, 12)}`,
      });
      await ctx.db.execute(`UPDATE ${runsTable(ctx)} SET report_document_key = $3, updated_at = now() WHERE company_id = $1 AND request_id = $2`,
        [companyId, run.requestId, key]);
    } catch (error) {
      ctx.logger.warn("crew bug finding report document failed", { issueId: issue.id, requestId: run.requestId, err: errText(error) });
    }
  }
  const saved = await getRunByRequest(ctx, companyId, run.requestId);
  ctx.logger.info("crew bug finding run ended", { issueId: issue.id, requestId: run.requestId, state: saved?.state, verdict: saved?.verdict });
  if (saved) await announceRun(ctx, issue, saved);
}
