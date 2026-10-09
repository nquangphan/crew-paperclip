import type { PluginContext } from "@paperclipai/plugin-sdk";
import { checkedId, pluginNamespace } from "../shared/db.js";
import { parseCrewCommit } from "../shared/markers.js";
import { loadManifestForSnapshot, projectScope, resolveSnapshot } from "./data.js";
import { buildDocsGraph, type DocsGraph, type GraphInput } from "./graph.js";
import { loadDocsStatus } from "./status.js";

const FLOW_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_COMMENTS = 5000;
const MAX_ISSUES = 500;
const MAX_NODES = 3000;

/**
 * Tickets of this project that reported a commit (`crew-commit sha=` written by an agent), with the paths that
 * commit changed. Only the project's own, visible issues count.
 */
async function loadTicketCommits(ctx: PluginContext, companyId: string, projectId: string): Promise<GraphInput["tickets"]> {
  const comments = await ctx.db.query<{ issueId: string; identifier: string; title: string; status: string; body: string }>(`
    SELECT i.id AS "issueId", coalesce(i.identifier, '') AS identifier, i.title, i.status, c.body
    FROM public.issue_comments c JOIN public.issues i ON i.id = c.issue_id
    WHERE i.company_id = $1 AND i.project_id = $2 AND i.hidden_at IS NULL AND c.deleted_at IS NULL
      AND c.author_agent_id IS NOT NULL AND c.body ~ '^crew-commit sha=[0-9a-f]{40}'
    ORDER BY c.created_at DESC, c.id DESC LIMIT ${MAX_COMMENTS}
  `, [companyId, projectId]);
  const issues = new Map<string, { identifier: string; title: string; status: string; shas: Set<string> }>();
  for (const row of comments) {
    const sha = parseCrewCommit(row.body);
    if (!sha) continue;
    let issue = issues.get(row.issueId);
    if (!issue) {
      if (issues.size >= MAX_ISSUES) continue;
      issue = { identifier: row.identifier, title: row.title, status: row.status, shas: new Set() };
      issues.set(row.issueId, issue);
    }
    issue.shas.add(sha);
  }
  if (issues.size === 0) return [];
  const allShas = [...new Set([...issues.values()].flatMap((issue) => [...issue.shas]))];
  const files = await ctx.db.query<{ sha: string; path: string }>(`
    SELECT sha, path FROM ${pluginNamespace(ctx)}.docs_commit_files
    WHERE company_id = $1 AND project_id = $2 AND sha IN (SELECT jsonb_array_elements_text($3::jsonb))
  `, [companyId, projectId, JSON.stringify(allShas)]);
  const pathsBySha = new Map<string, string[]>();
  for (const row of files) pathsBySha.set(row.sha, [...(pathsBySha.get(row.sha) ?? []), row.path]);
  return [...issues].map(([issueId, issue]) => ({
    issueId, identifier: issue.identifier, title: issue.title, status: issue.status,
    paths: [...issue.shas].flatMap((sha) => pathsBySha.get(sha) ?? []),
  }));
}

/** Docs graph of a project snapshot; null when the project has no completed snapshot. */
export async function loadDocsGraph(
  ctx: PluginContext, company: string, project: string, opts: { snapshotId?: string; flowId?: string } = {},
): Promise<DocsGraph | null> {
  const companyId = checkedId(company).toLowerCase();
  const projectId = checkedId(project).toLowerCase();
  await projectScope(ctx, projectId, companyId);
  if (opts.flowId !== undefined && !FLOW_ID.test(opts.flowId)) throw new Error("flowId không hợp lệ");
  const snapshot = await resolveSnapshot(ctx, companyId, projectId, opts.snapshotId);
  if (!snapshot) return null;
  const ns = pluginNamespace(ctx);
  const [projectRow] = await ctx.db.query<{ name: string }>(
    "SELECT name FROM public.projects WHERE id = $1 AND company_id = $2", [projectId, companyId]);
  const pages = await ctx.db.query<{ path: string; title: string }>(
    `SELECT path, title FROM ${ns}.docs_snapshot_pages WHERE snapshot_id = $1 ORDER BY path`, [snapshot.id]);
  const links = await ctx.db.query<{ fromPath: string; toPath: string | null; status: string }>(
    `SELECT from_path AS "fromPath", to_path AS "toPath", status FROM ${ns}.docs_links WHERE snapshot_id = $1 ORDER BY from_path, occurrence`,
    [snapshot.id]);
  const manifest = await loadManifestForSnapshot(ctx, snapshot);
  const tickets = manifest ? await loadTicketCommits(ctx, companyId, projectId) : [];
  const graph = buildDocsGraph({
    projectId, projectName: projectRow?.name ?? projectId, pages, links, manifest, tickets,
    flowId: opts.flowId ?? null, maxNodes: MAX_NODES,
  });
  return {
    snapshot: {
      snapshotId: snapshot.id, commit: snapshot.commit, receivedAt: new Date(snapshot.received_at).toISOString(),
      auditState: snapshot.audit_state, manifestState: snapshot.manifest_state,
    },
    ...graph,
  };
}

const optional = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

export function registerDocsGraph(ctx: PluginContext): void {
  ctx.data.register("crew.docs.graph", params =>
    loadDocsGraph(ctx, String(params.companyId ?? ""), String(params.projectId ?? ""),
      { snapshotId: optional(params.snapshotId), flowId: optional(params.flowId) }));
  ctx.data.register("crew.docs.status", params =>
    loadDocsStatus(ctx, String(params.companyId ?? ""), String(params.projectId ?? "")));
}
