import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, environments, projects } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { applyCrewMachineTables, BOOK, MINI, SECRET_ID, seedCrewProject, seedPairing, seedTemplate } from "./helpers/crew-machine-tables.js";

const { replaceRefs } = vi.hoisted(() => ({ replaceRefs: vi.fn(async () => undefined) }));
vi.mock("../services/secrets.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/secrets.ts")>()),
  secretService: () => ({ replaceSecretRefsForInstanceTarget: replaceRefs, syncEnvBindingsForTarget: async () => undefined }),
}));

import {
  machineEnvironmentName, projectLayout, projectProvisionable, readProjectMachine, readProjectRepo, reconcileProjectMachine,
  startProvisioning, writeProjectRepo,
} from "../crew/machine-provision.ts";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;
const ORIGIN = "git@github.com:nquangphan/kidy_school.git";
const DOCS = "git@github.com:nquangphan/kidy_school_2.0_docs.git";

suite("dựng project trên máy (Postgres)", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let ns: string;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-machine-provision-");
    db = createDb(temporary.connectionString);
    ns = await applyCrewMachineTables(db);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });
  beforeEach(() => replaceRefs.mockClear());

  async function world() {
    const p = await seedCrewProject(db, ns, { key: "kidy-school", host: BOOK.ip });
    await seedPairing(db, ns, p.companyId, BOOK, await seedTemplate(db, BOOK));
    const miniTemplate = await seedTemplate(db, MINI);
    await seedPairing(db, ns, p.companyId, MINI, miniTemplate);
    return { ...p, miniTemplate };
  }
  const jobs = (companyId: string) =>
    db.execute(sql.raw(`SELECT id::text AS id, kind, status, payload, created_by_user_id FROM ${ns}.crew_machine_jobs
      WHERE company_id = '${companyId}' ORDER BY created_at`));
  const rows = (result: unknown) => (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Record<string, unknown>[];

  it("bố cục project: khóa và tên checkout theo đường dẫn environment mặc định", async () => {
    const w = await world();
    expect(await projectLayout(db, w.companyId, w.projectId)).toEqual({
      projectKey: "kidy-school",
      agents: [
        { agentId: w.agents.assistant.agentId, checkoutName: "assistant", environmentName: w.agents.assistant.environmentName, crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 60 } },
        { agentId: w.agents["executor-1"].agentId, checkoutName: "executor-1", environmentName: w.agents["executor-1"].environmentName, crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 60 } },
        { agentId: w.agents.reviewer.agentId, checkoutName: "reviewer", environmentName: w.agents.reviewer.environmentName, crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 60 } },
        { agentId: w.agents.integrator.agentId, checkoutName: "integrator", environmentName: w.agents.integrator.environmentName, crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 60 } },
      ],
    });
  });

  it("bắt đầu dựng: máy chưa ghép, chưa có repo thì từ chối; có repo thì xếp đúng một việc ensure-project", async () => {
    const w = await world();
    const start = (machineId: string) => startProvisioning(db, { companyId: w.companyId, projectId: w.projectId, machineId, createdBy: "owner" });
    expect(await start("50000000-0000-4000-8000-0000000000ff")).toEqual({ ok: false, reason: "not_paired" });
    expect(await start(MINI.machineId)).toEqual({ ok: false, reason: "no_repo" });
    await writeProjectRepo(db, {
      companyId: w.companyId, projectId: w.projectId, userId: "owner",
      repo: { originUrl: ORIGIN, branch: "main", companions: [{ name: "kidy_school_2.0_docs", originUrl: DOCS }] },
    });
    const first = await start(MINI.machineId);
    const again = await start(MINI.machineId);
    expect(first.ok && again.ok && first.jobId === again.jobId).toBe(true);
    const list = rows(await jobs(w.companyId));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "ensure-project", status: "queued", created_by_user_id: "owner" });
    expect(list[0]!.payload).toEqual({
      kind: "ensure-project", projectKey: "kidy-school", projectId: w.projectId, originUrl: ORIGIN, branch: "main",
      roles: [
        { role: "assistant", branch: "agent/kidy-school-assistant" },
        { role: "executor-1", branch: "agent/kidy-school-executor-1" },
        { role: "reviewer", branch: "agent/kidy-school-reviewer" },
        { role: "integrator", branch: "agent/kidy-school-integrator" },
      ],
      companions: [{ name: "kidy_school_2.0_docs", originUrl: DOCS }],
    });
    expect(await readProjectMachine(db, w.companyId, w.projectId, MINI.machineId)).toMatchObject({ status: "provisioning", error: null });
  });

  it("việc xong: tạo environment cho từng agent trên máy, đúng host/secret/checkout, rồi ready; gọi lại không tạo thêm", async () => {
    const w = await world();
    await writeProjectRepo(db, { companyId: w.companyId, projectId: w.projectId, userId: "owner", repo: { originUrl: ORIGIN, branch: "main", companions: [] } });
    const started = await startProvisioning(db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId, createdBy: "crew:auto" });
    if (!started.ok) throw new Error("không xếp được việc");
    const result = {
      kind: "ensure-project", repoPath: "/Volumes/CORSAIR/Projects/kidy_school", cloned: false, companions: [],
      checkouts: ["assistant", "executor-1", "reviewer", "integrator"].map((role) => ({ role, path: `/Users/owner/crew-agents/kidy-school/${role}`, head: "a".repeat(40) })),
    };
    await db.execute(sql.raw(`UPDATE ${ns}.crew_machine_jobs SET status = 'done', result = '${JSON.stringify(result)}'::jsonb WHERE id = '${started.jobId}'`));

    const row = await reconcileProjectMachine(db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId });
    expect(row).toMatchObject({ status: "ready", repoPath: "/Volumes/CORSAIR/Projects/kidy_school", error: null });
    const created = await db.select().from(environments).where(sql`${environments.metadata}->>'crewMachineId' = ${MINI.machineId}`);
    const executor = w.agents["executor-1"];
    const env = created.find((item) => (item.metadata as Record<string, unknown>).crewAgentId === executor.agentId)!;
    expect(created).toHaveLength(4);
    expect(env.name).toBe(machineEnvironmentName(executor.environmentName, MINI.hostname));
    expect(env.name.endsWith("@phans-mac-mini")).toBe(true);
    expect(env.status).toBe("active");
    expect(env.config).toMatchObject({
      host: MINI.ip, port: 2222, username: "owner", knownHosts: `[${MINI.ip}]:2222 ssh-ed25519 AAAA`, strictHostKeyChecking: true,
      remoteWorkspacePath: "/Users/owner/crew-agents/kidy-school/executor-1",
      privateKeySecretRef: { type: "secret_ref", secretId: SECRET_ID, version: "latest" },
    });
    expect(env.metadata).toMatchObject({ workspaceRealizationMode: "in_place", crewLoadGate: { maxLoad1: 6, maxWaitMinutes: 60 } });
    expect(replaceRefs).toHaveBeenCalledWith(
      { targetType: "environment", targetId: env.id },
      [expect.objectContaining({ secretId: SECRET_ID, configPath: "privateKeySecretRef" })],
      expect.anything(),
    );

    await db.execute(sql.raw(`UPDATE ${ns}.project_machines SET status = 'provisioning' WHERE machine_id = '${MINI.machineId}' AND company_id = '${w.companyId}'`));
    await reconcileProjectMachine(db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId });
    expect(await db.select().from(environments).where(sql`${environments.metadata}->>'crewMachineId' = ${MINI.machineId}`)).toHaveLength(4);
  });

  it("việc lỗi thì failed kèm lý do; việc còn chờ thì vẫn provisioning dù lâu (máy tắt, việc nằm trong hàng đợi)", async () => {
    const w = await world();
    await writeProjectRepo(db, { companyId: w.companyId, projectId: w.projectId, userId: "owner", repo: { originUrl: ORIGIN, branch: "main", companions: [] } });
    const started = await startProvisioning(db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId, createdBy: "owner" });
    if (!started.ok) throw new Error("không xếp được việc");
    await db.execute(sql.raw(`UPDATE ${ns}.crew_machine_jobs SET status = 'failed', error_code = 'clone_auth_failed',
      error_text = 'GitHub từ chối key SSH của máy' WHERE id = '${started.jobId}'`));
    expect(await reconcileProjectMachine(db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId }))
      .toMatchObject({ status: "failed", error: "GitHub từ chối key SSH của máy" });

    const again = await startProvisioning(db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId, createdBy: "owner" });
    expect(again.ok).toBe(true);
    const later = new Date(Date.now() + 3 * 60 * 60_000);
    expect(await reconcileProjectMachine(db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId, now: later }))
      .toMatchObject({ status: "provisioning", error: null });
  });

  it("máy báo thiếu checkout của một agent (agent thêm sau khi việc được xếp): xếp lại việc, vẫn provisioning", async () => {
    const w = await world();
    await writeProjectRepo(db, { companyId: w.companyId, projectId: w.projectId, userId: "owner", repo: { originUrl: ORIGIN, branch: "main", companions: [] } });
    const started = await startProvisioning(db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId, createdBy: "owner" });
    if (!started.ok) throw new Error("không xếp được việc");
    const result = {
      kind: "ensure-project", repoPath: "/x", cloned: false, companions: [],
      checkouts: ["assistant", "reviewer", "integrator"].map((role) => ({ role, path: `/Users/owner/crew-agents/kidy-school/${role}`, head: "d".repeat(40) })),
    };
    await db.execute(sql.raw(`UPDATE ${ns}.crew_machine_jobs SET status = 'done', result = '${JSON.stringify(result)}'::jsonb WHERE id = '${started.jobId}'`));
    expect(await reconcileProjectMachine(db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId }))
      .toMatchObject({ status: "provisioning" });
    const queued = rows(await db.execute(sql.raw(`SELECT status FROM ${ns}.crew_machine_jobs
      WHERE company_id = '${w.companyId}' AND kind = 'ensure-project' AND status = 'queued'`)));
    expect(queued).toHaveLength(1);
  });

  it("environment cùng tên đã archive của chính agent được bật lại, không tạo bản mới", async () => {
    const w = await world();
    const executor = w.agents["executor-1"];
    const name = machineEnvironmentName(executor.environmentName, MINI.hostname);
    const [old] = await db.insert(environments).values({
      name, driver: "ssh", status: "archived", config: { host: MINI.ip },
      metadata: { crewAgentId: executor.agentId, crewMachineId: MINI.machineId },
    }).returning();
    await writeProjectRepo(db, { companyId: w.companyId, projectId: w.projectId, userId: "owner", repo: { originUrl: ORIGIN, branch: "main", companions: [] } });
    const started = await startProvisioning(db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId, createdBy: "owner" });
    if (!started.ok) throw new Error("không xếp được việc");
    const result = {
      kind: "ensure-project", repoPath: "/x", cloned: true, companions: [],
      checkouts: ["assistant", "executor-1", "reviewer", "integrator"].map((role) => ({ role, path: `/Users/owner/crew-agents/kidy-school/${role}`, head: "b".repeat(40) })),
    };
    await db.execute(sql.raw(`UPDATE ${ns}.crew_machine_jobs SET status = 'done', result = '${JSON.stringify(result)}'::jsonb WHERE id = '${started.jobId}'`));
    await reconcileProjectMachine(db, { companyId: w.companyId, projectId: w.projectId, machineId: MINI.machineId });
    const [again] = await db.select().from(environments).where(eq(environments.id, old!.id));
    expect(again).toMatchObject({ status: "active", config: expect.objectContaining({ host: MINI.ip, remoteWorkspacePath: "/Users/owner/crew-agents/kidy-school/executor-1" }) });
  });

  it("project dựng được khi có repo và ít nhất một checkout vai trò", async () => {
    const w = await world();
    expect(await projectProvisionable(db, w.companyId, w.projectId)).toBe(false);
    await writeProjectRepo(db, { companyId: w.companyId, projectId: w.projectId, userId: "owner", repo: { originUrl: ORIGIN, branch: "main", companions: [] } });
    expect(await projectProvisionable(db, w.companyId, w.projectId)).toBe(true);
    const [bare] = await db.insert(projects).values({ companyId: w.companyId, name: "không vai trò" }).returning();
    await writeProjectRepo(db, { companyId: w.companyId, projectId: bare!.id, userId: "owner", repo: { originUrl: ORIGIN, branch: "main", companions: [] } });
    expect(await projectProvisionable(db, w.companyId, bare!.id)).toBe(false);
  });

  it("không lưu origin https có userinfo, kể cả ở repo đi kèm", async () => {
    const w = await world();
    const write = (repo: { originUrl: string; branch: string; companions: { name: string; originUrl: string }[] }) =>
      writeProjectRepo(db, { companyId: w.companyId, projectId: w.projectId, userId: "owner", repo });
    await expect(write({ originUrl: "https://ghp_token@github.com/nquangphan/kidy_school.git", branch: "main", companions: [] }))
      .rejects.toThrow(/userinfo/);
    await expect(write({ originUrl: ORIGIN, branch: "main", companions: [{ name: "docs", originUrl: "https://u:p@github.com/x/y.git" }] }))
      .rejects.toThrow(/userinfo/);
    expect(await readProjectRepo(db, w.companyId, w.projectId)).toBeNull();
    expect(await write({ originUrl: "https://github.com/nquangphan/kidy_school.git", branch: "main", companions: [] }))
      .toMatchObject({ originUrl: "https://github.com/nquangphan/kidy_school.git" });
  });
});
