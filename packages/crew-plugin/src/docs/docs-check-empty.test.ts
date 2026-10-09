import type { PluginContext } from "@paperclipai/plugin-sdk";
import { expect, it } from "vitest";
import { loadDocsCheck } from "./data.js";

const company = "5befeb1a-1578-4656-b913-267494592e53";
const ctx = { db: { query: async () => { throw new Error("không được truy vấn"); } } } as unknown as PluginContext;

it("docsCheck chưa có issue gốc thì trả null, không ném lỗi", async () => {
  await expect(loadDocsCheck(ctx, "", company)).resolves.toBeNull();
});

it("docsCheck với ID sai định dạng vẫn từ chối", async () => {
  await expect(loadDocsCheck(ctx, "khong-phai-uuid", company)).rejects.toThrow();
});
