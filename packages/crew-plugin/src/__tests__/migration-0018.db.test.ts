import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";

describe("migration phòng của thành viên góp ý trên database đã có các migration trước", () => {
  it("thành viên cũ thành Phòng Marketing, nhận Phòng QC, chặn phòng lạ", async () => {
    const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
    const root = await mkdtemp(join(tmpdir(), "crew-contributor-department-0018-"));
    let host: PluginHost | undefined;
    try {
      await mkdir(join(root, "migrations"));
      const files = (await readdir(join(packageRoot, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
      const department = files.find((file) => file.startsWith("0018_"));
      expect(department).toBe("0018_contributor_department.sql");
      for (const file of files.filter((name) => name < "0018_")) await copyFile(join(packageRoot, "migrations", file), join(root, "migrations", file));
      host = await startPluginHost("crew-contributor-department-0018-", root);
      const { sql, ns } = host;
      await sql.unsafe(`INSERT INTO ${ns}.crew_contributors (company_id,user_id,granted_by_user_id) VALUES ($1,'old-guest','owner')`, [companyId]);

      await copyFile(join(packageRoot, "migrations", department!), join(root, "migrations", department!));
      await host.applyMigrations(root);

      // Thành viên có từ trước giữ nguyên, mặc định là Phòng Marketing.
      expect(await sql.unsafe(`SELECT user_id, department FROM ${ns}.crew_contributors`))
        .toEqual([{ user_id: "old-guest", department: "marketing" }]);

      await sql.unsafe(`INSERT INTO ${ns}.crew_contributors (company_id,user_id,granted_by_user_id,department) VALUES ($1,'qc-guest','owner','qc')`, [companyId]);
      await sql.unsafe(`INSERT INTO ${ns}.crew_contributors (company_id,user_id,granted_by_user_id) VALUES ($1,'new-guest','owner')`, [companyId]);
      expect(await sql.unsafe(`SELECT user_id, department FROM ${ns}.crew_contributors ORDER BY user_id`)).toEqual([
        { user_id: "new-guest", department: "marketing" },
        { user_id: "old-guest", department: "marketing" },
        { user_id: "qc-guest", department: "qc" },
      ]);

      await expect(sql.unsafe(`UPDATE ${ns}.crew_contributors SET department = 'sales' WHERE user_id = 'qc-guest'`))
        .rejects.toThrow(/crew_contributors_department_ck/);
      await expect(sql.unsafe(`UPDATE ${ns}.crew_contributors SET department = NULL WHERE user_id = 'qc-guest'`))
        .rejects.toThrow(/null value/);
    } finally {
      await host?.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
