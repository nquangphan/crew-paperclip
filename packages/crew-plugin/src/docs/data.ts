import type { PluginContext } from "@paperclipai/plugin-sdk";
import { parseCrewDocsCheck } from "../shared/markers.js";
import { checkedId, pluginNamespace } from "../shared/db.js";
import { docsStageAgents } from "../shared/policy.js";

export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, "\\$&");
}

async function projectScope(ctx: PluginContext, projectId: string, companyId: string) {
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
export async function loadDocsTree(ctx: PluginContext, projectId: string, companyId: string) {
  await projectScope(ctx, projectId, companyId);
  const ns = pluginNamespace(ctx);
  const snapshots = await ctx.db.query<{
    id: string; repo: string; commit: string; audit_state: string; check_exit: number;
    received_at: string; machine_id: string; dropped: unknown;
  }>(`
    SELECT s.* FROM ${ns}.docs_current c
    JOIN ${ns}.docs_snapshots s ON s.id = c.snapshot_id
    WHERE c.company_id = $1 AND c.project_id = $2
  `, [companyId, projectId]);
  const snapshot = snapshots[0];
  if (!snapshot) return null;
  const pages = await ctx.db.query<{ path: string; title: string; parentPath: string; sha256: string }>(`
    SELECT path, title, parent_path AS "parentPath", sha256
    FROM ${ns}.docs_pages WHERE snapshot_id = $1 ORDER BY path
  `, [snapshot.id]);
  return {
    projectId,
    repo: snapshot.repo,
    commit: snapshot.commit,
    auditState: snapshot.audit_state,
    checkExit: snapshot.check_exit,
    receivedAt: snapshot.received_at,
    machineId: snapshot.machine_id,
    dropped: typeof snapshot.dropped === "string" ? JSON.parse(snapshot.dropped) : snapshot.dropped,
    pages,
  };
}
export async function loadDocsPage(ctx: PluginContext, projectId: string, path: string, companyId: string) {
  await projectScope(ctx, projectId, companyId);
  const ns = pluginNamespace(ctx);
  const rows = await ctx.db.query<{ path: string; title: string; text: string; sha256: string }>(`
    SELECT p.path, p.title, p.text, p.sha256
    FROM ${ns}.docs_pages p JOIN ${ns}.docs_current c ON c.snapshot_id = p.snapshot_id
    WHERE c.company_id = $1 AND c.project_id = $2 AND p.path = $3
  `, [companyId, projectId, path]);
  if (!rows[0]) return null;
  const links = await ctx.db.query<{
    fromPath: string; occurrence: number; originalHref: string; toPath: string | null;
    fragment: string | null; status: string;
  }>(`
    SELECT from_path AS "fromPath", occurrence, original_href AS "originalHref",
      to_path AS "toPath", fragment, status
    FROM ${ns}.docs_links l JOIN ${ns}.docs_current c ON c.snapshot_id = l.snapshot_id
    WHERE c.company_id = $1 AND c.project_id = $2 AND l.from_path = $3 ORDER BY occurrence
  `, [companyId, projectId, path]);
  return { ...rows[0], links };
}
export async function searchDocs(ctx: PluginContext, projectId: string, q: string, companyId: string) {
  await projectScope(ctx, projectId, companyId);
  if (typeof q !== "string" || q.length > 200) throw new Error("Từ khóa không hợp lệ");
  if (!q.trim()) return [];
  const ns = pluginNamespace(ctx);
  return ctx.db.query<{ path: string; title: string }>(`
    SELECT p.path, p.title
    FROM ${ns}.docs_pages p JOIN ${ns}.docs_current c ON c.snapshot_id = p.snapshot_id
    WHERE c.company_id = $1 AND c.project_id = $2
      AND (p.title ILIKE $3 ESCAPE '\\' OR p.text ILIKE $3 ESCAPE '\\')
    ORDER BY p.path LIMIT 50
  `, [companyId, projectId, `%${escapeLike(q)}%`]);
}
export function registerDocsData(ctx: PluginContext): void {
  ctx.data.register("crew.docsCheck", params =>
    loadDocsCheck(ctx, String(params.issueId ?? ""), String(params.companyId ?? "")));
  ctx.data.register("crew.docs.projects", params =>
    loadDocsProjects(ctx, String(params.companyId ?? "")));
  ctx.data.register("crew.docs.tree", params =>
    loadDocsTree(ctx, String(params.projectId ?? ""), String(params.companyId ?? "")));
  ctx.data.register("crew.docs.page", params =>
    loadDocsPage(ctx, String(params.projectId ?? ""), String(params.path ?? ""), String(params.companyId ?? "")));
  ctx.data.register("crew.docs.search", params =>
    searchDocs(ctx, String(params.projectId ?? ""), String(params.q ?? ""), String(params.companyId ?? "")));
}
