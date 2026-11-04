import type { PluginContext } from "@paperclipai/plugin-sdk";
import { cancelJob } from "../jobs/data.js";
import { announceRun, type BugFindingRun, cut, errText, getRunByRequest, listOpenRuns, runsTable } from "./runs.js";

type Ctx = Pick<PluginContext, "db" | "issues" | "logger">;

export const BUG_FINDING_WATCHDOG_JOB_KEY = "bug-finding-watchdog";
/** Lượt `requested` chưa có máy nhận việc quá chừng này thì hết giờ. */
export const REQUEST_TIMEOUT_MS = 30 * 60_000;
/** Lượt chưa có kết quả (kể cả lúc app chờ mạng hay tài nguyên) quá chừng này kể từ lúc xếp thì hết giờ. */
export const RESULT_TIMEOUT_MS = 8 * 3_600_000;
const REQUEST_TIMEOUT_TEXT = "Không máy nào nhận việc Bug Finding trong 30 phút";
const RESULT_TIMEOUT_TEXT = "Bug Finding chưa có kết quả sau 8 giờ";

/**
 * Job mỗi phút: đối chiếu lượt đang mở với việc máy và đồng hồ, để stage cầu nối không kẹt im lặng (Mac tắt, mất mạng,
 * app treo):
 * - việc `bug-finding-review` xong (app đã nhận yêu cầu) → lượt `queued`;
 * - việc máy hỏng hoặc bị hủy khi lượt còn `requested` → lượt `failed` với mã và lỗi của việc;
 * - `requested` quá 30 phút → `timeout` và hủy việc còn chờ; `queued`/`running` quá 8 giờ → `timeout`.
 * Mỗi lượt kết thúc được báo bằng comment hệ thống và đánh thức reviewer. Mọi lệnh ghi là compare-and-set trên `state`,
 * nên kết quả từ Mac tới cùng lúc không bị ghi đè.
 */
export async function runBugFindingWatchdog(ctx: Ctx, now: Date): Promise<{ queued: number; failed: number; timedOut: number }> {
  const counts = { queued: 0, failed: 0, timedOut: 0 };
  for (const run of await listOpenRuns(ctx)) {
    try {
      const age = now.getTime() - new Date(run.createdAt).getTime();
      if (run.state === "requested" && run.jobStatus === "done") {
        if (await move(ctx, run, "queued", null, false)) counts.queued += 1;
      } else if (run.state === "requested" && (run.jobStatus === "failed" || run.jobStatus === "cancelled")) {
        const reason = [run.jobErrorCode ?? run.jobStatus, run.jobErrorText].filter(Boolean).join(": ");
        if (await finish(ctx, run, "failed", cut(reason))) counts.failed += 1;
      } else if (run.state === "requested" && age > REQUEST_TIMEOUT_MS) {
        if (run.machineJobId) await cancelJob(ctx, run.companyId, run.machineJobId, now);
        if (await finish(ctx, run, "timeout", REQUEST_TIMEOUT_TEXT)) counts.timedOut += 1;
      } else if (run.state !== "requested" && age > RESULT_TIMEOUT_MS) {
        if (await finish(ctx, run, "timeout", RESULT_TIMEOUT_TEXT)) counts.timedOut += 1;
      }
    } catch (error) {
      ctx.logger.warn("crew bug finding watchdog failed", { requestId: run.requestId, issueId: run.issueId, err: errText(error) });
    }
  }
  return counts;
}

async function move(ctx: Ctx, run: BugFindingRun, state: "queued" | "failed" | "timeout", error: string | null, final: boolean): Promise<boolean> {
  const { rowCount } = await ctx.db.execute(`UPDATE ${runsTable(ctx)} SET state = $4, error = COALESCE($5::text, error),
      finished_at = CASE WHEN $6::boolean THEN now() ELSE finished_at END, updated_at = now()
    WHERE company_id = $1 AND request_id = $2 AND state = $3`, [run.companyId, run.requestId, run.state, state, error, final]);
  return rowCount === 1;
}

async function finish(ctx: Ctx, run: BugFindingRun, state: "failed" | "timeout", error: string): Promise<boolean> {
  if (!await move(ctx, run, state, error, true)) return false;
  ctx.logger.info("crew bug finding run ended", { requestId: run.requestId, issueId: run.issueId, state, error });
  const [issue, saved] = await Promise.all([ctx.issues.get(run.issueId, run.companyId), getRunByRequest(ctx, run.companyId, run.requestId)]);
  if (issue && saved) await announceRun(ctx, issue, saved);
  return true;
}
