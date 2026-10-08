import type { PluginContext } from "@paperclipai/plugin-sdk";
import { registerMapFeature } from "./handlers/map.js";
import { registerDocsData } from "./docs/data.js";
import { registerDocsWebhook } from "./docs/webhook.js";

export function registerFeatures(ctx: PluginContext): void {
  registerMapFeature(ctx);
  registerDocsData(ctx); registerDocsWebhook(ctx);
}
