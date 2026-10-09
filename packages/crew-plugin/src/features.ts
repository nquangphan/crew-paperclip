import type { PluginContext } from "@paperclipai/plugin-sdk";
import { registerCompaniesData } from "./companies/data.js";
import { registerDocsData } from "./docs/data.js";
import { registerDocsGraph } from "./docs/graph-data.js";
import { registerDocsHistory } from "./docs/history.js";
import { registerDocsWebhook } from "./docs/webhook.js";
import { registerMapFeature } from "./handlers/map.js";
import { registerRootsFeature } from "./handlers/roots.js";
import { registerJobsData } from "./jobs/data.js";
import { registerMachinesFeature } from "./machines/data.js";
import { registerSetupData } from "./setup/data.js";
import { registerSkillSyncData } from "./skills/sync-data.js";
import { registerStorageData } from "./storage/data.js";
import { registerUsageData } from "./usage/data.js";

export function registerFeatures(ctx: PluginContext): void {
  registerMapFeature(ctx);
  registerRootsFeature(ctx);
  registerDocsData(ctx);
  registerDocsWebhook(ctx);
  registerDocsHistory(ctx);
  registerDocsGraph(ctx);
  registerMachinesFeature(ctx);
  registerJobsData(ctx);
  registerSetupData(ctx);
  registerSkillSyncData(ctx);
  registerCompaniesData(ctx);
  registerStorageData(ctx);
  registerUsageData(ctx);
}
