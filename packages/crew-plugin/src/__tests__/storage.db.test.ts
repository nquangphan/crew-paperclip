import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { createDb, plugins } from "../../../db/src/index.js";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { pluginDatabaseService } from "../../../../server/src/services/plugin-database.js";
import manifest from "../manifest.js";
import { loadStorageReport } from "../storage/data.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const otherCompany = "10000000-0000-4000-8000-000000000002";
const P1 = "20000000-0000-4000-8000-000000000001";
const P2 = "20000000-0000-4000-8000-000000000002";
const P3 = "20000000-0000-4000-8000-000000000003";
const emptyProject = "20000000-0000-4000-8000-000000000004";
const archivedProject = "20000000-0000-4000-8000-000000000005";
const machine1 = "50000000-0000-4000-8000-000000000001";
const machine2 = "50000000-0000-4000-8000-000000000002";
const hostPluginId = "60000000-0000-4000-8000-000000000001";
const agentId = "40000000-0000-4000-8000-000000000001";
const issue = (n: number) => `70000000-0000-4000-8000-00000000000${n}`;
const snap = (n: number) => `80000000-0000-4000-8000-00000000000${n}`;
const run = (n: number) => `90000000-0000-4000-8000-00000000000${n}`;
const att = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const t1 = "# Trang một\nnội dung";
const t2 = "# Trang hai\nthêm chữ có dấu";
const t2b = "# Trang hai đã đổi\nthêm chữ có dấu và dài hơn";
const t3 = "# Của công ty khác";
const manifestText = "version: 1\nsource: {include: [\"src/**\"]}\n";
const legacyText = "Trang cũ tiếng Việt có dấu";
const cache = { bytes: 5000, blobBytes: 4000, blobs: 3, runs: 2, limitBytes: 2147483648, measuredAt: "2026-10-10T01:00:00.000Z" };

type Page = { path: string; text: string };
const snapshots: Array<{ id: string; company: string; project: string; commit: string; pages: Page[]; manifest: string | null }> = [
  { id: snap(1), company: companyId, project: P1, commit: "a".repeat(40), pages: [{ path: "docs/a.md", text: t1 }, { path: "docs/b.md", text: t2 }], manifest: manifestText },
  { id: snap(2), company: companyId, project: P1, commit: "b".repeat(40), pages: [{ path: "docs/a.md", text: t1 }, { path: "docs/b.md", text: t2b }], manifest: manifestText },
  { id: snap(3), company: companyId, project: P2, commit: "c".repeat(40), pages: [{ path: "docs/a.md", text: t1 }, { path: "docs/b.md", text: t2 }], manifest: manifestText },
  { id: snap(4), company: otherCompany, project: P3, commit: "d".repeat(40), pages: [{ path: "docs/a.md", text: t1 }, { path: "docs/z.md", text: t3 }], manifest: null },
];
const links = [
  { snapshot: snap(1), from: "docs/a.md", to: "docs/b.md", href: "b.md" },
  { snapshot: snap(1), from: "docs/b.md", to: null, href: "ngoài.md" },
  { snapshot: snap(2), from: "docs/a.md", to: "docs/b.md", href: "b.md" },
  { snapshot: snap(4), from: "docs/a.md", to: "docs/z.md", href: "z.md" },
];
const commitFiles = [{ sha: "a".repeat(40), path: "src/x.ts" }, { sha: "a".repeat(40), path: "README.md" }, { sha: "b".repeat(40), path: "src/y.ts" }];
const comments = ["Bình luận một", "Bình luận hai dài hơn"];
const auditRows = [{ id: att(1), issue: issue(1), size: 100 as number | null }, { id: att(2), issue: issue(2), size: null }];

interface Host { sql: postgres.Sql; ctx: PluginContext; ns: string; cleanup: () => Promise<void> }

/** Embedded Postgres with the real host plugin-database service, so SQL binding and validators match production. */
async function startHost(): Promise<Host> {
  const database = await startEmbeddedPostgresTestDatabase("crew-storage-");
  const sql = postgres(database.connectionString, { max: 4, onnotice: () => {} });
  const hostDb = createDb(database.connectionString);
  await hostDb.insert(plugins).values({
    id: hostPluginId, pluginKey: manifest.id, packageName: "@crew/paperclip-plugin", version: manifest.version,
    apiVersion: manifest.apiVersion, categories: manifest.categories, manifestJson: manifest, status: "installed",
  });
  const pluginDb = pluginDatabaseService(hostDb);
  await pluginDb.applyMigrations(hostPluginId, manifest, packageRoot);
  const ns = await pluginDb.getRuntimeNamespace(hostPluginId);
  const ctx = {
    db: {
      namespace: ns,
      query: <T>(statement: string, params?: unknown[]) => pluginDb.query<T>(hostPluginId, statement, params),
      execute: (statement: string, params?: unknown[]) => pluginDb.execute(hostPluginId, statement, params),
    },
    logger: { info: () => {}, debug: () => {}, error: () => {}, warn: () => {} },
  } as unknown as PluginContext;
  return { sql, ctx, ns, cleanup: async () => { await sql.end(); await database.cleanup(); } };
}

async function seed(host: Host): Promise<void> {
  const { sql, ns } = host;
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${companyId},'Crew','CRE'),(${otherCompany},'Other','OTH')`;
  await sql`INSERT INTO projects (id,company_id,name,archived_at) VALUES (${P1},${companyId},'Repo A',NULL),(${P2},${companyId},'Repo B',NULL),(${P3},${otherCompany},'Repo C',NULL),(${emptyProject},${companyId},'Trống',NULL),(${archivedProject},${companyId},'Đã lưu',now())`;
  await sql`INSERT INTO agents (id,company_id,name) VALUES (${agentId},${companyId},'Executor')`;
  await sql`INSERT INTO issues (id,company_id,project_id,identifier,title,status) VALUES
    (${issue(1)},${companyId},${P1},'TPS-1','Một','done'),(${issue(2)},${companyId},${P1},'TPS-2','Hai','done'),(${issue(3)},${companyId},${P1},'TPS-3','Ba','todo'),
    (${issue(4)},${companyId},${P2},'TPS-4','Khác dự án','todo')`;
  for (const [i, body] of comments.entries()) {
    await sql`INSERT INTO issue_comments (company_id,issue_id,author_agent_id,body) VALUES (${companyId},${issue(1 + i)},${agentId},${body})`;
  }
  await sql`INSERT INTO issue_comments (company_id,issue_id,author_agent_id,body) VALUES (${companyId},${issue(4)},${agentId},'thuộc P2')`;
  await sql`INSERT INTO heartbeat_runs (id,company_id,agent_id,status,context_snapshot) VALUES
    (${run(1)},${companyId},${agentId},'succeeded',${sql.json({ issueId: issue(1) })}),
    (${run(2)},${companyId},${agentId},'succeeded',${sql.json({ projectId: P1 })}),
    (${run(3)},${companyId},${agentId},'succeeded',${sql.json({ issueId: issue(4) })})`;
  await sql`INSERT INTO cost_events (company_id,agent_id,issue_id,project_id,heartbeat_run_id,provider,model,cost_cents,occurred_at)
    VALUES (${companyId},${agentId},${issue(1)},${P1},${run(1)},'anthropic','opus',5,now())`;

  const blobs = new Map<string, string>();
  for (const s of snapshots) {
    for (const p of s.pages) blobs.set(sha(p.text), p.text);
    if (s.manifest !== null) blobs.set(sha(s.manifest), s.manifest);
  }
  for (const [hash, text] of blobs) await sql.unsafe(`INSERT INTO ${ns}.docs_blobs (sha256, byte_size, text) VALUES ($1, $2, $3)`, [hash, bytes(text), text]);
  for (const s of snapshots) {
    await sql.unsafe(`INSERT INTO ${ns}.docs_snapshots (id,company_id,project_id,machine_id,repo,commit,audit_state,check_exit,completed_at,content_key,manifest_sha256)
      VALUES ($1,$2,$3,'m','repo',$4,'verified',0,now(),$5,$6)`, [s.id, s.company, s.project, s.commit, `k:${s.id}`, s.manifest === null ? null : sha(s.manifest)]);
    for (const p of s.pages) {
      await sql.unsafe(`INSERT INTO ${ns}.docs_snapshot_pages (snapshot_id,path,title,sha256) VALUES ($1,$2,'t',$3)`, [s.id, p.path, sha(p.text)]);
    }
  }
  // One snapshot that never completed holds a blob nobody can read: it must not count.
  await sql.unsafe(`INSERT INTO ${ns}.docs_blobs (sha256,byte_size,text) VALUES ($1,$2,$3)`, [sha("dở dang"), bytes("dở dang"), "dở dang"]);
  await sql.unsafe(`INSERT INTO ${ns}.docs_snapshots (id,company_id,project_id,machine_id,repo,commit,audit_state,check_exit,content_key) VALUES ($1,$2,$3,'m','repo',$4,'verified',0,'k:dang')`,
    [snap(5), companyId, P1, "e".repeat(40)]);
  await sql.unsafe(`INSERT INTO ${ns}.docs_snapshot_pages (snapshot_id,path,title,sha256) VALUES ($1,'docs/dang.md','t',$2)`, [snap(5), sha("dở dang")]);

  await sql.unsafe(`INSERT INTO ${ns}.docs_pages (snapshot_id,path,title,text,sha256) VALUES ($1,'docs/cu.md','t',$2,'x')`, [snap(1), legacyText]);
  for (const l of links) {
    await sql.unsafe(`INSERT INTO ${ns}.docs_links (snapshot_id,from_path,occurrence,original_href,to_path,status) VALUES ($1,$2,1,$3,$4,'ok')`, [l.snapshot, l.from, l.href, l.to]);
  }
  for (const [i, c] of [{ sha: "a".repeat(40) }, { sha: "b".repeat(40) }].entries()) {
    await sql.unsafe(`INSERT INTO ${ns}.docs_commits (company_id,project_id,sha,is_merge,first_snapshot_id) VALUES ($1,$2,$3,false,$4)`, [companyId, P1, c.sha, snap(1 + i)]);
  }
  for (const f of commitFiles) await sql.unsafe(`INSERT INTO ${ns}.docs_commit_files (company_id,project_id,sha,path) VALUES ($1,$2,$3,$4)`, [companyId, P1, f.sha, f.path]);

  for (const a of auditRows) {
    await sql.unsafe(`INSERT INTO ${ns}.crew_attachment_audit (attachment_id,company_id,issue_id,verdict,byte_size,checked_at) VALUES ($1,$2,$3,'allowed',$4,$5)`,
      [a.id, companyId, a.issue, a.size, a.id === att(1) ? "2026-10-09T01:00:00Z" : "2026-10-10T01:00:00Z"]);
  }
  // Reports go in through the host the way the machine webhook writes them.
  const report = (extra: object) => JSON.stringify({ version: 1, ...extra });
  const insertMachine = (company: string, machine: string, hostname: string, body: string) => host.ctx.db.execute(
    `INSERT INTO ${ns}.machine_latest (company_id,machine_id,hostname,received_at,sent_at,report) VALUES ($1,$2,$3,'2026-10-10T01:00:00Z','2026-10-10T01:00:00Z',$4::jsonb)`,
    [company, machine, hostname, body]);
  await insertMachine(companyId, machine1, "mac-a", report({ attachmentCache: cache }));
  await insertMachine(companyId, machine2, "mac-b", report({}));
  await insertMachine(otherCompany, "50000000-0000-4000-8000-000000000009", "mac-khác", "{}");
}

const sum = (values: Iterable<number>) => [...values].reduce((a, b) => a + b, 0);
const contentOf = (project: string, only: string[] = snapshots.filter((s) => s.project === project).map((s) => s.id)) =>
  snapshots.filter((s) => only.includes(s.id)).flatMap((s) => [...s.pages.map((p) => p.text), ...(s.manifest === null ? [] : [s.manifest])]);
const distinctBytes = (texts: string[]) => sum([...new Set(texts)].map(bytes));

describe("storage report on the real host database", () => {
  let host: Host;
  beforeAll(async () => { host = await startHost(); await seed(host); }, 120_000);
  afterAll(async () => { await host?.cleanup(); });

  it("measures each project and the company without double counting shared blobs", async () => {
    const report = await loadStorageReport(host.ctx, companyId);
    expect(report.projects.map((p) => p.projectId).sort()).toEqual([P1, P2, emptyProject].sort());
    const p1 = report.projects.find((p) => p.projectId === P1)!;
    const p2 = report.projects.find((p) => p.projectId === P2)!;

    // docs: every reference counts for logical, each distinct blob once for physical; unfinished snapshots are ignored.
    expect(p1.docs).toMatchObject({ snapshots: 2, pages: 4 });
    expect(p1.docs.logical).toEqual({ kind: "logic", bytes: sum(contentOf(P1).map(bytes)) });
    expect(p1.docs.physical).toEqual({ kind: "vat_ly", bytes: distinctBytes(contentOf(P1)) });
    expect(p1.docs.legacy).toEqual({ kind: "logic", bytes: bytes(legacyText) });
    expect(p2.docs.legacy).toEqual({ kind: "logic", bytes: 0 });
    expect(report.company.docsPhysical).toEqual({ kind: "vat_ly", bytes: distinctBytes([...contentOf(P1), ...contentOf(P2)]) });
    expect(report.company.docsShared).toEqual({ kind: "vat_ly", bytes: distinctBytes(contentOf(P2)) });
    expect(report.company.docsLegacy).toEqual({ kind: "logic", bytes: bytes(legacyText) });

    // index
    const linkBytes = sum(links.filter((l) => l.snapshot !== snap(4)).map((l) => bytes(l.from) + bytes(l.to ?? "") + bytes(l.href)));
    expect(p1.index).toEqual({ links: 3, commits: 2, commitFiles: 3,
      logical: { kind: "logic", bytes: linkBytes + sum(commitFiles.map((f) => 40 + bytes(f.path))) } });

    // tickets
    expect(p1.tickets).toEqual({ issues: 3, comments: 2, runs: 2, costEvents: 1,
      commentBytes: { kind: "logic", bytes: sum(comments.map(bytes)) },
      physical: { kind: "chua_do", reason: "bảng Paperclip dùng chung, không tách được theo company" } });
    expect(p2.tickets).toMatchObject({ issues: 1, comments: 1, runs: 1, costEvents: 0 });

    // attachments
    expect(p1.attachments).toEqual({ count: 2, unsized: 1, since: "2026-10-09T01:00:00.000Z", logical: { kind: "logic", bytes: 100 },
      physical: { kind: "chua_do", reason: "kho file Paperclip không cho plugin đo" } });
    expect(p2.attachments).toMatchObject({ count: 0, unsized: 0, since: null });

    const empty = report.projects.find((p) => p.projectId === emptyProject)!;
    expect(empty.name).toBe("Trống");
    expect(empty.docs).toMatchObject({ snapshots: 0, pages: 0, logical: { kind: "logic", bytes: 0 }, physical: { kind: "vat_ly", bytes: 0 } });
  });

  it("lists machines of the company with their attachment cache or null", async () => {
    const report = await loadStorageReport(host.ctx, companyId);
    expect(report.machines.map((m) => [m.hostname, m.attachmentCache])).toEqual([["mac-a", cache], ["mac-b", null]]);
    expect(report.machines[0]).toMatchObject({ machineId: machine1, receivedAt: "2026-10-10T01:00:00.000Z" });
  });

  it("reports plugin table sizes, or says they were not measured", async () => {
    const report = await loadStorageReport(host.ctx, companyId);
    const blobs = report.pluginTables.find((t) => t.table === "docs_blobs");
    expect(blobs?.total.kind).toBe("vat_ly");
    expect(blobs?.total.kind === "vat_ly" && blobs.total.bytes).toBeGreaterThan(0);
    expect(report.pluginTables.map((t) => t.table)).toContain("crew_attachment_audit");
  });

  it("never mixes companies", async () => {
    const other = await loadStorageReport(host.ctx, otherCompany);
    expect(other.projects.map((p) => p.projectId)).toEqual([P3]);
    expect(other.projects[0]?.docs.logical).toEqual({ kind: "logic", bytes: sum(contentOf(P3).map(bytes)) });
    expect(other.company.docsShared).toEqual({ kind: "vat_ly", bytes: 0 });
    expect(other.machines.map((m) => m.hostname)).toEqual(["mac-khác"]);
    await expect(loadStorageReport(host.ctx, "không-phải-uuid")).rejects.toThrow("ID không hợp lệ");
  });
});
