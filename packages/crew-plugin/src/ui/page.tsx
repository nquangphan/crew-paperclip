import { createElement as h } from "react";
import { DataTable, ErrorBoundary, Spinner, useHostNavigation, usePluginData, type PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import type { CrewRoot } from "../handlers/roots.js";
import { getPageSections } from "./registry.js";
import { statusLabel, stageLabel } from "./map/ticket-node.js";

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
  const root = (row: Record<string, unknown>) => row as unknown as CrewRoot;
  return h(DataTable, {
    rows: data as unknown as Record<string, unknown>[],
    columns: [
      { key: "identifier", header: "Yêu cầu", render: (_: unknown, row: Record<string, unknown>) =>
        h("a", { ...navigation.linkProps(`/issues/${root(row).id}`) }, `${root(row).identifier} · ${root(row).title}`) },
      { key: "status", header: "Trạng thái", render: (_: unknown, row: Record<string, unknown>) => statusLabel(root(row).status) },
      { key: "stage", header: "Giai đoạn", render: (_: unknown, row: Record<string, unknown>) =>
        stageLabel({ kind: root(row).kind, stage: root(row).stage }) },
      { key: "doneChildren", header: "Issue con hoàn tất", render: (_: unknown, row: Record<string, unknown>) =>
        `${root(row).doneChildren}/${root(row).totalChildren}` },
      { key: "updatedAt", header: "Cập nhật", render: (_: unknown, row: Record<string, unknown>) => dateLabel(root(row).updatedAt) },
    ],
    emptyMessage: "Chưa có yêu cầu Crew đang mở.",
  });
}

function GuideLink() {
  const navigation = useHostNavigation();
  return h("p", null, h("a", { ...navigation.linkProps("/huong-dan") }, "Xem hướng dẫn"));
}

export function CrewPage({ context }: PluginPageProps) {
  if (!context.companyId) return h("div", { role: "status" }, "Chọn company để xem Crew.");
  return h("main", { "aria-label": "Trang Crew" },
    h("h1", null, "Crew"),
    h(GuideLink, null),
    h("section", { "aria-label": "Yêu cầu" },
      h("h2", null, "Yêu cầu"),
      h(ErrorBoundary, { fallback: h("div", { role: "alert", style: alertStyle }, "Không hiển thị được yêu cầu Crew."), children: h(Requests, { companyId: context.companyId }) })),
    ...getPageSections().map((section) => h("section", { key: section.id, "aria-label": section.title },
      h("h2", null, section.title),
      h(ErrorBoundary, { fallback: h("div", { role: "alert", style: alertStyle }, `Không hiển thị được mục ${section.title}.`), children: h(section.component, { companyId: context.companyId! }) }))),
  );
}
