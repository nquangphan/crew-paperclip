import type { PluginContext } from "@paperclipai/plugin-sdk";
import { checkedId, pluginNamespace } from "../shared/db.js";
import type { AttachmentCache } from "../machines/webhook.js";

/**
 * Dung lượng theo company, mỗi con số ghi rõ nó đo kiểu nào:
 * - `logic`: tổng byte nội dung mà người dùng thấy (mỗi tham chiếu đếm một lần);
 * - `vat_ly`: byte thật sau khi bỏ trùng (blob dùng chung chỉ đếm một lần);
 * - `chua_do`: plugin không có cách đo, kèm lý do. Không bao giờ đổi thành 0.
 */
export type Measured = { kind: "logic" | "vat_ly"; bytes: number } | { kind: "chua_do"; reason: string };

export interface ProjectStorage {
  projectId: string;
  name: string;
  docs: { snapshots: number; pages: number; logical: Measured; physical: Measured; legacy: Measured };
  index: { links: number; commits: number; commitFiles: number; logical: Measured };
  tickets: { issues: number; comments: number; runs: number; costEvents: number; commentBytes: Measured; physical: Measured };
  attachments: { count: number; unsized: number; since: string | null; logical: Measured; physical: Measured };
}

export interface StorageReport {
  measuredAt: string;
  projects: ProjectStorage[];
  company: { docsPhysical: Measured; docsShared: Measured; docsLegacy: Measured };
  /** Toàn plugin, mọi company: bảng của plugin không tách theo company. */
  pluginTables: Array<{ table: string; total: Measured }>;
  machines: Array<{ machineId: string; hostname: string; receivedAt: string; attachmentCache: AttachmentCache | null }>;
}

export const NOT_MEASURED = {
  sharedTables: "bảng Paperclip dùng chung, không tách được theo company",
  fileStore: "kho file Paperclip không cho plugin đo",
  machineCache: "máy chưa gửi số liệu cache",
  tableSize: "không gọi được hàm đo kích thước bảng",
} as const;

const PLUGIN_TABLES = ["docs_snapshots", "docs_current", "docs_pages", "docs_links", "docs_blobs", "docs_snapshot_pages",
  "docs_commits", "docs_commit_files", "machine_reports", "machine_latest", "crew_project_roles", "crew_attachment_audit"] as const;

type Db = Pick<PluginContext, "db">;
const logic = (bytes: unknown): Measured => ({ kind: "logic", bytes: Number(bytes ?? 0) });
const physical = (bytes: unknown): Measured => ({ kind: "vat_ly", bytes: Number(bytes ?? 0) });
const iso = (value: string | Date | null): string | null => (value === null ? null : new Date(value).toISOString());

/** Blob references of finished snapshots of projects that still exist: every page plus the manifest. Docs left behind by a deleted project are not counted. */
const REFS = (ns: string) => `refs AS (
  SELECT s.project_id, s.id AS snapshot_id, sp.sha256 FROM ${ns}.docs_snapshots s JOIN ${ns}.docs_snapshot_pages sp ON sp.snapshot_id = s.id
  WHERE s.company_id = $1 AND s.completed_at IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = s.project_id)
  UNION ALL
  SELECT s.project_id, s.id, s.manifest_sha256 FROM ${ns}.docs_snapshots s
  WHERE s.company_id = $1 AND s.completed_at IS NOT NULL AND s.manifest_sha256 IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = s.project_id))`;

async function pluginTableSizes(ctx: Db, ns: string): Promise<StorageReport["pluginTables"]> {
  try {
    const rows = await ctx.db.query<{ name: string; bytes: string | number }>(
      `SELECT t AS name, pg_total_relation_size(($2 || '.' || t)::regclass)::bigint AS bytes FROM jsonb_array_elements_text($1::jsonb) AS t`,
      [JSON.stringify(PLUGIN_TABLES), ns]);
    const sizes = new Map(rows.map((row) => [row.name, Number(row.bytes)]));
    return PLUGIN_TABLES.map((table) => {
      const bytes = sizes.get(table);
      return { table, total: bytes === undefined ? { kind: "chua_do", reason: NOT_MEASURED.tableSize } : physical(bytes) };
    });
  } catch {
    return PLUGIN_TABLES.map((table) => ({ table, total: { kind: "chua_do", reason: NOT_MEASURED.tableSize } }));
  }
}

export async function loadStorageReport(ctx: Db, companyId: string, now = new Date()): Promise<StorageReport> {
  checkedId(companyId);
  const ns = pluginNamespace(ctx);
  const q = <T>(sql: string, params: unknown[] = [companyId]) => ctx.db.query<T>(sql, params);

  const projects = await q<{ id: string; name: string }>(
    `SELECT id::text, name FROM public.projects WHERE company_id = $1 AND archived_at IS NULL ORDER BY name, id`);

  const docs = new Map((await q<{ pid: string; snapshots: number; pages: number }>(
    `SELECT s.project_id::text AS pid, count(DISTINCT s.id)::int AS snapshots,
       (SELECT count(*) FROM ${ns}.docs_snapshot_pages sp WHERE sp.snapshot_id = ANY(array_agg(s.id)))::int AS pages
     FROM ${ns}.docs_snapshots s WHERE s.company_id = $1 AND s.completed_at IS NOT NULL GROUP BY s.project_id`)).map((r) => [r.pid, r]));
  const logical = new Map((await q<{ pid: string; bytes: string }>(
    `WITH ${REFS(ns)} SELECT r.project_id::text AS pid, sum(b.byte_size)::bigint AS bytes
     FROM refs r JOIN ${ns}.docs_blobs b ON b.sha256 = r.sha256 GROUP BY r.project_id`)).map((r) => [r.pid, r.bytes]));
  const distinct = new Map((await q<{ pid: string; bytes: string }>(
    `WITH ${REFS(ns)}, per AS (SELECT DISTINCT project_id, sha256 FROM refs)
     SELECT p.project_id::text AS pid, sum(b.byte_size)::bigint AS bytes
     FROM per p JOIN ${ns}.docs_blobs b ON b.sha256 = p.sha256 GROUP BY p.project_id`)).map((r) => [r.pid, r.bytes]));
  const company = (await q<{ physical: string; shared: string }>(
    `WITH ${REFS(ns)}, uses AS (
       SELECT b.sha256, b.byte_size, count(DISTINCT r.project_id) AS projects
       FROM refs r JOIN ${ns}.docs_blobs b ON b.sha256 = r.sha256 GROUP BY b.sha256, b.byte_size)
     SELECT coalesce(sum(byte_size), 0)::bigint AS physical,
       coalesce(sum(byte_size) FILTER (WHERE projects >= 2), 0)::bigint AS shared FROM uses`))[0];
  const legacy = new Map((await q<{ pid: string; bytes: string }>(
    `SELECT s.project_id::text AS pid, coalesce(sum(octet_length(p.text)), 0)::bigint AS bytes
     FROM ${ns}.docs_pages p JOIN ${ns}.docs_snapshots s ON s.id = p.snapshot_id WHERE s.company_id = $1 GROUP BY s.project_id`))
    .map((r) => [r.pid, r.bytes]));

  const links = new Map((await q<{ pid: string; links: number; bytes: string }>(
    `SELECT s.project_id::text AS pid, count(*)::int AS links,
       coalesce(sum(octet_length(l.from_path) + coalesce(octet_length(l.to_path), 0) + octet_length(l.original_href)), 0)::bigint AS bytes
     FROM ${ns}.docs_links l JOIN ${ns}.docs_snapshots s ON s.id = l.snapshot_id WHERE s.company_id = $1 GROUP BY s.project_id`))
    .map((r) => [r.pid, r]));
  const commits = new Map((await q<{ pid: string; commits: number }>(
    `SELECT project_id::text AS pid, count(*)::int AS commits FROM ${ns}.docs_commits WHERE company_id = $1 GROUP BY project_id`))
    .map((r) => [r.pid, r.commits]));
  const commitFiles = new Map((await q<{ pid: string; files: number; bytes: string }>(
    `SELECT project_id::text AS pid, count(*)::int AS files, coalesce(sum(40 + octet_length(path)), 0)::bigint AS bytes
     FROM ${ns}.docs_commit_files WHERE company_id = $1 GROUP BY project_id`)).map((r) => [r.pid, r]));

  const issues = new Map((await q<{ pid: string; n: number }>(
    `SELECT project_id::text AS pid, count(*)::int AS n FROM public.issues WHERE company_id = $1 AND project_id IS NOT NULL GROUP BY project_id`))
    .map((r) => [r.pid, r.n]));
  const comments = new Map((await q<{ pid: string; n: number; bytes: string }>(
    `SELECT i.project_id::text AS pid, count(*)::int AS n, coalesce(sum(octet_length(c.body)), 0)::bigint AS bytes
     FROM public.issue_comments c JOIN public.issues i ON i.id = c.issue_id
     WHERE c.company_id = $1 AND i.project_id IS NOT NULL GROUP BY i.project_id`)).map((r) => [r.pid, r]));
  const runs = new Map((await q<{ pid: string; n: number }>(
    `SELECT coalesce(i.project_id::text, r.context_snapshot->>'projectId') AS pid, count(*)::int AS n
     FROM public.heartbeat_runs r LEFT JOIN public.issues i ON i.id::text = r.context_snapshot->>'issueId'
     WHERE r.company_id = $1 GROUP BY 1`)).filter((r) => r.pid !== null).map((r) => [r.pid, r.n]));
  const costEvents = new Map((await q<{ pid: string; n: number }>(
    `SELECT project_id::text AS pid, count(*)::int AS n FROM public.cost_events WHERE company_id = $1 AND project_id IS NOT NULL GROUP BY project_id`))
    .map((r) => [r.pid, r.n]));
  const attachments = new Map((await q<{ pid: string; n: number; unsized: number; bytes: string; since: string | Date }>(
    `SELECT i.project_id::text AS pid, count(*)::int AS n, (count(*) FILTER (WHERE a.byte_size IS NULL))::int AS unsized,
       coalesce(sum(a.byte_size), 0)::bigint AS bytes, min(a.checked_at) AS since
     FROM ${ns}.crew_attachment_audit a JOIN public.issues i ON i.id = a.issue_id
     WHERE a.company_id = $1 AND i.project_id IS NOT NULL GROUP BY i.project_id`)).map((r) => [r.pid, r]));

  const machines = await q<{ machine_id: string; hostname: string; received_at: string | Date; cache: AttachmentCache | string | null }>(
    `SELECT machine_id::text, hostname, received_at, report->'attachmentCache' AS cache FROM ${ns}.machine_latest
     WHERE company_id = $1 ORDER BY hostname, machine_id`);

  const legacyTotal = [...legacy.values()].reduce((sum, bytes) => sum + Number(bytes), 0);
  return {
    measuredAt: now.toISOString(),
    projects: projects.map(({ id, name }) => {
      const attached = attachments.get(id);
      return {
        projectId: id, name,
        docs: { snapshots: docs.get(id)?.snapshots ?? 0, pages: docs.get(id)?.pages ?? 0,
          logical: logic(logical.get(id)), physical: physical(distinct.get(id)), legacy: logic(legacy.get(id)) },
        index: { links: links.get(id)?.links ?? 0, commits: commits.get(id) ?? 0, commitFiles: commitFiles.get(id)?.files ?? 0,
          logical: logic(Number(links.get(id)?.bytes ?? 0) + Number(commitFiles.get(id)?.bytes ?? 0)) },
        tickets: { issues: issues.get(id) ?? 0, comments: comments.get(id)?.n ?? 0, runs: runs.get(id) ?? 0, costEvents: costEvents.get(id) ?? 0,
          commentBytes: logic(comments.get(id)?.bytes), physical: { kind: "chua_do", reason: NOT_MEASURED.sharedTables } },
        attachments: { count: attached?.n ?? 0, unsized: attached?.unsized ?? 0, since: iso(attached?.since ?? null),
          logical: logic(attached?.bytes), physical: { kind: "chua_do", reason: NOT_MEASURED.fileStore } },
      };
    }),
    company: { docsPhysical: physical(company?.physical), docsShared: physical(company?.shared), docsLegacy: logic(legacyTotal) },
    pluginTables: await pluginTableSizes(ctx, ns),
    machines: machines.map((row) => ({
      machineId: row.machine_id, hostname: row.hostname, receivedAt: new Date(row.received_at).toISOString(),
      attachmentCache: typeof row.cache === "string" ? JSON.parse(row.cache) as AttachmentCache : row.cache,
    })),
  };
}

export function registerStorageData(ctx: PluginContext): void {
  ctx.data.register("crew.storage", (params) => loadStorageReport(ctx, checkedId(params.companyId)));
}
