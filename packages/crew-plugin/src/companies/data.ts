import type { PluginContext } from "@paperclipai/plugin-sdk";
import { pluginNamespace, uuidArray } from "../shared/db.js";

export interface CrewCompany { id: string; name: string }
type Ctx = Pick<PluginContext, "companies" | "config" | "logger" | "db">;

/** JSON-RPC `INVOCATION_SCOPE_DENIED` of the plugin host. */
const SCOPE_DENIED = -32005;

/**
 * The core plugin host keeps the invocation of every event it hands the worker for 15 minutes. While one is
 * alive it refuses any worker→host call without an invocation that touches companies, so `companies.list`
 * from a job or an unscoped data call fails with -32005 (also, briefly, while any scoped call is running).
 */
export function isScopeDenied(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === SCOPE_DENIED;
}

const table = (ctx: Pick<PluginContext, "db">) => `${pluginNamespace(ctx)}.crew_companies`;

/** A company is a Crew company when its own plugin config lists it under `companies` (the webhook secret binding). */
async function isCrewCompany(ctx: Ctx, companyId: string, logErrors: boolean): Promise<boolean> {
  try {
    const config = await ctx.config.get(companyId);
    const items = Array.isArray(config.companies) ? config.companies : [];
    return items.some((item: unknown) =>
      !!item && typeof item === "object" && (item as Record<string, unknown>).companyId === companyId);
  } catch (error) {
    if (logErrors) {
      ctx.logger.error("crew companies: config unreadable", { companyId, err: error instanceof Error ? error.message : String(error) });
    }
    return false;
  }
}

/** Crew companies stored by an earlier successful lookup. */
async function storedCrewCompanies(ctx: Ctx): Promise<CrewCompany[]> {
  return (await ctx.db.query<CrewCompany>(`SELECT company_id::text AS id, name FROM ${table(ctx)} ORDER BY name, company_id`))
    .map((row) => ({ id: row.id, name: row.name }));
}

/**
 * Keeps the stored list in step with a lookup: Crew companies are upserted, checked companies that are no
 * longer Crew are dropped, and a complete lookup (every live company) drops everything else too.
 * A storage failure only logs: the lookup result is still returned to the caller.
 */
async function rememberCrewCompanies(ctx: Ctx, checked: CrewCompany[], crew: CrewCompany[], complete: boolean): Promise<void> {
  try {
    const crewIds = new Set(crew.map((company) => company.id));
    if (complete) {
      await ctx.db.execute(`DELETE FROM ${table(ctx)} WHERE NOT (company_id = ANY($1::uuid[]))`, [uuidArray([...crewIds])]);
    } else {
      const gone = checked.filter((company) => !crewIds.has(company.id)).map((company) => company.id);
      if (gone.length > 0) await ctx.db.execute(`DELETE FROM ${table(ctx)} WHERE company_id = ANY($1::uuid[])`, [uuidArray(gone)]);
    }
    for (const company of crew) {
      await ctx.db.execute(
        `INSERT INTO ${table(ctx)} (company_id, name) VALUES ($1, $2)
         ON CONFLICT (company_id) DO UPDATE SET name = EXCLUDED.name, seen_at = now()`,
        [company.id, company.name],
      );
    }
  } catch (error) {
    ctx.logger.warn("crew companies: could not store the Crew companies", { err: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Every Crew company, for callers that have no company scope (a job, an admin data call). Live companies come
 * from `companies.list`; when the host refuses it (-32005) the stored list is used and one warning is logged.
 * Each candidate is still checked against its own config, and the stored list is updated from the result.
 */
export async function allCrewCompanies(ctx: Ctx, source: string, options: { logConfigErrors?: boolean } = {}): Promise<CrewCompany[]> {
  let candidates: CrewCompany[];
  let complete = true;
  try {
    candidates = (await ctx.companies.list())
      .filter((company) => company.status !== "archived")
      .map((company) => ({ id: company.id, name: company.name }));
  } catch (error) {
    if (!isScopeDenied(error)) throw error;
    ctx.logger.warn("crew companies: host refused companies.list, using the stored Crew companies", { source });
    candidates = await storedCrewCompanies(ctx);
    complete = false;
  }
  const checked = await Promise.all(candidates.map(async (company) =>
    ({ company, crew: await isCrewCompany(ctx, company.id, options.logConfigErrors ?? true) })));
  const crew = checked.filter(({ crew: isCrew }) => isCrew).map(({ company }) => company);
  await rememberCrewCompanies(ctx, candidates, crew, complete);
  return crew;
}

/**
 * The Crew companies a job may scan: only those stored by an earlier lookup, each re-checked against its own
 * config. No other company is listed or has its config read, so the host logs no error for a company without
 * Crew config. New Crew companies enter the stored list when the web loads `crew.companies` for them.
 */
export async function storedVerifiedCrewCompanies(ctx: Ctx): Promise<CrewCompany[]> {
  const candidates = await storedCrewCompanies(ctx);
  const checked = await Promise.all(candidates.map(async (company) => ({ company, crew: await isCrewCompany(ctx, company.id, false) })));
  const crew = checked.filter(({ crew: isCrew }) => isCrew).map(({ company }) => company);
  await rememberCrewCompanies(ctx, candidates, crew, false);
  return crew;
}

/**
 * Data key `crew.companies`. Plugin config is stored per company, so a company is checked against its own
 * config. When the host scoped the call to one company (the web always does), only that company is read, with
 * `companies.get`. Called without a company the host only lets an instance admin through, and every Crew
 * company is returned.
 */
export async function loadCrewCompanies(ctx: Ctx, params: Record<string, unknown>): Promise<CrewCompany[]> {
  const scoped = typeof params.companyId === "string" && params.companyId !== "" ? params.companyId : null;
  if (scoped === null) return allCrewCompanies(ctx, "crew.companies");
  const company = await ctx.companies.get(scoped);
  if (!company || company.status === "archived") return [];
  const candidate = { id: company.id, name: company.name };
  const crew = (await isCrewCompany(ctx, company.id, true)) ? [candidate] : [];
  await rememberCrewCompanies(ctx, [candidate], crew, false);
  return crew;
}

export function registerCompaniesData(ctx: PluginContext): void {
  ctx.data.register("crew.companies", (params) => loadCrewCompanies(ctx, params));
}
