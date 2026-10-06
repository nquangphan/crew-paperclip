import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "crew.core",
  apiVersion: 1,
  version: "0.0.0",
  displayName: "Crew",
  description: "Crew plugin for Paperclip.",
  author: "2P Crew",
  categories: ["automation"],
  capabilities: ["issues.read"],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
