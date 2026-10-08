import type { PluginContext } from "@paperclipai/plugin-sdk";
import { registerMapFeature } from "./data/map.js";

export function registerFeatures(ctx: PluginContext): void {
  registerMapFeature(ctx);
}
