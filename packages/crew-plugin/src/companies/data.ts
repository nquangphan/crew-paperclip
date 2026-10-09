import type { PluginContext } from "@paperclipai/plugin-sdk";

export interface CrewCompany { id: string; name: string }
type Ctx = Pick<PluginContext, "companies" | "config" | "logger">;

/** A company is a Crew company when its own plugin config lists it under `companies` (the webhook secret binding). */
async function isCrewCompany(ctx: Ctx, companyId: string): Promise<boolean> {
  try {
    const config = await ctx.config.get(companyId);
    const items = Array.isArray(config.companies) ? config.companies : [];
    return items.some((item: unknown) =>
      !!item && typeof item === "object" && (item as Record<string, unknown>).companyId === companyId);
  } catch (error) {
    ctx.logger.error("crew companies: config unreadable", { companyId, err: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Data key `crew.companies`. Plugin config is stored per company, so every live (not archived) company is checked
 * against its own config. Called without a company the host only lets an instance admin through, and every Crew
 * company is returned; when the host scoped the call to one company, only that company can be returned.
 */
export async function loadCrewCompanies(ctx: Ctx, params: Record<string, unknown>): Promise<CrewCompany[]> {
  const scoped = typeof params.companyId === "string" && params.companyId !== "" ? params.companyId : null;
  const companies = (await ctx.companies.list())
    .filter((company) => company.status !== "archived" && (scoped === null || company.id === scoped));
  const checked = await Promise.all(companies.map(async (company) => ({ company, crew: await isCrewCompany(ctx, company.id) })));
  return checked.filter(({ crew }) => crew).map(({ company }) => ({ id: company.id, name: company.name }));
}

export function registerCompaniesData(ctx: PluginContext): void {
  ctx.data.register("crew.companies", (params) => loadCrewCompanies(ctx, params));
}
