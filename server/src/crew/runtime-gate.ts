import { and, eq, sql } from "drizzle-orm";
import { activityLog, agents, type Db, type heartbeatRuns, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logActivity } from "../services/activity-log.js";
import { loadCrewCompanyConfig } from "./issue-policy.js";
import { type CrewRuntime, isCrewRuntime } from "./model-policy.js";
import {
  crewRuntimeDecisionsTable,
  crewRuntimeWaitsTable,
  readPluginRows,
  readRuntimeSwitch,
  resolveAgentMachine,
} from "./runtime-switch.js";
import { CREW_RUNTIME_FALLBACK_WAKE_REASON } from "./runtime-fallback.js";

type Run = typeof heartbeatRuns.$inferSelect;

/** Activity đánh dấu run đã bị công tắc giữ (một lần mỗi run); hàng chờ cho plugin nằm ở `crew_runtime_waits`. */
export const RUNTIME_GATE_WAITING_ACTION = "crew.runtime_gate.waiting";

export interface RuntimeGateDeps {
  loadAgent(agentId: string): Promise<{ adapterType: string; defaultEnvironmentId: string | null } | null>;
  /** Company có cấu hình Crew (`loadCrewCompanyConfig(...).kind === "ok"`). */
  isCrewCompany(companyId: string): Promise<boolean>;
  /**
   * Hủy (sau khi claim trả về) run `queued` của agent đã bị plugin chuyển đi: quyết định `fallback` mới nhất của issue
   * có `from_agent_id = run.agentId`, run tạo trước quyết định đó, và issue đã giao agent khác. Trả `true` khi hủy.
   */
  cancelSuperseded(run: Run): Promise<boolean>;
  /** Máy của agent theo luật chung với plugin; `null` = không xác định (công tắc mặc định). */
  resolveMachine(input: { companyId: string; agentId: string }): Promise<string | null>;
  switchOn(input: { companyId: string; machineId: string | null; runtime: CrewRuntime }): Promise<boolean>;
  hasWaitingMarker(runId: string): Promise<boolean>;
  /** Ghi hàng chờ `crew_runtime_waits` (`ON CONFLICT DO NOTHING`) rồi activity `crew.runtime_gate.waiting`. */
  recordWaiting(run: Run, details: { runtime: CrewRuntime; machineId: string | null; issueId: string | null }): Promise<void>;
}

function readIssueId(contextSnapshot: unknown): string | null {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return null;
  const value = (contextSnapshot as Record<string, unknown>).issueId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Cổng công tắc runtime của H1 (sau cổng tải). Trả `true` để giữ run ở `queued`:
 * - run của agent đã bị chuyển runtime (fallback) mà còn `queued`: hủy rồi giữ;
 * - agent `claude_local`/`codex_local`/`opencode_local`, công tắc runtime đó trên máy của agent tắt. Agent không có
 *   environment thì không xác định máy (không tra bản tin): công tắc mặc định, nên Codex/OpenCode bị giữ, Claude chạy.
 * Không comment, không hủy vì công tắc: plugin lo fallback. Lỗi đọc khi tra máy hay công tắc: Codex/OpenCode coi như công tắc mặc định (tắt) và giữ run
 * (ghi cảnh báo); Claude cho claim (fail open), vì lỗi hạ tầng không được chặn Claude. Lỗi ở các bước khác cũng fail open.
 */
export async function evaluateRuntimeGate(input: { db: Db; run: Run }, deps: RuntimeGateDeps): Promise<boolean> {
  const { run } = input;
  if (run.status !== "queued") return false;
  try {
    const agent = await deps.loadAgent(run.agentId);
    if (!agent) return false;
    if (!(await deps.isCrewCompany(run.companyId))) return false;
    try {
      if (await deps.cancelSuperseded(run)) return true;
    } catch (err) {
      logger.warn({ err, runId: run.id }, "crew-runtime-gate: checking for a superseded run failed; continuing");
    }
    if (!isCrewRuntime(agent.adapterType)) return false;
    const runtime = agent.adapterType;
    // Lỗi hạ tầng không được chặn Claude (fail open); Codex/OpenCode coi như công tắc mặc định (tắt) và giữ run.
    const failSoft = (err: unknown, what: string): void => {
      if (runtime === "claude_local") throw err;
      logger.warn({ err, runId: run.id, runtime }, `crew-runtime-gate: ${what} failed; treating the switch as default (off)`);
    };
    let machineId: string | null = null;
    if (agent.defaultEnvironmentId) {
      try {
        machineId = await deps.resolveMachine({ companyId: run.companyId, agentId: run.agentId });
      } catch (err) {
        failSoft(err, "resolving the agent machine");
      }
    }
    let on = false;
    try {
      on = await deps.switchOn({ companyId: run.companyId, machineId, runtime });
    } catch (err) {
      failSoft(err, "reading the runtime switch");
    }
    if (on) return false;
    try {
      if (!(await deps.hasWaitingMarker(run.id))) {
        await deps.recordWaiting(run, { runtime, machineId, issueId: readIssueId(run.contextSnapshot) });
      }
    } catch (err) {
      logger.warn({ err, runId: run.id }, "crew-runtime-gate: recording the waiting run failed; the run stays held");
    }
    return true;
  } catch (err) {
    logger.warn({ err, runId: run.id }, "crew-runtime-gate: failed open, run may be claimed");
    return false;
  }
}

export function defaultRuntimeGateDeps(
  db: Db,
  options: { scheduleCancel(runId: string, reason: string): void },
): RuntimeGateDeps {
  return {
    async loadAgent(agentId) {
      const [agent] = await db
        .select({ adapterType: agents.adapterType, defaultEnvironmentId: agents.defaultEnvironmentId })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);
      return agent ?? null;
    },
    async isCrewCompany(companyId) {
      return (await loadCrewCompanyConfig(companyId)).kind === "ok";
    },
    async cancelSuperseded(run) {
      const issueId = readIssueId(run.contextSnapshot);
      if (!issueId) return false;
      const rows = await readPluginRows(
        db,
        crewRuntimeDecisionsTable(),
        (table) => sql`SELECT from_agent_id::text AS from_agent_id, decided_at FROM ${table}
          WHERE company_id = ${run.companyId} AND issue_id = ${issueId} AND kind = 'fallback'
          ORDER BY decided_at DESC, id DESC LIMIT 1`,
      );
      const latest = rows?.[0];
      if (!latest || String(latest.from_agent_id).toLowerCase() !== run.agentId.toLowerCase()) return false;
      if (new Date(latest.decided_at as string | Date).getTime() < run.createdAt.getTime()) return false;
      const [issue] = await db
        .select({ assigneeAgentId: issues.assigneeAgentId })
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.companyId, run.companyId)))
        .limit(1);
      if (!issue || issue.assigneeAgentId === run.agentId) return false;
      options.scheduleCancel(run.id, CREW_RUNTIME_FALLBACK_WAKE_REASON);
      logger.info({ runId: run.id, issueId }, "crew-runtime-gate: cancelling a queued run of an agent the issue was moved away from");
      return true;
    },
    resolveMachine: (input) => resolveAgentMachine(db, input),
    switchOn: (input) => readRuntimeSwitch(db, input),
    async hasWaitingMarker(runId) {
      const [row] = await db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(and(eq(activityLog.runId, runId), eq(activityLog.action, RUNTIME_GATE_WAITING_ACTION)))
        .limit(1);
      return Boolean(row);
    },
    async recordWaiting(run, details) {
      // Bảng chưa có (plugin chưa migrate): chỉ ghi activity cho người xem; job fallback của plugin chưa chạy được.
      await readPluginRows(
        db,
        crewRuntimeWaitsTable(),
        (table) => sql`INSERT INTO ${table} (run_id, company_id, issue_id, agent_id, machine_id, runtime)
          VALUES (${run.id}, ${run.companyId}, ${details.issueId}, ${run.agentId}, ${details.machineId}, ${details.runtime})
          ON CONFLICT (run_id) DO NOTHING`,
      );
      await logActivity(db, {
        companyId: run.companyId,
        actorType: "system",
        actorId: "crew",
        action: RUNTIME_GATE_WAITING_ACTION,
        entityType: "heartbeat_run",
        entityId: run.id,
        agentId: run.agentId,
        runId: run.id,
        issueId: details.issueId,
        details,
      });
    },
  };
}
