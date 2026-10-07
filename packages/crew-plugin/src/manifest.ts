import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "crew.core",
  apiVersion: 1,
  version: "0.0.0",
  displayName: "Crew",
  description: "Crew plugin for Paperclip.",
  author: "2P Crew",
  categories: ["automation"],
  capabilities: [
    "events.subscribe",
    "issues.read",
    "issues.update",
    "issue.comments.create",
    "agents.read",
    "agents.invoke",
    "plugin.state.read",
    "plugin.state.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
