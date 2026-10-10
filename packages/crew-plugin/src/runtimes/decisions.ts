import type { Issue, PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { checkedId, jsonObject, pluginNamespace, UUID, uuidArray } from "../shared/db.js";
import { type ProjectRoles, readProjectRoles } from "../roles/data.js";
import { CREW_CODEX_REVIEWER_MODEL, CREW_MODEL_LINE_RE, type CrewComplexity, type CrewEffort, type CrewRuntime, isCrewRuntime } from "./catalog.js";
import { resolveAgentMachine } from "./machine.js";
import { readRuntimeSwitch } from "./switches.js";

/**
 * Sổ quyết định runtime của issue (`crew_runtime_decisions`): dòng `select` (lựa chọn ban đầu của executor và reviewer)
 * ghi khi thấy issue mới, dòng `fallback`/`fallback_refused` do bộ chuyển runtime ghi. Data `crew.runtimeDecisions`
 * đọc lại cho crew-web.
 */
export type RuntimeDecisionRole = "executor" | "reviewer";
export type RuntimeDecisionKind = "select" | "fallback" | "fallback_refused";
export type RuntimeDecisionTrigger = "quota" | "auth" | "unavailable" | "switch_off" | "other";

/** Một dòng của data `crew.runtimeDecisions`. Giờ là ISO UTC; UI đổi sang Asia/Ho_Chi_Minh. */
export interface RuntimeDecision {
  id: string;
  role: RuntimeDecisionRole;
  kind: RuntimeDecisionKind;
  runId: string | null;
  machineId: string | null;
  fromAgentId: string | null;
  fromAgentName: string | null;
  toAgentId: string | null;
  toAgentName: string | null;
  fromRuntime: string | null;
  toRuntime: string | null;
  model: string | null;
  complexity: string | null;
  trigger: RuntimeDecisionTrigger | null;
  reason: string;
  decidedAt: string;
}

export interface NewRuntimeDecision {
  companyId: string;
  issueId: string;
  role: RuntimeDecisionRole;
  kind: RuntimeDecisionKind;
  runId?: string | null;
  machineId?: string | null;
  fromAgentId?: string | null;
  toAgentId?: string | null;
  fromRuntime?: CrewRuntime | null;
  toRuntime?: CrewRuntime | null;
  model?: string | null;
  complexity?: CrewComplexity | null;
  trigger?: RuntimeDecisionTrigger | null;
  reason: string;
}

export const RUNTIME_DECISIONS_LIMIT = 50;
const MAX_REASON_LENGTH = 500;
const DATA_KEY = "crew.runtimeDecisions";

type DbCtx = Pick<PluginContext, "db">;
const table = (ctx: DbCtx) => `${pluginNamespace(ctx)}.crew_runtime_decisions`;
const optionalId = (value: string | null | undefined) => value ? checkedId(value).toLowerCase() : null;

/** Ghi một quyết định; trùng chỉ mục duy nhất (`(run_id, kind)`, `select` theo `(issue_id, role)`) thì bỏ qua. */
export async function insertRuntimeDecision(ctx: DbCtx, decision: NewRuntimeDecision): Promise<boolean> {
  const result = await ctx.db.execute(
    `INSERT INTO ${table(ctx)} (company_id,issue_id,role,kind,run_id,machine_id,from_agent_id,to_agent_id,from_runtime,
       to_runtime,model,complexity,trigger,reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
    [checkedId(decision.companyId), checkedId(decision.issueId), decision.role, decision.kind, optionalId(decision.runId),
      optionalId(decision.machineId), optionalId(decision.fromAgentId), optionalId(decision.toAgentId),
      decision.fromRuntime ?? null, decision.toRuntime ?? null, decision.model ?? null, decision.complexity ?? null,
      decision.trigger ?? null, decision.reason.slice(0, MAX_REASON_LENGTH)],
  );
  return result.rowCount > 0;
}

type DecisionRow = {
  id: string; role: RuntimeDecisionRole; kind: RuntimeDecisionKind; run_id: string | null; machine_id: string | null;
  from_agent_id: string | null; from_agent_name: string | null; to_agent_id: string | null; to_agent_name: string | null;
  from_runtime: string | null; to_runtime: string | null; model: string | null; complexity: string | null;
  trigger: RuntimeDecisionTrigger | null; reason: string; decided_at: string | Date;
};

/** Quyết định của một issue trong company, mới nhất trước, tối đa 50. */
export async function loadRuntimeDecisions(ctx: DbCtx, params: Record<string, unknown>): Promise<RuntimeDecision[]> {
  const companyId = checkedId(params.companyId);
  const issueId = checkedId(params.issueId);
  const rows = await ctx.db.query<DecisionRow>(
    `SELECT d.id::text AS id, d.role, d.kind, d.run_id::text AS run_id, d.machine_id::text AS machine_id,
       d.from_agent_id::text AS from_agent_id, fa.name AS from_agent_name, d.to_agent_id::text AS to_agent_id,
       ta.name AS to_agent_name, d.from_runtime, d.to_runtime, d.model, d.complexity, d.trigger, d.reason, d.decided_at
     FROM ${table(ctx)} d
     LEFT JOIN public.agents fa ON fa.id = d.from_agent_id AND fa.company_id = d.company_id
     LEFT JOIN public.agents ta ON ta.id = d.to_agent_id AND ta.company_id = d.company_id
     WHERE d.company_id = $1 AND d.issue_id = $2
     ORDER BY d.decided_at DESC, d.id DESC LIMIT ${RUNTIME_DECISIONS_LIMIT}`,
    [companyId, issueId],
  );
  return rows.map((row) => ({
    id: row.id, role: row.role, kind: row.kind, runId: row.run_id, machineId: row.machine_id,
    fromAgentId: row.from_agent_id, fromAgentName: row.from_agent_name, toAgentId: row.to_agent_id,
    toAgentName: row.to_agent_name, fromRuntime: row.from_runtime, toRuntime: row.to_runtime, model: row.model,
    complexity: row.complexity, trigger: row.trigger, reason: row.reason, decidedAt: new Date(row.decided_at).toISOString(),
  }));
}

export interface CrewModelMarker {
  complexity: CrewComplexity; model: string; effort: CrewEffort | "default"; runtime: CrewRuntime; reason: string;
}

/** Dòng `crew-model` trong mô tả issue; marker không có `runtime=` là `claude_local`. */
export function parseCrewModelMarker(description: string | null | undefined): CrewModelMarker | null {
  const match = CREW_MODEL_LINE_RE.exec(description ?? "");
  if (!match) return null;
  return {
    complexity: match[1] as CrewComplexity, model: match[2]!, effort: match[3] as CrewEffort | "default",
    runtime: (match[4] as CrewRuntime | undefined) ?? "claude_local", reason: match[5]!.trim(),
  };
}

/** Cùng luật server: marker trước, không có marker thì `adapterType` của assignee, ngoài ba runtime coi như Claude. */
export function executorRuntimeOf(description: string | null | undefined, assigneeAdapterType: string | null): CrewRuntime {
  const marker = parseCrewModelMarker(description);
  if (marker) return marker.runtime;
  return isCrewRuntime(assigneeAdapterType) ? assigneeAdapterType : "claude_local";
}

export type CrewIssueTemplate = "child" | "root" | "research" | "bmad";
export interface ReviewerChoice { agentId: string; runtime: "claude_local" | "codex_local"; reason: string }
const CODEX_REVIEWER_ABSENT_STATUSES = new Set(["terminated", "pending_approval"]);

/**
 * Bản chép `chooseReviewer` của server (`server/src/crew/model-policy.ts`). Server không lưu lý do chọn reviewer, nên
 * plugin tính lại theo cùng luật khi ghi dòng `select` của reviewer.
 */
export function chooseReviewer(input: {
  template: CrewIssueTemplate;
  executorRuntime: CrewRuntime;
  claudeReviewerAgentId: string;
  codexReviewer: { agentId: string; status: string } | null;
  codexSwitchOn: boolean;
}): ReviewerChoice {
  const claude = (reason: string): ReviewerChoice => ({ agentId: input.claudeReviewerAgentId, runtime: "claude_local", reason });
  if (input.template !== "child") return claude("chỉ issue con được reviewer Codex");
  if (input.executorRuntime === "codex_local") return claude("executor đã là Codex");
  const codex = input.codexReviewer;
  if (!codex || CODEX_REVIEWER_ABSENT_STATUSES.has(codex.status)) return claude("không có reviewer Codex");
  if (codex.status === "paused") return claude("reviewer Codex đang pause");
  if (!input.codexSwitchOn) return claude("Codex đang tắt trên máy reviewer");
  return { agentId: codex.agentId, runtime: "codex_local", reason: `executor ${input.executorRuntime}, Codex bật → reviewer codex_local` };
}

export interface AgentInfo { id: string; name: string; status: string; adapterType: string; defaultEnvironmentId: string | null }

/** Agent của company theo id (lowercase); agent company khác không bao giờ được đọc. */
export async function loadAgents(ctx: DbCtx, companyId: string, ids: readonly (string | null | undefined)[]): Promise<Map<string, AgentInfo>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id && UUID.test(id)).map((id) => id.toLowerCase()))];
  if (wanted.length === 0) return new Map();
  const rows = await ctx.db.query<{ id: string; name: string; status: string; adapter_type: string; default_environment_id: string | null }>(
    `SELECT id::text AS id, name, status, adapter_type, default_environment_id::text AS default_environment_id
     FROM public.agents WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [checkedId(companyId), uuidArray(wanted)],
  );
  return new Map(rows.map((row) => [row.id.toLowerCase(), {
    id: row.id.toLowerCase(), name: row.name, status: row.status, adapterType: row.adapter_type,
    defaultEnvironmentId: row.default_environment_id,
  }]));
}

/**
 * Máy của agent cho công tắc: agent không có environment thì không tra máy (`null` = công tắc mặc định), như cổng H1
 * của server; có environment thì theo luật chung `resolveAgentMachine`.
 */
export async function machineOfAgent(ctx: DbCtx, companyId: string, agent: AgentInfo | undefined): Promise<string | null> {
  if (!agent?.defaultEnvironmentId) return null;
  return await resolveAgentMachine(ctx, { companyId, agentId: agent.id });
}

type Stage = { id: string | null; type: string | null; agentIds: string[] };

/** Stage của policy (chỉ phần cần: id, loại, agent participant theo thứ tự). */
export function policyStages(policy: unknown): Stage[] {
  const stages = jsonObject(policy)?.stages;
  if (!Array.isArray(stages)) return [];
  return stages.map((raw) => {
    const stage = jsonObject(raw) ?? {};
    const participants = Array.isArray(stage.participants) ? stage.participants : [];
    return {
      id: typeof stage.id === "string" ? stage.id : null,
      type: typeof stage.type === "string" ? stage.type : null,
      agentIds: participants.flatMap((item) => {
        const p = jsonObject(item);
        return p?.type === "agent" && typeof p.agentId === "string" ? [p.agentId.toLowerCase()] : [];
      }),
    };
  });
}

/** Mẫu policy Crew theo số stage: con 1, research/bmad 2, gốc 4 (chỉ cần phân biệt issue con với phần còn lại). */
function templateOf(stages: Stage[]): CrewIssueTemplate {
  return stages.length === 1 ? "child" : stages.length === 4 ? "root" : "research";
}

/** Executor của project: hai ô Claude cùng hai ô runtime. */
export const projectExecutors = (roles: ProjectRoles): string[] =>
  [...roles.executorAgentIds, roles.codexExecutorAgentId, roles.opencodeExecutorAgentId].filter((id): id is string => !!id);

/**
 * Dòng `select` của issue mới thuộc project Crew: executor theo marker `crew-model` (không có marker thì không ghi),
 * reviewer theo participant đầu của stage review đầu tiên (H4 đặt reviewer Codex đứng đầu khi chọn nó). Lý do chọn
 * reviewer tính lại theo cùng luật server. Ghi lại nhiều lần vẫn một dòng mỗi vai trò.
 */
export async function recordSelect(
  ctx: Pick<PluginContext, "db" | "config">, companyId: string, issue: Issue,
): Promise<{ executor: boolean; reviewer: boolean }> {
  const result = { executor: false, reviewer: false };
  if (!issue.projectId) return result;
  const roles = await readProjectRoles(ctx, companyId, issue.projectId.toLowerCase());
  if (!roles) return result;
  const stages = policyStages(issue.executionPolicy);
  const reviewStage = stages[0]?.type === "review" ? stages[0] : null;
  const reviewerId = reviewStage?.agentIds[0] ?? null;
  const assigneeId = issue.assigneeAgentId?.toLowerCase() ?? null;
  const agents = await loadAgents(ctx, companyId, [assigneeId, reviewerId, roles.codexReviewerAgentId]);

  const marker = parseCrewModelMarker(issue.description);
  if (marker) {
    const assignee = assigneeId ? agents.get(assigneeId) : undefined;
    result.executor = await insertRuntimeDecision(ctx, {
      companyId, issueId: issue.id, role: "executor", kind: "select",
      machineId: await machineOfAgent(ctx, companyId, assignee), toAgentId: assignee?.id ?? null,
      toRuntime: marker.runtime, model: marker.model, complexity: marker.complexity, reason: marker.reason,
    });
  }

  if (reviewerId && agents.has(reviewerId) && [roles.reviewerAgentId, roles.codexReviewerAgentId].includes(reviewerId)) {
    const reviewer = agents.get(reviewerId)!;
    const codex = roles.codexReviewerAgentId ? agents.get(roles.codexReviewerAgentId) : undefined;
    const base = {
      template: templateOf(stages),
      executorRuntime: executorRuntimeOf(issue.description, assigneeId ? agents.get(assigneeId)?.adapterType ?? null : null),
      claudeReviewerAgentId: roles.reviewerAgentId,
      codexReviewer: codex ? { agentId: codex.id, status: codex.status } : null,
    };
    const machineId = await machineOfAgent(ctx, companyId, reviewer);
    let reason: string;
    if (reviewerId === roles.codexReviewerAgentId) {
      reason = chooseReviewer({ ...base, codexSwitchOn: true }).reason;
    } else {
      const ideal = chooseReviewer({ ...base, codexSwitchOn: true });
      const choice = ideal.runtime === "codex_local" && codex
        ? chooseReviewer({ ...base, codexSwitchOn: await readRuntimeSwitch(ctx, {
          companyId, machineId: await machineOfAgent(ctx, companyId, codex), runtime: "codex_local",
        }) })
        : ideal;
      // Server chọn Claude mà luật hiện giờ cho Codex: công tắc vừa đổi hoặc server đọc lỗi.
      reason = choice.runtime === "claude_local" ? choice.reason : "reviewer Claude của project";
    }
    result.reviewer = await insertRuntimeDecision(ctx, {
      companyId, issueId: issue.id, role: "reviewer", kind: "select", machineId, toAgentId: reviewer.id,
      toRuntime: reviewerId === roles.codexReviewerAgentId ? "codex_local" : "claude_local",
      model: reviewerId === roles.codexReviewerAgentId ? CREW_CODEX_REVIEWER_MODEL.model : null, reason,
    });
  }
  return result;
}

export async function handleIssueCreated(
  ctx: Pick<PluginContext, "db" | "config" | "issues" | "logger">, event: PluginEvent,
): Promise<void> {
  const companyId = event.companyId;
  const issueId = event.entityId;
  if (!companyId || !UUID.test(companyId) || event.entityType !== "issue" || !issueId || !UUID.test(issueId)) return;
  try {
    const issue = await ctx.issues.get(issueId, companyId);
    if (!issue) return;
    await recordSelect(ctx, companyId, issue);
  } catch (error) {
    ctx.logger.warn("crew runtime decisions: recording the selection failed", {
      companyId, issueId, err: error instanceof Error ? error.message : String(error),
    });
  }
}

export function registerRuntimeDecisions(ctx: PluginContext): void {
  ctx.data.register(DATA_KEY, (params) => loadRuntimeDecisions(ctx, params));
  ctx.events.on("issue.created", (event) => handleIssueCreated(ctx, event));
}

