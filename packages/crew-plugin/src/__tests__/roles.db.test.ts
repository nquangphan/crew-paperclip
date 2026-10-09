import { readFile } from "node:fs/promises";
import { afterAll, expect, it } from "vitest";
import type { PluginApiRequestInput, PluginContext } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { pluginManifestV1Schema } from "../../../shared/src/validators/plugin.js";
import {
  derivePluginDatabaseNamespace,
  validatePluginMigrationStatement,
  validatePluginRuntimeExecute,
  validatePluginRuntimeQuery,
} from "../../../../server/src/services/plugin-database.js";
import manifest from "../manifest.js";
import { handleRolesApi } from "../roles/api.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000001";
const otherProject = "20000000-0000-4000-8000-000000000002";
const thirdProject = "20000000-0000-4000-8000-000000000003";
const [assistant, executorA, executorB, reviewer, integrator, spare] = [1, 2, 3, 4, 5, 6]
  .map((n) => `40000000-0000-4000-8000-00000000000${n}`);
const foreignAgent = "40000000-0000-4000-8000-000000000099";
const [retired, fresh] = ["40000000-0000-4000-8000-000000000007", "40000000-0000-4000-8000-000000000008"];
const userId = "user-board-1";
const ns = derivePluginDatabaseNamespace("crew.core");
let cleanup: (() => Promise<void>) | undefined;
afterAll(async () => { await cleanup?.(); });

const validBody = (overrides: Record<string, unknown> = {}) => ({
  companyId, assistantAgentId: assistant, executorAgentIds: [executorA, executorB],
  reviewerAgentId: reviewer, integratorAgentId: integrator, ...overrides,
});

function request(routeKey: string, options: {
  body?: unknown; project?: string; company?: string; actor?: PluginApiRequestInput["actor"];
} = {}): PluginApiRequestInput {
  const method = routeKey === "roles.get" ? "GET" : routeKey === "roles.set" ? "POST" : "DELETE";
  const project = options.project ?? projectId;
  const company = options.company ?? companyId;
  return {
    routeKey, method, path: `/projects/${project}/roles`, params: { projectId: project },
    query: method === "POST" ? {} : { companyId: company }, body: options.body ?? null,
    actor: options.actor ?? { actorType: "user", actorId: userId, userId, agentId: null, runId: null },
    companyId: company, headers: {},
  };
}

it("declares board-only role routes that pass the host manifest validator", () => {
  const parsed = pluginManifestV1Schema.parse(manifest);
  expect(parsed.capabilities).toContain("api.routes.register");
  expect(parsed.apiRoutes?.map((r) => [r.routeKey, r.method, r.path, r.auth, r.companyResolution])).toEqual([
    ["roles.get", "GET", "/projects/:projectId/roles", "board", { from: "query", key: "companyId" }],
    ["roles.set", "POST", "/projects/:projectId/roles", "board", { from: "body", key: "companyId" }],
    ["roles.delete", "DELETE", "/projects/:projectId/roles", "board", { from: "query", key: "companyId" }],
  ]);
});

it("stores project roles for a company, validates every id against the company and never writes bad input", async () => {
  const database = await startEmbeddedPostgresTestDatabase("crew-roles-");
  const sql = postgres(database.connectionString, { max: 2, onnotice: () => {} });
  cleanup = async () => { await sql.end(); await database.cleanup(); };
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${companyId},'Crew','CRE'),(${otherCompany},'Other','OTH')`;
  await sql`INSERT INTO projects (id,company_id,name) VALUES (${projectId},${companyId},'Repo A'),(${otherProject},${otherCompany},'Other'),(${thirdProject},${companyId},'Repo C')`;
  for (const [i, id] of [assistant, executorA, executorB, reviewer, integrator, spare, retired, fresh].entries()) {
    await sql`INSERT INTO agents (id,company_id,name) VALUES (${id},${companyId},${`Agent ${i}`})`;
  }
  await sql`INSERT INTO agents (id,company_id,name) VALUES (${foreignAgent},${otherCompany},'Foreign')`;
  await sql.unsafe(`CREATE SCHEMA ${ns}`);
  const migration = await readFile(new URL("../../migrations/0004_project_roles.sql", import.meta.url), "utf8");
  for (const statement of migration.split(";").map((part) => part.trim()).filter(Boolean)) {
    validatePluginMigrationStatement(statement, ns, manifest.database!.coreReadTables);
    await sql.unsafe(statement);
  }

  let dbCalls = 0;
  const ctx = { db: {
    namespace: ns,
    query: async <T>(query: string, params: unknown[] = []) => {
      dbCalls++;
      validatePluginRuntimeQuery(query, ns, manifest.database!.coreReadTables);
      return await sql.unsafe<T[]>(query, params as never[]);
    },
    execute: async (query: string, params: unknown[] = []) => {
      dbCalls++;
      validatePluginRuntimeExecute(query, ns);
      return { rowCount: (await sql.unsafe(query, params as never[])).count };
    },
  } } as unknown as PluginContext;
  const rows = async () => await sql.unsafe(`SELECT * FROM ${ns}.crew_project_roles ORDER BY project_id`);

  // 1. Valid set, read back, upsert replaces the row.
  expect(await handleRolesApi(ctx, request("roles.get"))).toEqual({ status: 200, body: { roles: null } });
  const set = await handleRolesApi(ctx, request("roles.set", { body: validBody({ reviewerAgentId: reviewer.toUpperCase() }) }));
  const expected = { assistantAgentId: assistant, executorAgentIds: [executorA, executorB], reviewerAgentId: reviewer, integratorAgentId: integrator };
  expect(set).toEqual({ status: 200, body: { roles: expected } });
  expect(await handleRolesApi(ctx, request("roles.get"))).toEqual({ status: 200, body: { roles: expected } });
  const replaced = { ...expected, executorAgentIds: [spare], reviewerAgentId: executorB };
  const otherUser = { actorType: "user" as const, actorId: "user-board-2", userId: "user-board-2", agentId: null, runId: null };
  expect(await handleRolesApi(ctx, request("roles.set", { body: validBody({ executorAgentIds: [spare], reviewerAgentId: executorB }), actor: otherUser })))
    .toEqual({ status: 200, body: { roles: replaced } });
  expect(await rows()).toHaveLength(1);
  expect((await rows())[0]).toMatchObject({ company_id: companyId, project_id: projectId, updated_by_user_id: "user-board-2" });
  expect(await handleRolesApi(ctx, request("roles.get"))).toEqual({ status: 200, body: { roles: replaced } });
  const snapshot = JSON.stringify(await rows());
  const unchanged = async () => expect(JSON.stringify(await rows())).toBe(snapshot);

  // 2. Agent from another company.
  expect(await handleRolesApi(ctx, request("roles.set", { body: validBody({ integratorAgentId: foreignAgent }) })))
    .toEqual({ status: 400, body: { error: `agent ${foreignAgent} không thuộc company` } });
  await unchanged();
  const ghost = "40000000-0000-4000-8000-0000000000aa";
  expect(await handleRolesApi(ctx, request("roles.set", { body: validBody({ executorAgentIds: [executorA, ghost] }) })))
    .toEqual({ status: 400, body: { error: `agent ${ghost} không thuộc company` } });
  await unchanged();

  // 3. Project from another company (and unknown project).
  for (const project of [otherProject, "20000000-0000-4000-8000-0000000000ff"]) {
    const res = await handleRolesApi(ctx, request("roles.set", { project, body: validBody() }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: `project ${project} không thuộc company` });
  }
  await unchanged();

  // 4. Role shape rules.
  for (const body of [
    validBody({ integratorAgentId: reviewer }),
    validBody({ executorAgentIds: [] }),
    validBody({ executorAgentIds: [executorA, executorB, spare] }),
    validBody({ executorAgentIds: [executorA, executorA] }),
    validBody({ assistantAgentId: executorA }),
    validBody({ reviewerAgentId: executorB }),
  ]) {
    const res = await handleRolesApi(ctx, request("roles.set", { body }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  }
  await unchanged();

  // 5. Agent actors are rejected even if the host lets them through.
  const agentActor = { actorType: "agent" as const, actorId: assistant, agentId: assistant, userId: null, runId: null };
  for (const routeKey of ["roles.get", "roles.set", "roles.delete"]) {
    const res = await handleRolesApi(ctx, request(routeKey, { body: validBody(), actor: agentActor }));
    expect(res.status).toBe(403);
  }
  await unchanged();

  // 7. Malformed input never reaches the database.
  const callsBefore = dbCalls;
  const { reviewerAgentId: _omit, ...missing } = validBody();
  for (const req of [
    request("roles.set", { body: missing }),
    request("roles.set", { body: validBody({ assistantAgentId: "not-a-uuid" }) }),
    request("roles.set", { body: validBody({ executorAgentIds: ["nope"] }) }),
    request("roles.set", { body: validBody({ executorAgentIds: executorA }) }),
    request("roles.set", { body: validBody({ extra: true }) }),
    request("roles.set", { body: validBody({ companyId: otherCompany }) }),
    request("roles.set", { body: null }),
    request("roles.set", { body: [validBody()] }),
    request("roles.set", { project: "bad", body: validBody() }),
    request("roles.get", { project: "bad" }),
    request("roles.delete", { project: "bad" }),
    request("roles.unknown"),
  ]) {
    const res = await handleRolesApi(ctx, req);
    expect([400, 404]).toContain(res.status);
  }
  expect(dbCalls).toBe(callsBefore);
  await unchanged();

  // Reads are scoped by company: another company sees nothing for this project.
  expect(await handleRolesApi(ctx, request("roles.get", { company: otherCompany }))).toEqual({ status: 200, body: { roles: null } });
  expect(await handleRolesApi(ctx, request("roles.delete", { company: otherCompany }))).toEqual({ status: 200, body: { deleted: false } });
  await unchanged();

  // 6. Delete is idempotent.
  expect(await handleRolesApi(ctx, request("roles.delete"))).toEqual({ status: 200, body: { deleted: true } });
  expect(await handleRolesApi(ctx, request("roles.delete"))).toEqual({ status: 200, body: { deleted: false } });
  expect(await handleRolesApi(ctx, request("roles.get"))).toEqual({ status: 200, body: { roles: null } });
  expect(await rows()).toHaveLength(0);

  // Table constraints back the API rules.
  await expect(sql.unsafe(`INSERT INTO ${ns}.crew_project_roles (company_id,project_id,assistant_agent_id,executor_agent_ids,reviewer_agent_id,integrator_agent_id,updated_by_user_id)
    VALUES ($1,$2,$3,$4::uuid[],$5,$5,'u')`, [companyId, projectId, assistant, `{${executorA}}`, reviewer])).rejects.toThrow();
  await expect(sql.unsafe(`INSERT INTO ${ns}.crew_project_roles (company_id,project_id,assistant_agent_id,executor_agent_ids,reviewer_agent_id,integrator_agent_id,updated_by_user_id)
    VALUES ($1,$2,$3,'{}'::uuid[],$4,$5,'u')`, [companyId, projectId, assistant, reviewer, integrator])).rejects.toThrow();

  // 8. A terminated agent cannot take a role (the gate would fail closed for the whole project right after).
  await sql`UPDATE agents SET status = 'terminated' WHERE id = ${retired}`;
  for (const body of [validBody({ reviewerAgentId: retired }), validBody({ executorAgentIds: [executorA, retired] })]) {
    expect(await handleRolesApi(ctx, request("roles.set", { body })))
      .toEqual({ status: 400, body: { error: `agent ${retired} đã terminated` } });
  }
  expect(await rows()).toHaveLength(0);

  // 9. Across projects of one company an agent is either a worker (assistant/executor) or a gate role
  //    (reviewer/integrator), never both: the gate forbids assigning work to any reviewer/integrator of the company.
  expect((await handleRolesApi(ctx, request("roles.set", { body: validBody() }))).status).toBe(200);
  for (const body of [
    // Worker in Repo A becomes a gate role here.
    validBody({ assistantAgentId: fresh, executorAgentIds: [spare], reviewerAgentId: executorA }),
    validBody({ assistantAgentId: fresh, executorAgentIds: [spare], integratorAgentId: assistant }),
    // Gate role in Repo A becomes a worker here.
    validBody({ assistantAgentId: fresh, executorAgentIds: [reviewer], reviewerAgentId: integrator, integratorAgentId: spare }),
    validBody({ assistantAgentId: integrator, executorAgentIds: [spare], integratorAgentId: fresh }),
  ]) {
    const res = await handleRolesApi(ctx, request("roles.set", { project: thirdProject, body }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.stringContaining("Repo A") });
  }
  expect(await rows()).toHaveLength(1);
  // Same role kind in two projects is fine; re-saving the same project never conflicts with itself.
  const sameKinds = validBody({ assistantAgentId: fresh, executorAgentIds: [executorA] });
  expect((await handleRolesApi(ctx, request("roles.set", { project: thirdProject, body: sameKinds }))).status).toBe(200);
  expect((await handleRolesApi(ctx, request("roles.set", { body: validBody() }))).status).toBe(200);
  // A row of a deleted project no longer counts.
  await sql`DELETE FROM projects WHERE id = ${projectId}`;
  const swapped = validBody({ assistantAgentId: reviewer, executorAgentIds: [integrator], reviewerAgentId: executorA, integratorAgentId: executorB });
  expect((await handleRolesApi(ctx, request("roles.set", { project: thirdProject, body: swapped }))).status).toBe(200);
}, 90_000);
