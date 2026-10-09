import type { PluginContext } from "@paperclipai/plugin-sdk";
import { checkedId, jsonObject, pluginNamespace } from "../shared/db.js";
import {
  type CrewRole, mergeModels, type ModelUsage, type RawRun, type RolledRun, sumRuns, toUsageRun, USAGE_NOTES,
  type UsageRun, type UsageTotals, vnWindowStart,
} from "./rollup.js";

/**
 * Usage chỉ đọc `heartbeat_runs` + `cost_events` của Paperclip, không ghi ledger riêng.
 * Chủ của một run là issue trong `cost_events` (nếu có) rồi tới `context_snapshot.issueId`.
 * Danh sách id bind bằng một tham số JSON vì host không bind mảng JS thành mảng Postgres.
 */
export interface IssueUsage {
  issue: { id: string; identifier: string; title: string };
  direct: UsageTotals;
  tree: UsageTotals | null;
  children: Array<{ id: string; identifier: string; title: string; status: string; tree: UsageTotals }>;
  byRole: Array<{ role: CrewRole; totals: UsageTotals }>;
  byModel: ModelUsage[];
  runs: UsageRun[];
  runsTruncated: boolean;
  reuse: { fresh: number; reused: number; unknown: number };
  notes: string[];
}

export interface UsageSummary {
  from: string;
  to: string;
  projectId: string | null;
  totals: UsageTotals;
  byRole: Array<{ role: CrewRole; totals: UsageTotals }>;
  byModel: ModelUsage[];
  unattributed: UsageTotals;
  topRoots: Array<{ id: string; identifier: string; title: string; tree: UsageTotals }>;
  notes: string[];
}

type Db = Pick<PluginContext, "db">;
const MAX_DEPTH = 20;
const MAX_RUNS = 200;
const ROLE_ORDER: CrewRole[] = ["assistant", "executor", "reviewer", "integrator", "khac"];
const WINDOWS = new Set([7, 30, 90]);

interface RunRow {
  runId: string; agentId: string; agentName: string; status: string;
  startedAt: string | Date | null; finishedAt: string | Date | null;
  usageJson: unknown; modelUsage: unknown; ctxIssue: string | null; ctxProject: string | null; ceIssue: string | null;
  costEventCount: number | string; input: string | number | null; cached: string | number | null; output: string | number | null;
  cents: string | number | null; model: string | null; billingType: string | null;
}

interface IssueRow { id: string; parentId: string | null; identifier: string; title: string; status: string; projectId: string | null }

const iso = (value: string | Date | null): string | null => (value === null ? null : new Date(value).toISOString());
const lower = (value: string | null): string | null => (value === null ? null : value.toLowerCase());

/** Run của company kèm tổng `cost_events` theo run; `where` chỉ dùng `r.` và tham số `$1` = company. */
function fetchRuns(ctx: Db, where: string, params: unknown[]): Promise<RunRow[]> {
  return ctx.db.query<RunRow>(
    `WITH sel AS (SELECT r.id FROM public.heartbeat_runs r WHERE r.company_id = $1 AND (${where}))
     SELECT r.id::text AS "runId", r.agent_id::text AS "agentId", a.name AS "agentName", r.status,
       r.started_at AS "startedAt", r.finished_at AS "finishedAt", r.usage_json AS "usageJson",
       r.result_json->'modelUsage' AS "modelUsage", lower(r.context_snapshot->>'issueId') AS "ctxIssue",
       lower(r.context_snapshot->>'projectId') AS "ctxProject", ce.issue_id AS "ceIssue",
       coalesce(ce.n, 0)::int AS "costEventCount", ce.input, ce.cached, ce.output, ce.cents, ce.model,
       ce.billing_type AS "billingType"
     FROM public.heartbeat_runs r
     JOIN public.agents a ON a.id = r.agent_id
     LEFT JOIN (
       SELECT c.heartbeat_run_id, min(c.issue_id::text) AS issue_id, count(*) AS n, sum(c.input_tokens)::bigint AS input,
         sum(c.cached_input_tokens)::bigint AS cached, sum(c.output_tokens)::bigint AS output,
         sum(c.cost_cents)::bigint AS cents, min(c.model) AS model, min(c.billing_type) AS billing_type
       FROM public.cost_events c
       WHERE c.company_id = $1 AND c.heartbeat_run_id IN (SELECT id FROM sel)
       GROUP BY c.heartbeat_run_id) ce ON ce.heartbeat_run_id = r.id
     WHERE r.company_id = $1 AND r.id IN (SELECT id FROM sel)`,
    params,
  );
}

type RoleBook = Map<string, { assistant: string; executors: Set<string>; reviewer: string; integrator: string }>;

async function loadRoles(ctx: Db, companyId: string): Promise<RoleBook> {
  const rows = await ctx.db.query<{ projectId: string; assistant: string; executors: string; reviewer: string; integrator: string }>(
    `SELECT project_id::text AS "projectId", assistant_agent_id::text AS assistant,
       array_to_string(executor_agent_ids, ',') AS executors, reviewer_agent_id::text AS reviewer,
       integrator_agent_id::text AS integrator
     FROM ${pluginNamespace(ctx)}.crew_project_roles WHERE company_id = $1`,
    [companyId],
  );
  return new Map(rows.map((row) => [row.projectId.toLowerCase(), {
    assistant: row.assistant.toLowerCase(), executors: new Set(row.executors.toLowerCase().split(",")),
    reviewer: row.reviewer.toLowerCase(), integrator: row.integrator.toLowerCase(),
  }]));
}

function roleOf(book: RoleBook, projectId: string | null, agentId: string): CrewRole {
  const roles = projectId ? book.get(projectId) : undefined;
  const id = agentId.toLowerCase();
  if (!roles) return "khac";
  if (roles.assistant === id) return "assistant";
  if (roles.executors.has(id)) return "executor";
  if (roles.reviewer === id) return "reviewer";
  if (roles.integrator === id) return "integrator";
  return "khac";
}

const num = (value: string | number | null): number => Number(value ?? 0);

function toRaw(row: RunRow, owner: string | null, identifier: string | null, role: CrewRole): RawRun {
  const costEventCount = Number(row.costEventCount);
  return {
    runId: row.runId, ownerIssueId: owner, identifier, agentId: row.agentId, agentName: row.agentName, role,
    status: row.status, startedAt: iso(row.startedAt), finishedAt: iso(row.finishedAt), costEventCount,
    ce: costEventCount > 0
      ? { input: num(row.input), cached: num(row.cached), output: num(row.output), cents: num(row.cents), model: row.model, billingType: row.billingType }
      : null,
    usageJson: jsonObject(row.usageJson), modelUsage: jsonObject(row.modelUsage),
  };
}

const ownerOf = (row: RunRow): string | null => lower(row.ceIssue) ?? row.ctxIssue;

function byRole(runs: RolledRun[]): Array<{ role: CrewRole; totals: UsageTotals }> {
  return ROLE_ORDER.flatMap((role) => {
    const mine = runs.filter((r) => r.role === role);
    return mine.length === 0 ? [] : [{ role, totals: sumRuns(mine) }];
  });
}

function publicRun({ models: _models, billedCents: _cents, ...run }: RolledRun): UsageRun {
  return run;
}

export async function loadIssueUsage(ctx: Db, companyId: string, issueId: string): Promise<IssueUsage | null> {
  checkedId(companyId);
  checkedId(issueId);
  const issues = await ctx.db.query<IssueRow>(
    `WITH RECURSIVE tree(id, depth) AS (
       SELECT id, 0 FROM public.issues WHERE id = $2 AND company_id = $1 AND hidden_at IS NULL
       UNION ALL
       SELECT i.id, t.depth + 1 FROM public.issues i JOIN tree t ON i.parent_id = t.id
       WHERE i.company_id = $1 AND i.hidden_at IS NULL AND t.depth < ${MAX_DEPTH})
     SELECT i.id::text, i.parent_id::text AS "parentId", coalesce(i.identifier, '') AS identifier, i.title, i.status,
       i.project_id::text AS "projectId"
     FROM public.issues i JOIN tree t ON t.id = i.id`,
    [companyId, issueId],
  );
  const rootId = issueId.toLowerCase();
  const byId = new Map(issues.map((row) => [row.id.toLowerCase(), row]));
  const root = byId.get(rootId);
  if (!root) return null;

  const ids = JSON.stringify([...byId.keys()]);
  const rows = await fetchRuns(ctx,
    `lower(r.context_snapshot->>'issueId') IN (SELECT jsonb_array_elements_text($2::jsonb))
     OR r.id IN (SELECT c.heartbeat_run_id FROM public.cost_events c WHERE c.company_id = $1
       AND c.issue_id::text IN (SELECT jsonb_array_elements_text($2::jsonb)))`,
    [companyId, ids]);
  const book = await loadRoles(ctx, companyId);
  const runs = rows.flatMap((row) => {
    const owner = ownerOf(row);
    const issue = owner ? byId.get(owner) : undefined;
    if (!owner || !issue) return [];
    return [toUsageRun(toRaw(row, owner, issue.identifier, roleOf(book, lower(issue.projectId), row.agentId)))];
  });

  const kids = new Map<string, string[]>();
  for (const [id, row] of byId) {
    const parent = lower(row.parentId);
    if (id !== rootId && parent) kids.set(parent, [...(kids.get(parent) ?? []), id]);
  }
  const subtree = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    for (const next of out) for (const kid of kids.get(next) ?? []) out.add(kid);
    return out;
  };
  const childRows = (kids.get(rootId) ?? []).map((id) => byId.get(id)!)
    .sort((a, b) => a.identifier.localeCompare(b.identifier, "vi", { numeric: true }) || a.id.localeCompare(b.id));
  const children = childRows.map((child) => {
    const members = subtree(child.id.toLowerCase());
    return { id: child.id, identifier: child.identifier, title: child.title, status: child.status,
      tree: sumRuns(runs.filter((r) => r.issueId !== null && members.has(r.issueId))) };
  });

  const sorted = [...runs].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "") || a.runId.localeCompare(b.runId));
  const settled = runs.filter((r) => r.completeness !== "dang_chay");
  return {
    issue: { id: root.id, identifier: root.identifier, title: root.title },
    direct: sumRuns(runs.filter((r) => r.issueId === rootId)),
    tree: children.length === 0 ? null : sumRuns(runs),
    children,
    byRole: byRole(runs),
    byModel: mergeModels(runs),
    runs: sorted.slice(0, MAX_RUNS).map(publicRun),
    runsTruncated: sorted.length > MAX_RUNS,
    reuse: {
      fresh: settled.filter((r) => r.sessionReused === false).length,
      reused: settled.filter((r) => r.sessionReused === true).length,
      unknown: settled.filter((r) => r.sessionReused === null).length,
    },
    notes: [...USAGE_NOTES],
  };
}

export async function loadUsageSummary(
  ctx: Db, companyId: string, opts: { projectId?: string; days: 7 | 30 | 90; now?: Date },
): Promise<UsageSummary> {
  checkedId(companyId);
  if (!WINDOWS.has(opts.days)) throw new Error("days không hợp lệ");
  const projectId = opts.projectId === undefined ? null : checkedId(opts.projectId).toLowerCase();
  const now = opts.now ?? new Date();
  const from = vnWindowStart(now, opts.days);

  const rows = await fetchRuns(ctx, "coalesce(r.started_at, r.created_at) >= $2::timestamptz", [companyId, from.toISOString()]);
  const issueRows = await ctx.db.query<IssueRow & { hidden: boolean }>(
    `SELECT id::text, parent_id::text AS "parentId", coalesce(identifier, '') AS identifier, title, status,
       project_id::text AS "projectId", hidden_at IS NOT NULL AS hidden
     FROM public.issues WHERE company_id = $1 LIMIT 50000`,
    [companyId],
  );
  const issues = new Map(issueRows.map((row) => [row.id.toLowerCase(), row]));
  /** Gốc của issue, hoặc null khi issue hay một tổ tiên bị ẩn (cùng luật với cây của `loadIssueUsage`). */
  const rootOf = (id: string): string | null => {
    let current = id;
    for (let step = 0; step <= MAX_DEPTH; step++) {
      const row = issues.get(current);
      if (!row || row.hidden) return null;
      const parent = lower(row.parentId);
      if (!parent || !issues.has(parent)) return current;
      current = parent;
    }
    return current;
  };
  const book = await loadRoles(ctx, companyId);

  const attributed: Array<{ root: string; run: RolledRun }> = [];
  const unattributed: RolledRun[] = [];
  for (const row of rows) {
    const owner = ownerOf(row);
    const issue = owner ? issues.get(owner) : undefined;
    if (owner && issue) {
      const root = rootOf(owner);
      if (root === null) continue;
      const issueProject = lower(issue.projectId);
      if (projectId !== null && issueProject !== projectId) continue;
      attributed.push({ root, run: toUsageRun(toRaw(row, owner, issue.identifier, roleOf(book, issueProject, row.agentId))) });
    } else {
      if (projectId !== null && row.ctxProject !== projectId) continue;
      unattributed.push(toUsageRun(toRaw(row, null, null, roleOf(book, row.ctxProject, row.agentId))));
    }
  }

  const all = [...attributed.map((a) => a.run), ...unattributed];
  const perRoot = new Map<string, RolledRun[]>();
  for (const { root, run } of attributed) perRoot.set(root, [...(perRoot.get(root) ?? []), run]);
  const topRoots = [...perRoot].map(([id, runs]) => {
    const row = issues.get(id)!;
    return { id: row.id, identifier: row.identifier, title: row.title, tree: sumRuns(runs) };
  }).sort((a, b) => b.tree.outputTokens - a.tree.outputTokens || b.tree.runs - a.tree.runs || a.id.localeCompare(b.id)).slice(0, 10);

  return {
    from: from.toISOString(), to: now.toISOString(), projectId,
    totals: sumRuns(all), byRole: byRole(all), byModel: mergeModels(all),
    unattributed: sumRuns(unattributed), topRoots, notes: [...USAGE_NOTES],
  };
}

export function registerUsageData(ctx: PluginContext): void {
  ctx.data.register("crew.usage.issue", (params) =>
    loadIssueUsage(ctx, checkedId(params.companyId), checkedId(params.issueId)));
  ctx.data.register("crew.usage.summary", (params) =>
    loadUsageSummary(ctx, checkedId(params.companyId), {
      projectId: params.projectId === undefined || params.projectId === null || params.projectId === "" ? undefined : String(params.projectId),
      days: Number(params.days ?? 7) as 7 | 30 | 90,
    }));
}
