import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { agents, companies, type Db, environments, projects } from "@paperclipai/db";
import { derivePluginDatabaseNamespace } from "../../services/plugin-database.js";

const migration = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../packages/crew-plugin/migrations/${file}`, import.meta.url)), "utf8")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

/** Bảng plugin luật nhiều máy dùng: bản tin máy, vai trò, hàng đợi việc, ghép máy và ba bảng của 0022. */
export async function applyCrewMachineTables(db: Db): Promise<string> {
  const ns = derivePluginDatabaseNamespace("crew.core");
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${ns}`));
  const statements = [
    ...migration("0003_machine_latest.sql").filter((s) => s.startsWith(`CREATE TABLE ${ns}.machine_latest`)),
    ...migration("0004_project_roles.sql"),
    ...migration("0006_machine_jobs.sql"),
    ...migration("0012_runtimes.sql"),
    ...migration("0014_machine_pairings.sql"),
    ...migration("0015_machine_pairings_unpaired_removal.sql"),
    ...migration("0022_multi_machine.sql"),
  ];
  for (const statement of statements) await db.execute(sql.raw(statement));
  return ns;
}

export interface TestMachine { machineId: string; hostname: string; ip: string }
export const BOOK: TestMachine = { machineId: "50000000-0000-4000-8000-0000000000b2", hostname: "Phans-MacBook-Pro", ip: "100.64.0.3" };
export const MINI: TestMachine = { machineId: "50000000-0000-4000-8000-0000000000a1", hostname: "Phans-Mac-mini", ip: "100.64.0.2" };
export const SECRET_ID = "90000000-0000-4000-8000-000000000001";
export const SLOTS = ["assistant", "executor-1", "reviewer", "integrator"] as const;

/** Environment `may-<máy>` app tạo lúc ghép: mẫu cho environment mới trên máy đó. */
export async function seedTemplate(db: Db, machine: TestMachine): Promise<string> {
  const id = randomUUID();
  await db.insert(environments).values({
    id,
    name: `may-${machine.hostname.toLowerCase()}-${id.slice(0, 6)}`,
    driver: "ssh",
    status: "active",
    config: {
      host: machine.ip, port: 2222, username: "owner", remoteWorkspacePath: "/Users/owner/crew-agents",
      privateKeySecretRef: { type: "secret_ref", secretId: SECRET_ID, version: "latest" },
      knownHosts: `[${machine.ip}]:2222 ssh-ed25519 AAAA`, strictHostKeyChecking: true,
    },
    metadata: { workspaceRealizationMode: "in_place", crewLoadGate: { maxLoad1: 6, maxWaitMinutes: 60 } },
  });
  return id;
}

export async function seedPairing(db: Db, ns: string, companyId: string, machine: TestMachine, templateId: string): Promise<void> {
  await db.execute(sql.raw(`INSERT INTO ${ns}.machine_pairings (company_id, machine_id, hostname, environment_id, tailscale_ip,
      port, host_key_fingerprint, key_nonce, paired_by_user_id)
    VALUES ('${companyId}', '${machine.machineId}', '${machine.hostname}', '${templateId}', '${machine.ip}', 2222,
      'SHA256:${"A".repeat(43)}', 'nonce', 'owner')`));
}

export async function seedReport(
  db: Db, ns: string, companyId: string, machine: TestMachine,
  report: { receivedAt: Date; load1: number | null; cpuCount: number; memFreePct: number | null; pollAt: Date | null },
): Promise<void> {
  const body = JSON.stringify({ jobsAgent: report.pollAt ? { version: "0.1.0", lastPollAt: report.pollAt.toISOString() } : undefined });
  await db.execute(sql.raw(`INSERT INTO ${ns}.machine_latest (company_id, machine_id, hostname, received_at, sent_at, load1,
      cpu_count, mem_free_pct, report)
    VALUES ('${companyId}', '${machine.machineId}', '${machine.hostname}', '${report.receivedAt.toISOString()}',
      '${report.receivedAt.toISOString()}', ${report.load1 ?? "NULL"}, ${report.cpuCount}, ${report.memFreePct ?? "NULL"}, '${body}'::jsonb)
    ON CONFLICT (company_id, machine_id) DO UPDATE SET received_at = EXCLUDED.received_at, load1 = EXCLUDED.load1,
      cpu_count = EXCLUDED.cpu_count, mem_free_pct = EXCLUDED.mem_free_pct, report = EXCLUDED.report`));
}

export interface SeededProject {
  companyId: string;
  projectId: string;
  agents: Record<(typeof SLOTS)[number], { agentId: string; environmentId: string; environmentName: string }>;
}

/** Company + project có bảng vai trò, mỗi vai một agent, environment mặc định ở `host` với checkout `~/crew-agents/<key>/<vai>`. */
export async function seedCrewProject(db: Db, ns: string, opts: { key: string; host: string }): Promise<SeededProject> {
  const companyId = randomUUID();
  await db.insert(companies).values({
    id: companyId, name: "Crew nhiều máy", issuePrefix: `M${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
    defaultResponsibleUserId: "owner",
  });
  const [project] = await db.insert(projects).values({ companyId, name: opts.key }).returning();
  const seeded = {} as SeededProject["agents"];
  for (const slot of SLOTS) {
    const environmentId = randomUUID();
    const environmentName = `${opts.key}-${slot}-${environmentId.slice(0, 6)}`;
    await db.insert(environments).values({
      id: environmentId, name: environmentName, driver: "ssh", status: "active",
      config: { host: opts.host, port: 2222, username: "owner", remoteWorkspacePath: `/Users/owner/crew-agents/${opts.key}/${slot}` },
      metadata: { workspaceRealizationMode: "in_place", crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 60 } },
    });
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId, companyId, name: `${opts.key} ${slot}`, role: "engineer", status: "idle", adapterType: "claude_local",
      adapterConfig: {}, permissions: {}, runtimeConfig: {}, defaultEnvironmentId: environmentId,
    });
    seeded[slot] = { agentId, environmentId, environmentName };
  }
  await db.execute(sql.raw(`INSERT INTO ${ns}.crew_project_roles (company_id, project_id, assistant_agent_id, executor_agent_ids,
      reviewer_agent_id, integrator_agent_id, updated_by_user_id)
    VALUES ('${companyId}', '${project!.id}', '${seeded.assistant.agentId}', ARRAY['${seeded["executor-1"].agentId}']::uuid[],
      '${seeded.reviewer.agentId}', '${seeded.integrator.agentId}', 'owner')`));
  return { companyId, projectId: project!.id, agents: seeded };
}
