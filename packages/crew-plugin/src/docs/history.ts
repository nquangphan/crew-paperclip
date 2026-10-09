import type { PluginContext } from "@paperclipai/plugin-sdk";
import { pluginNamespace } from "../shared/db.js";
import { projectScope } from "./data.js";
import type { ManifestState } from "./webhook.js";

export interface DocsHistoryItem {
  snapshotId: string;
  commit: string;
  receivedAt: string;
  completedAt: string;
  auditState: string;
  format: 1 | 2;
  manifestState: ManifestState;
  pageCount: number;
  current: boolean;
  /** Page changes against the next older snapshot; null for the oldest item returned. */
  changed: { added: number; modified: number; removed: number } | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Completed snapshots of a project, newest first. */
export async function loadDocsHistory(
  ctx: PluginContext, projectId: string, companyId: string, limit = DEFAULT_LIMIT,
): Promise<DocsHistoryItem[]> {
  await projectScope(ctx, projectId, companyId);
  const size = Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT ? limit : DEFAULT_LIMIT;
  const ns = pluginNamespace(ctx);
  const rows = await ctx.db.query<{
    id: string; commit: string; received_at: string; completed_at: string; audit_state: string;
    format: number; manifest_state: ManifestState; page_count: number; current: boolean;
  }>(`
    SELECT s.id, s.commit, s.received_at, s.completed_at, s.audit_state, s.format, s.manifest_state,
      (SELECT count(*)::int FROM ${ns}.docs_snapshot_pages p WHERE p.snapshot_id = s.id) AS page_count,
      EXISTS (SELECT 1 FROM ${ns}.docs_current c WHERE c.snapshot_id = s.id) AS current
    FROM ${ns}.docs_snapshots s
    WHERE s.company_id = $1 AND s.project_id = $2 AND s.completed_at IS NOT NULL
    ORDER BY s.completed_at DESC, s.id DESC LIMIT $3
  `, [companyId, projectId, size + 1]);
  const pages = new Map<string, Map<string, string>>();
  const pagesOf = async (id: string) => {
    let found = pages.get(id);
    if (!found) {
      const list = await ctx.db.query<{ path: string; sha256: string }>(
        `SELECT path, sha256 FROM ${ns}.docs_snapshot_pages WHERE snapshot_id = $1`, [id],
      );
      found = new Map(list.map((row) => [row.path, row.sha256]));
      pages.set(id, found);
    }
    return found;
  };
  const items: DocsHistoryItem[] = [];
  for (let i = 0; i < Math.min(rows.length, size); i++) {
    const row = rows[i]!;
    const older = rows[i + 1];
    let changed: DocsHistoryItem["changed"] = null;
    if (older) {
      const now = await pagesOf(row.id);
      const before = await pagesOf(older.id);
      let added = 0;
      let modified = 0;
      for (const [path, sha] of now) {
        const prev = before.get(path);
        if (prev === undefined) added++;
        else if (prev !== sha) modified++;
      }
      let removed = 0;
      for (const path of before.keys()) if (!now.has(path)) removed++;
      changed = { added, modified, removed };
    }
    items.push({
      snapshotId: row.id, commit: row.commit,
      receivedAt: new Date(row.received_at).toISOString(), completedAt: new Date(row.completed_at).toISOString(),
      auditState: row.audit_state, format: row.format === 2 ? 2 : 1, manifestState: row.manifest_state,
      pageCount: Number(row.page_count), current: Boolean(row.current), changed,
    });
  }
  return items;
}

export function registerDocsHistory(ctx: PluginContext): void {
  ctx.data.register("crew.docs.history", params =>
    loadDocsHistory(ctx, String(params.projectId ?? ""), String(params.companyId ?? ""), Number(params.limit ?? DEFAULT_LIMIT)));
}
