import type { PluginContext } from "@paperclipai/plugin-sdk";
import { registerMapFeature } from "./handlers/map.js";
import { registerMachinesFeature } from "./machines/data.js";

export function registerFeatures(ctx: PluginContext): void {
  registerMapFeature(ctx);
  registerMachinesFeature(ctx);
}
