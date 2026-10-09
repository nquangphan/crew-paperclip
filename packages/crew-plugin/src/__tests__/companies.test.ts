import { expect, it, vi } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { loadCrewCompanies } from "../companies/data.js";

const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const C = "10000000-0000-4000-8000-00000000000c";
const D = "10000000-0000-4000-8000-00000000000d";
const ref = { type: "secret_ref", secretId: "20000000-0000-4000-8000-000000000001" };

/** Plugin config is stored per company; a Crew company lists itself in its own `companies`. */
function context(companies: { id: string; name: string; status?: string }[], configs: Record<string, unknown>) {
  const error = vi.fn();
  const ctx = {
    companies: {
      list: vi.fn(async () => companies.map((c) => ({ status: "active", ...c }))),
      get: vi.fn(async (id: string) => {
        const company = companies.find((c) => c.id === id);
        return company ? { status: "active", ...company } : null;
      }),
    },
    db: { namespace: "plugin_crew_core_test", query: vi.fn(async () => []), execute: vi.fn(async () => ({ rowCount: 0 })) },
    config: {
      get: vi.fn(async (companyId: string) => {
        const config = configs[companyId];
        if (config instanceof Error) throw config;
        return config ?? {};
      }),
    },
    logger: { error, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  } as unknown as PluginContext;
  return { ctx, error };
}

it("chỉ trả company còn tồn tại có cấu hình Crew của chính nó", async () => {
  const { ctx } = context(
    [{ id: A, name: "TPS" }, { id: C, name: "Không Crew" }, { id: D, name: "Lưu trữ", status: "archived" }],
    {
      [A]: { companies: [{ companyId: A, webhookSecretRef: ref }, { companyId: B, webhookSecretRef: ref }] },
      [C]: { companies: [{ companyId: A, webhookSecretRef: ref }] },
      [D]: { companies: [{ companyId: D, webhookSecretRef: ref }] },
    },
  );
  expect(await loadCrewCompanies(ctx, {})).toEqual([{ id: A, name: "TPS" }]);
});

it("cấu hình rỗng thì trả mảng rỗng; company đọc cấu hình lỗi thì bỏ qua", async () => {
  expect(await loadCrewCompanies(context([{ id: A, name: "TPS" }], {}).ctx, {})).toEqual([]);
  const { ctx, error } = context([{ id: A, name: "TPS" }, { id: B, name: "E2E" }], {
    [A]: new Error("plugin disabled"),
    [B]: { companies: [{ companyId: B, webhookSecretRef: ref }] },
  });
  expect(await loadCrewCompanies(ctx, {})).toEqual([{ id: B, name: "E2E" }]);
  expect(error).toHaveBeenCalledOnce();
});

it("khi host gắn companyId (người không phải admin) thì chỉ trả đúng company đó", async () => {
  const configs = {
    [A]: { companies: [{ companyId: A, webhookSecretRef: ref }] },
    [B]: { companies: [{ companyId: B, webhookSecretRef: ref }] },
  };
  const { ctx } = context([{ id: A, name: "TPS" }, { id: B, name: "E2E" }], configs);
  expect(await loadCrewCompanies(ctx, { companyId: B })).toEqual([{ id: B, name: "E2E" }]);
  expect(await loadCrewCompanies(ctx, { companyId: C })).toEqual([]);
  expect(ctx.companies.list).not.toHaveBeenCalled();
});
