// Một sự kiện plugin có companyId không được để lại phạm vi invocation sau khi handler xử lý xong: nếu còn, mọi lời
// gọi worker→host không kèm invocation id (data không company, job) bị từ chối INVOCATION_SCOPE_DENIED tới 15 phút.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import type { PaperclipPluginManifestV1 } from "@paperclipai/shared";
import { createHostClientHandlers, type HostServices } from "@paperclipai/plugin-sdk";

vi.mock("../middleware/logger.js", () => {
  const l: Record<string, unknown> = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  l.child = vi.fn(() => l);
  return { logger: l, httpLogger: vi.fn() };
});

import { createPluginWorkerHandle } from "../services/plugin-worker-manager.js";

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "plugin-worker-invocation-scope.cjs");
const MANIFEST: PaperclipPluginManifestV1 = {
  id: "test.plugin", apiVersion: 1, version: "1.0.0", displayName: "t", description: "t", author: "t",
  categories: ["automation"], capabilities: [], entrypoints: { worker: "dist/worker.js" },
};

function makeHandle() {
  const list = vi.fn(async () => [{ id: "company-a" }]);
  const get = vi.fn(async (params: { companyId: string }) => ({ id: params.companyId }));
  const handlers = createHostClientHandlers({
    pluginId: "test.plugin",
    capabilities: ["companies.read"],
    services: { companies: { list, get } } as unknown as HostServices,
  });
  const handle = createPluginWorkerHandle("test.plugin", {
    entrypointPath: WORKER, manifest: MANIFEST, config: {},
    instanceInfo: { instanceId: "i", hostVersion: "1.0.0" }, apiVersion: 1, hostHandlers: handlers,
  });
  return { handle, list, get };
}

// getData không có companyId (data gọi không company, hay job) → worker gọi companies.list không kèm invocation id.
const unscopedList = { key: "probe", params: { mode: "none", hostMethod: "companies.list" }, renderEnvironment: null };
const event = {
  eventId: "e1", eventType: "agent.run.cancelled", companyId: "company-a", occurredAt: new Date().toISOString(), payload: {},
};

describe("plugin event delivery invocation scope", () => {
  it("companies.list không scope chạy được khi chưa có sự kiện", async () => {
    const { handle, list } = makeHandle();
    try {
      await handle.start();
      await expect(handle.call("getData", unscopedList)).resolves.toEqual([{ id: "company-a" }]);
      expect(list).toHaveBeenCalledTimes(1);
    } finally { await handle.stop().catch(() => undefined); }
  });

  it("handler sự kiện vẫn gọi host trong phạm vi company của sự kiện", async () => {
    const { handle, get } = makeHandle();
    try {
      await handle.start();
      handle.notify("onEvent", { event });
      await vi.waitFor(() => expect(get).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-a" })));
    } finally { await handle.stop().catch(() => undefined); }
  });

  it("handler sự kiện xử lý xong thì companies.list không scope chạy lại được ngay", async () => {
    const { handle, list, get } = makeHandle();
    try {
      await handle.start();
      handle.notify("onEvent", { event });
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 100));
      await expect(handle.call("getData", unscopedList)).resolves.toEqual([{ id: "company-a" }]);
      expect(list).toHaveBeenCalledTimes(1);
    } finally { await handle.stop().catch(() => undefined); }
  });

  it("worker dùng SDK thật nhận sự kiện qua call, handler chạy trong scope, sau đó data không company chạy được", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "crew-event-sdk-"));
    const entry = path.join(dir, "worker.mjs");
    await build({
      entryPoints: [path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "plugin-worker-sdk-event.ts")],
      bundle: true, platform: "node", format: "esm", target: "node24", outfile: entry, logLevel: "silent",
    });
    const list = vi.fn(async () => [{ id: "company-a" }]);
    const get = vi.fn(async (params: { companyId: string }) => ({ id: params.companyId }));
    const subscribe = vi.fn(async () => undefined);
    const manifest = { ...MANIFEST, capabilities: ["companies.read", "events.subscribe"] } as PaperclipPluginManifestV1;
    const handle = createPluginWorkerHandle("test.plugin", {
      entrypointPath: entry, manifest, config: {},
      instanceInfo: { instanceId: "i", hostVersion: "1.0.0" }, apiVersion: 1,
      hostHandlers: createHostClientHandlers({
        pluginId: "test.plugin",
        capabilities: manifest.capabilities,
        services: { companies: { list, get }, events: { subscribe, emit: vi.fn() } } as unknown as HostServices,
      }),
    });
    try {
      await handle.start();
      handle.notify("onEvent", { event });
      await vi.waitFor(() => expect(get).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-a" })));
      await new Promise((resolve) => setTimeout(resolve, 100));
      await expect(handle.call("getData", { key: "all-companies", params: {}, renderEnvironment: null }))
        .resolves.toEqual([{ id: "company-a" }]);
    } finally {
      await handle.stop().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
