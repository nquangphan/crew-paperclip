import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CREW_POLICY_CONFIG_ENV } from "../crew/issue-policy.ts";
import { crewRolesTable, loadCompanyRoleAgentIds, loadCrewRoles } from "../crew/project-roles.ts";
import { logger } from "../middleware/logger.js";

const COMPANY = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const FILE_REVIEWER = "30000000-0000-4000-8000-000000000001";
const FILE_INTEGRATOR = "30000000-0000-4000-8000-000000000002";
const ROW_REVIEWER = "40000000-0000-4000-8000-0000000000aa";
const ROW_INTEGRATOR = "40000000-0000-4000-8000-0000000000bb";

const dialect = new PgDialect();

type Answer = Record<string, unknown>[] | Error;

/** `db` giả: ghi lại câu SQL, trả lời theo thứ tự; `transaction` chạy callback trên chính nó (savepoint). */
function fakeDb(answers: Answer[] = []) {
  const statements: string[] = [];
  const queue = [...answers];
  const db = {
    statements,
    async execute(query: SQL) {
      statements.push(dialect.sqlToQuery(query).sql);
      const next = queue.shift() ?? [];
      if (next instanceof Error) throw next;
      return next;
    },
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };
  return db;
}

const configDir = mkdtempSync(path.join(tmpdir(), "crew-project-roles-"));
const configFile = path.join(configDir, "crew-policy.json");
const previousEnv = process.env[CREW_POLICY_CONFIG_ENV];

function writeConfig(entry: unknown) {
  writeFileSync(configFile, JSON.stringify({ companies: entry === undefined ? {} : { [COMPANY]: entry } }));
}
const okEntry = {
  reviewerAgentId: FILE_REVIEWER,
  integratorAgentId: FILE_INTEGRATOR,
  ownerUserId: "owner-1",
  trackingProjectIds: ["50000000-0000-4000-8000-000000000001"],
};

beforeAll(() => {
  process.env[CREW_POLICY_CONFIG_ENV] = configFile;
});
afterAll(() => {
  if (previousEnv === undefined) delete process.env[CREW_POLICY_CONFIG_ENV];
  else process.env[CREW_POLICY_CONFIG_ENV] = previousEnv;
  rmSync(configDir, { recursive: true, force: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("crewRolesTable", () => {
  it("trùng namespace plugin crew.core mà migration plugin dùng", () => {
    expect(crewRolesTable()).toBe("plugin_crew_core_0433ea20b6.crew_project_roles");
    const migration = readFileSync(
      fileURLToPath(new URL("../../../packages/crew-plugin/migrations/0004_project_roles.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain(`CREATE TABLE ${crewRolesTable()} (`);
    const machines = readFileSync(
      fileURLToPath(new URL("../../../packages/crew-plugin/migrations/0002_machines.sql", import.meta.url)),
      "utf8",
    );
    expect(machines).toContain("plugin_crew_core_0433ea20b6.");
  });
});

describe("loadCrewRoles", () => {
  it("company không có trong file: absent, không chạy SQL", async () => {
    writeConfig(undefined);
    const db = fakeDb();
    await expect(loadCrewRoles({ db: db as never, companyId: COMPANY, projectId: PROJECT })).resolves.toEqual({ kind: "absent" });
    expect(db.statements).toEqual([]);
  });

  it("cấu hình file lỗi: invalid (fail closed), không chạy SQL", async () => {
    writeConfig({ reviewerAgentId: FILE_REVIEWER });
    const db = fakeDb();
    await expect(loadCrewRoles({ db: db as never, companyId: COMPANY, projectId: PROJECT })).resolves.toMatchObject({ kind: "invalid" });
    expect(db.statements).toEqual([]);
  });

  it("projectId null hoặc undefined: config file nguyên vẹn, không SQL", async () => {
    writeConfig(okEntry);
    const db = fakeDb();
    for (const projectId of [null, undefined]) {
      await expect(loadCrewRoles({ db: db as never, companyId: COMPANY, projectId })).resolves.toEqual({
        kind: "ok",
        roles: { reviewerAgentId: FILE_REVIEWER, integratorAgentId: FILE_INTEGRATOR },
        ownerUserId: "owner-1",
        trackingProjectIds: okEntry.trackingProjectIds,
      });
    }
    expect(db.statements).toEqual([]);
  });

  it("bảng chưa migrate: chỉ một câu to_regclass, không đọc bảng, trả config file", async () => {
    writeConfig(okEntry);
    const db = fakeDb([[{ ok: false }]]);
    const config = await loadCrewRoles({ db: db as never, companyId: COMPANY, projectId: PROJECT });
    expect(config).toMatchObject({ kind: "ok", roles: { reviewerAgentId: FILE_REVIEWER, integratorAgentId: FILE_INTEGRATOR } });
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]).toContain("to_regclass");
    expect(db.statements.join("\n")).not.toMatch(/FROM\s+plugin_crew_core_0433ea20b6\.crew_project_roles/i);
  });

  it("project không có dòng: config file", async () => {
    writeConfig(okEntry);
    const db = fakeDb([[{ ok: true }], []]);
    await expect(loadCrewRoles({ db: db as never, companyId: COMPANY, projectId: PROJECT })).resolves.toMatchObject({
      kind: "ok",
      roles: { reviewerAgentId: FILE_REVIEWER, integratorAgentId: FILE_INTEGRATOR },
    });
    expect(db.statements).toHaveLength(2);
  });

  it("có dòng, hai agent còn thuộc company: vai trò của dòng (chữ thường), owner và tracking giữ từ file", async () => {
    writeConfig(okEntry);
    const db = fakeDb([
      [{ ok: true }],
      [{
        reviewer_agent_id: ROW_REVIEWER.toUpperCase(),
        integrator_agent_id: ROW_INTEGRATOR,
        reviewer_status: "idle",
        integrator_status: "paused",
      }],
    ]);
    await expect(loadCrewRoles({ db: db as never, companyId: COMPANY, projectId: PROJECT })).resolves.toEqual({
      kind: "ok",
      roles: { reviewerAgentId: ROW_REVIEWER, integratorAgentId: ROW_INTEGRATOR, codexReviewerAgentId: null },
      ownerUserId: "owner-1",
      trackingProjectIds: okEntry.trackingProjectIds,
    });
    expect(db.statements[1]).toMatch(/FROM plugin_crew_core_0433ea20b6\.crew_project_roles/);
    expect(db.statements[1]).toMatch(/"agents"/);
    // Cột ô runtime đọc qua to_jsonb: bảng chưa có cột (chưa áp 0012) vẫn chạy.
    expect(db.statements[1]).toMatch(/to_jsonb\(r\) ->> 'codex_reviewer_agent_id'/);
  });

  it("có reviewer Codex còn trong company: điền codexReviewerAgentId (chữ thường)", async () => {
    writeConfig(okEntry);
    const CODEX = "77777777-7777-4777-8777-77777777777a";
    const db = fakeDb([
      [{ ok: true }],
      [{
        reviewer_agent_id: ROW_REVIEWER,
        integrator_agent_id: ROW_INTEGRATOR,
        reviewer_status: "idle",
        integrator_status: "idle",
        codex_reviewer_agent_id: CODEX.toUpperCase(),
      }],
    ]);
    await expect(loadCrewRoles({ db: db as never, companyId: COMPANY, projectId: PROJECT })).resolves.toMatchObject({
      kind: "ok",
      roles: { reviewerAgentId: ROW_REVIEWER, integratorAgentId: ROW_INTEGRATOR, codexReviewerAgentId: CODEX },
    });
  });

  it("dòng trỏ agent đã xóa, đã chuyển company hoặc terminated: invalid (fail closed), không rơi về vai trò file", async () => {
    writeConfig(okEntry);
    const error = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const cases = [
      { reviewer_status: null, integrator_status: "idle", gone: "reviewer" },
      { reviewer_status: "idle", integrator_status: null, gone: "integrator" },
      { reviewer_status: "terminated", integrator_status: "idle", gone: "reviewer" },
    ];
    for (const c of cases) {
      const db = fakeDb([
        [{ ok: true }],
        [{ reviewer_agent_id: ROW_REVIEWER, integrator_agent_id: ROW_INTEGRATOR, ...c }],
      ]);
      const config = await loadCrewRoles({ db: db as never, companyId: COMPANY, projectId: PROJECT });
      expect(config.kind).toBe("invalid");
      expect(config.kind === "invalid" && config.reason).toContain(c.gone === "reviewer" ? ROW_REVIEWER : ROW_INTEGRATOR);
    }
    expect(error).toHaveBeenCalled();
  });

  it("lỗi đọc khác: config file, cảnh báo tối đa một lần mỗi phút cho mỗi company", async () => {
    writeConfig(okEntry);
    vi.useFakeTimers({ now: new Date("2026-10-09T06:00:00Z"), toFake: ["Date"] });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const read = () =>
      loadCrewRoles({ db: fakeDb([[{ ok: true }], new Error("boom")]) as never, companyId: COMPANY, projectId: PROJECT });
    await expect(read()).resolves.toMatchObject({ kind: "ok", roles: { reviewerAgentId: FILE_REVIEWER } });
    await read();
    expect(warn).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-09T06:01:01Z"));
    await read();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("H4 (onReadError throw): lỗi đọc khi có projectId thì ném 503 crew_roles_unavailable, không rơi về vai trò file", async () => {
    writeConfig(okEntry);
    vi.spyOn(logger, "warn").mockImplementation(() => logger);
    for (const answers of [[[{ ok: true }], new Error("lock timeout")], [new Error("permission denied for schema")]] as Answer[][]) {
      await expect(
        loadCrewRoles({ db: fakeDb(answers) as never, companyId: COMPANY, projectId: PROJECT, onReadError: "throw" }),
      ).rejects.toMatchObject({ status: 503, details: { code: "crew_roles_unavailable" } });
    }
    // Bảng chưa có, project không có dòng hay issue không project: vẫn vai trò file như I7.
    for (const [answers, projectId] of [[[[{ ok: false }]], PROJECT], [[[{ ok: true }], []], PROJECT], [[], null]] as [Answer[], string | null][]) {
      await expect(
        loadCrewRoles({ db: fakeDb(answers) as never, companyId: COMPANY, projectId, onReadError: "throw" }),
      ).resolves.toMatchObject({ kind: "ok", roles: { reviewerAgentId: FILE_REVIEWER, integratorAgentId: FILE_INTEGRATOR } });
    }
  });

  it("chỉ đọc dòng của project còn tồn tại trong company", async () => {
    writeConfig(okEntry);
    const db = fakeDb([[{ ok: true }], []]);
    await loadCrewRoles({ db: db as never, companyId: COMPANY, projectId: PROJECT });
    expect(db.statements[1]).toMatch(/JOIN "projects" p ON p\.id = r\.project_id AND p\.company_id = r\.company_id/);
  });

  it("đọc trong savepoint (transaction lồng) để lỗi không abort transaction bên ngoài", async () => {
    writeConfig(okEntry);
    const db = fakeDb([[{ ok: true }], []]);
    const transaction = vi.spyOn(db, "transaction");
    await loadCrewRoles({ db: db as never, companyId: COMPANY, projectId: PROJECT });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe("loadCompanyRoleAgentIds", () => {
  it("vai trò file ∪ mọi dòng của company (chữ thường)", async () => {
    writeConfig(okEntry);
    const db = fakeDb([
      [{ ok: true }],
      [
        { reviewer_agent_id: ROW_REVIEWER.toUpperCase(), integrator_agent_id: ROW_INTEGRATOR },
        { reviewer_agent_id: FILE_REVIEWER, integrator_agent_id: "40000000-0000-4000-8000-0000000000cc" },
      ],
    ]);
    const ids = await loadCompanyRoleAgentIds({ db: db as never, companyId: COMPANY });
    expect([...ids].sort()).toEqual(
      [FILE_REVIEWER, FILE_INTEGRATOR, ROW_REVIEWER, ROW_INTEGRATOR, "40000000-0000-4000-8000-0000000000cc"].sort(),
    );
  });

  it("bảng chưa có hoặc lỗi đọc: chỉ vai trò file; cấu hình file lỗi: chỉ các dòng", async () => {
    writeConfig(okEntry);
    vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const missing = await loadCompanyRoleAgentIds({ db: fakeDb([[{ ok: false }]]) as never, companyId: COMPANY });
    expect([...missing].sort()).toEqual([FILE_REVIEWER, FILE_INTEGRATOR].sort());
    const failed = await loadCompanyRoleAgentIds({ db: fakeDb([[{ ok: true }], new Error("boom")]) as never, companyId: COMPANY });
    expect([...failed].sort()).toEqual([FILE_REVIEWER, FILE_INTEGRATOR].sort());

    writeConfig({ reviewerAgentId: FILE_REVIEWER });
    const rowsOnly = await loadCompanyRoleAgentIds({
      db: fakeDb([[{ ok: true }], [{ reviewer_agent_id: ROW_REVIEWER, integrator_agent_id: ROW_INTEGRATOR }]]) as never,
      companyId: COMPANY,
    });
    expect([...rowsOnly].sort()).toEqual([ROW_REVIEWER, ROW_INTEGRATOR].sort());
  });

  it("bỏ dòng của project đã xóa (JOIN projects)", async () => {
    writeConfig(okEntry);
    const db = fakeDb([[{ ok: true }], []]);
    await loadCompanyRoleAgentIds({ db: db as never, companyId: COMPANY });
    expect(db.statements[1]).toMatch(/JOIN "projects" p ON p\.id = r\.project_id AND p\.company_id = r\.company_id/);
  });

  it("company không có trong file: tập rỗng, không SQL", async () => {
    writeConfig(undefined);
    const db = fakeDb();
    expect((await loadCompanyRoleAgentIds({ db: db as never, companyId: COMPANY })).size).toBe(0);
    expect(db.statements).toEqual([]);
  });
});
