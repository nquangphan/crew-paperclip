// Worker built on the real plugin SDK: an event handler that reads its company through the host, and a data handler
// without a company that lists companies. Bundled by the test before it starts.
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.events.on("agent.run.cancelled", async (event) => {
      await ctx.companies.get(event.companyId);
    });
    ctx.data.register("all-companies", async () => ctx.companies.list());
  },
});

runWorker(plugin, import.meta.url);
