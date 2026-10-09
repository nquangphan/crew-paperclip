import { definePlugin, type PluginContext, runWorker } from "@paperclipai/plugin-sdk";
import { registerRunCancelledHandler } from "./run-cancelled.js";
import { registerFeatures } from "./features.js";
import { dispatchCrewWebhook } from "./shared/webhook.js";
import { handleDocsApi } from "./docs/api.js";
import { handleJobsApi } from "./jobs/api.js";
import { handleRolesApi } from "./roles/api.js";
import { registerAttachmentsAudit } from "./attachments/audit.js";

// onApiRequest receives no context, so keep the one handed to setup.
let pluginCtx: PluginContext | undefined;

const plugin = definePlugin({
  async setup(ctx) {
    pluginCtx = ctx;
    registerRunCancelledHandler(ctx);
    registerFeatures(ctx);
    registerAttachmentsAudit(ctx);
  },
  onWebhook: dispatchCrewWebhook,
  onApiRequest: async (input) => {
    if (!pluginCtx) throw new Error("Plugin chưa sẵn sàng");
    if (input.routeKey.startsWith("jobs.")) return handleJobsApi(pluginCtx, input);
    if (input.routeKey.startsWith("roles.")) return handleRolesApi(pluginCtx, input);
    return (await handleDocsApi(pluginCtx, input)) ?? { status: 404, body: { error: "Route không tồn tại" } };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
