import { afterAll, expect, it } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { loadCrewRoots } from "../handlers/roots.js";

const company = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const root = "30000000-0000-4000-8000-000000000036";
const oldRoot = "30000000-0000-4000-8000-000000000035";
const policy = JSON.stringify({ maxReviewRounds: 5, stages: [{}, {}, {}, {}] });
let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => { await cleanup?.(); });

it("lists only company Crew roots, newest first, with direct child progress and execution stage", async () => {
  const database = await startEmbeddedPostgresTestDatabase("crew-roots-");
  const sql = postgres(database.connectionString, { max: 2, onnotice: () => {} });
  cleanup = async () => { await sql.end(); await database.cleanup(); };
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${company},'Crew roots','CRE'),(${other},'Other','OTH')`;
  async function issue(id: string, companyId: string, parentId: string | null, identifier: string, status: string, executionPolicy: string | null, updatedAt: string, stage = "review") {
    await sql`INSERT INTO issues (id,company_id,parent_id,identifier,title,status,execution_policy,execution_state,updated_at)
      VALUES (${id},${companyId},${parentId},${identifier},${identifier + " title"},${status},${executionPolicy}::jsonb,${JSON.stringify({currentStageId: stage, currentStageType: "review", completedStageIds: []})}::jsonb,${updatedAt}::timestamptz)`;
  }
  await issue(oldRoot, company, null, "CRE-35", "done", policy, "2026-10-01T00:00:00Z");
  await issue(root, company, null, "CRE-36", "in_progress", policy, "2026-10-02T00:00:00Z");
  await issue("30000000-0000-4000-8000-000000000037", company, root, "CRE-37", "done", null, "2026-10-02T00:00:00Z");
  await issue("30000000-0000-4000-8000-000000000038", company, root, "CRE-38", "todo", null, "2026-10-02T00:00:00Z");
  await issue("30000000-0000-4000-8000-000000000039", company, null, "CRE-39", "todo", null, "2026-10-03T00:00:00Z");
  await issue("30000000-0000-4000-8000-000000000040", other, null, "OTH-1", "todo", policy, "2026-10-04T00:00:00Z");
  const ctx = { db: { query: async <T>(query: string, params: unknown[] = []) => await sql.unsafe<T[]>(query, params as never[]) } } as unknown as PluginContext;
  const all = await loadCrewRoots(ctx, company);
  expect(all.map((item) => item.identifier)).toEqual(["CRE-36", "CRE-35"]);
  expect(all[0]).toMatchObject({ id: root, doneChildren: 1, totalChildren: 2, stage: { currentStageId: "review", currentType: "review" } });
  expect((await loadCrewRoots(ctx, company, "open")).map((item) => item.id)).toEqual([root]);
});
