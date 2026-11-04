import type { Issue, PluginContext } from "@paperclipai/plugin-sdk";
import { checkedId, jsonObject, pluginNamespace } from "../shared/db.js";

/**
 * Lượt Bug Finding của ticket tổng `code-bf` (bảng `crew_bug_finding_runs`, migration `0025_bug_finding.sql`). Gate stage
 * cầu nối của server đọc cùng bảng (`server/src/crew/bug-finding-runs.ts`).
 */
export type BugFindingRunState = "requested" | "queued" | "running" | "succeeded" | "failed" | "timeout" | "cancelled" | "skipped";
export type BugFindingVerdict = "APPROVE" | "APPROVE WITH CONDITIONS" | "BLOCK";

/** Finding rút gọn đúng 12 trường mà 2P Crew gửi lên (`review-result.json` của Bug Finding). */
export interface BugFindingFinding {
  id: string; rule: string | null; title: string; severity: string; certainty: string | null; status: string;
  action: string | null; mr_relation: string | null; location: string | null; fix: string | null; accept: string | null;
  question: string | null;
}
export const FINDING_KEYS = [
  "id", "rule", "title", "severity", "certainty", "status", "action", "mr_relation", "location", "fix", "accept", "question",
] as const;

export interface BugFindingRun {
  id: string; companyId: string; issueId: string; approvalRound: number; run: number; requestId: string;
  machineJobId: string | null; machineId: string | null; headSha: string; prUrl: string; state: BugFindingRunState;
  verdict: BugFindingVerdict | null; lanesDone: number | null; lanesTotal: number | null; findings: BugFindingFinding[] | null;
  feedbackText: string | null; reportDocumentKey: string | null; costUsd: number | null; error: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
}

/** Tối đa 3 lượt mỗi vòng duyệt của owner: lần đầu và tối đa 2 lô sửa tự động. */
export const MAX_RUNS = 3;
export const MAX_BATCHES = 2;
export const RUN_STATES: readonly BugFindingRunState[] = ["requested", "queued", "running", "succeeded", "failed", "timeout", "cancelled", "skipped"];
export const OPEN_RUN_STATES: readonly BugFindingRunState[] = ["requested", "queued", "running"];
/** Lượt kết thúc mà không có kết quả: reviewer xếp lại hoặc hỏi owner bỏ qua. */
export const BROKEN_RUN_STATES: readonly BugFindingRunState[] = ["failed", "timeout", "cancelled"];
export const VERDICTS: readonly BugFindingVerdict[] = ["APPROVE", "APPROVE WITH CONDITIONS", "BLOCK"];
/** Finding còn mở cần xử lý (luật cầu nối, spec mục 5.5). */
export const OPEN_FINDING_STATUSES = ["OPEN", "STILL_PRESENT", "REGRESSED", "PARTIALLY_FIXED", "UNABLE_TO_VERIFY"];
export const ERROR_MAX = 300;
export const RESULT_WAKE_REASON = "crew_bug_finding_result";

type Db = Pick<PluginContext, "db">;
type Row = {
  id: string; company_id: string; issue_id: string; approval_round: number | string; run: number | string; request_id: string;
  machine_job_id: string | null; machine_id: string | null; head_sha: string; pr_url: string; state: BugFindingRunState;
  verdict: BugFindingVerdict | null; lanes_done: number | string | null; lanes_total: number | string | null; findings: unknown;
  feedback_text: string | null; report_document_key: string | null; cost_usd: number | string | null; error: string | null;
  created_at: string | Date; started_at: string | Date | null; finished_at: string | Date | null;
};
/** Cột của bảng lượt; `p` là tiền tố bảng khi câu có JOIN (`r.`). */
const columns = (p = "") => `${p}id::text AS id, ${p}company_id::text AS company_id, ${p}issue_id::text AS issue_id,
  ${p}approval_round AS approval_round, ${p}run AS run, ${p}request_id::text AS request_id, ${p}machine_job_id::text AS machine_job_id,
  ${p}machine_id::text AS machine_id, ${p}head_sha AS head_sha, ${p}pr_url AS pr_url, ${p}state AS state, ${p}verdict AS verdict,
  ${p}lanes_done AS lanes_done, ${p}lanes_total AS lanes_total, ${p}findings AS findings, ${p}feedback_text AS feedback_text,
  ${p}report_document_key AS report_document_key, ${p}cost_usd AS cost_usd, ${p}error AS error, ${p}created_at AS created_at,
  ${p}started_at AS started_at, ${p}finished_at AS finished_at`;
const COLUMNS = columns();

export const runsTable = (ctx: Db) => `${pluginNamespace(ctx)}.crew_bug_finding_runs`;
const iso = (value: string | Date | null) => value === null ? null : new Date(value).toISOString();
const num = (value: number | string | null) => value === null ? null : Number(value);
export const cut = (value: string, max = ERROR_MAX) => value.length > max ? value.slice(0, max) : value;

function toRun(row: Row): BugFindingRun {
  const findings = typeof row.findings === "string" ? JSON.parse(row.findings) as unknown : row.findings;
  return {
    id: row.id, companyId: row.company_id, issueId: row.issue_id, approvalRound: Number(row.approval_round), run: Number(row.run),
    requestId: row.request_id, machineJobId: row.machine_job_id, machineId: row.machine_id, headSha: row.head_sha, prUrl: row.pr_url,
    state: row.state, verdict: row.verdict, lanesDone: num(row.lanes_done), lanesTotal: num(row.lanes_total),
    findings: Array.isArray(findings) ? findings as BugFindingFinding[] : null, feedbackText: row.feedback_text,
    reportDocumentKey: row.report_document_key, costUsd: num(row.cost_usd), error: row.error, createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at), finishedAt: iso(row.finished_at),
  };
}

/** Mọi lượt của issue, mới nhất trước. */
export async function listRuns(ctx: Db, companyId: string, issueId: string): Promise<BugFindingRun[]> {
  const rows = await ctx.db.query<Row>(`SELECT ${COLUMNS} FROM ${runsTable(ctx)} WHERE company_id = $1 AND issue_id = $2
    ORDER BY created_at DESC, run DESC`, [checkedId(companyId), checkedId(issueId)]);
  return rows.map(toRun);
}

export async function getRunByRequest(ctx: Db, companyId: string, requestId: string): Promise<BugFindingRun | null> {
  const rows = await ctx.db.query<Row>(`SELECT ${COLUMNS} FROM ${runsTable(ctx)} WHERE company_id = $1 AND request_id = $2`,
    [checkedId(companyId), checkedId(requestId)]);
  return rows[0] ? toRun(rows[0]) : null;
}

/** Lượt đang chờ hoặc đang chạy của mọi company (watchdog), cũ nhất trước. */
export async function listOpenRuns(ctx: Db, limit = 500): Promise<(BugFindingRun & { jobStatus: string | null; jobErrorCode: string | null; jobErrorText: string | null })[]> {
  const rows = await ctx.db.query<Row & { job_status: string | null; job_error_code: string | null; job_error_text: string | null }>(
    `SELECT ${columns("r.")}, j.status AS job_status, j.error_code AS job_error_code,
       j.error_text AS job_error_text
     FROM ${runsTable(ctx)} r LEFT JOIN ${pluginNamespace(ctx)}.crew_machine_jobs j ON j.id = r.machine_job_id AND j.company_id = r.company_id
     WHERE r.state IN ('requested','queued','running') ORDER BY r.created_at LIMIT ${Math.trunc(limit)}`);
  return rows.map((row) => ({ ...toRun(row), jobStatus: row.job_status, jobErrorCode: row.job_error_code, jobErrorText: row.job_error_text }));
}

/**
 * Vòng duyệt của owner: số lần owner yêu cầu sửa ticket tổng (0 = trước lần đầu). Server tăng `crew_bug_finding_rounds` khi
 * owner yêu cầu sửa ở stage duyệt và chạy lại từ stage gộp (`server/src/crew/issue-gate.ts`); số lô sửa tự động đếm lại từ 0.
 */
export async function approvalRound(ctx: Db, companyId: string, issueId: string): Promise<number> {
  const rows = await ctx.db.query<{ round: number | string }>(`SELECT round FROM ${pluginNamespace(ctx)}.crew_bug_finding_rounds
    WHERE company_id = $1 AND issue_id = $2`, [checkedId(companyId), checkedId(issueId)]);
  return Number(rows[0]?.round ?? 0);
}

/** Lô sửa tự động đã dùng trong vòng: mỗi head PR mới sau head đầu tiên là một lô. */
export function batchesUsed(runs: readonly BugFindingRun[], round: number): number {
  const heads = new Set(runs.filter((run) => run.approvalRound === round).map((run) => run.headSha));
  return Math.max(0, heads.size - 1);
}

export function openFindings(findings: readonly BugFindingFinding[] | null): number {
  return (findings ?? []).filter((finding) => OPEN_FINDING_STATUSES.includes(finding.status)).length;
}

/** `executionState.currentParticipant` là agent: người giữ stage hiện tại của issue. */
export function currentParticipantAgent(issue: Issue): string | null {
  const participant = jsonObject(jsonObject(issue.executionState)?.currentParticipant);
  return participant?.type === "agent" && typeof participant.agentId === "string" ? participant.agentId : null;
}

/**
 * Comment hệ thống `crew-bugfinding run=<n> sha=<head> verdict=<v> open=<k> state=<state>` (verdict viết liền bằng `_`,
 * `none` khi không có), rồi đánh thức người giữ stage hiện tại với reason `crew_bug_finding_result`. Lỗi được ghi log,
 * không chặn người gọi: lượt đã lưu, reviewer vẫn đọc được qua `GET …/issues/:id/bug-finding`.
 */
export async function announceRun(
  ctx: Pick<PluginContext, "issues" | "logger">, issue: Issue, run: BugFindingRun, options: { wake?: boolean; note?: string } = {},
): Promise<void> {
  const verdict = run.verdict ? run.verdict.replace(/ /g, "_") : "none";
  const open = openFindings(run.findings);
  const head = run.headSha.slice(0, 12);
  const detail = options.note ?? (run.state === "succeeded"
    ? `Bug Finding xong lượt ${run.run} cho head PR ${head}: ${run.verdict ?? "không có verdict"}, còn ${open} finding mở.`
    : `Bug Finding lượt ${run.run} cho head PR ${head} không xong (${run.state})${run.error ? `: ${run.error}` : ""}.`);
  try {
    await ctx.issues.createComment(issue.id, `crew-bugfinding run=${run.run} sha=${run.headSha} verdict=${verdict} open=${open} state=${run.state}\n\n${detail}`,
      issue.companyId);
  } catch (error) {
    ctx.logger.warn("crew bug finding comment failed", { issueId: issue.id, requestId: run.requestId, err: errText(error) });
  }
  if (options.wake === false || !currentParticipantAgent(issue)) return;
  try {
    await ctx.issues.requestWakeup(issue.id, issue.companyId, {
      reason: RESULT_WAKE_REASON, idempotencyKey: `crew-bug-finding:${run.requestId}:${run.state}`,
    });
  } catch (error) {
    ctx.logger.warn("crew bug finding wakeup failed", { issueId: issue.id, requestId: run.requestId, err: errText(error) });
  }
}

export const errText = (error: unknown) => error instanceof Error ? error.message : String(error);
