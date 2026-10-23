import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { environmentService } from "../services/environments.js";
import { crewTableSql, type ExecDb, MAX_TREE_DEPTH, pairedMachine, pairedMachines } from "./machine-pin.js";
import {
  CHECKOUT_RE, listProjectMachines, projectLayout, readProjectMachine, readProjectRepo, startProvisioning, writeProjectRepo,
} from "./machine-provision.js";
import { rowsOf } from "./project-roles.js";

export interface ReleaseBlocker { issueId: string; identifier: string | null; hostname: string; runStatus: string }
export interface ReleaseResult { archivedEnvironmentIds: string[]; jobs: { machineId: string; jobId: string }[] }
export interface ProvisionOthersResult {
  queued: { machineId: string; jobId: string }[];
  skipped: { machineId: string; reason: string }[];
}

const DEPTH = sql.raw(String(MAX_TREE_DEPTH));
const idList = (ids: readonly string[]) => ids.map((id) => id.toLowerCase()).join(",");
/** Thứ tự ổn định của vai trò trong việc `remove-checkouts`: Trợ Lý, executor, reviewer, integrator, còn lại. */
const checkoutRank = (name: string) =>
  name === "assistant" ? 0 : name.startsWith("executor") ? 1 : name.startsWith("reviewer") ? 2 : name === "integrator" ? 3 : 4;

/**
 * Cây đã ghim máy của project còn run `queued`/`running` (của `agentIds`; `null` = mọi agent). Gỡ lúc này sẽ archive
 * environment hay checkout cây đó đang dùng, nên đường gỡ phải dừng và báo danh sách.
 */
export async function machineReleaseBlockers(
  db: ExecDb, input: { companyId: string; projectId: string; agentIds: readonly string[] | null },
): Promise<ReleaseBlocker[]> {
  const byAgent = input.agentIds
    ? sql`AND r.agent_id = ANY(string_to_array(${idList(input.agentIds)}, ',')::uuid[])`
    : sql``;
  const rows = rowsOf(await db.execute(sql`WITH RECURSIVE tree(id, root, machine_id, depth) AS (
      SELECT p.root_issue_id, p.root_issue_id, p.machine_id, 0
      FROM ${crewTableSql("issue_machine_pins")} p JOIN issues i ON i.id = p.root_issue_id
      WHERE p.company_id = ${input.companyId} AND i.project_id = ${input.projectId}
      UNION ALL
      SELECT i.id, tree.root, tree.machine_id, tree.depth + 1 FROM issues i JOIN tree ON i.parent_id = tree.id
      WHERE i.company_id = ${input.companyId} AND tree.depth < ${DEPTH}
    )
    SELECT DISTINCT tree.root::text AS issue_id, ri.identifier, coalesce(mp.hostname, tree.machine_id::text) AS hostname,
      r.status AS run_status
    FROM heartbeat_runs r
    JOIN tree ON r.context_snapshot->>'issueId' = tree.id::text
    JOIN issues ri ON ri.id = tree.root
    LEFT JOIN ${crewTableSql("machine_pairings")} mp ON mp.company_id = ${input.companyId} AND mp.machine_id = tree.machine_id
    WHERE r.company_id = ${input.companyId} AND r.status IN ('queued', 'running') ${byAgent}
    ORDER BY ri.identifier, r.status`));
  return rows.map((row) => ({
    issueId: String(row.issue_id),
    identifier: typeof row.identifier === "string" ? row.identifier : null,
    hostname: String(row.hostname),
    runStatus: String(row.run_status),
  }));
}

async function queueRemoveCheckouts(
  db: ExecDb,
  input: { companyId: string; projectId: string; projectKey: string; machineId: string; roles: string[]; createdBy: string },
): Promise<string> {
  const open = rowsOf(await db.execute(sql`SELECT id::text AS id FROM ${crewTableSql("crew_machine_jobs")}
    WHERE company_id = ${input.companyId} AND machine_id = ${input.machineId} AND kind = 'remove-checkouts'
      AND status IN ('queued', 'claimed') AND payload->>'projectId' = ${input.projectId}
    ORDER BY created_at DESC LIMIT 1`));
  if (typeof open[0]?.id === "string") return open[0].id;
  const jobId = randomUUID();
  const payload = {
    kind: "remove-checkouts", projectId: input.projectId, projectKey: input.projectKey, roles: input.roles, removeStatusRepo: false,
  };
  await db.execute(sql`INSERT INTO ${crewTableSql("crew_machine_jobs")} (id, company_id, machine_id, kind, payload, created_by_user_id)
    VALUES (${jobId}, ${input.companyId}, ${input.machineId}, 'remove-checkouts', ${JSON.stringify(payload)}::text::jsonb, ${input.createdBy})`);
  return jobId;
}

/**
 * Dọn máy khác khi gỡ agent (`wholeProject: false`) hay cả project: từ chối khi còn cây chạy dở (`machineReleaseBlockers`);
 * archive (không xóa) environment `@máy` của các agent; xếp `remove-checkouts` cho máy khác `primaryMachineId`; gỡ cả
 * project thì xóa dòng `project_machines` của project. Gọi lại không xếp việc trùng.
 */
export async function releaseProjectMachines(
  db: Db,
  input: {
    companyId: string; projectId: string; agentIds: readonly string[]; wholeProject: boolean;
    primaryMachineId: string | null; createdBy: string;
  },
): Promise<{ ok: true; result: ReleaseResult } | { ok: false; blockers: ReleaseBlocker[] }> {
  const blockers = await machineReleaseBlockers(db, {
    companyId: input.companyId, projectId: input.projectId, agentIds: input.wholeProject ? null : input.agentIds,
  });
  if (blockers.length > 0) return { ok: false, blockers };
  const ids = idList(input.agentIds);
  const envRows = rowsOf(await db.execute(sql`SELECT e.id::text AS id, e.status, e.metadata->>'crewMachineId' AS machine_id
    FROM environments e JOIN agents a ON a.id::text = e.metadata->>'crewAgentId' AND a.company_id = ${input.companyId}
    WHERE e.driver = 'ssh' AND e.metadata->>'crewAgentId' = ANY(string_to_array(${ids}, ','))
    ORDER BY e.name`));
  const envs = environmentService(db);
  const archivedEnvironmentIds: string[] = [];
  for (const row of envRows) {
    if (row.status !== "active") continue;
    await envs.update(String(row.id), { status: "archived" });
    archivedEnvironmentIds.push(String(row.id));
  }
  const pathRows = rowsOf(await db.execute(sql`SELECT e.config->>'remoteWorkspacePath' AS path
    FROM agents a JOIN environments e ON e.id = a.default_environment_id
    WHERE a.company_id = ${input.companyId} AND a.id = ANY(string_to_array(${ids}, ',')::uuid[])`));
  let projectKey: string | null = null;
  const names: string[] = [];
  for (const row of pathRows) {
    const match = CHECKOUT_RE.exec(String(row.path ?? ""));
    if (!match || match[2] === "repo") continue;
    projectKey ??= match[1]!;
    if (match[1] === projectKey && !names.includes(match[2]!)) names.push(match[2]!);
  }
  names.sort((a, b) => checkoutRank(a) - checkoutRank(b) || a.localeCompare(b));
  const machines = new Set(envRows.map((row) => row.machine_id).filter((id): id is string => typeof id === "string"));
  if (input.wholeProject) {
    for (const row of await listProjectMachines(db, input.companyId, input.projectId)) machines.add(row.machineId);
  }
  if (input.primaryMachineId) machines.delete(input.primaryMachineId.toLowerCase());
  const jobs: ReleaseResult["jobs"] = [];
  if (projectKey && names.length > 0) {
    for (const machineId of [...machines].sort()) {
      jobs.push({
        machineId,
        jobId: await queueRemoveCheckouts(db, {
          companyId: input.companyId, projectId: input.projectId, projectKey, machineId, roles: names, createdBy: input.createdBy,
        }),
      });
    }
  }
  if (input.wholeProject) {
    await db.execute(sql`DELETE FROM ${crewTableSql("project_machines")}
      WHERE company_id = ${input.companyId} AND project_id = ${input.projectId}`);
  }
  return { ok: true, result: { archivedEnvironmentIds, jobs } };
}

/**
 * Máy chính (máy đã dựng project trước, `exceptMachineId`) được ghi `ready` khi environment mặc định của mọi agent vai
 * trò trỏ đúng host của máy, để máy chính được đếm như máy đã dựng project.
 */
async function markPrimaryReady(db: ExecDb, input: { companyId: string; projectId: string; machineId: string }): Promise<void> {
  const machine = await pairedMachine(db, input.companyId, input.machineId);
  if (!machine) return;
  const layout = await projectLayout(db, input.companyId, input.projectId);
  if (!layout) return;
  const ids = idList(layout.agents.map((agent) => agent.agentId));
  const hosts = rowsOf(await db.execute(sql`SELECT e.config->>'host' AS host
    FROM agents a JOIN environments e ON e.id = a.default_environment_id
    WHERE a.company_id = ${input.companyId} AND a.id = ANY(string_to_array(${ids}, ',')::uuid[])`));
  if (hosts.length !== layout.agents.length || hosts.some((row) => row.host !== machine.tailscaleIp)) return;
  await db.execute(sql`INSERT INTO ${crewTableSql("project_machines")} (company_id, project_id, machine_id, status)
    VALUES (${input.companyId}, ${input.projectId}, ${machine.machineId}, 'ready')
    ON CONFLICT (company_id, project_id, machine_id) DO UPDATE SET status = 'ready', error = NULL, updated_at = now()
    WHERE ${crewTableSql("project_machines")}.status <> 'ready'`);
}

/**
 * Dựng sẵn project trên mọi máy đã ghép khác `exceptMachineId` (wizard thêm project/agent, app thêm project). Máy offline
 * vẫn được xếp việc (việc chờ trong hàng đợi). Lỗi từng máy (chưa có repo, chưa có vai trò) nằm ở `skipped`.
 * `exceptMachineId` là máy chính, cùng mã máy `crew-mac status` dùng lúc ghép (`machine_pairings.machine_id`).
 */
export async function provisionOtherMachines(
  db: ExecDb,
  input: {
    companyId: string; projectId: string; exceptMachineId: string | null; includeReady: boolean;
    repo: { originUrl: string; branch: string } | null; createdBy: string;
  },
): Promise<ProvisionOthersResult> {
  if (input.repo && !(await readProjectRepo(db, input.companyId, input.projectId))) {
    await writeProjectRepo(db, {
      companyId: input.companyId, projectId: input.projectId, userId: input.createdBy, repo: { ...input.repo, companions: [] },
    });
  }
  if (input.exceptMachineId) {
    await markPrimaryReady(db, { companyId: input.companyId, projectId: input.projectId, machineId: input.exceptMachineId });
  }
  const result: ProvisionOthersResult = { queued: [], skipped: [] };
  for (const machine of await pairedMachines(db, input.companyId)) {
    if (machine.machineId === input.exceptMachineId?.toLowerCase()) continue;
    const row = await readProjectMachine(db, input.companyId, input.projectId, machine.machineId);
    if (row?.status === "provisioning") {
      result.skipped.push({ machineId: machine.machineId, reason: "provisioning" });
      continue;
    }
    if (row?.status === "ready" && !input.includeReady) {
      result.skipped.push({ machineId: machine.machineId, reason: "ready" });
      continue;
    }
    const started = await startProvisioning(db, {
      companyId: input.companyId, projectId: input.projectId, machineId: machine.machineId, createdBy: input.createdBy,
    });
    if (started.ok) result.queued.push({ machineId: machine.machineId, jobId: started.jobId });
    else result.skipped.push({ machineId: machine.machineId, reason: started.reason });
  }
  return result;
}
