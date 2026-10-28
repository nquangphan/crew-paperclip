import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { derivePluginDatabaseNamespace } from "../services/plugin-database.js";
import { DEFAULT_MAX_LOAD1, type MachineCandidate, type ProjectMachineStatus } from "./machine-select.js";
import { assistantCallTaskId } from "./assistant-call-routes.js";
import { CREW_PLUGIN_KEY, rowsOf } from "./project-roles.js";

/** `db` của server hoặc `tx` của một transaction: các hàm ở đây chỉ cần `execute`. */
export type ExecDb = Pick<Db, "execute">;

/** Cây sâu hơn mức này coi như dữ liệu hỏng (vòng `parentId`): không tìm được gốc thì không ghim. */
export const MAX_TREE_DEPTH = 50;
const DEPTH = sql.raw(String(MAX_TREE_DEPTH));

export const crewTable = (name: string): string => `${derivePluginDatabaseNamespace(CREW_PLUGIN_KEY)}.${name}`;
export const crewTableSql = (name: string) => sql.raw(crewTable(name));

export interface PairedMachine {
  machineId: string;
  hostname: string;
  tailscaleIp: string;
  port: number;
  /** Environment `may-<máy>` app tạo lúc ghép (`machine_pairings.environment_id`): mẫu host, cổng, user, secret SSH. */
  templateEnvironmentId: string;
}

export interface MachinePin {
  rootIssueId: string;
  machineId: string;
  source: "owner" | "auto";
  reason: Record<string, unknown>;
  pinnedAt: string;
}

type Row = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const iso = (value: unknown): string | null =>
  value === null || value === undefined ? null : new Date(value as string | Date).toISOString();
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function jsonRecord(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

/** Bảng của migration 0022 đã có. Chưa có (plugin chưa nâng cấp) thì mọi đường ghim máy giữ hành vi cũ. */
export async function machineTablesReady(db: ExecDb): Promise<boolean> {
  const rows = rowsOf(await db.execute(sql`SELECT to_regclass(${crewTable("issue_machine_pins")}) IS NOT NULL AS ok`));
  return rows[0]?.ok === true;
}

/** Issue gốc của cây: đi `parentId` lên tới issue không có cha, trong cùng company. */
export async function findRootIssueId(db: ExecDb, companyId: string, issueId: string): Promise<string | null> {
  const rows = rowsOf(await db.execute(sql`WITH RECURSIVE up(id, parent_id, depth) AS (
      SELECT id, parent_id, 0 FROM issues WHERE id = ${issueId} AND company_id = ${companyId}
      UNION ALL
      SELECT i.id, i.parent_id, up.depth + 1 FROM issues i JOIN up ON i.id = up.parent_id
      WHERE i.company_id = ${companyId} AND up.depth < ${DEPTH}
    )
    SELECT id::text AS id FROM up WHERE parent_id IS NULL LIMIT 1`));
  return text(rows[0]?.id);
}

/** Cây đã có run bắt đầu chạy trên một máy: có lease environment gắn với một issue của cây. */
export async function treeStarted(db: ExecDb, companyId: string, rootIssueId: string): Promise<boolean> {
  const rows = rowsOf(await db.execute(sql`WITH RECURSIVE tree(id, depth) AS (
      SELECT id, 0 FROM issues WHERE id = ${rootIssueId} AND company_id = ${companyId}
      UNION ALL
      SELECT i.id, tree.depth + 1 FROM issues i JOIN tree ON i.parent_id = tree.id
      WHERE i.company_id = ${companyId} AND tree.depth < ${DEPTH}
    )
    SELECT EXISTS (
      SELECT 1 FROM environment_leases l JOIN tree ON l.issue_id = tree.id WHERE l.company_id = ${companyId}
    ) AS started`));
  return rows[0]?.started === true;
}

const PIN_COLUMNS = sql`root_issue_id::text AS root_issue_id, machine_id::text AS machine_id, source, reason, pinned_at`;

function toPin(row: Row): MachinePin {
  return {
    rootIssueId: String(row.root_issue_id),
    machineId: String(row.machine_id),
    source: row.source === "owner" ? "owner" : "auto",
    reason: jsonRecord(row.reason),
    pinnedAt: iso(row.pinned_at) ?? new Date(0).toISOString(),
  };
}

export async function readPin(db: ExecDb, companyId: string, rootIssueId: string): Promise<MachinePin | null> {
  const rows = rowsOf(await db.execute(sql`SELECT ${PIN_COLUMNS} FROM ${crewTableSql("issue_machine_pins")}
    WHERE company_id = ${companyId} AND root_issue_id = ${rootIssueId} LIMIT 1`));
  return rows[0] ? toPin(rows[0]) : null;
}

/** Ghim `auto`; cây đã có ghim (kể cả của owner) thì giữ nguyên ghim cũ. `inserted` cho biết lần gọi này đã ghim. */
export async function insertAutoPin(
  db: ExecDb,
  input: { companyId: string; rootIssueId: string; machineId: string; reason: Record<string, unknown> },
): Promise<{ pin: MachinePin; inserted: boolean }> {
  const inserted = rowsOf(await db.execute(sql`INSERT INTO ${crewTableSql("issue_machine_pins")}
      (company_id, root_issue_id, machine_id, source, reason)
    VALUES (${input.companyId}, ${input.rootIssueId}, ${input.machineId}, 'auto', ${JSON.stringify(input.reason)}::text::jsonb)
    ON CONFLICT (company_id, root_issue_id) DO NOTHING
    RETURNING root_issue_id`));
  const pin = await readPin(db, input.companyId, input.rootIssueId);
  if (!pin) throw new Error(`crew: không đọc lại được ghim máy của ${input.rootIssueId}`);
  return { pin, inserted: inserted.length === 1 };
}

/** Ghim của owner thay mọi ghim cũ. Bên gọi kiểm trước: issue gốc, cây chưa có run, chỉ owner. */
export async function setOwnerPin(
  db: ExecDb,
  input: { companyId: string; rootIssueId: string; machineId: string },
): Promise<MachinePin> {
  await db.execute(sql`INSERT INTO ${crewTableSql("issue_machine_pins")} (company_id, root_issue_id, machine_id, source, reason)
    VALUES (${input.companyId}, ${input.rootIssueId}, ${input.machineId}, 'owner', '{}'::jsonb)
    ON CONFLICT (company_id, root_issue_id) DO UPDATE
      SET machine_id = EXCLUDED.machine_id, source = 'owner', reason = '{}'::jsonb, pinned_at = now()`);
  const pin = await readPin(db, input.companyId, input.rootIssueId);
  if (!pin) throw new Error(`crew: không đọc lại được ghim máy của ${input.rootIssueId}`);
  return pin;
}

const PAIRED_COLUMNS = sql`machine_id::text AS machine_id, hostname, tailscale_ip, port, environment_id::text AS environment_id`;

function toPaired(row: Row): PairedMachine {
  return {
    machineId: String(row.machine_id),
    hostname: String(row.hostname),
    tailscaleIp: String(row.tailscale_ip),
    port: Number(row.port),
    templateEnvironmentId: String(row.environment_id),
  };
}

/** Máy đã ghép, chưa gỡ, của company. Máy được nhận diện theo `tailscale_ip`, không theo đường dẫn checkout. */
export async function pairedMachines(db: ExecDb, companyId: string): Promise<PairedMachine[]> {
  const rows = rowsOf(await db.execute(sql`SELECT ${PAIRED_COLUMNS} FROM ${crewTableSql("machine_pairings")}
    WHERE company_id = ${companyId} AND revoked_at IS NULL ORDER BY hostname, machine_id`));
  return rows.map(toPaired);
}

export async function pairedMachine(db: ExecDb, companyId: string, machineId: string): Promise<PairedMachine | null> {
  const rows = rowsOf(await db.execute(sql`SELECT ${PAIRED_COLUMNS} FROM ${crewTableSql("machine_pairings")}
    WHERE company_id = ${companyId} AND machine_id = ${machineId} AND revoked_at IS NULL LIMIT 1`));
  return rows[0] ? toPaired(rows[0]) : null;
}

export async function machineOfHost(db: ExecDb, companyId: string, host: string): Promise<string | null> {
  const rows = rowsOf(await db.execute(sql`SELECT machine_id::text AS machine_id FROM ${crewTableSql("machine_pairings")}
    WHERE company_id = ${companyId} AND tailscale_ip = ${host} AND revoked_at IS NULL LIMIT 1`));
  return text(rows[0]?.machine_id);
}

/** Tên máy kể cả khi dòng ghép đã gỡ; không có dòng ghép thì lấy từ bản tin. */
export async function machineHostname(db: ExecDb, companyId: string, machineId: string): Promise<string | null> {
  const rows = rowsOf(await db.execute(sql`SELECT coalesce(
      (SELECT hostname FROM ${crewTableSql("machine_pairings")} WHERE company_id = ${companyId} AND machine_id = ${machineId} LIMIT 1),
      (SELECT hostname FROM ${crewTableSql("machine_latest")} WHERE company_id = ${companyId} AND machine_id = ${machineId} LIMIT 1)
    ) AS hostname`));
  return text(rows[0]?.hostname);
}

/**
 * Environment SSH `active` của agent trên máy: environment mặc định nếu nó trỏ đúng host của máy, không thì environment
 * Crew tạo cho agent trên máy đó (`metadata.crewAgentId`, xem `createMachineEnvironment`).
 */
export async function agentEnvironmentOnMachine(
  db: ExecDb, companyId: string, agentId: string, machine: PairedMachine,
): Promise<string | null> {
  const rows = rowsOf(await db.execute(sql`SELECT e.id::text AS id
    FROM environments e JOIN agents a ON a.id = ${agentId} AND a.company_id = ${companyId}
    WHERE e.driver = 'ssh' AND e.status = 'active' AND e.config->>'host' = ${machine.tailscaleIp}
      AND (e.id = a.default_environment_id OR e.metadata->>'crewAgentId' = ${agentId})
    ORDER BY coalesce(e.id = a.default_environment_id, false) DESC, e.created_at DESC
    LIMIT 1`));
  return text(rows[0]?.id);
}

/** Máy ghim của cây chứa `issueId`; bảng chưa có, không tìm được gốc hay chưa ghim thì `null`. */
export async function pinnedMachineId(db: ExecDb, companyId: string, issueId: string): Promise<string | null> {
  if (!(await machineTablesReady(db))) return null;
  const rootIssueId = await findRootIssueId(db, companyId, issueId);
  if (!rootIssueId) return null;
  return (await readPin(db, companyId, rootIssueId))?.machineId ?? null;
}

/** Environment của agent trên máy đã ghim cho cây của `issueId`, hoặc `null` (giữ hành vi stock). */
export async function resolvePinnedEnvironment(
  db: ExecDb, input: { companyId: string; agentId: string; issueId: string },
): Promise<string | null> {
  const machineId = await pinnedMachineId(db, input.companyId, input.issueId);
  if (!machineId) return null;
  const machine = await pairedMachine(db, input.companyId, machineId);
  if (!machine) return null;
  return agentEnvironmentOnMachine(db, input.companyId, input.agentId, machine);
}

/** Implementation Crew của hook lõi `resolveRunEnvironment`: environment của run theo máy đã ghim cho cây yêu cầu. */
export async function crewResolveRunEnvironment(input: {
  db: ExecDb;
  agent: { id: string; companyId: string };
  issueId: string | null;
  run?: { contextSnapshot?: unknown } | null;
}): Promise<string | null> {
  // Run gọi Trợ Lý bằng tag không mang issueId (xem `assistant-call-routes.ts`): máy theo issue ở `context.taskId`.
  const issueId = input.issueId ?? assistantCallTaskId(input.run?.contextSnapshot);
  if (!issueId) return null;
  return resolvePinnedEnvironment(input.db, { companyId: input.agent.companyId, agentId: input.agent.id, issueId });
}

const PROJECT_STATUSES: readonly ProjectMachineStatus[] = ["ready", "provisioning", "failed"];

/**
 * Ứng viên chọn máy cho một project: mọi máy đã ghép của company kèm bản tin mới nhất, trạng thái project trên máy, số run
 * `running` của cả instance trên host đó (lease `active`) và `maxLoad1` của environment mẫu (thiếu thì 8).
 */
export async function loadMachineCandidates(db: ExecDb, companyId: string, projectId: string): Promise<MachineCandidate[]> {
  const rows = rowsOf(await db.execute(sql`SELECT p.machine_id::text AS machine_id, p.hostname,
      l.received_at, l.load1, l.cpu_count, l.mem_free_pct, l.report->'jobsAgent'->>'lastPollAt' AS jobs_poll_at,
      pm.status AS project_status,
      (SELECT count(DISTINCT r.id) FROM heartbeat_runs r
         JOIN environment_leases el ON el.heartbeat_run_id = r.id AND el.status = 'active'
         JOIN environments e ON e.id = el.environment_id
       WHERE r.status = 'running' AND e.config->>'host' = p.tailscale_ip) AS running,
      (SELECT e.metadata->'crewLoadGate'->>'maxLoad1' FROM environments e WHERE e.id = p.environment_id) AS max_load1
    FROM ${crewTableSql("machine_pairings")} p
    LEFT JOIN ${crewTableSql("machine_latest")} l ON l.company_id = p.company_id AND l.machine_id = p.machine_id
    LEFT JOIN ${crewTableSql("project_machines")} pm
      ON pm.company_id = p.company_id AND pm.project_id = ${projectId} AND pm.machine_id = p.machine_id
    WHERE p.company_id = ${companyId} AND p.revoked_at IS NULL
    ORDER BY p.hostname, p.machine_id`));
  return rows.map((row) => {
    const status = PROJECT_STATUSES.find((value) => value === row.project_status) ?? null;
    const maxLoad1 = num(row.max_load1);
    return {
      machineId: String(row.machine_id),
      hostname: String(row.hostname),
      projectStatus: status,
      receivedAt: iso(row.received_at),
      jobsPollAt: text(row.jobs_poll_at) ? iso(row.jobs_poll_at) : null,
      load1: num(row.load1),
      cpuCount: num(row.cpu_count),
      memFreePct: num(row.mem_free_pct),
      running: num(row.running) ?? 0,
      maxLoad1: maxLoad1 !== null && maxLoad1 > 0 ? maxLoad1 : DEFAULT_MAX_LOAD1,
    };
  });
}
