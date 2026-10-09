import { createHash, randomUUID } from "node:crypto";
import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { authenticateCrewWebhook, registerCrewWebhook } from "../shared/webhook.js";
import { pluginNamespace, UUID } from "../shared/db.js";
import { computeContentKey } from "./content-key.js";
import { parseFlowsManifest } from "./manifest.js";

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
const commitPathOk = (path: unknown): boolean => typeof path === "string" && path.length > 0 && path.length <= 1024 && !/[\u0000-\u001f]/.test(path);
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const MANIFEST_MAX_BYTES = 512 * 1024;
const MAX_COMMITS = 200;
const MAX_PATHS_PER_COMMIT = 500;
const MAX_COMMIT_PATHS = 100_000;

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
  format?: 2;
  manifest?:
    | { status: "present"; text: string; sha256: string }
    | { status: "absent" }
    | { status: "dropped"; reason: "secret-scan" | "too-large" };
  commits?: {
    base: string | null;
    truncated: boolean;
    items: Array<{ sha: string; merge: boolean; paths: string[] }>;
  };
}
export type ManifestState = "not_sent" | "absent" | "ok" | "invalid" | "dropped";

function validManifest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const m = value as Record<string, unknown>;
  if (m.status === "absent") return true;
  if (m.status === "dropped") return m.reason === "secret-scan" || m.reason === "too-large";
  return m.status === "present" && typeof m.text === "string"
    && Buffer.byteLength(m.text, "utf8") <= MANIFEST_MAX_BYTES
    && sha64.test(String(m.sha256)) && sha256(m.text) === m.sha256;
}
function validCommits(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.truncated !== "boolean" || !(c.base === null || sha40.test(String(c.base)))) return false;
  if (!Array.isArray(c.items) || c.items.length > MAX_COMMITS) return false;
  const seen = new Set<string>();
  let total = 0;
  for (const raw of c.items as unknown[]) {
    const item = raw as Record<string, unknown> | null;
    if (!item || typeof item !== "object" || !sha40.test(String(item.sha)) || seen.has(String(item.sha))
      || typeof item.merge !== "boolean" || !Array.isArray(item.paths) || item.paths.length > MAX_PATHS_PER_COMMIT
      || (item.merge && item.paths.length > 0) || !item.paths.every(commitPathOk)) return false;
    seen.add(String(item.sha));
    total += item.paths.length;
  }
  return total <= MAX_COMMIT_PATHS;
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
  for (const p of pages) if (sha256(p.text) !== p.sha256) fail("mã băm trang không khớp nội dung");
  if (v.format !== undefined && v.format !== 2) fail("format không hợp lệ");
  if ((v.manifest !== undefined || v.commits !== undefined) && v.format !== 2) fail("format không hợp lệ");
  if (v.manifest !== undefined && !validManifest(v.manifest)) fail("manifest không hợp lệ");
  if (v.commits !== undefined && !validCommits(v.commits)) fail("commits không hợp lệ");
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
  await storeDocsSnapshot(ctx, body);
}

// Lists are bound as one JSON parameter: the host binds JS arrays as SQL value lists, not as Postgres arrays.
const BATCH = 200;
const FILE_BATCH = 1000;
function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Stores a validated snapshot content-addressed and keeps history. Pages land in a staging row that becomes
 * visible only once `completed_at` is set; the partial unique index on the content key lets exactly one of two
 * identical concurrent sends complete, the other resolves to the winner.
 */
export async function storeDocsSnapshot(ctx: PluginContext, body: DocsSnapshot): Promise<{ snapshotId: string; deduplicated: boolean }> {
  const ns = pluginNamespace(ctx);
  const { companyId, projectId } = body;
  const manifest = body.manifest;
  const parsed = manifest?.status === "present" ? parseFlowsManifest(manifest.text) : null;
  const manifestState: ManifestState = !manifest ? "not_sent"
    : manifest.status === "present" ? parsed!.state : manifest.status;
  const manifestSha = manifest?.status === "present" ? manifest.sha256 : null;
  const format = body.format ?? 1;
  const contentKey = computeContentKey({ format, commit: body.commit, auditState: body.auditState,
    manifestSha256: manifestSha, pages: body.pages, dropped: body.dropped });
  // Broken staging rows of this project only; completed snapshots are history and stay.
  await ctx.db.execute(`DELETE FROM ${ns}.docs_snapshots WHERE company_id = $1 AND project_id = $2
    AND completed_at IS NULL AND received_at < now() - interval '10 minutes'`, [companyId, projectId]);
  const existing = await findCompleted(ctx, body, contentKey);
  if (existing) return adopt(ctx, body, existing);
  const blobs = new Map(body.pages.map((page) => [page.sha256, page.text]));
  if (manifest?.status === "present") blobs.set(manifest.sha256, manifest.text);
  await putBlobs(ctx, blobs);
  const id = randomUUID();
  await ctx.db.execute(`INSERT INTO ${ns}.docs_snapshots (id, company_id, project_id, machine_id, repo, commit, audit_state,
      check_exit, dropped, content_key, format, manifest_state, manifest_sha256, manifest_errors, commits_truncated)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15)`,
  [id, companyId, projectId, body.machineId, body.repo, body.commit, body.auditState, body.checkExit,
    JSON.stringify(body.dropped), contentKey, format, manifestState, manifestSha,
    JSON.stringify(parsed?.state === "invalid" ? parsed.errors : []), body.commits?.truncated ?? false]);
  await insertPages(ctx, id, body.pages);
  await insertLinks(ctx, id, body.links);
  try {
    await ctx.db.execute(`UPDATE ${ns}.docs_snapshots SET completed_at = now() WHERE id = $1`, [id]);
  } catch (error) {
    // The host does not keep the Postgres error code; a completed twin with the same key is the only
    // acceptable reason for this update to fail.
    const winner = await findCompleted(ctx, body, contentKey);
    if (!winner || winner === id) throw error;
    await ctx.db.execute(`DELETE FROM ${ns}.docs_snapshots WHERE id = $1 AND completed_at IS NULL`, [id]);
    return adopt(ctx, body, winner);
  }
  await storeCommits(ctx, body, id);
  await pointCurrent(ctx, companyId, projectId, id);
  return { snapshotId: id, deduplicated: false };
}

async function adopt(ctx: PluginContext, body: DocsSnapshot, snapshotId: string) {
  await storeCommits(ctx, body, snapshotId);
  await pointCurrent(ctx, body.companyId, body.projectId, snapshotId);
  return { snapshotId, deduplicated: true };
}

async function findCompleted(ctx: PluginContext, body: DocsSnapshot, contentKey: string): Promise<string | null> {
  const rows = await ctx.db.query<{ id: string }>(`SELECT id FROM ${pluginNamespace(ctx)}.docs_snapshots
    WHERE company_id = $1 AND project_id = $2 AND commit = $3 AND content_key = $4 AND completed_at IS NOT NULL
    LIMIT 1`, [body.companyId, body.projectId, body.commit, contentKey]);
  return rows[0]?.id ?? null;
}

/** Inserts missing blobs, then compares every stored blob byte for byte before anything references it. */
async function putBlobs(ctx: PluginContext, blobs: Map<string, string>): Promise<void> {
  const ns = pluginNamespace(ctx);
  for (const batch of batches([...blobs], BATCH)) {
    const rows = batch.map(([sha, text]) => ({ s: sha, n: Buffer.byteLength(text, "utf8"), t: text }));
    await ctx.db.execute(`INSERT INTO ${ns}.docs_blobs (sha256, byte_size, text)
      SELECT x.s, x.n, x.t FROM jsonb_to_recordset($1::jsonb) AS x(s text, n integer, t text)
      ON CONFLICT (sha256) DO NOTHING`, [JSON.stringify(rows)]);
    const stored = await ctx.db.query<{ sha256: string; byte_size: number; text: string }>(`SELECT sha256, byte_size, text
      FROM ${ns}.docs_blobs WHERE sha256 IN (SELECT jsonb_array_elements_text($1::jsonb))`,
    [JSON.stringify(batch.map(([sha]) => sha))]);
    const found = new Map(stored.map((row) => [row.sha256, row]));
    for (const row of rows) {
      const blob = found.get(row.s);
      if (!blob || Number(blob.byte_size) !== row.n || blob.text !== row.t) {
        ctx.logger.warn("docs-snapshot: blob trùng mã băm nhưng khác nội dung", { sha: row.s.slice(0, 12) });
        fail("trùng mã băm nhưng khác nội dung");
      }
    }
  }
}

async function insertPages(ctx: PluginContext, snapshotId: string, pages: DocsSnapshot["pages"]): Promise<void> {
  for (const batch of batches(pages, BATCH)) {
    await ctx.db.execute(`INSERT INTO ${pluginNamespace(ctx)}.docs_snapshot_pages (snapshot_id, path, title, parent_path, sha256)
      SELECT $1::uuid, x.path, x.title, x.parent, x.sha FROM jsonb_to_recordset($2::jsonb) AS x(path text, title text, parent text, sha text)`,
    [snapshotId, JSON.stringify(batch.map((p) => ({ path: p.path, title: p.title, parent: p.parentPath, sha: p.sha256 })))]);
  }
}

async function insertLinks(ctx: PluginContext, snapshotId: string, links: DocsSnapshot["links"]): Promise<void> {
  for (const batch of batches(links, BATCH)) {
    await ctx.db.execute(`INSERT INTO ${pluginNamespace(ctx)}.docs_links
        (snapshot_id, from_path, occurrence, original_href, to_path, fragment, status)
      SELECT $1::uuid, x.from_path, x.occurrence, x.href, x.to_path, x.fragment, x.status
      FROM jsonb_to_recordset($2::jsonb) AS x(from_path text, occurrence integer, href text, to_path text, fragment text, status text)`,
    [snapshotId, JSON.stringify(batch.map((l) => ({ from_path: l.fromPath, occurrence: l.occurrence, href: l.originalHref,
      to_path: l.toPath, fragment: l.fragment, status: l.status })))]);
  }
}

/** Idempotent: a commit keeps the first snapshot that reported it, files only accumulate. */
async function storeCommits(ctx: PluginContext, body: DocsSnapshot, snapshotId: string): Promise<void> {
  if (!body.commits) return;
  const ns = pluginNamespace(ctx);
  for (const batch of batches(body.commits.items, BATCH)) {
    await ctx.db.execute(`INSERT INTO ${ns}.docs_commits (company_id, project_id, sha, is_merge, first_snapshot_id)
      SELECT $1::uuid, $2::uuid, x.sha, x.merge, $3::uuid FROM jsonb_to_recordset($4::jsonb) AS x(sha text, merge boolean)
      ON CONFLICT DO NOTHING`,
    [body.companyId, body.projectId, snapshotId, JSON.stringify(batch.map((c) => ({ sha: c.sha, merge: c.merge })))]);
  }
  const files = body.commits.items.flatMap((c) => c.paths.map((path) => ({ sha: c.sha, path })));
  for (const batch of batches(files, FILE_BATCH)) {
    await ctx.db.execute(`INSERT INTO ${ns}.docs_commit_files (company_id, project_id, sha, path)
      SELECT $1::uuid, $2::uuid, x.sha, x.path FROM jsonb_to_recordset($3::jsonb) AS x(sha text, path text)
      ON CONFLICT DO NOTHING`, [body.companyId, body.projectId, JSON.stringify(batch)]);
  }
}

async function pointCurrent(ctx: PluginContext, companyId: string, projectId: string, snapshotId: string): Promise<void> {
  await ctx.db.execute(`INSERT INTO ${pluginNamespace(ctx)}.docs_current (company_id, project_id, snapshot_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (company_id, project_id) DO UPDATE SET snapshot_id = EXCLUDED.snapshot_id`, [companyId, projectId, snapshotId]);
}

export function registerDocsWebhook(ctx: PluginContext): void {
  registerCrewWebhook("docs-snapshot", input => receiveDocsSnapshot(ctx, input));
}
