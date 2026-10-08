import type { PluginContext } from "@paperclipai/plugin-sdk";
import { parseCrewDocsCheck } from "../shared/markers.js";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const checkId = (v: unknown) => { if (typeof v !== "string" || !uuid.test(v)) throw new Error("ID không hợp lệ"); return v; };
const namespace = (ctx: PluginContext) => { const ns = ctx.db.namespace; if (!/^plugin_[a-z0-9_]+$/.test(ns)) throw new Error("Namespace không hợp lệ"); return ns; };
export function escapeLike(q: string): string { return q.replace(/[\\%_]/g, "\\$&"); }
async function projectScope(ctx: PluginContext, projectId: string, companyId: string) {
  const rows = await ctx.db.query<{id:string}>("SELECT id FROM public.projects WHERE id = $1 AND company_id = $2", [checkId(projectId),checkId(companyId)]);
  if (!rows[0]) throw new Error("Dự án không thuộc company hiện tại");
}
export async function loadDocsCheck(ctx: PluginContext, issueId: string, companyId: string) {
  let current = checkId(issueId);
  const visited = new Set<string>();
  while (true) {
    if (visited.has(current)) throw new Error("Cây issue có vòng lặp");
    visited.add(current);
    const rows = await ctx.db.query<{parent_id:string|null}>("SELECT parent_id FROM public.issues WHERE id = $1 AND company_id = $2", [current,checkId(companyId)]);
    if (!rows[0]) throw new Error("Issue không thuộc company hiện tại");
    if (!rows[0].parent_id) break;
    current = rows[0].parent_id!;
  }
  const comments = await ctx.db.query<{body:string;created_at:string;author_agent_id:string|null}>("SELECT body, created_at, author_agent_id FROM public.issue_comments WHERE issue_id = $1 AND company_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC", [current,companyId]);
  for (const row of comments) { const parsed = parseCrewDocsCheck(row.body); if (parsed) return { ...parsed, at: row.created_at, author: row.author_agent_id }; }
  return null;
}
export async function loadDocsProjects(ctx: PluginContext, companyId: string) {
  const ns = namespace(ctx);
  return ctx.db.query<{projectId:string;repo:string}>(`SELECT c.project_id AS "projectId", s.repo FROM ${ns}.docs_current c JOIN ${ns}.docs_snapshots s ON s.id = c.snapshot_id JOIN public.projects p ON p.id = c.project_id AND p.company_id = c.company_id WHERE c.company_id = $1 ORDER BY s.repo`, [checkId(companyId)]);
}
export async function loadDocsTree(ctx: PluginContext, projectId: string, companyId: string) {
  await projectScope(ctx,projectId,companyId);
  const ns = namespace(ctx);
  const snapshots = await ctx.db.query<{id:string;repo:string;commit:string;audit_state:string;check_exit:number;received_at:string;machine_id:string;dropped:unknown}>(`SELECT s.* FROM ${ns}.docs_current c JOIN ${ns}.docs_snapshots s ON s.id = c.snapshot_id WHERE c.company_id = $1 AND c.project_id = $2`, [companyId,projectId]);
  const s = snapshots[0]; if (!s) return null;
  const pages = await ctx.db.query<{path:string;title:string;parentPath:string|null;sha256:string}>(`SELECT path,title,parent_path AS "parentPath",sha256 FROM ${ns}.docs_pages WHERE snapshot_id = $1 ORDER BY path`, [s.id]);
  return { projectId, repo:s.repo, commit:s.commit, auditState:s.audit_state, checkExit:s.check_exit, receivedAt:s.received_at, machineId:s.machine_id, dropped: typeof s.dropped === "string" ? JSON.parse(s.dropped) : s.dropped, pages };
}
export async function loadDocsPage(ctx: PluginContext, projectId: string, path: string, companyId: string) {
  await projectScope(ctx,projectId,companyId);
  const ns = namespace(ctx);
  const rows = await ctx.db.query<{path:string;title:string;text:string;sha256:string}>(`SELECT p.path,p.title,p.text,p.sha256 FROM ${ns}.docs_pages p JOIN ${ns}.docs_current c ON c.snapshot_id = p.snapshot_id WHERE c.company_id = $1 AND c.project_id = $2 AND p.path = $3`, [companyId,projectId,path]);
  if (!rows[0]) return null;
  const links = await ctx.db.query<{fromPath:string;occurrence:number;originalHref:string;toPath:string|null;fragment:string|null;status:string}>(`SELECT from_path AS "fromPath",occurrence,original_href AS "originalHref",to_path AS "toPath",fragment,status FROM ${ns}.docs_links l JOIN ${ns}.docs_current c ON c.snapshot_id = l.snapshot_id WHERE c.company_id = $1 AND c.project_id = $2 AND l.from_path = $3 ORDER BY occurrence`, [companyId,projectId,path]);
  return { ...rows[0], links };
}
export async function searchDocs(ctx: PluginContext, projectId: string, q: string, companyId: string) {
  await projectScope(ctx,projectId,companyId);
  if (typeof q !== "string" || q.length > 200) throw new Error("Từ khóa không hợp lệ");
  if (!q.trim()) return [];
  const ns = namespace(ctx);
  return ctx.db.query<{path:string;title:string}>(`SELECT p.path,p.title FROM ${ns}.docs_pages p JOIN ${ns}.docs_current c ON c.snapshot_id = p.snapshot_id WHERE c.company_id = $1 AND c.project_id = $2 AND (p.title ILIKE $3 ESCAPE '\\' OR p.text ILIKE $3 ESCAPE '\\') ORDER BY p.path LIMIT 50`, [companyId,projectId,`%${escapeLike(q)}%`]);
}
export function registerDocsData(ctx: PluginContext): void {
  ctx.data.register("crew.docsCheck", p => loadDocsCheck(ctx,String(p.issueId ?? ""),String(p.companyId ?? "")));
  ctx.data.register("crew.docs.projects", p => loadDocsProjects(ctx,String(p.companyId ?? "")));
  ctx.data.register("crew.docs.tree", p => loadDocsTree(ctx,String(p.projectId ?? ""),String(p.companyId ?? "")));
  ctx.data.register("crew.docs.page", p => loadDocsPage(ctx,String(p.projectId ?? ""),String(p.path ?? ""),String(p.companyId ?? "")));
  ctx.data.register("crew.docs.search", p => searchDocs(ctx,String(p.projectId ?? ""),String(p.q ?? ""),String(p.companyId ?? "")));
}
