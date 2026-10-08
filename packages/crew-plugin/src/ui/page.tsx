import { createElement as h } from "react";
import { DataTable, ErrorBoundary, Spinner, useHostNavigation, usePluginData, type PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import type { CrewRoot } from "../handlers/roots.js";
import { getPageSections } from "./registry.js";

const alertStyle = { border: "1px solid var(--destructive)", borderRadius: "var(--radius)", padding: "0.75rem" };

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
}

function Requests({ companyId }: { companyId: string }) {
  const navigation = useHostNavigation();
  const { data, loading, error } = usePluginData<CrewRoot[]>("crew.roots", { companyId, status: "open" });
  if (loading) return h("div", { role: "status" }, h(Spinner, null), " Đang tải yêu cầu…");
  if (error) return h("div", { role: "alert", style: alertStyle }, `Không tải được yêu cầu: ${error.message}`);
  if (!data) return h("div", { role: "status" }, "Chưa có dữ liệu yêu cầu.");
  return h(DataTable, {
    rows: data,
    columns: [
      { key: "identifier", header: "Yêu cầu", render: (_: unknown, row: CrewRoot) =>
        h("a", { ...navigation.linkProps(`/issues/${row.id}`) }, `${row.identifier} · ${row.title}`) },
      { key: "status", header: "Trạng thái" },
      { key: "stage", header: "Stage", render: (_: unknown, row: CrewRoot) =>
        row.stage?.currentType ?? (row.stage?.completed.length ? "Đã xong" : "Chưa bắt đầu") },
      { key: "doneChildren", header: "Issue con hoàn tất", render: (_: unknown, row: CrewRoot) =>
        `${row.doneChildren}/${row.totalChildren}` },
      { key: "updatedAt", header: "Cập nhật", render: (_: unknown, row: CrewRoot) => dateLabel(row.updatedAt) },
    ],
    emptyMessage: "Chưa có yêu cầu Crew đang mở.",
  });
}

export function CrewPage({ context }: PluginPageProps) {
  if (!context.companyId) return h("div", { role: "status" }, "Chọn company để xem Crew.");
  return h("main", { "aria-label": "Trang Crew" },
    h("h1", null, "Crew"),
    h("section", { "aria-label": "Yêu cầu" },
      h("h2", null, "Yêu cầu"),
      h(ErrorBoundary, { fallback: h("div", { role: "alert", style: alertStyle }, "Không hiển thị được yêu cầu Crew.") },
        h(Requests, { companyId: context.companyId }))),
    ...getPageSections().map((section) => h("section", { key: section.id, "aria-label": section.title },
      h("h2", null, section.title),
      h(ErrorBoundary, { fallback: h("div", { role: "alert", style: alertStyle }, `Không hiển thị được mục ${section.title}.`) },
        h(section.component, { companyId: context.companyId! })))),
  );
}
