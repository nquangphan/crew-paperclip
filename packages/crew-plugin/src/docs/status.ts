import type { PluginContext } from "@paperclipai/plugin-sdk";
import { checkedId, pluginNamespace } from "../shared/db.js";
import { projectScope, resolveSnapshot } from "./data.js";

export type DocsState = "missing" | "unverified" | "invalid" | "stale" | "current";
export interface DocsStateInput { snapshot: { commit: string; auditState: string } | null;
  latestPushed: { sha: string; at: string } | null; pushedKnown: boolean | null }
const vnTime = (iso: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit",
  day: "2-digit", month: "2-digit", year: "numeric", hour12: false }).formatToParts(new Date(iso))
  .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {} as Record<string, string>);
export function docsState(input: DocsStateInput): { state: DocsState; reason: string } {
  if (!input.snapshot) return { state: "missing", reason: "Dự án chưa có ảnh chụp docs nào." };
  const short = input.snapshot.commit.slice(0, 12);
  if (input.latestPushed && input.pushedKnown === false) {
    const t = vnTime(input.latestPushed.at);
    return { state: "stale", reason: `Commit ${input.latestPushed.sha.slice(0, 12)} đã push lúc ${t.hour}:${t.minute} ${t.day}/${t.month}/${t.year} nhưng ảnh chụp docs chưa có commit này.` };
  }
  if (input.snapshot.auditState === "invalid") return { state: "invalid", reason: `crew-docs check báo lỗi ở commit ${short}.` };
  if (input.snapshot.auditState === "unverified") return { state: "unverified", reason: `Chưa chạy được crew-docs check ở commit ${short}.` };
  return { state: "current", reason: `Docs khớp commit ${short}.` };
}

export interface DocsStatus {
  state: DocsState; staleKnown: boolean;
  snapshot: { snapshotId: string; commit: string; receivedAt: string; auditState: string } | null;
  latestPushed: { sha: string; issueId: string; identifier: string; at: string } | null;
  reason: string;
}

const PUSHED = /^crew-merge sha=([0-9a-f]{40}) branch=\S+ pushed=yes/;

/** Docs state of a project: its current snapshot against the newest commit an agent reported as pushed. */
export async function loadDocsStatus(ctx: PluginContext, company: string, project: string): Promise<DocsStatus> {
  const companyId = checkedId(company).toLowerCase();
  const projectId = checkedId(project).toLowerCase();
  await projectScope(ctx, projectId, companyId);
  const snapshot = await resolveSnapshot(ctx, companyId, projectId);
  const ns = pluginNamespace(ctx);
  const comments = await ctx.db.query<{ body: string; at: string; issueId: string; identifier: string }>(`
    SELECT c.body, c.created_at AS at, i.id AS "issueId", coalesce(i.identifier, '') AS identifier
    FROM public.issue_comments c JOIN public.issues i ON i.id = c.issue_id
    WHERE i.company_id = $1 AND i.project_id = $2 AND i.hidden_at IS NULL AND c.deleted_at IS NULL
      AND c.author_agent_id IS NOT NULL AND c.body ~ '^crew-merge sha=[0-9a-f]{40} branch=\\S+ pushed=yes'
    ORDER BY c.created_at DESC, c.id DESC LIMIT 1
  `, [companyId, projectId]);
  const comment = comments[0];
  const sha = comment ? PUSHED.exec(comment.body.split("\n", 1)[0] ?? "")?.[1] : undefined;
  const latestPushed = comment && sha
    ? { sha, issueId: comment.issueId, identifier: comment.identifier, at: new Date(comment.at).toISOString() }
    : null;
  let pushedKnown: boolean | null = null;
  if (latestPushed) {
    const rows = await ctx.db.query<{ any: boolean; hit: boolean }>(`
      SELECT EXISTS(SELECT 1 FROM ${ns}.docs_commits WHERE company_id = $1 AND project_id = $2) AS any,
        EXISTS(SELECT 1 FROM ${ns}.docs_commits WHERE company_id = $1 AND project_id = $2 AND sha = $3) AS hit
    `, [companyId, projectId, latestPushed.sha]);
    if (rows[0]?.any) pushedKnown = rows[0].hit;
  }
  const { state, reason } = docsState({
    snapshot: snapshot ? { commit: snapshot.commit, auditState: snapshot.audit_state } : null, latestPushed, pushedKnown,
  });
  return {
    state, staleKnown: pushedKnown !== null, reason, latestPushed,
    snapshot: snapshot ? { snapshotId: snapshot.id, commit: snapshot.commit,
      receivedAt: new Date(snapshot.received_at).toISOString(), auditState: snapshot.audit_state } : null,
  };
}
