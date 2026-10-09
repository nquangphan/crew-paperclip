import { createHash, createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PluginApiRequestInput, PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { createDb, plugins } from "../../../db/src/index.js";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { pluginDatabaseService } from "../../../../server/src/services/plugin-database.js";
import { pluginManifestV1Schema } from "../../../shared/src/validators/plugin.js";
import manifest from "../manifest.js";
import { receiveDocsSnapshot } from "../docs/webhook.js";
import { handleDocsApi } from "../docs/api.js";
import { loadDocsGraph } from "../docs/graph-data.js";
import { loadDocsStatus } from "../docs/status.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000001";
const sameCompanyProject = "20000000-0000-4000-8000-000000000003";
const emptyProject = "20000000-0000-4000-8000-000000000004";
const otherCompanyProject = "20000000-0000-4000-8000-000000000002";
const machineId = "50000000-0000-4000-8000-000000000001";
const hostPluginId = "60000000-0000-4000-8000-000000000001";
const agentId = "40000000-0000-4000-8000-000000000001";
const issueA = "70000000-0000-4000-8000-000000000001";
const issueB = "70000000-0000-4000-8000-000000000002";
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const page = (path: string, title: string, text: string) =>
  ({ path, title, parentPath: path.slice(0, path.lastIndexOf("/")), text, sha256: sha(text) });
const pages = [page("docs/index.md", "Mục lục", "# Mục lục"), page("docs/core.md", "Core", "# Core")];
const manifestText = 'version: 1\nsource: {include: ["src/**"]}\nflows: {core: {title: Core, doc: docs/core.md, files: [src/a.ts]}}\n';
const X = "a".repeat(40);
const Y = "b".repeat(40);
const snapshot = (commit: string) => ({
  version: 1, format: 2, companyId, machineId, projectId, repo: "repo-a", commit, auditState: "verified", checkExit: 0,
  pages, links: [{ fromPath: "docs/index.md", occurrence: 1, originalHref: "core.md", toPath: "docs/core.md", fragment: null, status: "ok" }],
  dropped: [], manifest: { status: "present", text: manifestText, sha256: sha(manifestText) },
  commits: { base: null, truncated: false, items: [{ sha: commit, merge: false, paths: ["src/a.ts", "README.md"] }] },
});

function signed(body: unknown): PluginWebhookInput {
  const rawBody = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const signature = `sha256=${createHmac("sha256", "test-secret").update(`${ts}.${rawBody}`).digest("hex")}`;
  return { endpointKey: "docs-snapshot", rawBody, requestId: "request-1",
    headers: { "X-Crew-Timestamp": String(ts), "X-Crew-Signature": signature } };
}

interface Host {
  sql: postgres.Sql;
  ctx: PluginContext;
  ns: string;
  warnings: Array<{ message: string; meta: unknown }>;
  applyMigrations: (root: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

/** Embedded Postgres with the real host plugin-database service, so SQL binding and validators match production. */
async function startHost(prefix: string, root = packageRoot): Promise<Host> {
  const database = await startEmbeddedPostgresTestDatabase(prefix);
  const sql = postgres(database.connectionString, { max: 4, onnotice: () => {} });
  const hostDb = createDb(database.connectionString);
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${companyId},'Crew','CRE'),(${otherCompany},'Other','OTH')`;
  await sql`INSERT INTO projects (id,company_id,name) VALUES (${projectId},${companyId},'Repo A'),(${sameCompanyProject},${companyId},'Repo B'),(${emptyProject},${companyId},'Empty'),(${otherCompanyProject},${otherCompany},'Other repo')`;
  await sql`INSERT INTO agents (id,company_id,name) VALUES (${agentId},${companyId},'Executor')`;
  await sql`INSERT INTO issues (id,company_id,project_id,identifier,title,status) VALUES (${issueA},${companyId},${projectId},'TPS-1','Sửa core','done'),(${issueB},${companyId},${sameCompanyProject},'TPS-9','Việc khác','done')`;
  await hostDb.insert(plugins).values({
    id: hostPluginId, pluginKey: manifest.id, packageName: "@crew/paperclip-plugin", version: manifest.version,
    apiVersion: manifest.apiVersion, categories: manifest.categories, manifestJson: manifest, status: "installed",
  });
  const pluginDb = pluginDatabaseService(hostDb);
  const applyMigrations = async (from: string) => {
    await pluginDb.applyMigrations(hostPluginId, manifest, from);
  };
  await applyMigrations(root);
  const ns = await pluginDb.getRuntimeNamespace(hostPluginId);
  const warnings: Host["warnings"] = [];
  const ctx = {
    db: {
      namespace: ns,
      query: <T>(statement: string, params?: unknown[]) => pluginDb.query<T>(hostPluginId, statement, params),
      execute: (statement: string, params?: unknown[]) => pluginDb.execute(hostPluginId, statement, params),
    },
    config: { get: async () => ({ companies: [{ companyId, webhookSecretRef: { type: "secret_ref", secretId: "40000000-0000-4000-8000-000000000001" } }] }) },
    secrets: { resolve: async () => "test-secret" },
    logger: { info: () => {}, debug: () => {}, error: () => {}, warn: (message: string, meta?: unknown) => { warnings.push({ message, meta }); } },
  } as unknown as PluginContext;
  return { sql, ctx, ns, warnings, applyMigrations,
    cleanup: async () => { await sql.end(); await database.cleanup(); } };
}


const request = (query: Record<string, string>, company = companyId, actorType: "user" | "agent" = "agent"): PluginApiRequestInput => ({
  routeKey: "docs.graph", method: "GET", path: "/docs/graph", params: {}, query, body: null,
  actor: { actorType, actorId: "actor-1", agentId: actorType === "agent" ? agentId : null, userId: actorType === "user" ? "u1" : null, runId: null },
  companyId: company, headers: {},
});

it("declares the docs graph route for board and agent that passes the host manifest validator", () => {
  const parsed = pluginManifestV1Schema.parse(manifest);
  const route = parsed.apiRoutes?.find((r) => r.routeKey === "docs.graph");
  expect([route?.method, route?.path, route?.auth, route?.companyResolution])
    .toEqual(["GET", "/docs/graph", "board-or-agent", { from: "query", key: "companyId" }]);
});

describe("docs graph and status on the real host database", () => {
  let host: Host;
  const comment = (issueId: string, body: string, author: "agent" | "user", at: string) =>
    host.sql.unsafe(`INSERT INTO issue_comments (company_id, issue_id, author_agent_id, author_user_id, body, created_at)
      VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`, [companyId, issueId, author === "agent" ? agentId : null, author === "user" ? "u1" : null, body, at]);

  beforeAll(async () => { host = await startHost("crew-docs-graph-"); }, 120_000);
  afterAll(async () => { await host?.cleanup(); });

  it("returns ticket edges only for agent commits of this project and serves the same body on the route", async () => {
    expect(await loadDocsStatus(host.ctx, companyId, projectId)).toMatchObject({ state: "missing", snapshot: null });
    expect(await loadDocsGraph(host.ctx, companyId, projectId)).toBeNull();
    expect(await handleDocsApi(host.ctx, request({ companyId, projectId }))).toEqual({ status: 404, body: { error: "Dự án chưa có tài liệu" } });

    await receiveDocsSnapshot(host.ctx, signed(snapshot(X)));
    await comment(issueA, `crew-commit sha=${X}`, "agent", "2026-10-10T01:00:00Z");
    await comment(issueB, `crew-commit sha=${X}`, "agent", "2026-10-10T01:01:00Z");
    const graph = await loadDocsGraph(host.ctx, companyId, projectId);
    expect(graph?.snapshot).toMatchObject({ commit: X, manifestState: "ok" });
    expect(graph?.edges.map((e) => e.id)).toContain(`ticket-flow:ticket:${issueA}->flow:core`);
    expect(graph?.nodes.some((n) => n.id === `ticket:${issueB}`)).toBe(false);
    const response = await handleDocsApi(host.ctx, request({ companyId, projectId }));
    expect(response?.status).toBe(200);
    expect(response?.body).toEqual(graph);
    expect(await handleDocsApi(host.ctx, request({ companyId, projectId, flowId: "core" }, companyId, "user")))
      .toMatchObject({ status: 200, body: { flowId: "core" } });
    expect(await handleDocsApi(host.ctx, { ...request({ companyId, projectId }), routeKey: "roles.get" })).toBeNull();
  });

  it("refuses another company's project, a mismatched company and bad parameters without leaking names", async () => {
    const cross = await handleDocsApi(host.ctx, request({ companyId: otherCompany, projectId }, otherCompany));
    expect(cross?.status).toBe(400);
    expect(cross?.body).toEqual({ error: "Dự án không thuộc company hiện tại" });
    expect(JSON.stringify(cross)).not.toContain("core");
    expect((await handleDocsApi(host.ctx, request({ companyId, projectId }, otherCompany)))?.status).toBe(400);
    expect((await handleDocsApi(host.ctx, request({ companyId, projectId: "nope" })))?.status).toBe(400);
    expect((await handleDocsApi(host.ctx, request({ companyId, projectId, flowId: "Bad Flow" })))?.status).toBe(400);
    expect((await handleDocsApi(host.ctx, request({ companyId, projectId: otherCompanyProject })))?.status).toBe(400);
    const foreign = await host.sql.unsafe(`SELECT id FROM ${host.ns}.docs_snapshots LIMIT 1`);
    await expect(loadDocsGraph(host.ctx, companyId, sameCompanyProject, { snapshotId: String(foreign[0]?.id) })).rejects.toThrow("Snapshot không thuộc dự án");
    expect((await handleDocsApi(host.ctx, request({ companyId, projectId: sameCompanyProject, snapshotId: String(foreign[0]?.id) })))?.status).toBe(400);
    expect(await loadDocsGraph(host.ctx, companyId, emptyProject)).toBeNull();
    expect((await handleDocsApi(host.ctx, request({ companyId, projectId: emptyProject })))?.status).toBe(404);
  });

  it("marks the docs stale only for an agent's pushed commit that no snapshot has seen", async () => {
    expect(await loadDocsStatus(host.ctx, companyId, projectId)).toMatchObject({ state: "current", staleKnown: false, latestPushed: null });
    await comment(issueA, `crew-merge sha=${X} branch=main pushed=yes`, "agent", "2026-10-10T01:10:00Z");
    expect(await loadDocsStatus(host.ctx, companyId, projectId)).toMatchObject({ state: "current", staleKnown: true });
    await comment(issueA, `crew-merge sha=${Y} branch=main pushed=yes`, "user", "2026-10-10T01:20:00Z");
    expect((await loadDocsStatus(host.ctx, companyId, projectId)).state).toBe("current");
    await comment(issueA, `crew-merge sha=${Y} branch=main pushed=yes`, "agent", "2026-10-10T01:30:00Z");
    const stale = await loadDocsStatus(host.ctx, companyId, projectId);
    expect(stale).toMatchObject({ state: "stale", staleKnown: true, latestPushed: { sha: Y, identifier: "TPS-1" } });
    expect(stale.reason).toBe(`Commit ${Y.slice(0, 12)} đã push lúc 08:30 10/10/2026 nhưng ảnh chụp docs chưa có commit này.`);
    await receiveDocsSnapshot(host.ctx, signed(snapshot(Y)));
    expect((await loadDocsStatus(host.ctx, companyId, projectId)).state).toBe("current");
    await expect(loadDocsStatus(host.ctx, otherCompany, projectId)).rejects.toThrow("Dự án không thuộc company hiện tại");
  });
});
