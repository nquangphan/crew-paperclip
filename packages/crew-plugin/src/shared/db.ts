import type { PluginContext } from "@paperclipai/plugin-sdk";

export const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function checkedId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("ID không hợp lệ");
  return value;
}

/** Postgres array literal of already validated uuids; avoids driver-specific array binding. */
export function uuidArray(ids: string[]): string {
  if (!ids.every((id) => UUID.test(id))) throw new Error("ID không hợp lệ");
  return `{${ids.join(",")}}`;
}

export function pluginNamespace(ctx: Pick<PluginContext, "db">): string {
  const namespace = ctx.db.namespace;
  if (!/^plugin_[a-z0-9_]+$/.test(namespace)) throw new Error("Namespace không hợp lệ");
  return namespace;
}

export function jsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
