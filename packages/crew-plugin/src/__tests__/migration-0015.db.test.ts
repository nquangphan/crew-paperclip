import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const macbook = "50000000-0000-4000-8000-000000000002";
const mini = "50000000-0000-4000-8000-000000000001";
const environmentId = "70000000-0000-4000-8000-000000000001";

describe("migration cho phép gỡ máy chưa ghép trên bảng ghép đã có dữ liệu", () => {
  it("giữ dòng ghép cũ, cho dòng đã gỡ thiếu thông tin ghép, chặn dòng chưa gỡ thiếu thông tin", async () => {
    const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
    const root = await mkdtemp(join(tmpdir(), "crew-pairing-0015-"));
    let host: PluginHost | undefined;
    try {
      await mkdir(join(root, "migrations"));
      const files = (await readdir(join(packageRoot, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
      const relax = files.find((file) => file.startsWith("0015_"));
      expect(relax).toBe("0015_machine_pairings_unpaired_removal.sql");
      for (const file of files.filter((name) => name < "0015_")) await copyFile(join(packageRoot, "migrations", file), join(root, "migrations", file));
      host = await startPluginHost("crew-pairing-0015-", root);
      const { sql, ns } = host;
      await sql.unsafe(`INSERT INTO ${ns}.machine_pairings (company_id,machine_id,hostname,environment_id,tailscale_ip,port,
        host_key_fingerprint,key_nonce,paired_by_user_id) VALUES ($1,$2,'macbook',$3,'100.100.1.2',2222,'SHA256:x','n','u')`,
      [companyId, macbook, environmentId]);

      await copyFile(join(packageRoot, "migrations", relax!), join(root, "migrations", relax!));
      await host.applyMigrations(root);

      expect(await sql.unsafe(`SELECT hostname, environment_id::text AS env, revoked_at FROM ${ns}.machine_pairings`))
        .toEqual([{ hostname: "macbook", env: environmentId, revoked_at: null }]);
      const nullable = await sql.unsafe(`SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'machine_pairings' AND is_nullable = 'YES' ORDER BY ordinal_position`, [ns]);
      expect(nullable.map((c) => c.column_name)).toEqual(["environment_id", "tailscale_ip", "port", "host_key_fingerprint",
        "paired_by_user_id", "paired_at", "revoked_at", "revoked_by_user_id"]);

      await sql.unsafe(`INSERT INTO ${ns}.machine_pairings (company_id,machine_id,hostname,key_nonce,paired_at,revoked_at,revoked_by_user_id)
        VALUES ($1,$2,'mac-mini','n',NULL,now(),'u')`, [companyId, mini]);
      await expect(sql.unsafe(`UPDATE ${ns}.machine_pairings SET revoked_at = NULL WHERE machine_id = $1`, [mini]))
        .rejects.toThrow(/machine_pairings_active_facts_check/);
    } finally {
      await host?.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
