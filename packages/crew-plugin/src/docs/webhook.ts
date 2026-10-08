import { randomUUID } from "node:crypto";
import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { authenticateCrewWebhook, registerCrewWebhook } from "../shared/webhook.js";
import { pluginNamespace, UUID } from "../shared/db.js";

const sha40 = /^[0-9a-f]{40}$/;
const sha64 = /^[0-9a-f]{64}$/;
const pathOk = (path: unknown): path is string =>
  typeof path === "string"
  && path.startsWith("docs/")
  && path.length <= 1024
  && !path.includes("\\")
  && !path.includes("\0")
  && !path.split("/").some(segment => !segment || segment === "." || segment === "..");
const parentOk = (path: string, parent: unknown): boolean =>
  typeof parent === "string" && parent === path.slice(0, path.lastIndexOf("/"));
const str = (value: unknown, max = 1024): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

function fail(message: string): never {
  throw new Error(`docs-snapshot: ${message}`);
}

export interface DocsSnapshot {
  version: 1;
  companyId: string;
  projectId: string;
  machineId: string;
  repo: string;
  commit: string;
  auditState: "verified" | "invalid" | "unverified";
  checkExit: number;
  pages: Array<{ path: string; title: string; parentPath: string; text: string; sha256: string }>;
  links: Array<{ fromPath: string; occurrence: number; originalHref: string; toPath: string | null; fragment: string | null; status: "ok" | "missing" | "external" | "unverified" }>;
  dropped: Array<{ path: string; reason: "secret-scan" | "secret-scan-metadata" }>;
}
export function validateDocsSnapshot(value: unknown): DocsSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("body không hợp lệ");
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !UUID.test(String(v.companyId)) || !UUID.test(String(v.projectId))
    || !UUID.test(String(v.machineId)) || !str(v.repo) || !sha40.test(String(v.commit))) {
    fail("metadata không hợp lệ");
  }
  const auditStates = ["verified", "invalid", "unverified", "unverified"];
  if (![0, 1, 2, 3].includes(v.checkExit as number) || v.auditState !== auditStates[v.checkExit as number]) {
    fail("auditState không khớp checkExit");
  }
  if (!Array.isArray(v.pages) || !Array.isArray(v.links) || !Array.isArray(v.dropped)) fail("danh sách không hợp lệ");
  const pages = v.pages as DocsSnapshot["pages"];
  const links = v.links as DocsSnapshot["links"];
  const dropped = v.dropped as DocsSnapshot["dropped"];
  const paths = new Set<string>();
  for (const p of pages) {
    if (!p || !pathOk(p.path) || !str(p.title, 2048)
      || !parentOk(p.path, p.parentPath) || typeof p.text !== "string"
      || !sha64.test(String(p.sha256)) || paths.has(p.path)) {
      fail("trang không hợp lệ");
    }
    paths.add(p.path);
  }
  const occurrences = new Set<string>();
  for (const l of links) {
    if (!l || !paths.has(l.fromPath) || !Number.isInteger(l.occurrence)
      || l.occurrence < 1 || !str(l.originalHref, 4096)
      || l.toPath !== null && !pathOk(l.toPath)
      || l.fragment !== null && !str(l.fragment, 1024)
      || !["ok", "missing", "external", "unverified"].includes(l.status)
      || occurrences.has(`${l.fromPath}:${l.occurrence}`)) {
      fail("liên kết không hợp lệ");
    }
    if (l.status === "ok" && (!l.toPath || !paths.has(l.toPath))) fail("liên kết đích không tồn tại");
    occurrences.add(`${l.fromPath}:${l.occurrence}`);
  }
  for (const item of dropped) {
    const validPath = item?.reason === "secret-scan" && pathOk(item.path)
      || item?.reason === "secret-scan-metadata" && item.path === "<đã che>";
    if (!validPath || paths.has(item.path)) fail("file bị bỏ không hợp lệ");
  }
  return v as unknown as DocsSnapshot;
}
export async function receiveDocsSnapshot(ctx: PluginContext, input: PluginWebhookInput): Promise<void> {
  const authenticated = await authenticateCrewWebhook(input, ctx, { maxBytes: 5 * 1024 * 1024 });
  const body = validateDocsSnapshot(authenticated.body);
  const project = await ctx.db.query<{ id: string }>(
    "SELECT id FROM public.projects WHERE id = $1 AND company_id = $2",
    [body.projectId, body.companyId],
  );
  if (!project[0]) fail("projectId không thuộc companyId");
  const ns = pluginNamespace(ctx);
  await ctx.db.execute(`
    DELETE FROM ${ns}.docs_snapshots s
    WHERE s.company_id = $1 AND s.project_id = $2
      AND s.received_at < now() - interval '10 minutes'
      AND NOT EXISTS (SELECT 1 FROM ${ns}.docs_current c WHERE c.snapshot_id = s.id)
  `, [body.companyId, body.projectId]);
  const previous = await ctx.db.query<{ snapshot_id: string }>(`
    SELECT snapshot_id FROM ${ns}.docs_current WHERE company_id = $1 AND project_id = $2
  `, [body.companyId, body.projectId]);
  const previousId = previous[0]?.snapshot_id;
  const id = randomUUID();
  // Staging rows remain invisible until the single current-pointer update succeeds.
  await ctx.db.execute(`
    INSERT INTO ${ns}.docs_snapshots
      (id, company_id, project_id, machine_id, repo, commit, audit_state, check_exit, dropped)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
  `, [id, body.companyId, body.projectId, body.machineId, body.repo, body.commit,
    body.auditState, body.checkExit, JSON.stringify(body.dropped)]);
  for (const page of body.pages) {
    await ctx.db.execute(`
      INSERT INTO ${ns}.docs_pages (snapshot_id,path,title,parent_path,text,sha256)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [id, page.path, page.title, page.parentPath, page.text, page.sha256]);
  }
  for (const link of body.links) {
    await ctx.db.execute(`
      INSERT INTO ${ns}.docs_links
        (snapshot_id,from_path,occurrence,original_href,to_path,fragment,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [id, link.fromPath, link.occurrence, link.originalHref, link.toPath, link.fragment, link.status]);
  }
  await ctx.db.execute(`
    INSERT INTO ${ns}.docs_current (company_id,project_id,snapshot_id)
    VALUES ($1,$2,$3)
    ON CONFLICT (company_id,project_id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id
  `, [body.companyId, body.projectId, id]);
  if (previousId) {
    await ctx.db.execute(`
      DELETE FROM ${ns}.docs_snapshots s WHERE s.id = $1
        AND NOT EXISTS (SELECT 1 FROM ${ns}.docs_current c WHERE c.snapshot_id = s.id)
    `, [previousId]);
  }
}
export function registerDocsWebhook(ctx: PluginContext): void {
  registerCrewWebhook("docs-snapshot", input => receiveDocsSnapshot(ctx, input));
}
