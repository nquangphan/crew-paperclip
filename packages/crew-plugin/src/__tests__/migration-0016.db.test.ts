import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const projectId = "30000000-0000-4000-8000-000000000001";

describe("migration quyền xem project trên database đã có các migration trước", () => {
  it("thêm bảng crew_project_access, khóa chính (company, user, project), giữ dữ liệu cũ", async () => {
    const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
    const root = await mkdtemp(join(tmpdir(), "crew-project-access-0016-"));
    let host: PluginHost | undefined;
    try {
      await mkdir(join(root, "migrations"));
      const files = (await readdir(join(packageRoot, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
      const access = files.find((file) => file.startsWith("0016_"));
      expect(access).toBe("0016_project_access.sql");
      for (const file of files.filter((name) => name < "0016_")) await copyFile(join(packageRoot, "migrations", file), join(root, "migrations", file));
      host = await startPluginHost("crew-project-access-0016-", root);
      const { sql, ns } = host;
      await sql.unsafe(`INSERT INTO ${ns}.crew_contributors (company_id,user_id,granted_by_user_id) VALUES ($1,'guest','owner')`, [companyId]);

      await copyFile(join(packageRoot, "migrations", access!), join(root, "migrations", access!));
      await host.applyMigrations(root);

      expect(await sql.unsafe(`SELECT user_id FROM ${ns}.crew_contributors`)).toEqual([{ user_id: "guest" }]);
      const grant = () => sql.unsafe(`INSERT INTO ${ns}.crew_project_access (company_id,user_id,project_id,granted_by_user_id)
        VALUES ($1,'guest',$2,'owner')`, [companyId, projectId]);
      await grant();
      await expect(grant()).rejects.toThrow(/crew_project_access_pkey/);
      expect((await sql.unsafe(`SELECT granted_at FROM ${ns}.crew_project_access`))[0]?.granted_at).toBeInstanceOf(Date);
      expect(await sql.unsafe(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'crew_project_access' ORDER BY indexname`, [ns]))
        .toEqual([{ indexname: "crew_project_access_pkey" }, { indexname: "crew_project_access_project_idx" }]);
    } finally {
      await host?.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
