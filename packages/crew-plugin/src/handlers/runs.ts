import type { PluginContext } from "@paperclipai/plugin-sdk";
import { checkedId, jsonObject } from "../shared/db.js";
import { fetchIssueRuns, ownerOf, toRaw, type RunRow } from "../usage/data.js";
import { toUsageRun } from "../usage/rollup.js";

/**
 * Run tóm tắt cho bản đồ (thẻ việc hiện vài run mới nhất, chân thẻ hiện tổng). Đọc cùng nguồn với Usage
 * (`heartbeat_runs` + `cost_events`, chủ run = issue của `cost_events` rồi tới `context_snapshot.issueId`), một truy vấn
 * cho cả cây. Tiền là USD quy đổi giá API do CLI báo (`usage_json.costUsd`); không có thì lấy `cost_events.cost_cents`
 * khi > 0; không có gì thì `null` (UI hiện "—"), không bao giờ coi là 0.
 */
export interface MapRun {
  id: string;
  status: string;
  agentName: string;
  /** Model của run; run chưa xong mà chưa báo model thì lấy model đang cấu hình của agent. */
  model: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number | null;
  billingType: string | null;
}

export interface MapRunTotals {
  /** Tổng số run (kể cả run không trả về trong `runs`). */
  count: number;
  /** Tổng tiền của các run có số liệu; `null` khi không run nào có. */
  costUsd: number | null;
  /** Có run tính theo gói thuê bao: tiền là giá quy đổi, không bị trừ thật. */
  subscription: boolean;
}

export interface IssueMapRuns extends MapRunTotals {
  /** Mới nhất trước, tối đa `MAP_RUNS_LIMIT`. */
  runs: MapRun[];
}

export interface MapRuns {
  /** Theo id issue (chữ thường); issue chưa có run thì không có khóa. */
  byIssue: Record<string, IssueMapRuns>;
  /** Tổng của mọi issue trong tập (yêu cầu gốc: cả cây). */
  tree: MapRunTotals;
}

export const MAP_RUNS_LIMIT = 20;
const MAX_DEPTH = 20;
/** Run còn có thể đổi model (chưa chạy xong); run đã xong thiếu model thì để trống, không đoán. */
const PENDING = new Set(["queued", "running"]);

const iso = (value: string | Date | null): string | null => (value === null ? null : new Date(value).toISOString());
const isSubscription = (billingType: string | null): boolean => !!billingType?.startsWith("subscription");
const roundUsd = (value: number): number => Math.round(value * 1e6) / 1e6;

/** Một dòng run của bản đồ từ dòng truy vấn Usage. */
export function toMapRun(row: RunRow): MapRun {
  const rolled = toUsageRun(toRaw(row, null, null, "khac"));
  const usage = jsonObject(row.usageJson);
  const billingType = rolled.billingType ?? (typeof usage?.billingType === "string" ? usage.billingType : null);
  const costUsd = rolled.estimatedUsd ?? (rolled.billedCents > 0 ? rolled.billedCents / 100 : null);
  return {
    id: row.runId,
    status: row.status,
    agentName: row.agentName,
    model: rolled.model ?? (PENDING.has(row.status) && row.agentModel ? row.agentModel : null),
    createdAt: iso(row.createdAt) as string,
    startedAt: rolled.startedAt,
    finishedAt: rolled.finishedAt,
    costUsd,
    billingType,
  };
}

/** Tổng của một tập run (mỗi run một lần). */
export function sumMapRuns(runs: readonly MapRun[]): MapRunTotals {
  let cost = 0;
  let costed = 0;
  for (const run of runs) {
    if (run.costUsd === null) continue;
    cost += run.costUsd;
    costed++;
  }
  return {
    count: runs.length,
    costUsd: costed > 0 ? roundUsd(cost) : null,
    subscription: runs.some((run) => isSubscription(run.billingType)),
  };
}

const newestFirst = (a: MapRun, b: MapRun): number =>
  (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt) || b.id.localeCompare(a.id);

/** Gom dòng run theo issue chủ (chỉ issue trong `issueIds`), cắt danh sách mỗi issue, tổng tính trên toàn bộ. */
export function groupMapRuns(rows: readonly RunRow[], issueIds: readonly string[], limit = MAP_RUNS_LIMIT): MapRuns {
  const wanted = new Set(issueIds.map((id) => id.toLowerCase()));
  const perIssue = new Map<string, MapRun[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const owner = ownerOf(row);
    if (!owner || !wanted.has(owner) || seen.has(row.runId)) continue;
    seen.add(row.runId);
    perIssue.set(owner, [...(perIssue.get(owner) ?? []), toMapRun(row)]);
  }
  const byIssue: Record<string, IssueMapRuns> = {};
  for (const [issueId, runs] of perIssue) {
    runs.sort(newestFirst);
    byIssue[issueId] = { ...sumMapRuns(runs), runs: runs.slice(0, limit) };
  }
  return { byIssue, tree: sumMapRuns([...perIssue.values()].flat()) };
}

/** Run của một tập issue cùng company (id đã kiểm). */
export async function loadMapRuns(ctx: Pick<PluginContext, "db">, companyId: string, issueIds: readonly string[]): Promise<MapRuns> {
  if (issueIds.length === 0) return { byIssue: {}, tree: sumMapRuns([]) };
  const rows = await fetchIssueRuns(ctx, companyId, issueIds);
  return groupMapRuns(rows, issueIds);
}

/** Run của một yêu cầu và mọi hậu duệ (tầng yêu cầu của trang Roadmap). Issue phải thuộc company được hỏi. */
export async function loadRequestRuns(ctx: Pick<PluginContext, "db">, companyId: string, issueId: string): Promise<MapRuns> {
  checkedId(companyId);
  checkedId(issueId);
  const tree = await ctx.db.query<{ id: string }>(
    `WITH RECURSIVE tree(id, depth) AS (
       SELECT id, 0 FROM public.issues WHERE id = $2 AND company_id = $1
       UNION ALL
       SELECT i.id, t.depth + 1 FROM public.issues i JOIN tree t ON i.parent_id = t.id
       WHERE i.company_id = $1 AND t.depth < ${MAX_DEPTH})
     SELECT DISTINCT id::text FROM tree`,
    [companyId, issueId],
  );
  if (tree.length === 0) throw new Error("Không tìm thấy issue");
  return loadMapRuns(ctx, companyId, tree.map((row) => row.id));
}

export function registerRunsFeature(ctx: PluginContext): void {
  ctx.data.register("crew.runs", async (params) =>
    loadRequestRuns(ctx, String(params.companyId ?? ""), String(params.issueId ?? "")));
}
