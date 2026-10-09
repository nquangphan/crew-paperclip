import { fileURLToPath } from "node:url";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import postgres from "../../../db/node_modules/postgres";
import { createDb, plugins } from "../../../db/src/index.js";
import { startEmbeddedPostgresTestDatabase } from "../../../db/src/test-embedded-postgres.js";
import { pluginDatabaseService } from "../../../../server/src/services/plugin-database.js";
import manifest from "../manifest.js";

const hostPluginId = "60000000-0000-4000-8000-000000000001";
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

export interface PluginHost {
  sql: postgres.Sql;
  ctx: PluginContext;
  ns: string;
  logs: { level: string; message: string; meta?: unknown }[];
  /** Set to make every `ctx.db` call throw, to check how routes report database failures. */
  fail: { error: Error | null };
  cleanup: () => Promise<void>;
}

/** Embedded Postgres with every plugin migration applied through the real host plugin-database service. */
export async function startPluginHost(prefix: string): Promise<PluginHost> {
  const database = await startEmbeddedPostgresTestDatabase(prefix);
  const sql = postgres(database.connectionString, { max: 4, onnotice: () => {} });
  const hostDb = createDb(database.connectionString);
  await hostDb.insert(plugins).values({
    id: hostPluginId, pluginKey: manifest.id, packageName: "@crew/paperclip-plugin", version: manifest.version,
    apiVersion: manifest.apiVersion, categories: manifest.categories, manifestJson: manifest, status: "installed",
  });
  const pluginDb = pluginDatabaseService(hostDb);
  await pluginDb.applyMigrations(hostPluginId, manifest, packageRoot);
  const ns = await pluginDb.getRuntimeNamespace(hostPluginId);
  const logs: PluginHost["logs"] = [];
  const fail: PluginHost["fail"] = { error: null };
  const record = (level: string) => (message: string, meta?: unknown) => { logs.push({ level, message, meta }); };
  const ctx = {
    db: {
      namespace: ns,
      query: <T>(statement: string, params?: unknown[]) => {
        if (fail.error) throw fail.error;
        return pluginDb.query<T>(hostPluginId, statement, params);
      },
      execute: (statement: string, params?: unknown[]) => {
        if (fail.error) throw fail.error;
        return pluginDb.execute(hostPluginId, statement, params);
      },
    },
    logger: { info: record("info"), debug: record("debug"), error: record("error"), warn: record("warn") },
  } as unknown as PluginContext;
  return { sql, ctx, ns, logs, fail, cleanup: async () => { await sql.end(); await database.cleanup(); } };
}
