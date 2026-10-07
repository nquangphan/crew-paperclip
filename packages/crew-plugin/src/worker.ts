import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { registerIntegratorWake } from "./integrator-wake.js";
import { registerRunCancelledHandler } from "./run-cancelled.js";

const plugin = definePlugin({
  async setup(ctx) {
    registerRunCancelledHandler(ctx);
    registerIntegratorWake(ctx);
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
