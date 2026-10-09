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
    "issue.comments.read",
    "issue.relations.read",
    "issue.subtree.read",
    "projects.read",
    "activity.read",
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "webhooks.receive",
    "secrets.read-ref",
    "ui.detailTab.register",
    "ui.page.register",
    "ui.sidebar.register",
    "ui.dashboardWidget.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      companies: {
        type: "array",
        title: "Webhook secrets by company",
        items: {
          type: "object",
          properties: {
            companyId: { type: "string", format: "uuid" },
            webhookSecretRef: {
              type: "object",
              format: "secret-ref",
              properties: {
                type: { const: "secret_ref" },
                secretId: { type: "string", format: "uuid" },
                version: { oneOf: [{ const: "latest" }, { type: "integer", minimum: 1 }] },
              },
              required: ["type", "secretId"],
              additionalProperties: false,
            },
          },
          required: ["companyId", "webhookSecretRef"],
        },
      },
    },
  },
  webhooks: [
    { endpointKey: "machine-status", displayName: "Crew machine status" },
    { endpointKey: "docs-snapshot", displayName: "Crew docs snapshot" },
  ],
  database: {
    migrationsDir: "migrations",
    coreReadTables: ["issues", "issue_relations", "issue_comments", "heartbeat_runs", "agents", "projects"],
  },
  ui: {
    slots: [{
      type: "detailTab",
      id: "crew-issue",
      displayName: "Crew",
      entityTypes: ["issue"],
      exportName: "CrewIssueTab",
    }, {
      type: "taskDetailView",
      id: "crew-issue-summary",
      displayName: "Crew",
      entityTypes: ["issue"],
      exportName: "CrewIssueSummary",
    }, {
      type: "page",
      id: "crew",
      displayName: "Crew",
      routePath: "crew",
      exportName: "CrewPage",
    }, {
      type: "dashboardWidget",
      id: "crew-machines",
      displayName: "Máy",
      exportName: "MachinesWidget",
    }, {
      type: "page",
      id: "crew-guide",
      displayName: "Hướng dẫn",
      routePath: "huong-dan",
      exportName: "CrewGuidePage",
    }, {
      type: "sidebar",
      id: "crew-link",
      displayName: "Crew",
      exportName: "CrewSidebarLink",
    }, {
      type: "sidebar",
      id: "crew-guide-link",
      displayName: "Hướng dẫn",
      exportName: "CrewGuideSidebarLink",
    }],
  },
};

export default manifest;
