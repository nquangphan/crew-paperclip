import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { applyCrewMachineTables, BOOK, MINI, seedCrewProject, seedPairing, seedReport, seedTemplate } from "./helpers/crew-machine-tables.js";
import { setOwnerPin } from "../crew/machine-pin.ts";
import { resolveAgentMachine } from "../crew/runtime-switch.ts";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

suite("máy của agent theo ghim và host (Postgres)", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let ns: string;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-runtime-machine-");
    db = createDb(temporary.connectionString);
    ns = await applyCrewMachineTables(db);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  it("hai Mac cùng đường dẫn checkout: suy theo host của environment, không theo bản tin mới nhất", async () => {
    const p = await seedCrewProject(db, ns, { key: "kidy-school", host: BOOK.ip });
    await seedPairing(db, ns, p.companyId, BOOK, await seedTemplate(db, BOOK));
    await seedPairing(db, ns, p.companyId, MINI, await seedTemplate(db, MINI));
    const path = "/Users/owner/crew-agents/kidy-school/executor-1";
    const older = new Date(Date.now() - 60_000);
    await seedReport(db, ns, p.companyId, BOOK, { receivedAt: older, load1: 1, cpuCount: 12, memFreePct: 50, pollAt: null });
    await seedReport(db, ns, p.companyId, MINI, { receivedAt: new Date(), load1: 1, cpuCount: 10, memFreePct: 50, pollAt: null });
    await db.execute(sql.raw(`UPDATE ${ns}.machine_latest
      SET report = jsonb_build_object('checkouts', jsonb_build_array(jsonb_build_object('path', '${path}')))
      WHERE company_id = '${p.companyId}'`));
    expect(await resolveAgentMachine(db, { companyId: p.companyId, agentId: p.agents["executor-1"].agentId })).toBe(BOOK.machineId);
  });

  it("issue thuộc cây đã ghim: máy ghim, kể cả khi environment mặc định ở máy khác", async () => {
    const p = await seedCrewProject(db, ns, { key: "kidy-docs", host: BOOK.ip });
    await seedPairing(db, ns, p.companyId, BOOK, await seedTemplate(db, BOOK));
    await seedPairing(db, ns, p.companyId, MINI, await seedTemplate(db, MINI));
    const [root] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, title: "Gốc", status: "todo" }).returning();
    const [child] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, parentId: root!.id, title: "Con", status: "todo" }).returning();
    await setOwnerPin(db, { companyId: p.companyId, rootIssueId: root!.id, machineId: MINI.machineId });
    expect(await resolveAgentMachine(db, { companyId: p.companyId, agentId: p.agents.reviewer.agentId, issueId: child!.id })).toBe(MINI.machineId);
    expect(await resolveAgentMachine(db, { companyId: p.companyId, agentId: p.agents.reviewer.agentId, issueId: null })).toBe(BOOK.machineId);
  });

  it("host chưa ghép: giữ luật đường dẫn cũ (company một máy thì lấy máy đó)", async () => {
    const p = await seedCrewProject(db, ns, { key: "my-money", host: "100.64.9.9" });
    await seedReport(db, ns, p.companyId, MINI, { receivedAt: new Date(), load1: 1, cpuCount: 10, memFreePct: 50, pollAt: null });
    expect(await resolveAgentMachine(db, { companyId: p.companyId, agentId: p.agents.assistant.agentId })).toBe(MINI.machineId);
  });
});
