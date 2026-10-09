import { createElement as h } from "react";
import { DataTable, Spinner, usePluginData } from "@paperclipai/plugin-sdk/ui";
import { registerPageSection } from "../registry.js";
import type { StorageReport, ProjectStorage } from "../../storage/data.js";
import { formatBytes, formatMeasured } from "./format.js";

const time = (value: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const row = (r: Record<string, unknown>) => r as unknown as ProjectStorage;
type Column = { key: string; header: string; render: (_: unknown, r: Record<string, unknown>) => string };
const col = (key: string, header: string, render: (p: ProjectStorage) => string): Column => ({ key, header, render: (_, r) => render(row(r)) });

export function StorageSection({ companyId }: { companyId: string }) {
  const { data, loading, error } = usePluginData<StorageReport>("crew.storage", { companyId });
  if (loading) return h("p", { role: "status" }, h(Spinner, null), " Đang đo dung lượng…");
  if (error) return h("p", { role: "alert" }, `Không tải được dung lượng: ${error.message}`);
  if (!data) return h("p", { role: "status" }, "Chưa có dữ liệu dung lượng.");
  const { company } = data;
  return h("div", null,
    h("p", null, `Đo lúc ${time(data.measuredAt)}`),
    h(DataTable, { rows: data.projects as unknown as Record<string, unknown>[], emptyMessage: "Chưa có dự án nào.", columns: [
      col("name", "Dự án", (p) => p.name),
      col("docs", "Docs (logic / vật lý / bản cũ)", (p) => `${p.docs.snapshots} ảnh chụp, ${p.docs.pages} trang · ${formatMeasured(p.docs.logical)} · ${formatMeasured(p.docs.physical)} · ${formatMeasured(p.docs.legacy)}`),
      col("index", "Index", (p) => `${p.index.links} liên kết, ${p.index.commits} commit · ${formatMeasured(p.index.logical)}`),
      col("tickets", "Ticket/event", (p) => `${p.tickets.issues} issue, ${p.tickets.comments} comment, ${p.tickets.runs} run · comment ${formatMeasured(p.tickets.commentBytes)} · ${formatMeasured(p.tickets.physical)}`),
      col("attachments", "File đính kèm", (p) => `${p.attachments.count} file (${p.attachments.unsized} chưa có cỡ)${p.attachments.since ? ` từ ${time(p.attachments.since)}` : ""} · ${formatMeasured(p.attachments.logical)} · ${formatMeasured(p.attachments.physical)}`),
    ] }),
    h("h3", null, "Tổng company"),
    h("ul", null,
      h("li", null, `Docs vật lý: ${formatMeasured(company.docsPhysical)}`),
      h("li", null, `Docs dùng chung: ${formatMeasured(company.docsShared)}`),
      h("li", null, `Docs bản cũ: ${formatMeasured(company.docsLegacy)}`)),
    h("h3", null, "Bảng của plugin (toàn plugin, mọi company)"),
    h("ul", null, ...data.pluginTables.map((t) => h("li", { key: t.table }, `${t.table}: ${formatMeasured(t.total)}`))),
    h("h3", null, "Máy"),
    data.machines.length ? h("ul", null, ...data.machines.map((m) => h("li", { key: m.machineId },
      m.attachmentCache
        ? `${m.hostname}: cache ${formatBytes(m.attachmentCache.blobBytes)} / ${formatBytes(m.attachmentCache.limitBytes)} · ${m.attachmentCache.blobs} blob · ${m.attachmentCache.runs} run · đo lúc ${time(m.attachmentCache.measuredAt)}`
        : `${m.hostname}: Chưa đo`))) : h("p", null, "Chưa có máy nào báo cáo."),
    h("p", null, "Logic = tổng theo từng ảnh chụp; vật lý = thực sự chiếm chỗ sau khử trùng; không cộng vật lý của các nhóm khi có nhóm chưa đo."));
}

registerPageSection({ id: "storage", title: "Dung lượng", order: 40, component: StorageSection });
