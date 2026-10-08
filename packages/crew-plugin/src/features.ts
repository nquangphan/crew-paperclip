import type { PluginContext } from "@paperclipai/plugin-sdk";
import { registerMapFeature } from "./handlers/map.js";
import { registerRootsFeature } from "./handlers/roots.js";

export function registerFeatures(ctx: PluginContext): void {
  registerMapFeature(ctx);
  registerRootsFeature(ctx);
}
