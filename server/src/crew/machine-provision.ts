import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { getConfiguredSecretProvider } from "../secrets/configured-provider.js";
import { collectEnvironmentSecretRefs, normalizeEnvironmentConfigForPersistence } from "../services/environment-config.js";
import { environmentService } from "../services/environments.js";
import { secretService } from "../services/secrets.js";
import {
  agentEnvironmentOnMachine, crewTableSql, type ExecDb, jsonRecord, type PairedMachine, pairedMachine,
} from "./machine-pin.js";
import type { ProjectMachineStatus } from "./machine-select.js";
import { rowsOf } from "./project-roles.js";

/**
 * Run của cây đã ghim chờ máy dựng project quá chừng này thì cổng H1 hủy run (máy tắt, app không chạy). Việc dựng vẫn nằm
 * trong hàng đợi và `project_machines` vẫn `provisioning` cho tới khi máy làm xong (owner chốt: máy offline thì việc chờ).
 */
export const PROVISION_TIMEOUT_MS = 60 * 60_000;
/** Checkout agent: `~/crew-agents/<khóa project>/<tên checkout>` (app 2P Crew và wizard web đều dựng như vậy). */
export const CHECKOUT_RE = /\/crew-agents\/([a-z][a-z0-9-]{1,30})\/([a-z][a-z0-9-]{0,30})\/?$/;
const ERROR_MAX = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Companion { name: string; originUrl: string }
export interface ProjectRepo { originUrl: string; branch: string; companions: Companion[] }
export interface ProjectRoleAgent { agentId: string; checkoutName: string; environmentName: string; crewLoadGate: unknown }
export interface ProjectLayout { projectKey: string; agents: ProjectRoleAgent[] }
export interface ProjectMachineRow {
  machineId: string;
  status: ProjectMachineStatus;
  error: string | null;
  repoPath: string | null;
  updatedAt: string;
}
export interface EnsureProjectPayload {
  kind: "ensure-project";
  projectKey: string;
  projectId: string;
  originUrl: string;
  branch: string;
  roles: { role: string; branch: string }[];
  companions: Companion[];
}
export interface EnsureProjectResult {
  kind: "ensure-project";
  repoPath: string;
  cloned: boolean;
  checkouts: { role: string; path: string; head: string }[];
  companions: { name: string; path: string }[];
}
export type ProvisionStart = { ok: true; jobId: string } | { ok: false; reason: "not_paired" | "no_repo" | "no_roles" };
export const PROVISION_UNAVAILABLE: Record<Extract<ProvisionStart, { ok: false }>["reason"], string> = {
  not_paired: "Máy chưa ghép, mở app 2P Crew → Máy → Ghép",
  no_repo: "Project chưa có origin repo: nhập ở trang project → Máy",
  no_roles: "Project chưa có vai trò hay checkout agent nào",
};

type Row = Record<string, unknown>;
const cut = (value: string) => (value.length > ERROR_MAX ? value.slice(0, ERROR_MAX) : value);

export async function readProjectRepo(db: ExecDb, companyId: string, projectId: string): Promise<ProjectRepo | null> {
  const rows = rowsOf(await db.execute(sql`SELECT origin_url, branch, companions FROM ${crewTableSql("project_repos")}
    WHERE company_id = ${companyId} AND project_id = ${projectId} LIMIT 1`));
  const row = rows[0];
  if (!row) return null;
  const list = Array.isArray(row.companions) ? row.companions : JSON.parse(String(row.companions ?? "[]"));
  return {
    originUrl: String(row.origin_url),
    branch: String(row.branch),
    companions: (list as unknown[]).map((item) => jsonRecord(item)).map((c) => ({ name: String(c.name), originUrl: String(c.originUrl) })),
  };
}

/** Origin `http(s)://user@…` mang token hay mật khẩu: không bao giờ lưu. */
const HTTP_USERINFO_RE = /^https?:\/\/[^/?#]*@/i;

/** Ghi origin và repo đi kèm của project; ném khi một origin `https` có userinfo. */
export async function writeProjectRepo(
  db: ExecDb, input: { companyId: string; projectId: string; repo: ProjectRepo; userId: string },
): Promise<ProjectRepo> {
  for (const origin of [input.repo.originUrl, ...input.repo.companions.map((c) => c.originUrl)]) {
    if (HTTP_USERINFO_RE.test(origin)) throw new Error("origin https không được chứa userinfo (user@ hay token@)");
  }
  await db.execute(sql`INSERT INTO ${crewTableSql("project_repos")}
      (company_id, project_id, origin_url, branch, companions, updated_by_user_id)
    VALUES (${input.companyId}, ${input.projectId}, ${input.repo.originUrl}, ${input.repo.branch},
      ${JSON.stringify(input.repo.companions)}::text::jsonb, ${input.userId})
    ON CONFLICT (company_id, project_id) DO UPDATE SET origin_url = EXCLUDED.origin_url, branch = EXCLUDED.branch,
      companions = EXCLUDED.companions, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`);
  return (await readProjectRepo(db, input.companyId, input.projectId))!;
}

/**
 * Agent vai trò của project (Trợ Lý, executor, reviewer, integrator, các ô runtime) cùng tên thư mục checkout của từng
 * agent, đọc từ environment mặc định. Agent không có checkout `~/crew-agents/<khóa>/<tên>` hay khác khóa thì bị bỏ.
 */
export async function projectLayout(db: ExecDb, companyId: string, projectId: string): Promise<ProjectLayout | null> {
  const roleRows = rowsOf(await db.execute(sql`SELECT to_jsonb(r) AS r FROM ${crewTableSql("crew_project_roles")} r
    WHERE r.company_id = ${companyId} AND r.project_id = ${projectId} LIMIT 1`));
  if (!roleRows[0]) return null;
  const r = jsonRecord(roleRows[0].r);
  const executors = Array.isArray(r.executor_agent_ids) ? r.executor_agent_ids : [];
  const ordered = [
    r.assistant_agent_id, ...executors, r.reviewer_agent_id, r.integrator_agent_id,
    r.codex_executor_agent_id, r.opencode_executor_agent_id, r.codex_reviewer_agent_id,
  ].filter((id): id is string => typeof id === "string" && UUID_RE.test(id)).map((id) => id.toLowerCase());
  const ids = [...new Set(ordered)];
  if (ids.length === 0) return null;
  const rows = rowsOf(await db.execute(sql`SELECT a.id::text AS id, e.name AS env_name,
      e.config->>'remoteWorkspacePath' AS path, e.metadata->'crewLoadGate' AS gate
    FROM agents a JOIN environments e ON e.id = a.default_environment_id
    WHERE a.company_id = ${companyId} AND a.status <> 'terminated'
      AND a.id = ANY(string_to_array(${ids.join(",")}, ',')::uuid[])`));
  const byId = new Map(rows.map((row) => [String(row.id).toLowerCase(), row] as const));
  let projectKey: string | null = null;
  const agents: ProjectRoleAgent[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    const match = row ? CHECKOUT_RE.exec(String(row.path ?? "")) : null;
    if (!row || !match || match[2] === "repo") continue;
    projectKey ??= match[1]!;
    if (match[1] !== projectKey || agents.some((agent) => agent.checkoutName === match[2])) continue;
    agents.push({ agentId: id, checkoutName: match[2]!, environmentName: String(row.env_name), crewLoadGate: row.gate ?? null });
  }
  return projectKey && agents.length > 0 ? { projectKey, agents } : null;
}

/** Project dựng được trên máy khác: có origin trong `project_repos` và ít nhất một checkout agent vai trò. */
export async function projectProvisionable(db: ExecDb, companyId: string, projectId: string): Promise<boolean> {
  if (!(await readProjectRepo(db, companyId, projectId))) return false;
  return (await projectLayout(db, companyId, projectId)) !== null;
}

export function ensureProjectPayload(projectId: string, layout: ProjectLayout, repo: ProjectRepo): EnsureProjectPayload {
  return {
    kind: "ensure-project",
    projectKey: layout.projectKey,
    projectId,
    originUrl: repo.originUrl,
    branch: repo.branch,
    roles: layout.agents.map((agent) => ({ role: agent.checkoutName, branch: `agent/${layout.projectKey}-${agent.checkoutName}` })),
    companions: repo.companions,
  };
}

const PM_COLUMNS = sql`machine_id::text AS machine_id, status, error, repo_path, updated_at`;
function toProjectMachine(row: Row): ProjectMachineRow {
  return {
    machineId: String(row.machine_id),
    status: row.status as ProjectMachineStatus,
    error: typeof row.error === "string" ? row.error : null,
    repoPath: typeof row.repo_path === "string" ? row.repo_path : null,
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

export async function readProjectMachine(
  db: ExecDb, companyId: string, projectId: string, machineId: string,
): Promise<ProjectMachineRow | null> {
  const rows = rowsOf(await db.execute(sql`SELECT ${PM_COLUMNS} FROM ${crewTableSql("project_machines")}
    WHERE company_id = ${companyId} AND project_id = ${projectId} AND machine_id = ${machineId} LIMIT 1`));
  return rows[0] ? toProjectMachine(rows[0]) : null;
}

export async function listProjectMachines(db: ExecDb, companyId: string, projectId: string): Promise<ProjectMachineRow[]> {
  const rows = rowsOf(await db.execute(sql`SELECT ${PM_COLUMNS} FROM ${crewTableSql("project_machines")}
    WHERE company_id = ${companyId} AND project_id = ${projectId} ORDER BY machine_id`));
  return rows.map(toProjectMachine);
}

async function setProjectMachine(
  db: ExecDb, key: { companyId: string; projectId: string; machineId: string },
  patch: { status: ProjectMachineStatus; error?: string | null; repoPath?: string | null },
): Promise<ProjectMachineRow | null> {
  await db.execute(sql`UPDATE ${crewTableSql("project_machines")}
    SET status = ${patch.status}, error = ${patch.error === undefined || patch.error === null ? null : cut(patch.error)},
      repo_path = coalesce(${patch.repoPath ?? null}::text, repo_path), updated_at = now()
    WHERE company_id = ${key.companyId} AND project_id = ${key.projectId} AND machine_id = ${key.machineId}`);
  return readProjectMachine(db, key.companyId, key.projectId, key.machineId);
}

/**
 * Đặt `project_machines` sang `provisioning` và xếp việc `ensure-project` cho máy (dùng lại việc còn `queued`/`claimed`
 * của cùng project và máy). Server ghi thẳng hàng đợi của plugin như các bảng plugin khác nó ghi.
 */
export async function startProvisioning(
  db: ExecDb, input: { companyId: string; projectId: string; machineId: string; createdBy: string },
): Promise<ProvisionStart> {
  const machine = await pairedMachine(db, input.companyId, input.machineId);
  if (!machine) return { ok: false, reason: "not_paired" };
  const repo = await readProjectRepo(db, input.companyId, input.projectId);
  if (!repo) return { ok: false, reason: "no_repo" };
  const layout = await projectLayout(db, input.companyId, input.projectId);
  if (!layout) return { ok: false, reason: "no_roles" };
  await db.execute(sql`INSERT INTO ${crewTableSql("project_machines")} (company_id, project_id, machine_id, status)
    VALUES (${input.companyId}, ${input.projectId}, ${input.machineId}, 'provisioning')
    ON CONFLICT (company_id, project_id, machine_id) DO UPDATE SET status = 'provisioning', error = NULL, updated_at = now()`);
  const open = rowsOf(await db.execute(sql`SELECT id::text AS id FROM ${crewTableSql("crew_machine_jobs")}
    WHERE company_id = ${input.companyId} AND machine_id = ${input.machineId} AND kind = 'ensure-project'
      AND status IN ('queued', 'claimed') AND payload->>'projectId' = ${input.projectId}
    ORDER BY created_at DESC LIMIT 1`));
  if (typeof open[0]?.id === "string") return { ok: true, jobId: open[0].id };
  const jobId = randomUUID();
  const payload = ensureProjectPayload(input.projectId, layout, repo);
  await db.execute(sql`INSERT INTO ${crewTableSql("crew_machine_jobs")} (id, company_id, machine_id, kind, payload, created_by_user_id)
    VALUES (${jobId}, ${input.companyId}, ${input.machineId}, 'ensure-project', ${JSON.stringify(payload)}::text::jsonb, ${input.createdBy})`);
  return { ok: true, jobId };
}

function parseResult(value: unknown): EnsureProjectResult | null {
  const r = jsonRecord(value);
  if (r.kind !== "ensure-project" || typeof r.repoPath !== "string" || !Array.isArray(r.checkouts)) return null;
  const checkouts = r.checkouts.map((item) => jsonRecord(item))
    .filter((c) => typeof c.role === "string" && typeof c.path === "string" && c.path.startsWith("/"))
    .map((c) => ({ role: String(c.role), path: String(c.path), head: String(c.head ?? "") }));
  return { kind: "ensure-project", repoPath: r.repoPath, cloned: r.cloned === true, checkouts, companions: [] };
}

/**
 * Đối chiếu `project_machines` đang `provisioning` với việc `ensure-project` mới nhất của project trên máy:
 * - `done`: tạo environment cho agent vai trò nào còn thiếu trên máy (theo checkout máy báo), rồi `ready`; máy không báo
 *   checkout của agent không có trong việc (agent thêm sau khi việc được xếp) thì xếp việc mới và giữ `provisioning`;
 *   thiếu checkout đã yêu cầu hay không tạo được environment (mẫu không active, trùng tên, secret) thì `failed`, giữ
 *   environment đã tạo;
 * - `failed`: `failed` kèm câu lỗi của app; `cancelled` hay không có việc: `failed`;
 * - còn chờ (kể cả rất lâu, máy tắt): giữ `provisioning`; cổng H1 tự hủy run chờ quá `PROVISION_TIMEOUT_MS`.
 * Gọi lại bao nhiêu lần cũng được; trạng thái khác `provisioning` thì trả nguyên.
 */
export async function reconcileProjectMachine(
  db: Db, input: { companyId: string; projectId: string; machineId: string },
): Promise<ProjectMachineRow | null> {
  const key = { companyId: input.companyId, projectId: input.projectId, machineId: input.machineId };
  const row = await readProjectMachine(db, input.companyId, input.projectId, input.machineId);
  if (!row || row.status !== "provisioning") return row;
  const jobs = rowsOf(await db.execute(sql`SELECT status, payload, result, error_code, error_text FROM ${crewTableSql("crew_machine_jobs")}
    WHERE company_id = ${input.companyId} AND machine_id = ${input.machineId} AND kind = 'ensure-project'
      AND payload->>'projectId' = ${input.projectId}
    ORDER BY created_at DESC, id DESC LIMIT 1`));
  const job = jobs[0];
  if (job?.status === "done") {
    const result = parseResult(job.result);
    if (!result) return setProjectMachine(db, key, { status: "failed", error: "Máy trả kết quả dựng project không hợp lệ" });
    const machine = await pairedMachine(db, input.companyId, input.machineId);
    if (!machine) return setProjectMachine(db, key, { status: "failed", error: "Máy chưa ghép, mở app 2P Crew → Máy → Ghép" });
    const layout = await projectLayout(db, input.companyId, input.projectId);
    if (!layout) return setProjectMachine(db, key, { status: "failed", error: "Project không còn vai trò" });
    const payloadRoles = jsonRecord(job.payload).roles;
    const requested = new Set(
      (Array.isArray(payloadRoles) ? payloadRoles : []).map((item) => jsonRecord(item).role).filter((role) => typeof role === "string"),
    );
    for (const agent of layout.agents) {
      if (await agentEnvironmentOnMachine(db, input.companyId, agent.agentId, machine)) continue;
      const checkout = result.checkouts.find((item) => item.role === agent.checkoutName);
      if (!checkout) {
        if (requested.has(agent.checkoutName)) {
          return setProjectMachine(db, key, { status: "failed", error: `Máy không dựng checkout ${agent.checkoutName}` });
        }
        const again = await startProvisioning(db, { ...key, createdBy: "crew:auto" });
        return again.ok ? readProjectMachine(db, input.companyId, input.projectId, input.machineId)
          : setProjectMachine(db, key, { status: "failed", error: PROVISION_UNAVAILABLE[again.reason] });
      }
      try {
        await createMachineEnvironment(db, { companyId: input.companyId, agent, machine, checkoutPath: checkout.path });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return setProjectMachine(db, key, {
          status: "failed", error: `Không tạo được environment cho ${agent.checkoutName}: ${reason}`,
        });
      }
    }
    return setProjectMachine(db, key, { status: "ready", error: null, repoPath: result.repoPath });
  }
  if (job?.status === "failed") {
    const text = typeof job.error_text === "string" && job.error_text ? job.error_text : String(job.error_code ?? "Dựng project thất bại");
    return setProjectMachine(db, key, { status: "failed", error: text });
  }
  if (!job) return setProjectMachine(db, key, { status: "failed", error: "Không có việc dựng project nào cho máy này" });
  if (job.status === "cancelled") return setProjectMachine(db, key, { status: "failed", error: "Việc dựng project đã bị hủy" });
  return row;
}

/** Tên environment của agent trên một máy: `<tên environment mặc định>@<tên máy>`. */
export function machineEnvironmentName(baseName: string, hostname: string): string {
  const slug = hostname.toLowerCase().replace(/\.local$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${baseName}@${slug || "may"}`;
}

type CreateInput = Exclude<Parameters<ReturnType<typeof environmentService>["create"]>[0], string>;

/**
 * Environment SSH của agent trên máy, đúng các bước của route tạo environment (`routes/environments.ts`): chuẩn hóa cấu
 * hình, ghi dòng và secret binding trong một transaction. Host, cổng, user, `knownHosts` và secret SSH chép từ environment
 * mẫu của máy; `crewLoadGate` chép từ mẫu (thiếu thì từ environment mặc định của agent). Environment cùng tên của chính
 * agent (kể cả đã archive) được bật lại và ghi đè cấu hình; cùng tên mà của agent khác thì ném.
 */
export async function createMachineEnvironment(
  db: Db, input: { companyId: string; agent: ProjectRoleAgent; machine: PairedMachine; checkoutPath: string },
): Promise<string> {
  const envs = environmentService(db);
  const template = await envs.getById(input.machine.templateEnvironmentId);
  if (!template || template.driver !== "ssh" || template.status !== "active") {
    throw new Error(`environment mẫu của máy ${input.machine.hostname} không còn active`);
  }
  const t = template.config as Record<string, unknown>;
  const config = {
    host: input.machine.tailscaleIp,
    port: t.port ?? input.machine.port,
    username: t.username,
    privateKeySecretRef: t.privateKeySecretRef,
    knownHosts: t.knownHosts,
    strictHostKeyChecking: true,
    remoteWorkspacePath: input.checkoutPath,
  };
  const gate = (template.metadata as Record<string, unknown> | null)?.crewLoadGate ?? input.agent.crewLoadGate ?? null;
  const metadata = {
    workspaceRealizationMode: "in_place",
    ...(gate ? { crewLoadGate: gate } : {}),
    crewAgentId: input.agent.agentId,
    crewMachineId: input.machine.machineId,
  };
  const name = machineEnvironmentName(input.agent.environmentName, input.machine.hostname);
  const existing = (await envs.list({ driver: "ssh" })).find((env) => env.name === name) ?? null;
  if (existing && (existing.metadata as Record<string, unknown> | null)?.crewAgentId !== input.agent.agentId) {
    throw new Error(`environment ${name} đã có và không thuộc agent ${input.agent.agentId}`);
  }
  const normalized = await normalizeEnvironmentConfigForPersistence({
    db, companyId: input.companyId, environmentName: name, driver: "ssh", secretProvider: getConfiguredSecretProvider(), config,
  });
  const secrets = secretService(db);
  return db.transaction(async (tx) => {
    const env = existing
      ? await envs.update(existing.id, { status: "active", config: normalized, metadata }, { db: tx })
      : await envs.create(
        {
          name, description: `Crew: ${input.agent.environmentName} trên ${input.machine.hostname}`, driver: "ssh",
          status: "active", config: normalized, envVars: {}, metadata,
        } satisfies CreateInput,
        undefined,
        { db: tx },
      );
    if (!env) throw new Error(`không ghi được environment ${name}`);
    await secrets.replaceSecretRefsForInstanceTarget(
      { targetType: "environment", targetId: env.id },
      await collectEnvironmentSecretRefs({ db, environment: env }),
      { db: tx },
    );
    await secrets.syncEnvBindingsForTarget(input.companyId, { targetType: "environment", targetId: env.id }, env.envVars, { db: tx });
    return env.id;
  });
}
