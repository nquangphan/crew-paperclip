import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, environmentLeases, environments, heartbeatRuns, issues } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { applyCrewMachineTables, BOOK, MINI, seedCrewProject, seedPairing, seedReport, seedTemplate } from "./helpers/crew-machine-tables.js";
import {
  agentEnvironmentOnMachine, crewResolveRunEnvironment, findRootIssueId, insertAutoPin, loadMachineCandidates, pairedMachine, readPin,
  resolvePinnedEnvironment, setOwnerPin, treeStarted,
} from "../crew/machine-pin.ts";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

suite("ghim máy theo cây yêu cầu (Postgres)", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let ns: string;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-machine-pin-");
    db = createDb(temporary.connectionString);
    ns = await applyCrewMachineTables(db);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function world() {
    const p = await seedCrewProject(db, ns, { key: "kidy-school", host: BOOK.ip });
    const bookTemplate = await seedTemplate(db, BOOK);
    const miniTemplate = await seedTemplate(db, MINI);
    await seedPairing(db, ns, p.companyId, BOOK, bookTemplate);
    await seedPairing(db, ns, p.companyId, MINI, miniTemplate);
    const [root] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, title: "Gốc", status: "todo" }).returning();
    const [child] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, parentId: root!.id, title: "Con", status: "todo" }).returning();
    const [leaf] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, parentId: child!.id, title: "Cháu", status: "todo" }).returning();
    return { ...p, root: root!.id, child: child!.id, leaf: leaf!.id, bookTemplate, miniTemplate };
  }

  it("đi parentId lên tới issue gốc; issue không có thì null", async () => {
    const w = await world();
    expect(await findRootIssueId(db, w.companyId, w.leaf)).toBe(w.root);
    expect(await findRootIssueId(db, w.companyId, w.root)).toBe(w.root);
    expect(await findRootIssueId(db, w.companyId, "20000000-0000-4000-8000-00000000dead")).toBeNull();
  });

  it("cây chưa có lease thì chưa khóa; lease ở issue cháu (kể cả run đã xong) thì khóa", async () => {
    const w = await world();
    expect(await treeStarted(db, w.companyId, w.root)).toBe(false);
    const executor = w.agents["executor-1"];
    // Run đã xong, lease đã trả: không tính vào số run `running` của host ở ca ứng viên bên dưới.
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: w.companyId, agentId: executor.agentId, status: "succeeded", invocationSource: "on_demand",
      responsibleUserId: "owner", contextSnapshot: { issueId: w.leaf },
    }).returning();
    await db.insert(environmentLeases).values({
      companyId: w.companyId, environmentId: executor.environmentId, issueId: w.leaf, heartbeatRunId: run!.id, status: "released",
    });
    expect(await treeStarted(db, w.companyId, w.root)).toBe(true);
  });

  it("ghim tự động không đè ghim có sẵn; owner đổi được", async () => {
    const w = await world();
    const first = await insertAutoPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: BOOK.machineId, reason: { rule: "ready" } });
    expect(first.inserted).toBe(true);
    const second = await insertAutoPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: MINI.machineId, reason: { rule: "ready" } });
    expect(second).toMatchObject({ inserted: false, pin: { machineId: BOOK.machineId, source: "auto", reason: { rule: "ready" } } });
    const owner = await setOwnerPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: MINI.machineId });
    expect(owner).toMatchObject({ machineId: MINI.machineId, source: "owner", reason: {} });
    expect(await readPin(db, w.companyId, w.root)).toMatchObject({ machineId: MINI.machineId, source: "owner" });
  });

  it("environment của agent trên máy: mặc định nếu cùng host, không thì bản có crewAgentId; archived thì không", async () => {
    const w = await world();
    const executor = w.agents["executor-1"];
    const book = (await pairedMachine(db, w.companyId, BOOK.machineId))!;
    const mini = (await pairedMachine(db, w.companyId, MINI.machineId))!;
    expect(book).toMatchObject({ hostname: BOOK.hostname, tailscaleIp: BOOK.ip, port: 2222, templateEnvironmentId: w.bookTemplate });
    expect(await agentEnvironmentOnMachine(db, w.companyId, executor.agentId, book)).toBe(executor.environmentId);
    expect(await agentEnvironmentOnMachine(db, w.companyId, executor.agentId, mini)).toBeNull();
    const [onMini] = await db.insert(environments).values({
      name: `${executor.environmentName}@phans-mac-mini`, driver: "ssh", status: "active",
      config: { host: MINI.ip, port: 2222, username: "owner", remoteWorkspacePath: "/Users/owner/crew-agents/kidy-school/executor-1" },
      metadata: { workspaceRealizationMode: "in_place", crewAgentId: executor.agentId, crewMachineId: MINI.machineId },
    }).returning();
    expect(await agentEnvironmentOnMachine(db, w.companyId, executor.agentId, mini)).toBe(onMini!.id);
    await db.update(environments).set({ status: "archived" }).where(eq(environments.id, onMini!.id));
    expect(await agentEnvironmentOnMachine(db, w.companyId, executor.agentId, mini)).toBeNull();
  });

  it("resolvePinnedEnvironment: chưa ghim thì null; ghim máy thì environment trên máy đó; máy đã gỡ thì null", async () => {
    const w = await world();
    const executor = w.agents["executor-1"];
    const input = { companyId: w.companyId, agentId: executor.agentId, issueId: w.leaf };
    expect(await resolvePinnedEnvironment(db, input)).toBeNull();
    await insertAutoPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: BOOK.machineId, reason: {} });
    expect(await resolvePinnedEnvironment(db, input)).toBe(executor.environmentId);
    await db.execute(sql.raw(`UPDATE ${ns}.machine_pairings SET revoked_at = now() WHERE company_id = '${w.companyId}' AND machine_id = '${BOOK.machineId}'`));
    expect(await resolvePinnedEnvironment(db, input)).toBeNull();
  });

  it("crewResolveRunEnvironment: run gọi Trợ Lý bằng tag không có issueId thì lấy máy theo taskId; run khác thì không", async () => {
    const w = await world();
    const assistant = w.agents.assistant;
    await insertAutoPin(db, { companyId: w.companyId, rootIssueId: w.root, machineId: BOOK.machineId, reason: {} });
    const agent = { id: assistant.agentId, companyId: w.companyId };
    const called = { contextSnapshot: { wakeReason: "crew_assistant_called", taskId: w.root } };
    expect(await crewResolveRunEnvironment({ db, agent, issueId: null, run: called })).toBe(assistant.environmentId);
    expect(await crewResolveRunEnvironment({ db, agent, issueId: w.leaf, run: null })).toBe(assistant.environmentId);
    expect(await crewResolveRunEnvironment({
      db, agent, issueId: null, run: { contextSnapshot: { wakeReason: "issue_assigned", taskId: w.root } },
    })).toBeNull();
    expect(await crewResolveRunEnvironment({ db, agent, issueId: null })).toBeNull();
  });

  it("ứng viên: run running theo host qua lease active, trạng thái project, maxLoad1 của environment mẫu", async () => {
    const w = await world();
    const now = new Date();
    await seedReport(db, ns, w.companyId, BOOK, { receivedAt: now, load1: 3.5, cpuCount: 12, memFreePct: 60, pollAt: now });
    await seedReport(db, ns, w.companyId, MINI, { receivedAt: now, load1: 1, cpuCount: 10, memFreePct: 54, pollAt: null });
    await db.execute(sql.raw(`INSERT INTO ${ns}.project_machines (company_id, project_id, machine_id, status)
      VALUES ('${w.companyId}', '${w.projectId}', '${BOOK.machineId}', 'ready')`));
    const executor = w.agents["executor-1"];
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: w.companyId, agentId: executor.agentId, status: "running", invocationSource: "on_demand",
      responsibleUserId: "owner", contextSnapshot: { issueId: w.root },
    }).returning();
    await db.insert(environmentLeases).values({
      companyId: w.companyId, environmentId: executor.environmentId, issueId: w.root, heartbeatRunId: run!.id, status: "active",
    });
    const list = await loadMachineCandidates(db, w.companyId, w.projectId);
    expect(list.find((c) => c.machineId === BOOK.machineId)).toMatchObject({
      hostname: BOOK.hostname, projectStatus: "ready", running: 1, load1: 3.5, cpuCount: 12, memFreePct: 60, maxLoad1: 6,
    });
    expect(list.find((c) => c.machineId === MINI.machineId)).toMatchObject({ projectStatus: null, running: 0, jobsPollAt: null });
  });
});
