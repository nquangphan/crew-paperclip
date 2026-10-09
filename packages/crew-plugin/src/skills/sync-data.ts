import type { PluginContext } from "@paperclipai/plugin-sdk";
import { checkedId, pluginNamespace } from "../shared/db.js";
import { sanitizeJobError } from "../jobs/sanitize.js";
import type { JobErrorCode, MachineJobStatus } from "../jobs/types.js";

/**
 * Sync state of one skill on one machine: `status`/`finishedAt` come from the newest `skill-sync` job of the pair,
 * `sha256` from the newest one that finished `done` (null if none has), so a queued or failed resync still shows
 * which copy the machine holds.
 */
export interface SkillSyncState {
  skillId: string; machineId: string; jobId: string; status: MachineJobStatus; sha256: string | null; finishedAt: string | null;
  /** Error of the newest job (sanitized); null unless that job failed. */
  errorCode: JobErrorCode | null; errorText: string | null;
}

type Row = { job_id: string; error_code: JobErrorCode | null; error_text: string | null; skill_id: string; machine_id: string; status: MachineJobStatus; sha256: string | null; finished_at: string | Date | null };

export async function loadSkillSync(ctx: Pick<PluginContext, "db">, params: Record<string, unknown>): Promise<SkillSyncState[]> {
  const companyId = checkedId(params.companyId);
  const table = `${pluginNamespace(ctx)}.crew_machine_jobs`;
  const rows = await ctx.db.query<Row>(`SELECT DISTINCT ON (j.payload->>'skillId', j.machine_id)
      j.payload->>'skillId' AS skill_id, j.machine_id, j.id AS job_id, j.error_code, j.error_text, j.status, j.finished_at,
      (SELECT d.result->>'sha256' FROM ${table} d
        WHERE d.company_id = j.company_id AND d.machine_id = j.machine_id AND d.kind = 'skill-sync' AND d.status = 'done'
          AND d.payload->>'skillId' = j.payload->>'skillId'
        ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS sha256
    FROM ${table} j
    WHERE j.company_id = $1 AND j.kind = 'skill-sync'
    ORDER BY j.payload->>'skillId', j.machine_id, j.created_at DESC, j.id DESC`, [companyId]);
  return rows.map((row) => ({
    skillId: row.skill_id, machineId: row.machine_id, jobId: String(row.job_id), status: row.status, sha256: row.sha256,
    errorCode: row.error_code, errorText: row.error_text === null ? null : sanitizeJobError(row.error_text),
    finishedAt: row.finished_at === null ? null : new Date(row.finished_at).toISOString(),
  }));
}

export function registerSkillSyncData(ctx: PluginContext): void {
  ctx.data.register("crew.skillSync", (params) => loadSkillSync(ctx, params));
}
