import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { createDb, plugins } from "../../../db/src/index.js";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { pluginDatabaseService } from "../../../../server/src/services/plugin-database.js";
import manifest from "../manifest.js";
import { loadIssueUsage, loadUsageSummary } from "../usage/data.js";
import { USAGE_NOTES, type UsageTotals } from "../usage/rollup.js";

const C = "10000000-0000-4000-8000-000000000001";
const O = "10000000-0000-4000-8000-000000000002";
const P = "20000000-0000-4000-8000-000000000001";
const PO = "20000000-0000-4000-8000-000000000002";
const hostPluginId = "60000000-0000-4000-8000-000000000001";
const agent = (n: number) => `40000000-0000-4000-8000-00000000000${n}`;
const [A0, A1, A2, A3, AX] = [0, 1, 2, 3, 9].map(agent);
const issue = (n: number) => `70000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const [R, C1, C11, C2, H, H1] = [1, 2, 3, 4, 5, 6].map(issue);
const run = (n: number) => `90000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const now = new Date("2026-10-10T01:30:00Z");
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

interface Host { sql: postgres.Sql; ctx: PluginContext; ns: string; cleanup: () => Promise<void> }

/** Embedded Postgres with the real host plugin-database service, so SQL binding and validators match production. */
async function startHost(): Promise<Host> {
  const database = await startEmbeddedPostgresTestDatabase("crew-usage-");
  const sql = postgres(database.connectionString, { max: 4, onnotice: () => {} });
  const hostDb = createDb(database.connectionString);
  await hostDb.insert(plugins).values({
    id: hostPluginId, pluginKey: manifest.id, packageName: "@crew/paperclip-plugin", version: manifest.version,
    apiVersion: manifest.apiVersion, categories: manifest.categories, manifestJson: manifest, status: "installed",
  });
  const pluginDb = pluginDatabaseService(hostDb);
  await pluginDb.applyMigrations(hostPluginId, manifest, packageRoot);
  const ns = await pluginDb.getRuntimeNamespace(hostPluginId);
  const ctx = {
    db: {
      namespace: ns,
      query: <T>(statement: string, params?: unknown[]) => pluginDb.query<T>(hostPluginId, statement, params),
      execute: (statement: string, params?: unknown[]) => pluginDb.execute(hostPluginId, statement, params),
    },
    logger: { info: () => {}, debug: () => {}, error: () => {}, warn: () => {} },
  } as unknown as PluginContext;
  return { sql, ctx, ns, cleanup: async () => { await sql.end(); await database.cleanup(); } };
}

type Ce = { input: number; cached?: number; output: number; issue?: string | null };
type RunSeed = { id: string; company?: string; agent: string; status: string; ctx: object; finished?: boolean;
  usage?: object | null; modelUsage?: object; ce?: Ce[] };

const perRun = (costUsd: number, sessionReused: boolean | null = null) =>
  ({ costUsd, cacheAdjustedCostUsd: costUsd, usageSource: "per_run", ...(sessionReused === null ? {} : { sessionReused }) });

const runs: RunSeed[] = [
  // R: run của Trợ Lý có đủ số liệu.
  { id: run(1), agent: A0, status: "succeeded", ctx: { issueId: R }, usage: perRun(0.1, false),
    modelUsage: { "claude-opus-5": { inputTokens: 90, cacheCreationInputTokens: 10, cacheReadInputTokens: 10, outputTokens: 20, costUSD: 0.1 } },
    ce: [{ input: 100, cached: 10, output: 20, issue: R }] },
  // C1: executor thất bại, executor chạy lại có HAI dòng cost_events, reviewer thiếu ước tính USD.
  { id: run(2), agent: A1, status: "failed", ctx: { issueId: C1 }, usage: perRun(0.05, true), ce: [{ input: 10, output: 1, issue: C1 }] },
  { id: run(3), agent: A1, status: "succeeded", ctx: { issueId: C1 }, usage: perRun(0.07), ce: [{ input: 5, output: 2, issue: C1 }, { input: 7, output: 3, issue: C1 }] },
  { id: run(4), agent: A2, status: "succeeded", ctx: { issueId: C1 }, usage: null, ce: [{ input: 20, output: 4, issue: C1 }] },
  // C11: executor bị hủy, không có số liệu nào.
  { id: run(5), agent: A1, status: "cancelled", ctx: { issueId: C11 }, usage: null },
  // C2: đang chạy, đã có một dòng cost_events nhưng chưa được cộng.
  { id: run(6), agent: A1, status: "running", finished: false, ctx: { issueId: C2 }, usage: null, ce: [{ input: 50, output: 5, issue: C2 }] },
  // H ẩn và con của H: không được tính.
  { id: run(7), agent: A1, status: "succeeded", ctx: { issueId: H }, usage: perRun(1), ce: [{ input: 1000, output: 100, issue: H }] },
  { id: run(8), agent: A1, status: "succeeded", ctx: { issueId: H1 }, usage: perRun(1), ce: [{ input: 1000, output: 100, issue: H1 }] },
  // Run không gắn issue trong project P.
  { id: run(9), agent: A3, status: "succeeded", ctx: { projectId: P }, usage: perRun(0.01), ce: [{ input: 3, output: 1, issue: null }] },
  // Company khác giả issueId của R.
  { id: run(10), company: O, agent: AX, status: "succeeded", ctx: { issueId: R }, usage: perRun(9), ce: [{ input: 999, output: 999, issue: R }] },
];

async function seed({ sql, ns }: Host): Promise<void> {
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${C},'Crew','CRE'),(${O},'Other','OTH')`;
  await sql`INSERT INTO projects (id,company_id,name) VALUES (${P},${C},'Repo A'),(${PO},${O},'Repo O')`;
  await sql`INSERT INTO agents (id,company_id,name) VALUES (${A0},${C},'Trợ Lý'),(${A1},${C},'Exec'),(${A2},${C},'Review'),(${A3},${C},'Merge'),(${AX},${O},'Lạ')`;
  await sql.unsafe(`INSERT INTO ${ns}.crew_project_roles (company_id,project_id,assistant_agent_id,executor_agent_ids,reviewer_agent_id,integrator_agent_id,updated_by_user_id)
    VALUES ($1,$2,$3,$4::uuid[],$5,$6,'u')`, [C, P, A0, `{${A1}}`, A2, A3]);
  const issues: Array<[string, string | null, string, string, string, boolean]> = [
    [R, null, "TPS-1", "Gốc", "in_progress", false], [C1, R, "TPS-2", "Con một", "done", false], [C11, C1, "TPS-3", "Cháu", "cancelled", false],
    [C2, R, "TPS-4", "Con hai", "in_progress", false], [H, R, "TPS-5", "Ẩn", "done", true], [H1, H, "TPS-6", "Con của ẩn", "done", false],
  ];
  for (const [id, parent, identifier, title, status, hidden] of issues) {
    await sql`INSERT INTO issues (id,company_id,project_id,parent_id,identifier,title,status,hidden_at)
      VALUES (${id},${C},${P},${parent},${identifier},${title},${status},${hidden ? now : null})`;
  }
  for (const [i, r] of runs.entries()) {
    const started = new Date(now.getTime() - (24 - i) * 3_600_000);
    await sql`INSERT INTO heartbeat_runs (id,company_id,agent_id,status,started_at,finished_at,context_snapshot,usage_json,result_json)
      VALUES (${r.id},${r.company ?? C},${r.agent},${r.status},${started},${r.finished === false ? null : new Date(started.getTime() + 60_000)},
        ${sql.json(r.ctx as postgres.JSONValue)},${r.usage ? sql.json(r.usage as postgres.JSONValue) : null},
        ${r.modelUsage ? sql.json({ modelUsage: r.modelUsage } as postgres.JSONValue) : null})`;
    for (const ce of r.ce ?? []) {
      await sql`INSERT INTO cost_events (company_id,agent_id,issue_id,project_id,heartbeat_run_id,provider,model,billing_type,input_tokens,cached_input_tokens,output_tokens,cost_cents,occurred_at)
        VALUES (${r.company ?? C},${r.agent},${ce.issue ?? null},${r.company === O ? PO : P},${r.id},'anthropic','claude-sonnet-5','subscription_included',${ce.input},${ce.cached ?? 0},${ce.output},0,${started})`;
    }
  }
}

const NUMERIC_KEYS = ["runs", "runsWithUsage", "runsMissing", "runsRunning", "inputTokens", "cachedInputTokens", "outputTokens",
  "estimatedUsd", "estimatedUsdRuns", "billedCents"] as const satisfies ReadonlyArray<keyof UsageTotals>;

describe("usage rollup on Paperclip tables", () => {
  let host: Host;
  beforeAll(async () => { host = await startHost(); await seed(host); }, 120_000);
  afterAll(async () => { await host?.cleanup(); });

  it("splits direct and tree usage without double counting or losing runs", async () => {
    const usage = await loadIssueUsage(host.ctx, C, R);
    expect(usage).not.toBeNull();
    if (!usage) return;
    expect(usage.issue).toEqual({ id: R, identifier: "TPS-1", title: "Gốc" });
    expect(usage.direct).toMatchObject({ runs: 1, inputTokens: 100, cachedInputTokens: 10, outputTokens: 20, estimatedUsd: 0.1, completeness: "day_du" });
    const tree = usage.tree;
    expect(tree).not.toBeNull();
    if (!tree) return;
    // R 1 + C1 3 + C11 1 + C2 1. Không có run của H/H1 hay company khác.
    expect(tree).toMatchObject({ runs: 6, runsWithUsage: 4, runsMissing: 1, runsRunning: 1,
      inputTokens: 100 + 10 + 12 + 20, outputTokens: 20 + 1 + 5 + 4, estimatedUsdRuns: 3, billedCents: 0, completeness: "mot_phan" });
    expect(tree.estimatedUsd).toBeCloseTo(0.22, 6);

    expect(usage.children.map((c) => [c.id, c.identifier, c.status, c.tree.runs])).toEqual([[C1, "TPS-2", "done", 4], [C2, "TPS-4", "in_progress", 1]]);
    for (const key of NUMERIC_KEYS) {
      const parts = (usage.direct[key] ?? 0) + usage.children.reduce((sum, c) => sum + (c.tree[key] ?? 0), 0);
      expect(tree[key] ?? 0, key).toBeCloseTo(parts, 6);
    }

    const role = (r: string) => usage.byRole.find((x) => x.role === r)?.totals;
    expect(usage.byRole.map((r) => r.role).sort()).toEqual(["assistant", "executor", "reviewer"]);
    expect(role("executor")).toMatchObject({ runs: 4, runsMissing: 1, runsRunning: 1, inputTokens: 22 });
    expect(role("reviewer")).toMatchObject({ runs: 1, inputTokens: 20, estimatedUsd: null, completeness: "mot_phan" });

    const runRow = (id: string) => usage.runs.find((r) => r.runId === id);
    expect(runRow(run(3))).toMatchObject({ inputTokens: 12, outputTokens: 5, issueId: C1, identifier: "TPS-2", role: "executor", completeness: "day_du" });
    expect(runRow(run(5))).toMatchObject({ completeness: "thieu", inputTokens: null, outputTokens: null, estimatedUsd: null, identifier: "TPS-3" });
    expect(runRow(run(6))?.completeness).toBe("dang_chay");
    expect(usage.runs).toHaveLength(6);
    expect(usage.runs.map((r) => r.runId)).toEqual([run(6), run(5), run(4), run(3), run(2), run(1)]);
    expect(usage.runsTruncated).toBe(false);
    expect(Object.keys(usage.runs[0] ?? {})).not.toContain("models");
    expect(Object.keys(usage.runs[0] ?? {})).not.toContain("billedCents");

    expect(usage.byModel).toEqual(expect.arrayContaining([
      { model: "claude-opus-5", source: "model_usage", inputTokens: 100, cachedInputTokens: 10, outputTokens: 20, estimatedUsd: 0.1 },
    ]));
    expect(usage.byModel.find((m) => m.model === "claude-sonnet-5")).toMatchObject({ source: "run_model", inputTokens: 42, outputTokens: 10, estimatedUsd: null });
    expect(usage.reuse).toEqual({ fresh: 1, reused: 1, unknown: 3 });
    expect(usage.notes).toEqual([...USAGE_NOTES]);
  });

  it("an issue without children has a null tree", async () => {
    const usage = await loadIssueUsage(host.ctx, C, C2);
    expect(usage?.tree).toBeNull();
    expect(usage?.direct).toMatchObject({ runs: 1, runsRunning: 1, inputTokens: 0, completeness: "khong_co" });
  });

  it("does not leak across companies or into hidden issues", async () => {
    expect(await loadIssueUsage(host.ctx, O, R)).toBeNull();
    expect(await loadIssueUsage(host.ctx, C, H)).toBeNull();
    await expect(loadIssueUsage(host.ctx, C, "not-a-uuid")).rejects.toThrow("ID không hợp lệ");
  });

  it("summarises a project window with unattributed runs and top roots", async () => {
    const summary = await loadUsageSummary(host.ctx, C, { projectId: P, days: 7, now });
    expect(summary.from).toBe("2026-10-03T17:00:00.000Z");
    expect(summary.to).toBe(now.toISOString());
    expect(summary.projectId).toBe(P);
    expect(summary.unattributed).toMatchObject({ runs: 1, inputTokens: 3 });
    expect(summary.totals).toMatchObject({ runs: 7, runsMissing: 1, runsRunning: 1, inputTokens: 145 });
    expect(summary.topRoots.map((r) => [r.id, r.identifier, r.tree.runs])).toEqual([[R, "TPS-1", 6]]);
    expect(summary.byRole.find((r) => r.role === "integrator")?.totals.runs).toBe(1);
    expect(summary.notes).toEqual([...USAGE_NOTES]);

    const company = await loadUsageSummary(host.ctx, C, { days: 30, now });
    expect(company.projectId).toBeNull();
    expect(company.totals.runs).toBe(7);
    expect(company.unattributed.runs).toBe(1);

    const other = await loadUsageSummary(host.ctx, O, { days: 7, now });
    expect(other.totals.runs).toBe(1);
    expect(other.topRoots).toEqual([]);

    const later = await loadUsageSummary(host.ctx, C, { days: 7, now: new Date("2026-10-30T00:00:00Z") });
    expect(later.totals.runs).toBe(0);
    await expect(loadUsageSummary(host.ctx, C, { days: 14 as 7, now })).rejects.toThrow("days không hợp lệ");
  });
});
