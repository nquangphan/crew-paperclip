import { afterAll, expect, it } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { closeRegisteredClients, createDb, pluginDatabaseNamespaces, plugins } from "../../../db/src/index.js";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { pluginDatabaseService } from "../../../../server/src/services/plugin-database.js";
import { loadCrewMap } from "../handlers/map.js";
import { loadDocsCheck } from "../docs/data.js";
import manifest from "../manifest.js";

const company = "10000000-0000-4000-8000-000000000001";
const agent = "20000000-0000-4000-8000-000000000001";
const hostPluginId = "60000000-0000-4000-8000-000000000001";
const ids = {
  root: "30000000-0000-4000-8000-000000000036",
  a: "30000000-0000-4000-8000-000000000037",
  b: "30000000-0000-4000-8000-000000000038",
  c: "30000000-0000-4000-8000-000000000039",
  repairRoot: "30000000-0000-4000-8000-000000000044",
  original: "30000000-0000-4000-8000-000000000045",
  fix: "30000000-0000-4000-8000-000000000046",
};
const stageIds = [1, 2, 3, 4].map((n) => `40000000-0000-4000-8000-00000000000${n}`);
const policy = (count: number) => ({
  mode: "approval", commentRequired: true, maxReviewRounds: 5,
  stages: stageIds.slice(0, count).map((id, index) => ({ id, type: count === 4 && index === 2 || count === 2 && index === 1 ? "approval" : "review", approvalsNeeded: 1,
    participants: count === 4 && index === 2 || count === 2 && index === 1
      ? [{ type: "user", userId: "50000000-0000-4000-8000-000000000001" }]
      : [{ type: "agent", agentId: agent }] })),
});
const state = (count: number, rounds = 0) => ({
  status: count === 4 ? "completed" : "pending",
  currentStageId: count === 4 ? null : stageIds[0],
  currentStageType: count === 4 ? null : "review",
  completedStageIds: count === 4 ? stageIds : [],
  changesRequestedCount: rounds,
});

let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => { await cleanup?.(); });

it("reads the CRE-36 dependency tree and a CRE-44 repair from embedded PostgreSQL", async () => {
  const database = await startEmbeddedPostgresTestDatabase("crew-map-");
  const sql = postgres(database.connectionString, { max: 2, onnotice: () => {} });
  const hostDb = createDb(database.connectionString);
  cleanup = async () => { await closeRegisteredClients(database.connectionString); await sql.end(); await database.cleanup(); };
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${company},'Crew map','CRE')`;
  await sql`INSERT INTO agents (id,company_id,name) VALUES (${agent},${company},'Executor')`;
  async function issue(id: string, identifier: string, parentId: string | null, description: string, status: string, stages = 1, rounds = 0) {
    await sql`INSERT INTO issues (id,company_id,parent_id,identifier,title,description,status,assignee_agent_id,execution_policy,execution_state)
      VALUES (${id},${company},${parentId},${identifier},${identifier + " title"},${description},${status},${agent},${JSON.stringify(policy(stages))}::jsonb,${JSON.stringify(state(stages, rounds))}::jsonb)`;
  }
  await issue(ids.root, "CRE-36", null, "Root", "done", 4);
  await issue(ids.a, "CRE-37", ids.root, "crew-bundle id=core seq=1", "done");
  await issue(ids.b, "CRE-38", ids.root, "crew-bundle id=core seq=2", "todo");
  await issue(ids.c, "CRE-39", ids.root, "crew-kind research", "done", 2);
  await sql`INSERT INTO issue_relations (company_id,issue_id,related_issue_id,type) VALUES (${company},${ids.a},${ids.b},'blocks')`;
  await sql`INSERT INTO issue_comments (company_id,issue_id,author_agent_id,body) VALUES (${company},${ids.root},${agent},${`crew-docs-check commit=${"d".repeat(40)} range=${"c".repeat(40)}..${"d".repeat(40)} exit=0`})`;
  await issue(ids.repairRoot, "CRE-44", null, "Root repair", "in_progress", 4);
  await issue(ids.original, "CRE-45", ids.repairRoot, "Original", "in_review", 1, 2);
  await issue(ids.fix, "CRE-46", ids.repairRoot, `crew-fix base=${"a".repeat(40)}`, "todo");
  await sql`INSERT INTO issue_comments (company_id,issue_id,body) VALUES (${company},${ids.original},${`crew-commit sha=${"a".repeat(40)} branch=crew/CRE-45 tests=ok result=ok`})`;
  await hostDb.insert(plugins).values({
    id: hostPluginId,
    pluginKey: manifest.id,
    packageName: "@crew/paperclip-plugin",
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    categories: manifest.categories,
    manifestJson: manifest,
    status: "installed",
  });
  const namespace = "plugin_crew_core";
  await hostDb.insert(pluginDatabaseNamespaces).values({
    pluginId: hostPluginId,
    pluginKey: manifest.id,
    namespaceName: namespace,
    namespaceMode: "schema",
    status: "active",
  });
  const pluginDb = pluginDatabaseService(hostDb);
  const ctx = {
    db: {
      namespace,
      query: <T>(statement: string, params?: unknown[]) => pluginDb.query<T>(hostPluginId, statement, params),
    },
  } as unknown as PluginContext;
  const first = await loadCrewMap(ctx, ids.b, company);
  expect(first.root.id).toBe(ids.root);
  expect(first.nodes).toHaveLength(4);
  expect(first.edges).toContainEqual({ kind: "dependency", from: ids.a, to: ids.b });
  expect(first.nodes.find((node) => node.id === ids.a)?.bundle).toEqual({ id: "core", seq: 1 });
  expect(first.nodes.find((node) => node.id === ids.c)?.kind).toBe("research");
  expect(first.root.stage?.completed).toEqual(stageIds);
  expect(await loadDocsCheck(ctx, ids.a, company)).toMatchObject({ commit: "d".repeat(40), exit: 0, author: agent });
  const second = await loadCrewMap(ctx, ids.repairRoot, company);
  expect(second.edges).toContainEqual({ kind: "repair", from: ids.original, to: ids.fix });
  expect(second.nodes.find((node) => node.id === ids.original)?.reviewRounds).toBe(2);
  expect(second.nodes.find((node) => node.id === ids.original)?.maxReviewRounds).toBe(5);
  expect(second.nodes.find((node) => node.id === ids.fix)?.kind).toBe("fix");
  await expect(loadCrewMap(ctx, ids.root, "10000000-0000-4000-8000-000000000099"))
    .rejects.toThrow("Issue không thuộc company hiện tại");
}, 90_000);
