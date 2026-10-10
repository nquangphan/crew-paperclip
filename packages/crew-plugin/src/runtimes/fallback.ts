import type { Issue, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { storedVerifiedCrewCompanies } from "../companies/data.js";
import { type ProjectRoles, readProjectRoles } from "../roles/data.js";
import { checkedId, jsonObject, pluginNamespace, UUID } from "../shared/db.js";
import { CREW_RUNTIME_CATALOG, CREW_RUNTIMES, type CrewRuntime, isCrewRuntime } from "./catalog.js";
import { classifyRuntimeFailure, type FailureClass } from "./classify.js";
import {
  chooseFallback, FALLBACK_TRIGGER_REASON, type FallbackCandidate, type FallbackTrigger, REFUSED_LARGE, runtimeHealthOf,
} from "./choose.js";
import {
  type AgentInfo, insertRuntimeDecision, loadAgents, machineOfAgent, type NewRuntimeDecision, parseCrewModelMarker,
  policyStages, projectExecutors,
} from "./decisions.js";
import { readRuntimeSwitch } from "./switches.js";

/**
 * Chuyển runtime cùng máy khi run hỏng vì runtime (quota, đăng nhập/key, runtime không chạy được) hoặc bị giữ vì công
 * tắc tắt. Executor sang executor khác của project; reviewer Codex luôn sang reviewer Claude của project. Mỗi run hỏng
 * một quyết định (`crew_runtime_decisions`, duy nhất theo `(run_id, kind)`), ghi trước mọi thay đổi trên issue.
 * Mọi lời gọi host kèm company; không lời gọi nào mang actor (lệnh của hệ thống).
 */

/** Lý do đánh thức agent đích; H1 ở server dùng nó để dọn worktree của run cũ trước run mới. */
export const RUNTIME_FALLBACK_WAKE_REASON = "crew_runtime_fallback";
/** Đánh thức reviewer Claude sau khi nhận lượt review của reviewer Codex (không dọn worktree như executor). */
export const REVIEWER_FALLBACK_WAKE_REASON = "crew_runtime_reviewer_fallback";
export const RUNTIME_FALLBACK_JOB_KEY = "runtime-fallback";
/** Run bị công tắc giữ quá chừng này mới chuyển: cho owner kịp bật lại sau khi lỡ tay tắt. */
export const RUNTIME_WAIT_GRACE_MS = 60_000;
const WAIT_BATCH = 50;

export type FallbackOutcome = "applied" | "duplicate" | "refused" | "skipped";
export type ReviewerTrigger = FallbackTrigger | "other";

const REVIEWER_TRIGGER_REASON: Readonly<Record<ReviewerTrigger, string>> = { ...FALLBACK_TRIGGER_REASON, other: "run lỗi" };
export const REVIEWER_NOT_IN_STAGE = "reviewer Claude không có trong stage review của issue";

type Ctx = Pick<PluginContext, "db" | "config" | "issues" | "logger">;
const decisions = (ctx: Pick<PluginContext, "db">) => `${pluginNamespace(ctx)}.crew_runtime_decisions`;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const CLOSED_STATUSES = new Set(["done", "cancelled"]);

/** Policy Crew đã gắn vào issue: có stage và số vòng review của Crew. */
function hasCrewPolicy(policy: unknown): boolean {
  const value = jsonObject(policy);
  return value?.maxReviewRounds === 5 && Array.isArray(value.stages) && value.stages.length > 0;
}

async function decidedForRun(ctx: Pick<PluginContext, "db">, companyId: string, runId: string): Promise<boolean> {
  const rows = await ctx.db.query(
    `SELECT 1 AS found FROM ${decisions(ctx)} WHERE company_id = $1 AND run_id = $2 AND kind IN ('fallback','fallback_refused') LIMIT 1`,
    [companyId, runId],
  );
  return rows.length > 0;
}

/** Lệnh ghi issue bị từ chối sau khi đã ghi `fallback`: đổi dòng đó thành `fallback_refused` để không ai tưởng đã chuyển. */
async function demoteDecision(ctx: Pick<PluginContext, "db">, companyId: string, runId: string, reason: string): Promise<void> {
  await ctx.db.execute(
    `UPDATE ${decisions(ctx)} SET kind = 'fallback_refused', reason = $3 WHERE company_id = $1 AND run_id = $2 AND kind = 'fallback'`,
    [companyId, runId, reason.slice(0, 500)],
  );
}

async function hostnameOf(ctx: Pick<PluginContext, "db">, companyId: string, machineId: string | null): Promise<string> {
  if (!machineId) return "không xác định";
  const rows = await ctx.db.query<{ hostname: string }>(
    `SELECT hostname FROM ${pluginNamespace(ctx)}.machine_latest WHERE company_id = $1 AND machine_id = $2`, [companyId, machineId],
  );
  return rows[0]?.hostname ?? "không xác định";
}

async function machineReport(ctx: Pick<PluginContext, "db">, companyId: string, machineId: string | null): Promise<unknown> {
  if (!machineId) return null;
  const rows = await ctx.db.query<{ report: unknown }>(
    `SELECT report FROM ${pluginNamespace(ctx)}.machine_latest WHERE company_id = $1 AND machine_id = $2`, [companyId, machineId],
  );
  return rows[0]?.report ?? null;
}

/** Issue có ảnh đính kèm; không đọc được danh sách thì coi như có (không bao giờ gửi ảnh cho model không đọc ảnh). */
async function issueHasImages(ctx: Ctx, companyId: string, issueId: string): Promise<boolean> {
  try {
    const attachments = await ctx.issues.listAttachments(issueId, companyId);
    return attachments.some((attachment) => (attachment.contentType ?? "").toLowerCase().startsWith("image/"));
  } catch {
    return true;
  }
}

async function wake(ctx: Ctx, companyId: string, issueId: string, runId: string, reason: string): Promise<void> {
  try {
    await ctx.issues.requestWakeup(issueId, companyId, { reason, idempotencyKey: `${reason}:${runId}` });
  } catch (error) {
    ctx.logger.warn("crew runtime fallback: wakeup failed", { companyId, issueId, runId, err: errorText(error) });
  }
}

async function blockIssue(ctx: Ctx, companyId: string, issueId: string, runId: string): Promise<void> {
  try {
    await ctx.issues.update(issueId, { status: "blocked" }, companyId);
  } catch (error) {
    ctx.logger.warn("crew runtime fallback: blocking the issue failed", { companyId, issueId, runId, err: errorText(error) });
  }
}

interface FallbackInput { companyId: string; issueId: string; runId: string; agentId: string; trigger: ReviewerTrigger }

/**
 * Chuyển runtime cho run hỏng (`agentId` là agent của run). Dừng (`skipped`) khi issue không thuộc project Crew, không có
 * policy Crew, đã xong/hủy, đã giao agent khác, hay agent không phải executor/reviewer Codex của project. Executor chỉ
 * chuyển với `quota`/`auth`/`unavailable`/`switch_off`; reviewer Codex chuyển với mọi lỗi (owner chốt).
 */
export async function applyFallback(ctx: Ctx, raw: FallbackInput): Promise<FallbackOutcome> {
  const input = { ...raw, companyId: checkedId(raw.companyId).toLowerCase(), issueId: checkedId(raw.issueId).toLowerCase(),
    runId: checkedId(raw.runId).toLowerCase(), agentId: checkedId(raw.agentId).toLowerCase() };
  const issue = await ctx.issues.get(input.issueId, input.companyId);
  if (!issue || CLOSED_STATUSES.has(issue.status) || issue.assigneeAgentId?.toLowerCase() !== input.agentId) return "skipped";
  if (!issue.projectId || !hasCrewPolicy(issue.executionPolicy)) return "skipped";
  const roles = await readProjectRoles(ctx, input.companyId, issue.projectId.toLowerCase());
  if (!roles) return "skipped";
  const reviewer = input.agentId === roles.codexReviewerAgentId;
  if (!reviewer && (!projectExecutors(roles).includes(input.agentId) || input.trigger === "other")) return "skipped";
  if (await decidedForRun(ctx, input.companyId, input.runId)) return "duplicate";
  return reviewer ? reviewerFallback(ctx, input, issue, roles) : executorFallback(ctx, { ...input, trigger: input.trigger as FallbackTrigger }, issue, roles);
}

async function executorFallback(
  ctx: Ctx, input: FallbackInput & { trigger: FallbackTrigger }, issue: Issue, roles: ProjectRoles,
): Promise<FallbackOutcome> {
  const { companyId, issueId, runId, agentId, trigger } = input;
  const executors = projectExecutors(roles);
  const agents = await loadAgents(ctx, companyId, executors);
  const from = agents.get(agentId);
  if (!from || !isCrewRuntime(from.adapterType)) return "skipped";
  const fromRuntime = from.adapterType;
  const machineId = await machineOfAgent(ctx, companyId, from);
  const complexity = parseCrewModelMarker(issue.description)?.complexity ?? "medium";
  const prior = await ctx.db.query<{ from_runtime: string | null; to_runtime: string | null }>(
    `SELECT from_runtime, to_runtime FROM ${decisions(ctx)}
     WHERE company_id = $1 AND issue_id = $2 AND role = 'executor' AND kind = 'fallback'`,
    [companyId, issueId],
  );
  const tried = [...new Set([fromRuntime, ...prior.flatMap((row) => [row.from_runtime, row.to_runtime]).filter(isCrewRuntime)])];
  const candidates: FallbackCandidate[] = [];
  for (const agent of agents.values()) {
    if (agent.id === agentId || !isCrewRuntime(agent.adapterType)) continue;
    candidates.push({ agentId: agent.id, name: agent.name, runtime: agent.adapterType, status: agent.status,
      machineId: await machineOfAgent(ctx, companyId, agent) });
  }
  const switches = {} as Record<CrewRuntime, boolean>;
  for (const runtime of CREW_RUNTIMES) switches[runtime] = await readRuntimeSwitch(ctx, { companyId, machineId, runtime });
  const choice = chooseFallback({
    complexity, trigger, from: { agentId, runtime: fromRuntime, machineId }, candidates, switches, tried,
    health: runtimeHealthOf(await machineReport(ctx, companyId, machineId)),
    hasImages: complexity === "large" ? false : await issueHasImages(ctx, companyId, issueId),
    fallbacksSoFar: prior.length,
  });
  const base: NewRuntimeDecision = { companyId, issueId, role: "executor", kind: "fallback", runId, machineId,
    fromAgentId: agentId, fromRuntime, complexity, trigger, reason: "" };

  if (choice.kind === "refused") {
    if (!await insertRuntimeDecision(ctx, { ...base, kind: "fallback_refused", reason: choice.reason })) return "duplicate";
    await refuseExecutor(ctx, input, fromRuntime, machineId, choice.reason);
    return "refused";
  }

  const toAgentId = choice.toAgentId;
  if (!await insertRuntimeDecision(ctx, { ...base, toAgentId, toRuntime: choice.toRuntime, model: choice.model, reason: choice.reason })) {
    return "duplicate";
  }
  const effortKey = CREW_RUNTIME_CATALOG[choice.toRuntime].effortKey;
  const adapterConfig = { model: choice.model, ...(effortKey && choice.effort ? { [effortKey]: choice.effort } : {}) };
  try {
    // SDK chưa khai báo `assigneeAdapterOverrides` trong patch; host chuyển nguyên patch cho issue service (H2 kiểm).
    await ctx.issues.update(issueId, { assigneeAgentId: toAgentId, assigneeAdapterOverrides: { adapterConfig } } as never, companyId);
  } catch (error) {
    const reason = `Crew không đổi được assignee (${errorText(error).slice(0, 200)})`;
    await demoteDecision(ctx, companyId, runId, reason);
    await refuseExecutor(ctx, input, fromRuntime, machineId, reason);
    return "refused";
  }
  await ctx.issues.createComment(issueId,
    `Crew: chuyển từ ${fromRuntime} (${from.name}) sang ${choice.toRuntime} (${choice.toAgentName}), model ${choice.model}. `
    + `Lý do: ${choice.reason}. Nhánh và commit của run trước được giữ.`, companyId);
  await wake(ctx, companyId, issueId, runId, RUNTIME_FALLBACK_WAKE_REASON);
  return "applied";
}

/**
 * Không chuyển được: comment một lần (dòng `fallback_refused` có `run_id` giữ cho lần sau không lặp). Công tắc tắt thì run
 * giữ `queued` chờ owner bật lại; `large` chờ Claude chạy lại (stock retry); còn lại chuyển issue sang `blocked`.
 */
async function refuseExecutor(
  ctx: Ctx, input: FallbackInput, fromRuntime: CrewRuntime, machineId: string | null, reason: string,
): Promise<void> {
  const { companyId, issueId, runId, trigger } = input;
  const head = `Crew: không chuyển runtime cho run \`${runId}\`: ${reason}.`;
  if (trigger === "switch_off") {
    const hostname = await hostnameOf(ctx, companyId, machineId);
    await ctx.issues.createComment(issueId, `${head} Runtime ${fromRuntime} đang tắt trên máy ${hostname}; run chờ tới khi owner bật lại.`, companyId);
    return;
  }
  if (reason === REFUSED_LARGE) {
    await ctx.issues.createComment(issueId, `${head} Crew chờ Claude chạy lại.`, companyId);
    return;
  }
  await ctx.issues.createComment(issueId, head, companyId);
  await blockIssue(ctx, companyId, issueId, runId);
}

/**
 * Reviewer Codex không chạy được: lượt review đang chờ reviewer Codex chuyển sang reviewer Claude của project bằng
 * `executionState` đang lưu (chỉ đổi `currentParticipant`) cùng `assigneeAgentId`, không đụng `executionPolicy`, không
 * actor (H2 chỉ cho đúng phép đổi này). Issue tạo trước khi có reviewer Claude trong stage thì không đổi được.
 */
async function reviewerFallback(ctx: Ctx, input: FallbackInput, issue: Issue, roles: ProjectRoles): Promise<FallbackOutcome> {
  const { companyId, issueId, runId, agentId, trigger } = input;
  const state = jsonObject(issue.executionState);
  const participant = jsonObject(state?.currentParticipant);
  if (issue.status !== "in_review" || state?.status !== "pending" || state.currentStageType !== "review"
    || participant?.type !== "agent" || String(participant.agentId).toLowerCase() !== agentId) return "skipped";
  const claudeId = roles.reviewerAgentId;
  const stage = policyStages(issue.executionPolicy).find((item) => item.id === state.currentStageId);
  const agents = await loadAgents(ctx, companyId, [agentId, claudeId]);
  const machineId = await machineOfAgent(ctx, companyId, agents.get(agentId));
  const reason = REVIEWER_TRIGGER_REASON[trigger];
  const base: NewRuntimeDecision = { companyId, issueId, role: "reviewer", kind: "fallback", runId, machineId,
    fromAgentId: agentId, fromRuntime: "codex_local", trigger, reason };

  if (!stage?.agentIds.includes(claudeId)) {
    if (!await insertRuntimeDecision(ctx, { ...base, kind: "fallback_refused", reason: `${reason}; ${REVIEWER_NOT_IN_STAGE}` })) return "duplicate";
    await refuseReviewer(ctx, input, reason);
    return "refused";
  }
  if (!await insertRuntimeDecision(ctx, { ...base, toAgentId: claudeId, toRuntime: "claude_local" })) return "duplicate";
  try {
    // SDK chưa khai báo `executionState` trong patch; host chuyển nguyên patch cho issue service (H2 kiểm).
    await ctx.issues.update(issueId, {
      executionState: { ...state, currentParticipant: { type: "agent", agentId: claudeId, userId: null } },
      assigneeAgentId: claudeId,
    } as never, companyId);
  } catch (error) {
    await demoteDecision(ctx, companyId, runId, `${reason}; Crew không đổi được reviewer (${errorText(error).slice(0, 200)})`);
    await refuseReviewer(ctx, input, reason);
    return "refused";
  }
  await ctx.issues.createComment(issueId,
    `Crew: chuyển reviewer từ codex_local (${nameOf(agents, agentId)}) sang claude_local (${nameOf(agents, claudeId)}). `
    + `Lý do: ${reason}. Số vòng review giữ nguyên.`, companyId);
  await wake(ctx, companyId, issueId, runId, REVIEWER_FALLBACK_WAKE_REASON);
  return "applied";
}

const nameOf = (agents: Map<string, AgentInfo>, id: string) => agents.get(id)?.name ?? id;

async function refuseReviewer(ctx: Ctx, input: FallbackInput, reason: string): Promise<void> {
  const { companyId, issueId, runId, trigger } = input;
  await ctx.issues.createComment(issueId,
    `Crew: reviewer Codex không chạy được (${reason}); owner bật lại Codex hoặc dùng "Ép Done"/sửa reviewer trên web.`, companyId);
  if (trigger !== "switch_off") await blockIssue(ctx, companyId, issueId, runId);
}

type RunFailedPayload = { runId?: unknown; agentId?: unknown; issueId?: unknown; error?: unknown; errorCode?: unknown };
const uuidOrNull = (value: unknown) => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;

/**
 * `agent.run.failed`: payload không có `errorFamily`, nên đọc từ `heartbeat_runs.result_json` (server ghi cùng lệnh kết
 * thúc run, trước khi phát sự kiện). Agent ngoài ba runtime không bao giờ chuyển.
 */
export async function handleRunFailed(ctx: Ctx, event: PluginEvent): Promise<FallbackOutcome | null> {
  const payload = (event.payload ?? {}) as RunFailedPayload;
  const companyId = uuidOrNull(event.companyId);
  const runId = uuidOrNull(payload.runId);
  const agentId = uuidOrNull(payload.agentId);
  const issueId = uuidOrNull(payload.issueId);
  if (!companyId || !runId || !agentId || !issueId) return null;
  try {
    const agent = (await loadAgents(ctx, companyId, [agentId])).get(agentId);
    if (!agent || !isCrewRuntime(agent.adapterType)) return null;
    const runs = await ctx.db.query<{ error_family: string | null }>(
      "SELECT result_json->>'errorFamily' AS error_family FROM public.heartbeat_runs WHERE id = $1 AND company_id = $2",
      [runId, companyId],
    );
    const failure: FailureClass = classifyRuntimeFailure({
      adapterType: agent.adapterType,
      errorCode: typeof payload.errorCode === "string" ? payload.errorCode : null,
      errorFamily: runs[0]?.error_family ?? null,
      message: typeof payload.error === "string" ? payload.error : null,
    });
    const outcome = await applyFallback(ctx, { companyId, issueId, runId, agentId, trigger: failure });
    if (outcome !== "skipped") ctx.logger.info("crew runtime fallback", { companyId, issueId, runId, failure, outcome });
    return outcome;
  } catch (error) {
    ctx.logger.error("crew runtime fallback failed", { companyId, issueId, runId, err: errorText(error) });
    return null;
  }
}

type WaitRow = { run_id: string; issue_id: string | null; agent_id: string; machine_id: string | null; runtime: string };

/**
 * Job mỗi phút: run bị H1 giữ vì công tắc tắt (`crew_runtime_waits`) quá 60 giây mà vẫn `queued` và công tắc vẫn tắt thì
 * chuyển runtime với trigger `switch_off`. Dòng nào xử lý xong (kể cả khi không cần làm gì) được đặt `handled_at`; lỗi thì
 * để lại cho phút sau.
 */
export async function runRuntimeFallbackJob(
  ctx: Ctx & Pick<PluginContext, "companies">, now: Date,
): Promise<{ handled: number; applied: number }> {
  let handled = 0;
  let applied = 0;
  const waits = `${pluginNamespace(ctx)}.crew_runtime_waits`;
  for (const company of await storedVerifiedCrewCompanies(ctx)) {
    const companyId = company.id.toLowerCase();
    let rows: WaitRow[];
    try {
      rows = await ctx.db.query<WaitRow>(
        `SELECT run_id::text AS run_id, issue_id::text AS issue_id, agent_id::text AS agent_id, machine_id::text AS machine_id, runtime
         FROM ${waits} WHERE company_id = $1 AND handled_at IS NULL AND first_seen_at <= $2
         ORDER BY first_seen_at, run_id LIMIT ${WAIT_BATCH}`,
        [companyId, new Date(now.getTime() - RUNTIME_WAIT_GRACE_MS).toISOString()],
      );
    } catch (error) {
      ctx.logger.error("crew runtime fallback job: reading waits failed", { companyId, err: errorText(error) });
      continue;
    }
    for (const row of rows) {
      try {
        const runs = await ctx.db.query<{ status: string }>(
          "SELECT status FROM public.heartbeat_runs WHERE id = $1 AND company_id = $2", [row.run_id, companyId],
        );
        const stillHeld = runs[0]?.status === "queued" && !!row.issue_id && isCrewRuntime(row.runtime)
          && !await readRuntimeSwitch(ctx, { companyId, machineId: row.machine_id, runtime: row.runtime });
        if (stillHeld) {
          const outcome = await applyFallback(ctx, { companyId, issueId: row.issue_id!, runId: row.run_id, agentId: row.agent_id, trigger: "switch_off" });
          if (outcome === "applied") applied++;
          ctx.logger.info("crew runtime fallback job", { companyId, runId: row.run_id, outcome });
        }
        await ctx.db.execute(`UPDATE ${waits} SET handled_at = now() WHERE company_id = $1 AND run_id = $2`, [companyId, row.run_id]);
        handled++;
      } catch (error) {
        ctx.logger.warn("crew runtime fallback job: run left for the next minute", { companyId, runId: row.run_id, err: errorText(error) });
      }
    }
  }
  return { handled, applied };
}

export function registerRuntimeFallback(ctx: PluginContext): void {
  ctx.events.on("agent.run.failed", async (event) => { await handleRunFailed(ctx, event); });
  ctx.jobs.register(RUNTIME_FALLBACK_JOB_KEY, async () => { await runRuntimeFallbackJob(ctx, new Date()); });
}
