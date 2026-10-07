import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { registerRunCancelledHandler } from "./run-cancelled.js";

const plugin = definePlugin({
  async setup(ctx) {
    registerRunCancelledHandler(ctx);
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
