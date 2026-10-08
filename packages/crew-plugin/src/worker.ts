import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { registerRunCancelledHandler } from "./run-cancelled.js";
import { registerFeatures } from "./features.js";
import { dispatchCrewWebhook } from "./shared/webhook.js";

const plugin = definePlugin({
  async setup(ctx) {
    registerRunCancelledHandler(ctx);
    registerFeatures(ctx);
  },
  onWebhook: dispatchCrewWebhook,
});

export default plugin;
runWorker(plugin, import.meta.url);
