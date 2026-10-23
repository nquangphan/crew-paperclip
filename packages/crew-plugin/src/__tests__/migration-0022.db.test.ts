import { describe, expect, it } from "vitest";
import { startPluginHost } from "./plugin-host-db.js";

const company = "10000000-0000-4000-8000-000000000001";
const project = "30000000-0000-4000-8000-000000000001";
const machine = "50000000-0000-4000-8000-000000000001";
const root = "20000000-0000-4000-8000-000000000001";

describe("migration 0022: máy của project, repo của project, ghim máy theo cây yêu cầu", () => {
  it("tạo ba bảng có ràng buộc và nhận việc ensure-project", async () => {
    const host = await startPluginHost("crew-mm-0022-");
    try {
      const { sql, ns } = host;
      await sql.unsafe(`INSERT INTO ${ns}.project_machines (company_id,project_id,machine_id,status) VALUES ($1,$2,$3,'provisioning')`,
        [company, project, machine]);
      await expect(sql.unsafe(`INSERT INTO ${ns}.project_machines (company_id,project_id,machine_id,status) VALUES ($1,$2,$3,'ready')`,
        [company, project, machine])).rejects.toThrow(/project_machines_pkey/);
      await expect(sql.unsafe(`UPDATE ${ns}.project_machines SET status = 'broken'`)).rejects.toThrow(/project_machines_status_check/);
      await expect(sql.unsafe(`UPDATE ${ns}.project_machines SET error = repeat('x', 301)`)).rejects.toThrow(/project_machines_error_check/);

      await sql.unsafe(`INSERT INTO ${ns}.project_repos (company_id,project_id,origin_url,updated_by_user_id)
        VALUES ($1,$2,'git@github.com:org/app.git','owner')`, [company, project]);
      expect(await sql.unsafe(`SELECT branch, companions FROM ${ns}.project_repos`)).toEqual([{ branch: "main", companions: [] }]);
      await expect(sql.unsafe(`UPDATE ${ns}.project_repos SET companions = '{}'::jsonb`)).rejects.toThrow(/project_repos_companions_check/);

      await sql.unsafe(`INSERT INTO ${ns}.issue_machine_pins (company_id,root_issue_id,machine_id,source) VALUES ($1,$2,$3,'auto')`,
        [company, root, machine]);
      await expect(sql.unsafe(`INSERT INTO ${ns}.issue_machine_pins (company_id,root_issue_id,machine_id,source) VALUES ($1,$2,$3,'owner')`,
        [company, root, machine])).rejects.toThrow(/issue_machine_pins_pkey/);
      await expect(sql.unsafe(`UPDATE ${ns}.issue_machine_pins SET source = 'web'`)).rejects.toThrow(/issue_machine_pins_source_check/);
      expect(await sql.unsafe(`SELECT reason FROM ${ns}.issue_machine_pins`)).toEqual([{ reason: {} }]);

      await sql.unsafe(`INSERT INTO ${ns}.crew_machine_jobs (company_id,machine_id,kind,payload,created_by_user_id)
        VALUES ($1,$2,'ensure-project','{}'::jsonb,'crew:auto')`, [company, machine]);
      await expect(sql.unsafe(`INSERT INTO ${ns}.crew_machine_jobs (company_id,machine_id,kind,payload,created_by_user_id)
        VALUES ($1,$2,'clone','{}'::jsonb,'x')`, [company, machine])).rejects.toThrow(/crew_machine_jobs_kind_check/);
    } finally {
      await host.cleanup();
    }
  }, 180_000);
});
