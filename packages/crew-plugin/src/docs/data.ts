import type { PluginContext } from "@paperclipai/plugin-sdk";
import { parseCrewDocsCheck } from "../shared/markers.js";
import { checkedId, pluginNamespace } from "../shared/db.js";
import { docsStageAgents } from "../shared/policy.js";
import { type FlowsManifestOk, parseFlowsManifest } from "./manifest.js";
import type { ManifestState } from "./webhook.js";

export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, "\\$&");
}

export async function projectScope(ctx: PluginContext, projectId: string, companyId: string) {
  const rows = await ctx.db.query<{ id: string }>(
    "SELECT id FROM public.projects WHERE id = $1 AND company_id = $2",
    [checkedId(projectId), checkedId(companyId)],
  );
  if (!rows[0]) throw new Error("Dự án không thuộc company hiện tại");
}

export async function loadDocsCheck(ctx: PluginContext, issueId: string, companyId: string) {
  // The issue summary asks before the map has resolved the root; no issue yet means no docs check, not an error.
  if (issueId === "") return null;
  let current = checkedId(issueId);
  const visited = new Set<string>();
  while (true) {
    if (visited.has(current)) throw new Error("Cây issue có vòng lặp");
    visited.add(current);
    const rows = await ctx.db.query<{ parent_id: string | null; execution_policy: unknown }>(`
      SELECT parent_id, execution_policy FROM public.issues
      WHERE id = $1 AND company_id = $2
    `, [current, checkedId(companyId)]);
    if (!rows[0]) throw new Error("Issue không thuộc company hiện tại");
    if (!rows[0].parent_id) {
      const authors = docsStageAgents(rows[0].execution_policy);
      if (!authors.length) return null;
      const comments = await ctx.db.query<{ body: string; created_at: string; author_agent_id: string }>(`
        SELECT body, created_at, author_agent_id FROM public.issue_comments
        WHERE issue_id = $1 AND company_id = $2 AND deleted_at IS NULL
          AND author_agent_id = ANY(string_to_array($3, ',')::uuid[]) AND body LIKE 'crew-docs-check %'
        ORDER BY created_at DESC, id DESC LIMIT 1
      `, [current, companyId, authors.join(",")]);
      const comment = comments[0];
      if (!comment) return null;
      const parsed = parseCrewDocsCheck(comment.body);
      return parsed
        ? { ...parsed, at: comment.created_at, author: comment.author_agent_id }
        : { invalid: true as const, at: comment.created_at, author: comment.author_agent_id };
    }
    current = rows[0].parent_id!;
  }
}
export async function loadDocsProjects(ctx: PluginContext, companyId: string) {
  const ns = pluginNamespace(ctx);
  return ctx.db.query<{ projectId: string; repo: string }>(`
    SELECT c.project_id AS "projectId", s.repo
    FROM ${ns}.docs_current c
    JOIN ${ns}.docs_snapshots s ON s.id = c.snapshot_id
    JOIN public.projects p ON p.id = c.project_id AND p.company_id = c.company_id
    WHERE c.company_id = $1 ORDER BY s.repo
  `, [checkedId(companyId)]);
}
export interface SnapshotRow {
  id: string; company_id: string; project_id: string; repo: string; commit: string; audit_state: string;
  check_exit: number; received_at: string; completed_at: string; machine_id: string; dropped: unknown;
  format: number; manifest_state: ManifestState; manifest_sha256: string | null;
}

/**
 * The completed snapshot to read: `snapshotId` when given (it must belong to this company and project),
 * otherwise the project's current one. Callers check the project scope first.
 */
export async function resolveSnapshot(
  ctx: PluginContext, companyId: string, projectId: string, snapshotId?: string,
): Promise<SnapshotRow | null> {
  const ns = pluginNamespace(ctx);
  if (snapshotId !== undefined) {
    const rows = await ctx.db.query<SnapshotRow>(`
      SELECT s.* FROM ${ns}.docs_snapshots s WHERE s.id = $1 AND s.completed_at IS NOT NULL
    `, [checkedId(snapshotId)]);
    const row = rows[0];
    if (!row || row.company_id !== companyId.toLowerCase() || row.project_id !== projectId.toLowerCase()) throw new Error("Snapshot không thuộc dự án");
    return row;
  }
  const rows = await ctx.db.query<SnapshotRow>(`
    SELECT s.* FROM ${ns}.docs_current c
    JOIN ${ns}.docs_snapshots s ON s.id = c.snapshot_id
    WHERE c.company_id = $1 AND c.project_id = $2 AND s.completed_at IS NOT NULL
  `, [companyId, projectId]);
  return rows[0] ?? null;
}

/** Parsed `docs/flows.yaml` of a snapshot, or null when the snapshot has no valid manifest. */
export async function loadManifestForSnapshot(
  ctx: PluginContext, snapshot: Pick<SnapshotRow, "manifest_state" | "manifest_sha256">,
): Promise<FlowsManifestOk | null> {
  if (snapshot.manifest_state !== "ok" || !snapshot.manifest_sha256) return null;
  const rows = await ctx.db.query<{ text: string }>(
    `SELECT text FROM ${pluginNamespace(ctx)}.docs_blobs WHERE sha256 = $1`, [snapshot.manifest_sha256],
  );
  if (!rows[0]) return null;
  const parsed = parseFlowsManifest(rows[0].text);
  return parsed.state === "ok" ? parsed : null;
}

export async function loadDocsTree(ctx: PluginContext, projectId: string, companyId: string, snapshotId?: string) {
  await projectScope(ctx, projectId, companyId);
  const snapshot = await resolveSnapshot(ctx, companyId, projectId, snapshotId);
  if (!snapshot) return null;
  const pages = await ctx.db.query<{ path: string; title: string; parentPath: string; sha256: string }>(`
    SELECT path, title, parent_path AS "parentPath", sha256
    FROM ${pluginNamespace(ctx)}.docs_snapshot_pages WHERE snapshot_id = $1 ORDER BY path
  `, [snapshot.id]);
  return {
    snapshotId: snapshot.id,
    projectId,
    repo: snapshot.repo,
    commit: snapshot.commit,
    auditState: snapshot.audit_state,
    checkExit: snapshot.check_exit,
    receivedAt: new Date(snapshot.received_at).toISOString(),
    machineId: snapshot.machine_id,
    manifestState: snapshot.manifest_state,
    dropped: typeof snapshot.dropped === "string" ? JSON.parse(snapshot.dropped) : snapshot.dropped,
    pages,
  };
}
export async function loadDocsPage(ctx: PluginContext, projectId: string, path: string, companyId: string, snapshotId?: string) {
  await projectScope(ctx, projectId, companyId);
  const snapshot = await resolveSnapshot(ctx, companyId, projectId, snapshotId);
  if (!snapshot) return null;
  const ns = pluginNamespace(ctx);
  const rows = await ctx.db.query<{ path: string; title: string; text: string; sha256: string }>(`
    SELECT p.path, p.title, b.text, p.sha256
    FROM ${ns}.docs_snapshot_pages p JOIN ${ns}.docs_blobs b ON b.sha256 = p.sha256
    WHERE p.snapshot_id = $1 AND p.path = $2
  `, [snapshot.id, path]);
  if (!rows[0]) return null;
  const links = await ctx.db.query<{
    fromPath: string; occurrence: number; originalHref: string; toPath: string | null;
    fragment: string | null; status: string;
  }>(`
    SELECT from_path AS "fromPath", occurrence, original_href AS "originalHref",
      to_path AS "toPath", fragment, status
    FROM ${ns}.docs_links WHERE snapshot_id = $1 AND from_path = $2 ORDER BY occurrence
  `, [snapshot.id, path]);
  return { ...rows[0], links };
}
export async function searchDocs(ctx: PluginContext, projectId: string, q: string, companyId: string) {
  await projectScope(ctx, projectId, companyId);
  if (typeof q !== "string" || q.length > 200) throw new Error("Từ khóa không hợp lệ");
  if (!q.trim()) return [];
  const ns = pluginNamespace(ctx);
  return ctx.db.query<{ path: string; title: string }>(`
    SELECT p.path, p.title
    FROM ${ns}.docs_current c
    JOIN ${ns}.docs_snapshot_pages p ON p.snapshot_id = c.snapshot_id
    JOIN ${ns}.docs_blobs b ON b.sha256 = p.sha256
    WHERE c.company_id = $1 AND c.project_id = $2
      AND (p.title ILIKE $3 ESCAPE '\\' OR b.text ILIKE $3 ESCAPE '\\')
    ORDER BY p.path LIMIT 50
  `, [companyId, projectId, `%${escapeLike(q)}%`]);
}
const optionalId = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;
export function registerDocsData(ctx: PluginContext): void {
  ctx.data.register("crew.docsCheck", params =>
    loadDocsCheck(ctx, String(params.issueId ?? ""), String(params.companyId ?? "")));
  ctx.data.register("crew.docs.projects", params =>
    loadDocsProjects(ctx, String(params.companyId ?? "")));
  ctx.data.register("crew.docs.tree", params =>
    loadDocsTree(ctx, String(params.projectId ?? ""), String(params.companyId ?? ""), optionalId(params.snapshotId)));
  ctx.data.register("crew.docs.page", params =>
    loadDocsPage(ctx, String(params.projectId ?? ""), String(params.path ?? ""), String(params.companyId ?? ""),
      optionalId(params.snapshotId)));
  ctx.data.register("crew.docs.search", params =>
    searchDocs(ctx, String(params.projectId ?? ""), String(params.q ?? ""), String(params.companyId ?? "")));
}
