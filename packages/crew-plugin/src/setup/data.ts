import { randomUUID } from "node:crypto";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { checkedId, pluginNamespace } from "../shared/db.js";
import {
  type AddAgentInput, type AddProjectInput, SETUP_LIST_LIMIT, SETUP_LOCK_MINUTES, SETUP_RUN_KINDS, SETUP_RUN_STATUSES,
  type SetupRun, type SetupRunKind, type SetupRunStatus, type SetupStepId, type SetupStepState,
} from "./types.js";

type Db = Pick<PluginContext, "db">;
type Row = {
  id: string; company_id: string; kind: SetupRunKind; project_key: string; project_id: string | null; machine_id: string;
  input: unknown; steps: unknown; status: SetupRunStatus; running_step: SetupStepId | null; running_since: string | Date | null;
  created_at: string | Date; updated_at: string | Date;
};

const COLUMNS = "id,company_id,kind,project_key,project_id,machine_id,input,steps,status,running_step,running_since,created_at,updated_at";
const table = (ctx: Db) => `${pluginNamespace(ctx)}.crew_setup_runs`;
const json = (value: unknown) => typeof value === "string" ? JSON.parse(value) as unknown : value;
const LOCK_MS = SETUP_LOCK_MINUTES * 60_000;

/** A lock older than the window is reported as no running step, the same rule `beginStep` applies. */
function toRun(row: Row, now: Date): SetupRun {
  const since = row.running_since === null ? null : new Date(row.running_since).getTime();
  const live = row.running_step !== null && since !== null && since >= now.getTime() - LOCK_MS;
  return {
    id: row.id, companyId: row.company_id, kind: row.kind, projectKey: row.project_key, projectId: row.project_id,
    machineId: row.machine_id, input: json(row.input) as AddProjectInput | AddAgentInput,
    steps: (json(row.steps) ?? {}) as SetupRun["steps"], status: row.status, runningStep: live ? row.running_step : null,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function getSetupRun(ctx: Db, companyId: string, id: string, now = new Date()): Promise<SetupRun | null> {
  const rows = await ctx.db.query<Row>(`SELECT ${COLUMNS} FROM ${table(ctx)} WHERE id = $1 AND company_id = $2`,
    [checkedId(id), checkedId(companyId)]);
  return rows[0] ? toRun(rows[0], now) : null;
}

/** The unfinished add-project run holding this key, if any (failed runs are resumed, not replaced). */
export async function activeProjectRun(ctx: Db, companyId: string, projectKey: string): Promise<string | null> {
  const rows = await ctx.db.query<{ id: string }>(`SELECT id FROM ${table(ctx)}
    WHERE company_id = $1 AND project_key = $2 AND kind = 'add-project' AND status <> 'done' LIMIT 1`,
  [checkedId(companyId), projectKey]);
  return rows[0]?.id ?? null;
}

export async function insertSetupRun(ctx: Db, run: {
  companyId: string; kind: SetupRunKind; projectKey: string; projectId: string | null; machineId: string;
  input: AddProjectInput | AddAgentInput; createdByUserId: string;
}): Promise<SetupRun> {
  const id = randomUUID();
  // jsonb goes in as text: the host binds a JS object as a plain parameter.
  await ctx.db.execute(`INSERT INTO ${table(ctx)} (id,company_id,kind,project_key,project_id,machine_id,input,created_by_user_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7::text::jsonb,$8)`,
  [id, checkedId(run.companyId), run.kind, run.projectKey, run.projectId === null ? null : checkedId(run.projectId),
    checkedId(run.machineId), JSON.stringify(run.input), run.createdByUserId]);
  return (await getSetupRun(ctx, run.companyId, id))!;
}

/**
 * Takes the run's single step lock. One UPDATE with the lock condition in its WHERE clause: under concurrent calls
 * Postgres re-checks the condition after the first writer commits, so only one caller gets row count 1. A failed
 * run goes back to `running` when a step begins again ("Chạy tiếp"); a finished run cannot be reopened.
 */
export async function beginStep(ctx: Db, companyId: string, id: string, stepId: SetupStepId, now: Date): Promise<boolean> {
  const { rowCount } = await ctx.db.execute(`UPDATE ${table(ctx)} SET running_step = $3, running_since = $4::timestamptz,
      status = 'running', updated_at = $4::timestamptz
    WHERE id = $1 AND company_id = $2 AND status <> 'done'
      AND (running_step IS NULL OR running_since IS NULL OR running_since < $4::timestamptz - make_interval(mins => $5))`,
  [checkedId(id), checkedId(companyId), stepId, now.toISOString(), SETUP_LOCK_MINUTES]);
  return rowCount === 1;
}

/**
 * Records a step outcome and releases the lock, only while that step holds it. `failed` fails the run;
 * `done` on the last step finishes it. `projectId` is set once the project exists.
 */
export async function finishStep(ctx: Db, companyId: string, id: string, stepId: SetupStepId, outcome: {
  state: SetupStepState; projectId: string | null; last: boolean;
}, now: Date): Promise<boolean> {
  const { rowCount } = await ctx.db.execute(`UPDATE ${table(ctx)} SET
      steps = steps || jsonb_build_object($3::text, $4::text::jsonb),
      status = CASE WHEN $5 = 'failed' THEN 'failed' WHEN $6::boolean THEN 'done' ELSE status END,
      project_id = COALESCE($7::uuid, project_id), running_step = NULL, running_since = NULL, updated_at = $8::timestamptz
    WHERE id = $1 AND company_id = $2 AND running_step = $3 AND status = 'running'`,
  [checkedId(id), checkedId(companyId), stepId, JSON.stringify(outcome.state), outcome.state.status,
    outcome.state.status === "done" && outcome.last, outcome.projectId === null ? null : checkedId(outcome.projectId),
    now.toISOString()]);
  return rowCount === 1;
}

export interface SetupRunFilter { kind?: SetupRunKind; status?: SetupRunStatus; projectId?: string }

/** Newest first, at most 100. Optional filters are bound as NULL when absent. */
export async function listSetupRuns(ctx: Db, companyId: string, filter: SetupRunFilter = {}, now = new Date()): Promise<SetupRun[]> {
  const rows = await ctx.db.query<Row>(`SELECT ${COLUMNS} FROM ${table(ctx)} WHERE company_id = $1
    AND ($2::text IS NULL OR kind = $2::text) AND ($3::text IS NULL OR status = $3::text)
    AND ($4::uuid IS NULL OR project_id = $4::uuid) ORDER BY created_at DESC, id DESC LIMIT $5`,
  [checkedId(companyId), filter.kind ?? null, filter.status ?? null, filter.projectId ? checkedId(filter.projectId) : null, SETUP_LIST_LIMIT]);
  return rows.map((row) => toRun(row, now));
}

/** Data key `crew.setupRuns`: `{companyId, kind?, status?, projectId?}`; unknown kind or status values are refused. */
export function loadSetupRuns(ctx: Db, params: Record<string, unknown>): Promise<SetupRun[]> {
  const optional = (value: unknown) => value === undefined || value === null || value === "" ? undefined : String(value);
  const kind = optional(params.kind);
  const status = optional(params.status);
  if (kind !== undefined && !SETUP_RUN_KINDS.includes(kind as SetupRunKind)) return Promise.reject(new Error("kind không hợp lệ"));
  if (status !== undefined && !SETUP_RUN_STATUSES.includes(status as SetupRunStatus)) return Promise.reject(new Error("status không hợp lệ"));
  return listSetupRuns(ctx, String(params.companyId ?? ""), {
    kind: kind as SetupRunKind | undefined, status: status as SetupRunStatus | undefined, projectId: optional(params.projectId),
  });
}

export function registerSetupData(ctx: PluginContext): void {
  ctx.data.register("crew.setupRuns", (params) => loadSetupRuns(ctx, params));
}
