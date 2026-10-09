import { createHash, createHmac } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { createDb, plugins } from "../../../db/src/index.js";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { pluginDatabaseService } from "../../../../server/src/services/plugin-database.js";
import manifest from "../manifest.js";
import { type DocsSnapshot, receiveDocsSnapshot, storeDocsSnapshot } from "../docs/webhook.js";
import { loadDocsPage, loadDocsTree, searchDocs } from "../docs/data.js";
import { loadDocsHistory } from "../docs/history.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000001";
const sameCompanyProject = "20000000-0000-4000-8000-000000000003";
const otherCompanyProject = "20000000-0000-4000-8000-000000000002";
const machineId = "50000000-0000-4000-8000-000000000001";
const hostPluginId = "60000000-0000-4000-8000-000000000001";
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationsDir = join(packageRoot, "migrations");

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const page = (path: string, title: string, text: string) =>
  ({ path, title, parentPath: path.slice(0, path.lastIndexOf("/")), text, sha256: sha(text) });
const ten = Array.from({ length: 10 }, (_, i) => page(`docs/p${i}.md`, `P${i}`, `# P${i}\nnội dung ${i}`));
const manifestText = 'version: 1\nsource: {include: ["src/**"]}\nflows: {core: {title: Core, doc: docs/p0.md, files: [src/a.ts]}}\n';
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);
const v2 = (commit: string, pages = ten, extra: Record<string, unknown> = {}) => ({
  version: 1, format: 2, companyId, machineId, projectId, repo: "repo-a", commit, auditState: "verified", checkExit: 0,
  pages, links: [], dropped: [],
  manifest: { status: "present", text: manifestText, sha256: sha(manifestText) },
  commits: { base: null, truncated: false, items: [{ sha: commit, merge: false, paths: ["src/a.ts", "docs/p1.md"] }] },
  ...extra,
});
const editedB = () => [page("docs/p1.md", "P1", "sửa"), ...ten.filter((p) => p.path !== "docs/p1.md")];

function signed(body: unknown): PluginWebhookInput {
  const rawBody = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const signature = `sha256=${createHmac("sha256", "test-secret").update(`${ts}.${rawBody}`).digest("hex")}`;
  return { endpointKey: "docs-snapshot", rawBody, requestId: "request-1",
    headers: { "X-Crew-Timestamp": String(ts), "X-Crew-Signature": signature } };
}

interface Host {
  sql: postgres.Sql;
  ctx: PluginContext;
  ns: string;
  warnings: Array<{ message: string; meta: unknown }>;
  applyMigrations: (root: string) => Promise<void>;
  cleanup: () => Promise<void>;
}

/** Embedded Postgres with the real host plugin-database service, so SQL binding and validators match production. */
async function startHost(prefix: string, root = packageRoot): Promise<Host> {
  const database = await startEmbeddedPostgresTestDatabase(prefix);
  const sql = postgres(database.connectionString, { max: 4, onnotice: () => {} });
  const hostDb = createDb(database.connectionString);
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${companyId},'Crew','CRE'),(${otherCompany},'Other','OTH')`;
  await sql`INSERT INTO projects (id,company_id,name) VALUES (${projectId},${companyId},'Repo A'),(${sameCompanyProject},${companyId},'Repo B'),(${otherCompanyProject},${otherCompany},'Other repo')`;
  await hostDb.insert(plugins).values({
    id: hostPluginId, pluginKey: manifest.id, packageName: "@crew/paperclip-plugin", version: manifest.version,
    apiVersion: manifest.apiVersion, categories: manifest.categories, manifestJson: manifest, status: "installed",
  });
  const pluginDb = pluginDatabaseService(hostDb);
  const applyMigrations = async (from: string) => {
    await pluginDb.applyMigrations(hostPluginId, manifest, from);
  };
  await applyMigrations(root);
  const ns = await pluginDb.getRuntimeNamespace(hostPluginId);
  const warnings: Host["warnings"] = [];
  const ctx = {
    db: {
      namespace: ns,
      query: <T>(statement: string, params?: unknown[]) => pluginDb.query<T>(hostPluginId, statement, params),
      execute: (statement: string, params?: unknown[]) => pluginDb.execute(hostPluginId, statement, params),
    },
    config: { get: async () => ({ companies: [{ companyId, webhookSecretRef: { type: "secret_ref", secretId: "40000000-0000-4000-8000-000000000001" } }] }) },
    secrets: { resolve: async () => "test-secret" },
    logger: { info: () => {}, debug: () => {}, error: () => {}, warn: (message: string, meta?: unknown) => { warnings.push({ message, meta }); } },
  } as unknown as PluginContext;
  return { sql, ctx, ns, warnings, applyMigrations,
    cleanup: async () => { await sql.end(); await database.cleanup(); } };
}

describe("content-addressed docs snapshots", () => {
  let host: Host;
  const n = async (from: string, where = "true") =>
    Number((await host.sql.unsafe(`SELECT count(*)::int AS n FROM ${host.ns}.${from} WHERE ${where}`))[0]?.n);
  const idOf = async (commit: string, project = projectId) => String((await host.sql.unsafe(
    `SELECT id FROM ${host.ns}.docs_snapshots WHERE commit = $1 AND project_id = $2 AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1`,
    [commit, project]))[0]?.id);
  const receive = (body: unknown) => receiveDocsSnapshot(host.ctx, signed(body));
  const reset = async () => {
    for (const table of ["docs_current", "docs_commit_files", "docs_commits", "docs_snapshots", "docs_blobs"]) {
      await host.sql.unsafe(`DELETE FROM ${host.ns}.${table}`);
    }
  };

  beforeAll(async () => { host = await startHost("crew-docs-dedup-"); }, 120_000);
  afterAll(async () => { await host?.cleanup(); });

  it("stores one new blob for one edited page and keeps the older snapshot readable", async () => {
    await reset();
    await receive(v2(A));
    await receive(v2(B, editedB()));
    expect(await n("docs_blobs")).toBe(12);
    expect(await n("docs_snapshots", "completed_at IS NOT NULL")).toBe(2);
    expect((await loadDocsTree(host.ctx, projectId, companyId))?.commit).toBe(B);
    const snapshotA = await idOf(A);
    expect((await loadDocsPage(host.ctx, projectId, "docs/p1.md", companyId, snapshotA))?.text).toBe("# P1\nnội dung 1");
    expect((await loadDocsPage(host.ctx, projectId, "docs/p1.md", companyId))?.text).toBe("sửa");
    const tree = await loadDocsTree(host.ctx, projectId, companyId, snapshotA);
    expect(tree).toMatchObject({ snapshotId: snapshotA, commit: A, manifestState: "ok" });
    expect(tree?.pages).toHaveLength(10);
    expect((await searchDocs(host.ctx, projectId, "sửa", companyId)).map((p) => p.path)).toEqual(["docs/p1.md"]);
  });

  it("treats a resend of the same body as the same snapshot", async () => {
    const before = await n("docs_snapshots");
    const body = v2(B, editedB()) as unknown as DocsSnapshot;
    await receive(body);
    const again = await storeDocsSnapshot(host.ctx, body);
    expect(again).toEqual({ snapshotId: await idOf(B), deduplicated: true });
    expect(await n("docs_snapshots")).toBe(before);
    expect(await n("docs_snapshots", "completed_at IS NOT NULL")).toBe(2);
    expect((await loadDocsTree(host.ctx, projectId, companyId))?.snapshotId).toBe(await idOf(B));
  });

  it("lists history newest first with page changes against the previous snapshot", async () => {
    const history = await loadDocsHistory(host.ctx, projectId, companyId);
    expect(history.map((item) => [item.commit, item.current, item.changed])).toEqual([
      [B, true, { added: 0, modified: 1, removed: 0 }],
      [A, false, null],
    ]);
    expect(history[0]).toMatchObject({ format: 2, manifestState: "ok", pageCount: 10, auditState: "verified" });
    expect(await loadDocsHistory(host.ctx, projectId, companyId, 1)).toHaveLength(1);
    await expect(loadDocsHistory(host.ctx, projectId, otherCompany)).rejects.toThrow();
  });

  it("records commits and changed files once per project", async () => {
    const rows = await host.sql.unsafe(`SELECT sha, is_merge, first_snapshot_id FROM ${host.ns}.docs_commits WHERE project_id = $1 ORDER BY sha`, [projectId]);
    expect(rows.map((r) => [r.sha, r.is_merge, r.first_snapshot_id])).toEqual([[A, false, await idOf(A)], [B, false, await idOf(B)]]);
    expect(await n("docs_commit_files", `sha = '${A}' AND path = 'src/a.ts'`)).toBe(1);
    const repeat = v2(C, editedB(), { commits: { base: B, truncated: false, items: [
      { sha: C, merge: true, paths: [] }, { sha: A, merge: false, paths: ["src/a.ts", "src/b.ts"] }] } });
    await receive(repeat);
    const after = await host.sql.unsafe(`SELECT sha, is_merge, first_snapshot_id FROM ${host.ns}.docs_commits WHERE project_id = $1 ORDER BY sha`, [projectId]);
    expect(after.map((r) => [r.sha, r.is_merge, r.first_snapshot_id])).toEqual([
      [A, false, await idOf(A)], [B, false, await idOf(B)], [C, true, await idOf(C)]]);
    expect(await n("docs_commit_files", `sha = '${A}'`)).toBe(3);
    expect(await n("docs_snapshots", "commits_truncated")).toBe(0);
  });

  it("completes exactly one snapshot when the same body arrives twice at once", async () => {
    const body = v2(D, editedB());
    await Promise.all([receive(body), receive(body)]);
    expect(await n("docs_snapshots", `commit = '${D}' AND completed_at IS NOT NULL`)).toBe(1);
    expect(await n("docs_snapshots", `commit = '${D}'`)).toBe(1);
    const other = v2("e".repeat(40), editedB()) as unknown as DocsSnapshot;
    const results = await Promise.all([storeDocsSnapshot(host.ctx, other), storeDocsSnapshot(host.ctx, other)]);
    expect(new Set(results.map((r) => r.snapshotId)).size).toBe(1);
    expect(await n("docs_snapshots", `commit = '${"e".repeat(40)}'`)).toBe(1);
    expect((await loadDocsTree(host.ctx, projectId, companyId))?.snapshotId).toBe(results[0]!.snapshotId);
  });

  it("rejects a page whose declared hash does not match its text and writes nothing", async () => {
    const counts = async () => [await n("docs_snapshots"), await n("docs_snapshot_pages"), await n("docs_commits"), await n("docs_blobs")];
    const before = await counts();
    const bad = { ...page("docs/p1.md", "P1", "thật"), sha256: sha("khác") };
    await expect(receive(v2("f".repeat(40), [bad]))).rejects.toThrow(/mã băm trang không khớp/);
    expect(await counts()).toEqual(before);
  });

  it("rejects a snapshot when a stored blob has the same hash but different bytes", async () => {
    const real = sha("thật");
    await host.sql.unsafe(`INSERT INTO ${host.ns}.docs_blobs (sha256, byte_size, text) VALUES ($1, 3, 'giả')`, [real]);
    const before = [await n("docs_snapshots"), await n("docs_snapshot_pages"), await n("docs_commits")];
    host.warnings.length = 0;
    await expect(receive(v2("f".repeat(40), [page("docs/p1.md", "P1", "thật")])))
      .rejects.toThrow(/trùng mã băm nhưng khác nội dung/);
    expect([await n("docs_snapshots"), await n("docs_snapshot_pages"), await n("docs_commits")]).toEqual(before);
    expect((await host.sql.unsafe(`SELECT text FROM ${host.ns}.docs_blobs WHERE sha256 = $1`, [real]))[0]?.text).toBe("giả");
    expect(JSON.stringify(host.warnings)).toContain(real.slice(0, 12));
    expect(JSON.stringify(host.warnings)).not.toContain(real);
    expect(JSON.stringify(host.warnings)).not.toContain("thật");
    await host.sql.unsafe(`DELETE FROM ${host.ns}.docs_blobs WHERE sha256 = $1`, [real]);
  });

  it("accepts a body from an older Mac without format, manifest or commits", async () => {
    const { format: _f, manifest: _m, commits: _c, ...old } = v2("1".repeat(40), editedB());
    await receive(old);
    const rows = await host.sql.unsafe(`SELECT format, manifest_state, manifest_sha256 FROM ${host.ns}.docs_snapshots WHERE commit = $1`, ["1".repeat(40)]);
    expect(rows.map((r) => [r.format, r.manifest_state, r.manifest_sha256])).toEqual([[1, "not_sent", null]]);
    expect((await loadDocsTree(host.ctx, projectId, companyId))?.manifestState).toBe("not_sent");
  });

  it("stores invalid and absent manifests with their state", async () => {
    const broken = "version: 2\n";
    await receive(v2("2".repeat(40), editedB(), { manifest: { status: "present", text: broken, sha256: sha(broken) } }));
    await receive(v2("3".repeat(40), editedB(), { manifest: { status: "absent" } }));
    const rows = await host.sql.unsafe(`SELECT commit, manifest_state, manifest_errors FROM ${host.ns}.docs_snapshots WHERE commit IN ($1, $2) ORDER BY commit`, ["2".repeat(40), "3".repeat(40)]);
    expect(rows[0]).toMatchObject({ manifest_state: "invalid" });
    expect((rows[0]!.manifest_errors as string[]).length).toBeGreaterThan(0);
    expect(rows[1]).toMatchObject({ manifest_state: "absent", manifest_errors: [] });
    await expect(receive(v2("4".repeat(40), editedB(), { manifest: { status: "present", text: broken, sha256: sha("x") } })))
      .rejects.toThrow(/manifest không hợp lệ/);
    await expect(receive(v2("4".repeat(40), editedB(), { format: undefined })))
      .rejects.toThrow(/format không hợp lệ/);
    await expect(receive(v2("4".repeat(40), editedB(), { commits: { base: null, truncated: false, items: [
      { sha: A, merge: false, paths: [] }, { sha: A, merge: false, paths: [] }] } }))).rejects.toThrow(/commits không hợp lệ/);
  });

  it("shares blobs across projects without letting one project read another's snapshot", async () => {
    const blobs = await n("docs_blobs");
    await receive({ ...v2(A), projectId: sameCompanyProject });
    expect(await n("docs_blobs")).toBe(blobs);
    const foreign = await idOf(A, sameCompanyProject);
    await expect(loadDocsTree(host.ctx, projectId, companyId, foreign)).rejects.toThrow(/Snapshot không thuộc dự án/);
    await expect(loadDocsPage(host.ctx, projectId, "docs/p1.md", companyId, foreign)).rejects.toThrow(/Snapshot không thuộc dự án/);
    await expect(loadDocsTree(host.ctx, otherCompanyProject, otherCompany, await idOf(A))).rejects.toThrow();
    await expect(loadDocsTree(host.ctx, projectId, companyId, "not-a-uuid")).rejects.toThrow(/ID không hợp lệ/);
    await expect(loadDocsTree(host.ctx, projectId, companyId, "70000000-0000-4000-8000-000000000001")).rejects.toThrow(/Snapshot không thuộc dự án/);
  });

  it("drops stale unfinished staging rows but keeps completed history", async () => {
    const staging = "70000000-0000-4000-8000-000000000002";
    await host.sql.unsafe(`INSERT INTO ${host.ns}.docs_snapshots (id, company_id, project_id, machine_id, repo, commit, audit_state, check_exit, received_at)
      VALUES ($1, $2, $3, $4, 'repo-a', $5, 'verified', 0, now() - interval '11 minutes')`, [staging, companyId, projectId, machineId, "9".repeat(40)]);
    await host.sql.unsafe(`INSERT INTO ${host.ns}.docs_snapshot_pages (snapshot_id, path, title, parent_path, sha256) VALUES ($1, 'docs/p0.md', 'P0', 'docs', $2)`, [staging, ten[0]!.sha256]);
    await host.sql.unsafe(`UPDATE ${host.ns}.docs_snapshots SET received_at = now() - interval '1 day', completed_at = now() - interval '1 day' WHERE commit = $1 AND project_id = $2`, [A, projectId]);
    const completed = await n("docs_snapshots", "completed_at IS NOT NULL");
    await receive(v2("5".repeat(40), editedB()));
    expect(await n("docs_snapshots", `id = '${staging}'`)).toBe(0);
    expect(await n("docs_snapshot_pages", `snapshot_id = '${staging}'`)).toBe(0);
    expect(await n("docs_snapshots", "completed_at IS NOT NULL")).toBe(completed + 1);
    expect(await n("docs_snapshots", `commit = '${A}' AND project_id = '${projectId}'`)).toBe(1);
  });

  it("keeps physical storage far below logical storage over 200 snapshots", async () => {
    await reset();
    const filler = "x".repeat(600);
    let pages = Array.from({ length: 300 }, (_, i) => page(`docs/s${i}.md`, `S${i}`, `# S${i}\n${filler}`));
    for (let s = 0; s < 200; s++) {
      pages = pages.map((p, i) => (i % 20 === s % 20 ? page(p.path, p.title, `# ${p.title} v${s}\n${filler}`) : p));
      const commit = createHash("sha1").update(String(s)).digest("hex");
      await storeDocsSnapshot(host.ctx, v2(commit, pages, { commits: undefined }) as unknown as DocsSnapshot);
    }
    const [row] = await host.sql.unsafe(`SELECT
      (SELECT sum(b.byte_size)::bigint FROM ${host.ns}.docs_snapshot_pages sp JOIN ${host.ns}.docs_blobs b ON b.sha256 = sp.sha256) AS logical,
      (SELECT sum(byte_size)::bigint FROM ${host.ns}.docs_blobs) AS physical,
      pg_total_relation_size('${host.ns}.docs_blobs') AS blobs_total,
      pg_total_relation_size('${host.ns}.docs_snapshot_pages') AS pages_total,
      (SELECT count(*)::int FROM ${host.ns}.docs_snapshots WHERE completed_at IS NOT NULL) AS snapshots`);
    const measured = { logical: Number(row!.logical), physical: Number(row!.physical), blobsTotal: Number(row!.blobs_total),
      pagesTotal: Number(row!.pages_total), snapshots: Number(row!.snapshots) };
    console.log(JSON.stringify(measured));
    expect(measured.snapshots).toBe(200);
    expect(measured.physical).toBeLessThan(measured.logical / 10);
  }, 300_000);
});

describe("migration backfill from the legacy docs_pages table", () => {
  it("rehashes legacy pages into blobs and marks the current snapshot completed", async () => {
    const root = await mkdtemp(join(tmpdir(), "crew-docs-backfill-"));
    let host: Host | undefined;
    try {
      await mkdir(join(root, "migrations"));
      for (const file of ["0001_docs.sql", "0002_machines.sql", "0003_machine_latest.sql", "0004_project_roles.sql", "0005_attachment_audit.sql"]) {
        await copyFile(join(migrationsDir, file), join(root, "migrations", file));
      }
      host = await startHost("crew-docs-backfill-", root);
      const { sql, ns } = host;
      const current = "70000000-0000-4000-8000-000000000010";
      const staging = "70000000-0000-4000-8000-000000000011";
      for (const id of [current, staging]) {
        await sql.unsafe(`INSERT INTO ${ns}.docs_snapshots (id, company_id, project_id, machine_id, repo, commit, audit_state, check_exit, received_at)
          VALUES ($1, $2, $3, $4, 'repo-a', $5, 'verified', 0, now() - interval '2 days')`, [id, companyId, projectId, machineId, A]);
      }
      await sql.unsafe(`INSERT INTO ${ns}.docs_current (company_id, project_id, snapshot_id) VALUES ($1, $2, $3)`, [companyId, projectId, current]);
      await sql.unsafe(`INSERT INTO ${ns}.docs_pages (snapshot_id, path, title, parent_path, text, sha256) VALUES
        ($1, 'docs/index.md', 'Index', 'docs', 'Chào', $2), ($1, 'docs/a.md', 'A', 'docs', 'Trang A', $3), ($4, 'docs/index.md', 'Index', 'docs', 'Chào', $2)`,
        [current, sha("Chào"), "b".repeat(64), staging]);
      await copyFile(join(migrationsDir, "0008_docs_storage.sql"), join(root, "migrations", "0008_docs_storage.sql"));
      await host.applyMigrations(root);
      const blobs = await sql.unsafe(`SELECT sha256, byte_size, text FROM ${ns}.docs_blobs ORDER BY text`);
      expect(blobs.map((b) => [b.sha256, b.byte_size, b.text])).toEqual([
        [sha("Chào"), Buffer.byteLength("Chào", "utf8"), "Chào"], [sha("Trang A"), 7, "Trang A"]]);
      const pages = await sql.unsafe(`SELECT path, sha256 FROM ${ns}.docs_snapshot_pages WHERE snapshot_id = $1 ORDER BY path`, [current]);
      expect(pages.map((p) => [p.path, p.sha256])).toEqual([["docs/a.md", sha("Trang A")], ["docs/index.md", sha("Chào")]]);
      const snapshots = await sql.unsafe(`SELECT id, completed_at IS NOT NULL AS done, content_key, format, manifest_state FROM ${ns}.docs_snapshots ORDER BY id`);
      expect(snapshots.map((s) => [s.id, s.done, s.content_key, s.format, s.manifest_state])).toEqual([
        [current, true, `legacy:${current}`, 1, "not_sent"], [staging, false, null, 1, "not_sent"]]);
      const tree = await loadDocsTree(host.ctx, projectId, companyId);
      expect(tree?.pages.map((p) => [p.path, p.sha256])).toEqual([["docs/a.md", sha("Trang A")], ["docs/index.md", sha("Chào")]]);
      expect((await loadDocsPage(host.ctx, projectId, "docs/a.md", companyId))?.text).toBe("Trang A");
      expect(await sql.unsafe(`SELECT count(*)::int AS n FROM ${ns}.docs_pages`)).toEqual([{ n: 3 }]);
    } finally {
      await host?.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
