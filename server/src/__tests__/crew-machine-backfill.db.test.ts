import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { applyCrewMachineTables, BOOK, MINI, seedCrewProject, seedPairing, seedTemplate } from "./helpers/crew-machine-tables.js";
import { readPin, setOwnerPin } from "../crew/machine-pin.ts";
import { listProjectMachines } from "../crew/machine-provision.ts";

const script = readFileSync(fileURLToPath(new URL("../../../crew/ops/backfill-machines.sql", import.meta.url)), "utf8")
  .split(";")
  .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
  .filter((statement) => statement && !/^(BEGIN|COMMIT)$/i.test(statement));

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe.sequential : describe.skip;

suite("backfill máy cho project và cây đang mở", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let ns: string;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("crew-machine-backfill-");
    db = createDb(temporary.connectionString);
    ns = await applyCrewMachineTables(db);
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function runScriptTwice() {
    for (const statement of script) await db.execute(sql.raw(statement));
    for (const statement of script) await db.execute(sql.raw(statement));
  }

  async function moveDefaultEnvironment(environmentId: string, host: string) {
    await db.execute(sql`UPDATE environments SET config = jsonb_set(config, '{host}', to_jsonb(${host}::text)) WHERE id = ${environmentId}`);
  }

  it("gắn project với máy đang chạy nó, ghim cây mở vào máy đó, chạy lại không đổi gì", async () => {
    const kidy = await seedCrewProject(db, ns, { key: "kidy-school", host: BOOK.ip });
    await seedPairing(db, ns, kidy.companyId, BOOK, await seedTemplate(db, BOOK));
    await seedPairing(db, ns, kidy.companyId, MINI, await seedTemplate(db, MINI));
    const [open] = await db.insert(issues).values({ companyId: kidy.companyId, projectId: kidy.projectId, title: "Đang chạy", status: "in_progress" }).returning();
    const [done] = await db.insert(issues).values({ companyId: kidy.companyId, projectId: kidy.projectId, title: "Xong", status: "done" }).returning();
    const [cancelled] = await db.insert(issues).values({ companyId: kidy.companyId, projectId: kidy.projectId, title: "Hủy", status: "cancelled" }).returning();
    const [child] = await db.insert(issues).values({ companyId: kidy.companyId, projectId: kidy.projectId, parentId: open!.id, title: "Con", status: "todo" }).returning();
    const unpaired = await seedCrewProject(db, ns, { key: "my-money", host: "100.64.9.9" });
    const [unpairedOpen] = await db.insert(issues).values({ companyId: unpaired.companyId, projectId: unpaired.projectId, title: "Chưa ghép", status: "todo" }).returning();

    await runScriptTwice();

    expect(await listProjectMachines(db, kidy.companyId, kidy.projectId)).toEqual([
      expect.objectContaining({ machineId: BOOK.machineId, status: "ready", error: null }),
    ]);
    expect(await readPin(db, kidy.companyId, open!.id)).toMatchObject({ machineId: BOOK.machineId, source: "auto", reason: { backfill: true } });
    expect(await readPin(db, kidy.companyId, done!.id)).toBeNull();
    expect(await readPin(db, kidy.companyId, cancelled!.id)).toBeNull();
    expect(await readPin(db, kidy.companyId, child!.id)).toBeNull();
    expect(await listProjectMachines(db, unpaired.companyId, unpaired.projectId)).toEqual([]);
    expect(await readPin(db, unpaired.companyId, unpairedOpen!.id)).toBeNull();
  });

  it("project có agent trên hai máy: gắn cả hai, ghim theo máy của người nhận gốc, không có thì theo Trợ Lý, giữ ghim có sẵn", async () => {
    const p = await seedCrewProject(db, ns, { key: "two-macs", host: BOOK.ip });
    await seedPairing(db, ns, p.companyId, BOOK, await seedTemplate(db, BOOK));
    await seedPairing(db, ns, p.companyId, MINI, await seedTemplate(db, MINI));
    await moveDefaultEnvironment(p.agents.reviewer.environmentId, MINI.ip);
    await moveDefaultEnvironment(p.agents.integrator.environmentId, "100.64.9.9");
    const tree = async (title: string, assigneeAgentId: string | null) => {
      const [row] = await db.insert(issues).values({ companyId: p.companyId, projectId: p.projectId, title, status: "todo", assigneeAgentId }).returning();
      return row!.id;
    };
    const onMini = await tree("Giao reviewer", p.agents.reviewer.agentId);
    const unassigned = await tree("Chưa giao", null);
    const unknownHost = await tree("Giao integrator ở máy chưa ghép", p.agents.integrator.agentId);
    const ownerPinned = await tree("Owner đã ghim", p.agents.reviewer.agentId);
    await setOwnerPin(db, { companyId: p.companyId, rootIssueId: ownerPinned, machineId: BOOK.machineId });

    await runScriptTwice();

    expect(await listProjectMachines(db, p.companyId, p.projectId)).toEqual([
      expect.objectContaining({ machineId: MINI.machineId, status: "ready" }),
      expect.objectContaining({ machineId: BOOK.machineId, status: "ready" }),
    ]);
    expect(await readPin(db, p.companyId, onMini)).toMatchObject({ machineId: MINI.machineId, source: "auto", reason: { backfill: true } });
    expect(await readPin(db, p.companyId, unassigned)).toMatchObject({ machineId: BOOK.machineId, source: "auto" });
    expect(await readPin(db, p.companyId, unknownHost)).toMatchObject({ machineId: BOOK.machineId, source: "auto" });
    expect(await readPin(db, p.companyId, ownerPinned)).toMatchObject({ machineId: BOOK.machineId, source: "owner" });
  });
});
