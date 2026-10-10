import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const machineId = "50000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const issueId = "60000000-0000-4000-8000-000000000001";
const runId = "70000000-0000-4000-8000-000000000001";
const [assistant, executor, reviewer, integrator, codex] = [1, 2, 3, 4, 5].map((n) => `40000000-0000-4000-8000-00000000000${n}`);

describe("migration runtime trên database đã có các migration trước", () => {
  it("giữ dữ liệu cũ, thêm bảng công tắc/quyết định/hàng chờ, ba cột vai trò và kind runtimes-setup", async () => {
    const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
    const root = await mkdtemp(join(tmpdir(), "crew-runtimes-migration-"));
    let host: PluginHost | undefined;
    try {
      await mkdir(join(root, "migrations"));
      const files = (await readdir(join(packageRoot, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
      const runtimes = files.find((file) => file.startsWith("0012_"));
      expect(runtimes).toBe("0012_runtimes.sql");
      for (const file of files.filter((name) => name < "0012_")) await copyFile(join(packageRoot, "migrations", file), join(root, "migrations", file));
      host = await startPluginHost("crew-runtimes-migration-", root);
      const { sql, ns } = host;
      await sql.unsafe(`INSERT INTO ${ns}.crew_project_roles (company_id,project_id,assistant_agent_id,executor_agent_ids,reviewer_agent_id,integrator_agent_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4::uuid[],$5,$6,'u')`, [companyId, projectId, assistant, `{${executor}}`, reviewer, integrator]);
      await sql.unsafe(`INSERT INTO ${ns}.crew_machine_jobs (company_id,machine_id,kind,payload,created_by_user_id)
        VALUES ($1,$2,'skill-remove','{}'::jsonb,'u')`, [companyId, machineId]);

      await copyFile(join(packageRoot, "migrations", runtimes!), join(root, "migrations", runtimes!));
      await host.applyMigrations(root);

      // Dòng vai trò cũ giữ nguyên, ba cột mới NULL; CHECK 1–2 executor không đổi.
      expect(await sql.unsafe(`SELECT executor_agent_ids::text AS executors, codex_executor_agent_id, opencode_executor_agent_id, codex_reviewer_agent_id
        FROM ${ns}.crew_project_roles`)).toEqual([{ executors: `{${executor}}`, codex_executor_agent_id: null, opencode_executor_agent_id: null, codex_reviewer_agent_id: null }]);
      await sql.unsafe(`UPDATE ${ns}.crew_project_roles SET codex_executor_agent_id = $1, codex_reviewer_agent_id = $2`, [codex, codex]);
      await expect(sql.unsafe(`UPDATE ${ns}.crew_project_roles SET executor_agent_ids = $1::uuid[]`, [`{${executor},${assistant},${codex}}`])).rejects.toThrow();

      // Kind việc máy: tên constraint giữ nguyên, nhận runtimes-setup, vẫn chặn kind lạ.
      const kindCheck = await sql.unsafe(`SELECT c.conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 AND c.conrelid = $2::regclass AND c.contype = 'c'`,
      [ns, `${ns}.crew_machine_jobs`]);
      const kind = kindCheck.find((row) => row.conname === "crew_machine_jobs_kind_check");
      expect(kind?.def).toContain("runtimes-setup");
      expect(kind?.def).toContain("skill-remove");
      expect(await sql.unsafe(`SELECT kind FROM ${ns}.crew_machine_jobs`)).toEqual([{ kind: "skill-remove" }]);
      await sql.unsafe(`INSERT INTO ${ns}.crew_machine_jobs (company_id,machine_id,kind,payload,created_by_user_id)
        VALUES ($1,$2,'runtimes-setup','{"kind":"runtimes-setup"}'::jsonb,'u')`, [companyId, machineId]);
      await expect(sql.unsafe(`INSERT INTO ${ns}.crew_machine_jobs (company_id,machine_id,kind,payload,created_by_user_id)
        VALUES ($1,$2,'reboot','{}'::jsonb,'u')`, [companyId, machineId])).rejects.toThrow(/kind_check/);

      // Công tắc: khóa (company, máy, runtime), runtime lạ bị chặn.
      await sql.unsafe(`INSERT INTO ${ns}.crew_runtime_switches (company_id,machine_id,runtime,enabled,updated_by_user_id)
        VALUES ($1,$2,'codex_local',true,'u')`, [companyId, machineId]);
      await expect(sql.unsafe(`INSERT INTO ${ns}.crew_runtime_switches (company_id,machine_id,runtime,enabled,updated_by_user_id)
        VALUES ($1,$2,'codex_local',false,'u')`, [companyId, machineId])).rejects.toThrow();
      await expect(sql.unsafe(`INSERT INTO ${ns}.crew_runtime_switches (company_id,machine_id,runtime,enabled,updated_by_user_id)
        VALUES ($1,$2,'process',true,'u')`, [companyId, machineId])).rejects.toThrow(/runtime_check/);

      // Quyết định: một select mỗi (issue, vai trò); một dòng mỗi (run, kind); ghi được chuyển reviewer Codex → Claude.
      const decide = (values: Record<string, unknown>) => {
        const keys = Object.keys(values);
        return sql.unsafe(`INSERT INTO ${ns}.crew_runtime_decisions (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})
          ON CONFLICT DO NOTHING`, Object.values(values) as never[]);
      };
      const base = { company_id: companyId, issue_id: issueId };
      expect((await decide({ ...base, kind: "select", to_agent_id: executor, to_runtime: "claude_local", model: "claude-sonnet-5", complexity: "small", reason: "r" })).count).toBe(1);
      expect((await decide({ ...base, kind: "select", to_agent_id: executor, to_runtime: "claude_local", reason: "lặp" })).count).toBe(0);
      expect((await decide({ ...base, role: "reviewer", kind: "select", to_agent_id: codex, to_runtime: "codex_local", reason: "r" })).count).toBe(1);
      const swap = { ...base, role: "reviewer", kind: "fallback", run_id: runId, machine_id: machineId, from_agent_id: codex, to_agent_id: reviewer,
        from_runtime: "codex_local", to_runtime: "claude_local", trigger: "switch_off", reason: "Codex tắt" };
      expect((await decide(swap)).count).toBe(1);
      expect((await decide(swap)).count).toBe(0);
      expect((await decide({ ...base, role: "reviewer", kind: "fallback_refused", run_id: runId, trigger: "other", reason: "lỗi khác" })).count).toBe(1);
      expect(await sql.unsafe(`SELECT role, kind FROM ${ns}.crew_runtime_decisions ORDER BY id`)).toEqual([
        { role: "executor", kind: "select" }, { role: "reviewer", kind: "select" },
        { role: "reviewer", kind: "fallback" }, { role: "reviewer", kind: "fallback_refused" },
      ]);
      await expect(decide({ ...base, role: "assistant", kind: "select", reason: "r" })).rejects.toThrow(/role_check/);
      await expect(decide({ ...base, kind: "switch", reason: "r" })).rejects.toThrow(/kind_check/);
      await expect(decide({ ...base, kind: "fallback", trigger: "crash", reason: "r" })).rejects.toThrow(/trigger_check/);

      // Hàng chờ: một dòng mỗi run, mở cho tới khi đánh dấu handled_at.
      const wait = () => sql.unsafe(`INSERT INTO ${ns}.crew_runtime_waits (run_id,company_id,issue_id,agent_id,machine_id,runtime)
        VALUES ($1,$2,$3,$4,$5,'codex_local') ON CONFLICT (run_id) DO NOTHING`, [runId, companyId, issueId, codex, machineId]);
      expect((await wait()).count).toBe(1);
      expect((await wait()).count).toBe(0);
      expect(await sql.unsafe(`SELECT run_id, handled_at FROM ${ns}.crew_runtime_waits`)).toEqual([{ run_id: runId, handled_at: null }]);
      expect(await sql.unsafe(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename LIKE 'crew_runtime_%' ORDER BY indexname`, [ns]))
        .toEqual([
          { indexname: "crew_runtime_decisions_issue_idx" }, { indexname: "crew_runtime_decisions_pkey" },
          { indexname: "crew_runtime_decisions_run_kind_uq" }, { indexname: "crew_runtime_decisions_select_uq" },
          { indexname: "crew_runtime_switches_pkey" }, { indexname: "crew_runtime_waits_open_idx" }, { indexname: "crew_runtime_waits_pkey" },
        ]);
    } finally {
      await host?.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
