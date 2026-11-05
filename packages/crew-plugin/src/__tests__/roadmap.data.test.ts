import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { loadCrewRoadmap, ROADMAP_NODE_LIMIT } from "../handlers/roadmap.js";

const company = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const big = "10000000-0000-4000-8000-000000000003";
const agent = "20000000-0000-4000-8000-000000000001";
const owner = "50000000-0000-4000-8000-000000000001";
const granted = "60000000-0000-4000-8000-000000000001";
const hidden = "60000000-0000-4000-8000-000000000002";
const otherProject = "60000000-0000-4000-8000-000000000003";
const bigProject = "60000000-0000-4000-8000-000000000004";
const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const policy = JSON.stringify({ maxReviewRounds: 5, stages: [
  { id: "s1", type: "review", participants: [{ type: "agent", agentId: agent }] },
  { id: "s2", type: "approval", participants: [{ type: "user", userId: owner }] },
] });
const state = (rounds = 0) => JSON.stringify({ currentStageId: "s1", currentStageType: "review", completedStageIds: [], changesRequestedCount: rounds });

let sql: ReturnType<typeof postgres>;
let cleanup: (() => Promise<void>) | undefined;
let queries = 0;
const ctx = {
  db: {
    query: async <T>(query: string, params: unknown[] = []) => {
      queries += 1;
      return await sql.unsafe<T[]>(query, params as never[]);
    },
  },
} as unknown as PluginContext;

type IssueSeed = {
  id: string; companyId?: string; parentId?: string | null; identifier: string; projectId?: string | null;
  status?: string; description?: string; human?: boolean; crew?: boolean; rounds?: number;
};
async function issue(seed: IssueSeed) {
  const companyId = seed.companyId ?? company;
  await sql`INSERT INTO issues (id,company_id,parent_id,project_id,identifier,title,description,status,assignee_agent_id,
      created_by_user_id,created_by_agent_id,execution_policy,execution_state)
    VALUES (${seed.id},${companyId},${seed.parentId ?? null},${seed.projectId === undefined ? granted : seed.projectId},
      ${seed.identifier},${seed.identifier + " title"},${seed.description ?? ""},${seed.status ?? "todo"},
      ${companyId === company ? agent : null},${seed.human === false ? null : owner},${seed.human === false ? agent : null},
      ${seed.crew === false ? null : policy}::jsonb,${state(seed.rounds)}::jsonb)`;
}

beforeAll(async () => {
  const database = await startEmbeddedPostgresTestDatabase("crew-roadmap-");
  sql = postgres(database.connectionString, { max: 2, onnotice: () => {} });
  cleanup = async () => { await sql.end(); await database.cleanup(); };
  await sql`INSERT INTO companies (id,name,issue_prefix) VALUES
    (${company},'Crew roadmap','CRE'),(${other},'Other','OTH'),(${big},'Big','BIG')`;
  await sql`INSERT INTO agents (id,company_id,name) VALUES (${agent},${company},'Executor')`;
  await sql`INSERT INTO projects (id,company_id,name) VALUES
    (${granted},${company},'Granted'),(${hidden},${company},'Hidden'),(${otherProject},${other},'Other'),
    (${bigProject},${big},'Big')`;

  // R1 (project được cấp): cây hai tầng, cạnh chặn, việc sửa và vòng sửa.
  await issue({ id: id(1), identifier: "CRE-1", status: "in_progress" });
  await issue({ id: id(2), parentId: id(1), identifier: "CRE-2", status: "done", description: "crew-bundle id=core seq=1" });
  await issue({ id: id(3), parentId: id(1), identifier: "CRE-3", description: "crew-bundle id=core seq=2", rounds: 2 });
  await issue({ id: id(4), parentId: id(3), identifier: "CRE-4", description: "crew-kind research" });
  await issue({ id: id(5), parentId: id(1), identifier: "CRE-5", description: `crew-fix base=${"a".repeat(40)}` });
  // Việc con nằm ở project không được cấp và cháu của nó: người bị giới hạn không thấy cả nhánh.
  await issue({ id: id(6), parentId: id(1), identifier: "CRE-6", projectId: hidden });
  await issue({ id: id(7), parentId: id(6), identifier: "CRE-7" });
  await sql`INSERT INTO issue_relations (company_id,issue_id,related_issue_id,type) VALUES (${company},${id(2)},${id(3)},'blocks')`;
  await sql`INSERT INTO issue_comments (company_id,issue_id,body) VALUES
    (${company},${id(2)},${`crew-commit sha=${"a".repeat(40)} branch=crew/CRE-2 tests=ok result=pass`}),
    (${company},${id(3)},${"Ghi chú không có marker"})`;
  // R2 ở project không được cấp, R3 không thuộc project, gốc do agent tạo, gốc của company khác.
  await issue({ id: id(10), identifier: "CRE-10", projectId: hidden });
  await issue({ id: id(11), parentId: id(10), identifier: "CRE-11", projectId: hidden });
  await issue({ id: id(20), identifier: "CRE-20", projectId: null });
  await issue({ id: id(30), identifier: "CRE-30", human: false });
  await issue({ id: id(31), parentId: id(30), identifier: "CRE-31" });
  await issue({ id: id(40), companyId: other, identifier: "OTH-1", projectId: otherProject });
  // Gốc do người tạo nhưng không có policy Crew vẫn là yêu cầu trên Roadmap.
  await issue({ id: id(50), identifier: "CRE-50", crew: false });
}, 60_000);

afterAll(async () => { await cleanup?.(); });

const ids = (roadmap: Awaited<ReturnType<typeof loadCrewRoadmap>>) => roadmap.nodes.map((node) => node.identifier).sort();

describe("crew.roadmap", () => {
  it("owner: cây đủ của mọi yêu cầu do người tạo, kể cả yêu cầu không thuộc project", async () => {
    const roadmap = await loadCrewRoadmap(ctx, company, { all: true });
    expect(ids(roadmap)).toEqual(["CRE-1", "CRE-10", "CRE-11", "CRE-2", "CRE-20", "CRE-3", "CRE-4", "CRE-5", "CRE-50", "CRE-6", "CRE-7"]);
    expect(roadmap.requests).toEqual(expect.arrayContaining([id(1), id(10), id(20), id(50)]));
    expect(roadmap.requests).toHaveLength(4);
    expect(roadmap.truncated).toBe(false);
  });

  it("dựng cạnh cha-con, chặn, sửa và vòng sửa như crew.map, kèm trường nút", async () => {
    const roadmap = await loadCrewRoadmap(ctx, company, { all: true });
    expect(roadmap.edges).toContainEqual({ kind: "parent", from: id(1), to: id(2) });
    expect(roadmap.edges).toContainEqual({ kind: "parent", from: id(3), to: id(4) });
    expect(roadmap.edges).toContainEqual({ kind: "dependency", from: id(2), to: id(3) });
    expect(roadmap.edges).toContainEqual({ kind: "repair", from: id(2), to: id(5) });
    expect(roadmap.edges).toContainEqual({ kind: "repair", from: id(3), to: id(3), label: "2 vòng sửa" });
    const node = (n: number) => roadmap.nodes.find((item) => item.id === id(n));
    expect(node(1)).toMatchObject({ rootId: id(1), parentId: null, projectId: granted, createdByUserId: owner, status: "in_progress" });
    expect(node(2)).toMatchObject({ rootId: id(1), parentId: id(1), bundle: { id: "core", seq: 1 }, assignee: { id: agent, name: "Executor" } });
    expect(node(4)).toMatchObject({ rootId: id(1), kind: "research" });
    expect(node(5)?.kind).toBe("fix");
    expect(node(3)).toMatchObject({ reviewRounds: 2, maxReviewRounds: 5, stage: { currentStageId: "s1", position: 0 } });
    expect(typeof node(1)?.createdAt).toBe("string");
    expect(roadmap.nodes.every((item) => !("description" in item))).toBe(true);
  });

  it("người được cấp một project: không thấy project khác, yêu cầu ngoài project và nhánh con ở project không được cấp", async () => {
    const roadmap = await loadCrewRoadmap(ctx, company, { all: false, projectIds: [granted] });
    expect(ids(roadmap)).toEqual(["CRE-1", "CRE-2", "CRE-3", "CRE-4", "CRE-5", "CRE-50"]);
    expect(roadmap.requests.sort()).toEqual([id(1), id(50)].sort());
    const seen = new Set(roadmap.nodes.map((node) => node.id));
    for (const edge of roadmap.edges) {
      expect(seen.has(edge.from) && seen.has(edge.to)).toBe(true);
    }
  });

  it("không được cấp gì, thiếu hoặc sai viewer: rỗng (đóng khi lỗi)", async () => {
    for (const viewer of [{ all: false, projectIds: [] }, undefined, null, { all: "yes" }, { all: false, projectIds: ["x'; drop"] }]) {
      const roadmap = await loadCrewRoadmap(ctx, company, viewer as never);
      expect(roadmap).toEqual({ requests: [], nodes: [], edges: [], diagnostics: [], truncated: false });
    }
    await expect(loadCrewRoadmap(ctx, "nope", { all: true })).rejects.toThrow();
  });

  it("project của company khác được cấp trong viewer không làm lộ issue company khác", async () => {
    const roadmap = await loadCrewRoadmap(ctx, company, { all: false, projectIds: [otherProject] });
    expect(roadmap.nodes).toEqual([]);
  });

  it("vượt trần: cắt theo cây, không việc nào mất gốc hay mất cha, nhiều nhất một cây cắt dở", async () => {
    // Mã đan xen khi so chuỗi (OTH-10..12 đứng trước OTH-2, OTH-9): cắt theo mã sẽ giữ con của OTH-9 mà mất gốc.
    await issue({ id: id(60), companyId: other, identifier: "OTH-2", projectId: otherProject });
    await issue({ id: id(61), companyId: other, parentId: id(60), identifier: "OTH-3", projectId: otherProject });
    await issue({ id: id(62), companyId: other, identifier: "OTH-9", projectId: otherProject });
    for (const [n, parent] of [[63, 62], [64, 62], [65, 63]] as const) {
      await issue({ id: id(n), companyId: other, parentId: id(parent), identifier: `OTH-${n - 53}`, projectId: otherProject });
    }
    const full = await loadCrewRoadmap(ctx, other, { all: true });
    expect(full.nodes).toHaveLength(7);
    const sizeOf = (roadmap: typeof full) => {
      const size = new Map<string, number>();
      for (const node of roadmap.nodes) size.set(node.rootId, (size.get(node.rootId) ?? 0) + 1);
      return size;
    };
    const fullSize = sizeOf(full);
    for (let limit = 1; limit < 7; limit += 1) {
      const cut = await loadCrewRoadmap(ctx, other, { all: true }, limit);
      expect(cut.truncated).toBe(true);
      expect(cut.nodes).toHaveLength(limit);
      const seen = new Set(cut.nodes.map((node) => node.id));
      for (const node of cut.nodes) {
        expect(cut.requests).toContain(node.rootId);
        if (node.parentId) expect(seen.has(node.parentId)).toBe(true);
      }
      const partial = [...sizeOf(cut)].filter(([root, size]) => size < (fullSize.get(root) ?? 0));
      expect(partial.length).toBeLessThanOrEqual(1);
    }
    expect((await loadCrewRoadmap(ctx, other, { all: true }, 7)).truncated).toBe(false);
  });

  it("số query cố định, không tăng theo số yêu cầu (dữ liệu cỡ thật: 165 yêu cầu, ~700 issue)", async () => {
    // Company "big" giả cỡ company thật (đo 2026-11-04: 698 issue, 165 gốc, cây lớn nhất 61, có cạnh chặn và việc sửa).
    const sizes = [61, 20, 18, 17, 16, 15, 15, 14, 13, 13];
    let n = 1000;
    const seedTree = async (rootCount: number, from: number) => {
      const rows: unknown[][] = [];
      const relations: unknown[][] = [];
      const comments: unknown[][] = [];
      for (let r = from; r < from + rootCount; r += 1) {
        const rootId = id(++n);
        rows.push([rootId, null, `BIG-${n}`, ""]);
        const size = sizes[r] ?? (r < 101 ? 4 : 1);
        let previous: string | null = null;
        for (let c = 1; c < size; c += 1) {
          const child = id(++n);
          const fix = c % 7 === 0 && previous;
          rows.push([child, c % 5 === 0 && previous ? previous : rootId, `BIG-${n}`, fix ? `crew-fix base=${"b".repeat(40)}` : `crew-bundle id=b${r} seq=${c}`]);
          if (previous && c % 3 === 0) relations.push([previous, child]);
          if (c % 6 === 0) comments.push([child, `crew-commit sha=${"b".repeat(40)} branch=crew/BIG-${n} tests=ok result=pass`]);
          previous = child;
        }
      }
      for (const [rowId, parentId, identifier, description] of rows) {
        await sql`INSERT INTO issues (id,company_id,parent_id,project_id,identifier,title,description,status,created_by_user_id,execution_policy,execution_state)
          VALUES (${rowId as string},${big},${parentId as string | null},${bigProject},${identifier as string},${`${identifier} tiêu đề`},${description as string},'done',${owner},${policy}::jsonb,${state()}::jsonb)`;
      }
      for (const [from_, to] of relations) {
        await sql`INSERT INTO issue_relations (company_id,issue_id,related_issue_id,type) VALUES (${big},${from_ as string},${to as string},'blocks')`;
      }
      for (const [issueId, body] of comments) {
        await sql`INSERT INTO issue_comments (company_id,issue_id,body) VALUES (${big},${issueId as string},${body as string})`;
      }
    };
    await seedTree(10, 0);
    queries = 0;
    const small = await loadCrewRoadmap(ctx, big, { all: false, projectIds: [bigProject] });
    const smallQueries = queries;
    await seedTree(155, 10);
    queries = 0;
    const started = performance.now();
    const full = await loadCrewRoadmap(ctx, big, { all: false, projectIds: [bigProject] });
    const elapsed = performance.now() - started;
    const fullQueries = queries;
    const json = JSON.stringify(full);
    const bytes = Buffer.byteLength(json);
    const gzipBytes = gzipSync(json).length;
    console.info(`crew.roadmap: ${full.requests.length} yêu cầu, ${full.nodes.length} issue, ${full.edges.length} cạnh, `
      + `${fullQueries} query, ${elapsed.toFixed(0)} ms, ${(bytes / 1024).toFixed(0)} KB JSON, ${(gzipBytes / 1024).toFixed(0)} KB gzip`);
    expect(small.requests).toHaveLength(10);
    expect(full.requests).toHaveLength(165);
    expect(full.nodes.length).toBeGreaterThan(600);
    expect(full.edges.some((edge) => edge.kind === "repair" && edge.from !== edge.to)).toBe(true);
    expect(fullQueries).toBe(smallQueries);
    expect(fullQueries).toBeLessThanOrEqual(3);
    expect(bytes).toBeLessThan(600 * 1024);
    expect(gzipBytes).toBeLessThan(100 * 1024);
    expect(ROADMAP_NODE_LIMIT).toBeGreaterThan(full.nodes.length);
  }, 120_000);
});
