import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";
const issueId = "60000000-0000-4000-8000-000000000001";
const commentId = "80000000-0000-4000-8000-000000000001";
const [assistant, executor, reviewer, integrator] = [1, 2, 3, 4].map((n) => `40000000-0000-4000-8000-00000000000${n}`);

describe("migration góp ý trên database đã có các migration trước", () => {
  it("giữ dữ liệu cũ, thêm bảng thành viên góp ý và hàng chờ với ràng buộc có tên", async () => {
    const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
    const root = await mkdtemp(join(tmpdir(), "crew-contributions-migration-"));
    let host: PluginHost | undefined;
    try {
      await mkdir(join(root, "migrations"));
      const files = (await readdir(join(packageRoot, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
      const contributions = files.find((file) => file.startsWith("0013_"));
      expect(contributions).toBe("0013_contributions.sql");
      for (const file of files.filter((name) => name < "0013_")) await copyFile(join(packageRoot, "migrations", file), join(root, "migrations", file));
      host = await startPluginHost("crew-contributions-migration-", root);
      const { sql, ns } = host;
      await sql.unsafe(`INSERT INTO ${ns}.crew_project_roles (company_id,project_id,assistant_agent_id,executor_agent_ids,reviewer_agent_id,integrator_agent_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4::uuid[],$5,$6,'u')`, [companyId, projectId, assistant, `{${executor}}`, reviewer, integrator]);

      await copyFile(join(packageRoot, "migrations", contributions!), join(root, "migrations", contributions!));
      await host.applyMigrations(root);

      // Dữ liệu cũ còn nguyên.
      expect(await sql.unsafe(`SELECT project_id, executor_agent_ids::text AS executors FROM ${ns}.crew_project_roles`))
        .toEqual([{ project_id: projectId, executors: `{${executor}}` }]);

      // Hai ràng buộc có tên, không để Postgres tự đặt.
      const checks = await sql.unsafe(`SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = $1 AND c.conrelid = $2::regclass AND c.contype = 'c' AND c.conname LIKE '%\\_ck' ORDER BY c.conname`,
      [ns, `${ns}.crew_contributions`]);
      expect(checks).toEqual([{ conname: "crew_contributions_result_ck" }, { conname: "crew_contributions_shape_ck" }]);

      // id tự sinh, trạng thái mặc định pending.
      const issueRow = await sql.unsafe(`INSERT INTO ${ns}.crew_contributions (company_id,kind,author_user_id,project_id,title)
        VALUES ($1,'issue','guest',$2,'Tiêu đề') RETURNING id, status, body`, [companyId, projectId]);
      expect(issueRow[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(issueRow[0]?.status).toBe("pending");
      expect(issueRow[0]?.body).toBeNull();
      const commentRow = await sql.unsafe(`INSERT INTO ${ns}.crew_contributions (company_id,kind,author_user_id,target_issue_id,body)
        VALUES ($1,'comment','guest',$2,'Góp ý') RETURNING id`, [companyId, issueId]);
      expect(commentRow[0]?.id).not.toBe(issueRow[0]?.id);

      // Sai shape bị chặn.
      const bad = (cols: string, values: unknown[]) => sql.unsafe(`INSERT INTO ${ns}.crew_contributions (company_id,author_user_id,${cols})
        VALUES ($1,'guest',${values.map((_, i) => `$${i + 2}`).join(",")})`, [companyId, ...values] as never[]);
      await expect(bad("kind,title", ["issue", "thiếu project"])).rejects.toThrow(/crew_contributions_shape_ck/);
      await expect(bad("kind,project_id,title,target_issue_id", ["issue", projectId, "t", issueId])).rejects.toThrow(/crew_contributions_shape_ck/);
      await expect(bad("kind,target_issue_id", ["comment", issueId])).rejects.toThrow(/crew_contributions_shape_ck/);
      await expect(bad("kind,target_issue_id,body,title", ["comment", issueId, "b", "t"])).rejects.toThrow(/crew_contributions_shape_ck/);
      await expect(bad("kind,project_id,title", ["note", projectId, "t"])).rejects.toThrow(/kind_check/);
      await expect(sql.unsafe(`UPDATE ${ns}.crew_contributions SET status = 'done'`)).rejects.toThrow(/status_check/);

      // Approved bắt buộc có kết quả tương ứng với kind.
      await expect(sql.unsafe(`UPDATE ${ns}.crew_contributions SET status = 'approved' WHERE id = $1`, [issueRow[0]?.id])).rejects.toThrow(/crew_contributions_result_ck/);
      await expect(sql.unsafe(`UPDATE ${ns}.crew_contributions SET status = 'approved', result_comment_id = $2 WHERE id = $1`, [issueRow[0]?.id, commentId]))
        .rejects.toThrow(/crew_contributions_result_ck/);
      await expect(sql.unsafe(`UPDATE ${ns}.crew_contributions SET status = 'approved' WHERE id = $1`, [commentRow[0]?.id])).rejects.toThrow(/crew_contributions_result_ck/);
      await sql.unsafe(`UPDATE ${ns}.crew_contributions SET status = 'approved', result_issue_id = $2 WHERE id = $1`, [issueRow[0]?.id, issueId]);
      await sql.unsafe(`UPDATE ${ns}.crew_contributions SET status = 'approved', result_comment_id = $2 WHERE id = $1`, [commentRow[0]?.id, commentId]);
      expect(await sql.unsafe(`SELECT status FROM ${ns}.crew_contributions ORDER BY kind`)).toEqual([{ status: "approved" }, { status: "approved" }]);

      // Khóa chính (company, user) của thành viên góp ý.
      const grant = () => sql.unsafe(`INSERT INTO ${ns}.crew_contributors (company_id,user_id,granted_by_user_id) VALUES ($1,'guest','owner')`, [companyId]);
      await grant();
      await expect(grant()).rejects.toThrow(/crew_contributors_pkey/);
      expect((await sql.unsafe(`SELECT granted_at FROM ${ns}.crew_contributors`))[0]?.granted_at).toBeInstanceOf(Date);

      expect(await sql.unsafe(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename IN ('crew_contributions','crew_contributors') ORDER BY indexname`, [ns]))
        .toEqual([
          { indexname: "crew_contributions_author_idx" }, { indexname: "crew_contributions_pkey" },
          { indexname: "crew_contributions_status_idx" }, { indexname: "crew_contributions_target_idx" },
          { indexname: "crew_contributors_pkey" },
        ]);
    } finally {
      await host?.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
