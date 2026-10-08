import { createElement as h } from "react";
import {
  DataTable,
  Spinner,
  StatusBadge,
  usePluginData,
  type PluginDetailTabProps,
} from "@paperclipai/plugin-sdk/ui";
import type { CrewMap, CrewMapNode } from "../handlers/map.js";

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    backlog: "Chưa lên lịch",
    todo: "Cần làm",
    in_progress: "Đang làm",
    in_review: "Đang duyệt",
    blocked: "Bị chặn",
    done: "Hoàn tất",
    cancelled: "Đã hủy",
  };
  return labels[status] ?? status;
}

function stageLabel(node: CrewMapNode): string {
  if (!node.stage) return "—";
  if (node.stage.currentType) return node.stage.currentType;
  return node.stage.completed.length > 0 ? "Hoàn tất" : "—";
}

export function CrewIssueTab({ context }: PluginDetailTabProps) {
  const { data, loading, error } = usePluginData<CrewMap>("crew.map", { issueId: context.entityId });
  if (loading) return h("div", { role: "status" }, h(Spinner, null), " Đang tải bản đồ Crew…");
  if (error) return h("div", { role: "alert" }, `Không tải được bản đồ Crew: ${error.message}`);
  if (!data) return h("div", { role: "status" }, "Chưa có dữ liệu Crew.");
  if (data.diagnostics.includes("not_crew_root")) {
    return h("div", { role: "status" }, "Issue này chưa có quy trình Crew.");
  }
  const current = data.nodes.find((node) => node.id === context.entityId);
  const columns = [
    { key: "identifier", header: "Issue" },
    { key: "title", header: "Tiêu đề" },
    { key: "status", header: "Trạng thái", render: (_: unknown, row: CrewMapNode) =>
      h(StatusBadge, {
        label: statusLabel(row.status),
        status: row.status === "done" ? "ok" : row.status === "blocked" ? "error" : "info",
      }) },
    { key: "stage", header: "Stage", render: (_: unknown, row: CrewMapNode) => stageLabel(row) },
    { key: "reviewRounds", header: "Vòng sửa", render: (_: unknown, row: CrewMapNode) =>
      `${row.reviewRounds}/${row.maxReviewRounds}` },
  ];
  return h("section", { "aria-label": "Bản đồ Crew" },
    h("h2", null, "Bản đồ yêu cầu"),
    current && current.id !== data.root.id
      ? h("p", null, `Issue hiện tại: ${current.identifier} · Gốc: ${data.root.identifier}`) : null,
    h(DataTable, { columns, rows: data.nodes, emptyMessage: "Chưa có issue con." }),
    h("h3", null, "Quan hệ"),
    h("ul", null, ...data.edges.map((edge, index) =>
      h("li", { key: `${edge.kind}-${edge.from}-${edge.to}-${index}` },
        `${data.nodes.find((node) => node.id === edge.from)?.identifier ?? edge.from} → ${data.nodes.find((node) => node.id === edge.to)?.identifier ?? edge.to} · ${edge.kind}${edge.label ? ` · ${edge.label}` : ""}`))),
    ...data.diagnostics.map((item) => h("p", { key: item, role: "status" }, item)),
  );
}
