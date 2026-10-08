import type { PluginContext } from "@paperclipai/plugin-sdk";
import { registerDocsData } from "./docs/data.js";
import { registerDocsWebhook } from "./docs/webhook.js";
import { registerMapFeature } from "./handlers/map.js";
import { registerRootsFeature } from "./handlers/roots.js";
import { registerMachinesFeature } from "./machines/data.js";

export function registerFeatures(ctx: PluginContext): void {
  registerMapFeature(ctx);
  registerRootsFeature(ctx);
  registerDocsData(ctx);
  registerDocsWebhook(ctx);
  registerMachinesFeature(ctx);
}
