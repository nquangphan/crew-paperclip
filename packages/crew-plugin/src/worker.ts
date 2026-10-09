import { definePlugin, type PluginContext, runWorker } from "@paperclipai/plugin-sdk";
import { registerRunCancelledHandler } from "./run-cancelled.js";
import { registerFeatures } from "./features.js";
import { dispatchCrewWebhook } from "./shared/webhook.js";
import { handleRolesApi } from "./roles/api.js";

// onApiRequest receives no context, so keep the one handed to setup.
let pluginCtx: PluginContext | undefined;

const plugin = definePlugin({
  async setup(ctx) {
    pluginCtx = ctx;
    registerRunCancelledHandler(ctx);
    registerFeatures(ctx);
  },
  onWebhook: dispatchCrewWebhook,
  onApiRequest: async (input) => {
    if (!pluginCtx) throw new Error("Plugin chưa sẵn sàng");
    return handleRolesApi(pluginCtx, input);
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
