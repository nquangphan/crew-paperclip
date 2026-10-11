import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type PluginHost, startPluginHost } from "./plugin-host-db.js";

const companyId = "10000000-0000-4000-8000-000000000001";
const machineId = "50000000-0000-4000-8000-000000000001";
const environmentId = "70000000-0000-4000-8000-000000000001";

describe("migration bảng ghép máy trên database đã có các migration trước", () => {
  it("giữ bản tin máy cũ, thêm machine_pairings với khóa (company, máy)", async () => {
    const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
    const root = await mkdtemp(join(tmpdir(), "crew-pairing-migration-"));
    let host: PluginHost | undefined;
    try {
      await mkdir(join(root, "migrations"));
      const files = (await readdir(join(packageRoot, "migrations"))).filter((file) => file.endsWith(".sql")).sort();
      const pairing = files.find((file) => file.startsWith("0014_"));
      expect(pairing).toBe("0014_machine_pairings.sql");
      for (const file of files.filter((name) => name < "0014_")) await copyFile(join(packageRoot, "migrations", file), join(root, "migrations", file));
      host = await startPluginHost("crew-pairing-migration-", root);
      const { sql, ns } = host;
      await sql.unsafe(`INSERT INTO ${ns}.machine_latest (company_id,machine_id,hostname,received_at,sent_at,report)
        VALUES ($1,$2,'mac-mini',now(),now(),'{}'::jsonb)`, [companyId, machineId]);

      await copyFile(join(packageRoot, "migrations", pairing!), join(root, "migrations", pairing!));
      await host.applyMigrations(root);

      expect(await sql.unsafe(`SELECT hostname FROM ${ns}.machine_latest`)).toEqual([{ hostname: "mac-mini" }]);
      expect(await sql.unsafe(`SELECT count(*)::int AS n FROM ${ns}.machine_pairings`)).toEqual([{ n: 0 }]);

      const columns = await sql.unsafe(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'machine_pairings' ORDER BY ordinal_position`, [ns]);
      expect(columns.map((c) => [c.column_name, c.data_type, c.is_nullable])).toEqual([
        ["company_id", "uuid", "NO"], ["machine_id", "uuid", "NO"], ["hostname", "text", "NO"],
        ["environment_id", "uuid", "NO"], ["tailscale_ip", "text", "NO"], ["port", "integer", "NO"],
        ["host_key_fingerprint", "text", "NO"], ["key_nonce", "text", "NO"], ["paired_by_user_id", "text", "NO"],
        ["paired_at", "timestamp with time zone", "NO"], ["revoked_at", "timestamp with time zone", "YES"],
        ["revoked_by_user_id", "text", "YES"],
      ]);

      const insert = () => sql.unsafe(`INSERT INTO ${ns}.machine_pairings (company_id,machine_id,hostname,environment_id,tailscale_ip,
        port,host_key_fingerprint,key_nonce,paired_by_user_id) VALUES ($1,$2,'macbook',$3,'100.100.1.2',2222,'SHA256:x','n','u')
        RETURNING paired_at, revoked_at`, [companyId, machineId, environmentId]);
      const [row] = await insert();
      expect(row?.paired_at).toBeInstanceOf(Date);
      expect(row?.revoked_at).toBeNull();
      await expect(insert()).rejects.toThrow(/machine_pairings_pkey/);
    } finally {
      await host?.cleanup();
      await rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
