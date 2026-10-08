import type { PluginContext } from "@paperclipai/plugin-sdk";
import { registerMapFeature } from "./handlers/map.js";

export function registerFeatures(ctx: PluginContext): void {
  registerMapFeature(ctx);
}
