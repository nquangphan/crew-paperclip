import { randomUUID } from "node:crypto";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { checkedId, pluginNamespace } from "../shared/db.js";
import {
  JOB_LEASE_MINUTES, JOB_LIST_LIMIT, JOB_MAX_ATTEMPTS, type JobErrorCode, type JobPayload, type JobResult,
  type MachineJob, type MachineJobKind, type MachineJobStatus,
} from "./types.js";

type Db = Pick<PluginContext, "db">;
type Row = {
  id: string; company_id: string; machine_id: string; kind: MachineJobKind; payload: unknown; status: MachineJobStatus;
  result: unknown; error_code: JobErrorCode | null; error_text: string | null; attempts: number | string;
  setup_run_id: string | null; created_at: string | Date; claimed_at: string | Date | null; finished_at: string | Date | null;
};

const COLUMNS = "id,company_id,machine_id,kind,payload,status,result,error_code,error_text,attempts,setup_run_id,created_at,claimed_at,finished_at";
export const LEASE_EXPIRED_TEXT = `Máy không báo kết quả trong ${JOB_LEASE_MINUTES} phút`;
const iso = (value: string | Date | null) => value === null ? null : new Date(value).toISOString();
const json = (value: unknown) => typeof value === "string" ? JSON.parse(value) as unknown : value;

function toJob(row: Row): MachineJob {
  return {
    id: row.id, companyId: row.company_id, machineId: row.machine_id, kind: row.kind, payload: json(row.payload) as JobPayload,
    status: row.status, result: (json(row.result) ?? null) as JobResult | null, errorCode: row.error_code, errorText: row.error_text,
    attempts: Number(row.attempts), setupRunId: row.setup_run_id, createdAt: iso(row.created_at)!, claimedAt: iso(row.claimed_at),
    finishedAt: iso(row.finished_at),
  };
}

const table = (ctx: Db) => `${pluginNamespace(ctx)}.crew_machine_jobs`;

export async function getJob(ctx: Db, companyId: string, jobId: string): Promise<MachineJob | null> {
  const rows = await ctx.db.query<Row>(`SELECT ${COLUMNS} FROM ${table(ctx)} WHERE id = $1 AND company_id = $2`,
    [checkedId(jobId), checkedId(companyId)]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function insertJob(ctx: Db, job: {
  companyId: string; machineId: string; payload: JobPayload; setupRunId: string | null; createdByUserId: string;
}): Promise<MachineJob> {
  const id = randomUUID();
  // jsonb goes in as text: the host binds a JS object as a plain parameter, and `$n::jsonb` alone double-encodes it.
  await ctx.db.execute(`INSERT INTO ${table(ctx)} (id,company_id,machine_id,kind,payload,setup_run_id,created_by_user_id)
    VALUES ($1,$2,$3,$4,$5::text::jsonb,$6,$7)`,
  [id, checkedId(job.companyId), checkedId(job.machineId), job.payload.kind, JSON.stringify(job.payload), job.setupRunId, job.createdByUserId]);
  return (await getJob(ctx, job.companyId, id))!;
}

export interface JobFilter { machineId?: string; setupRunId?: string; status?: MachineJobStatus; limit?: number }

/** Newest first, at most 100. Optional filters are bound as NULL when absent. */
export async function listJobs(ctx: Db, companyId: string, filter: JobFilter = {}): Promise<MachineJob[]> {
  const limit = Math.min(Math.max(1, Math.trunc(filter.limit ?? JOB_LIST_LIMIT)), JOB_LIST_LIMIT);
  const rows = await ctx.db.query<Row>(`SELECT ${COLUMNS} FROM ${table(ctx)} WHERE company_id = $1
    AND ($2::uuid IS NULL OR machine_id = $2::uuid) AND ($3::uuid IS NULL OR setup_run_id = $3::uuid)
    AND ($4::text IS NULL OR status = $4::text) ORDER BY created_at DESC, id DESC LIMIT $5`,
  [checkedId(companyId), filter.machineId ? checkedId(filter.machineId) : null,
    filter.setupRunId ? checkedId(filter.setupRunId) : null, filter.status ?? null, limit]);
  return rows.map(toJob);
}

/** Data key `crew.machineJobs`: `{companyId, machineId?, setupRunId?}`. */
export function loadMachineJobs(ctx: Db, params: Record<string, unknown>): Promise<MachineJob[]> {
  const optional = (value: unknown) => value === undefined || value === null || value === "" ? undefined : String(value);
  return listJobs(ctx, String(params.companyId ?? ""), {
    machineId: optional(params.machineId), setupRunId: optional(params.setupRunId),
  });
}

export function registerJobsData(ctx: PluginContext): void {
  ctx.data.register("crew.machineJobs", (params) => loadMachineJobs(ctx, params));
}

/**
 * Hands the oldest queued job of one machine to that machine, or null.
 *
 * The host's `ctx.db` runs one statement per call with no transaction, and `execute` returns only a row count,
 * so `BEGIN … FOR UPDATE SKIP LOCKED … COMMIT` is not available. Each step is instead one atomic statement:
 * 1. expired leases go back to the queue (`attempts + 1`), or fail with `lease_expired` on the third expiry;
 * 2. the candidate is taken with a compare-and-set `UPDATE … WHERE id = $n AND status = 'queued'`. Under
 *    concurrent claims Postgres re-checks the WHERE clause after the first writer commits, so exactly one
 *    caller sees row count 1 and the others move on to the next candidate.
 */
export async function claimNextJob(ctx: Db, companyId: string, machineId: string, now: Date): Promise<MachineJob | null> {
  const company = checkedId(companyId);
  const machine = checkedId(machineId);
  const at = now.toISOString();
  await ctx.db.execute(`UPDATE ${table(ctx)} SET attempts = attempts + 1,
      status = CASE WHEN attempts + 1 >= $4 THEN 'failed' ELSE 'queued' END,
      error_code = CASE WHEN attempts + 1 >= $4 THEN 'lease_expired' ELSE error_code END,
      error_text = CASE WHEN attempts + 1 >= $4 THEN $5 ELSE error_text END,
      finished_at = CASE WHEN attempts + 1 >= $4 THEN $3::timestamptz ELSE NULL END,
      claimed_at = NULL, lease_until = NULL
    WHERE company_id = $1 AND machine_id = $2 AND status = 'claimed' AND lease_until < $3::timestamptz`,
  [company, machine, at, JOB_MAX_ATTEMPTS, LEASE_EXPIRED_TEXT]);

  for (;;) {
    const candidates = await ctx.db.query<{ id: string }>(`SELECT id FROM ${table(ctx)}
      WHERE company_id = $1 AND machine_id = $2 AND status = 'queued' ORDER BY created_at, id LIMIT 5`, [company, machine]);
    if (candidates.length === 0) return null;
    for (const { id } of candidates) {
      const { rowCount } = await ctx.db.execute(`UPDATE ${table(ctx)} SET status = 'claimed', claimed_at = $2::timestamptz,
          lease_until = $2::timestamptz + make_interval(mins => $3)
        WHERE id = $1 AND status = 'queued'`, [id, at, JOB_LEASE_MINUTES]);
      if (rowCount === 1) return getJob(ctx, company, id);
    }
  }
}

export type JobOutcome =
  | { status: "done"; result: JobResult }
  | { status: "failed"; errorCode: JobErrorCode; errorText: string | null; result?: JobResult };

/** Records the outcome of a claimed job; false when the job is no longer claimed by this machine. */
export async function finishJob(
  ctx: Db, companyId: string, jobId: string, machineId: string, outcome: JobOutcome, now: Date,
): Promise<boolean> {
  const done = outcome.status === "done";
  const result = outcome.result ?? null;
  const { rowCount } = await ctx.db.execute(`UPDATE ${table(ctx)} SET status = $4, result = $5::text::jsonb,
      error_code = $6, error_text = $7, finished_at = $8::timestamptz, lease_until = NULL
    WHERE id = $1 AND company_id = $2 AND machine_id = $3 AND status = 'claimed'`,
  [checkedId(jobId), checkedId(companyId), checkedId(machineId), outcome.status,
    result ? JSON.stringify(result) : null, done ? null : outcome.errorCode, done ? null : outcome.errorText, now.toISOString()]);
  return rowCount === 1;
}

/** `failed` → `queued`; attempts are kept so the history of lease expiries stays visible. */
export async function retryJob(ctx: Db, companyId: string, jobId: string): Promise<boolean> {
  const { rowCount } = await ctx.db.execute(`UPDATE ${table(ctx)} SET status = 'queued', result = NULL, error_code = NULL,
      error_text = NULL, claimed_at = NULL, lease_until = NULL, finished_at = NULL
    WHERE id = $1 AND company_id = $2 AND status = 'failed'`, [checkedId(jobId), checkedId(companyId)]);
  return rowCount === 1;
}

/** `queued` or `claimed` → `cancelled`; a later result from the app is refused because the job is no longer claimed. */
export async function cancelJob(ctx: Db, companyId: string, jobId: string, now: Date): Promise<boolean> {
  const { rowCount } = await ctx.db.execute(`UPDATE ${table(ctx)} SET status = 'cancelled', lease_until = NULL,
      finished_at = $3::timestamptz
    WHERE id = $1 AND company_id = $2 AND status IN ('queued','claimed')`, [checkedId(jobId), checkedId(companyId), now.toISOString()]);
  return rowCount === 1;
}
