import { createElement as h } from "react";
import { ErrorBoundary, Spinner, usePluginData, type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import type { CrewMap } from "../handlers/map.js";
import { TicketMap } from "./map/ticket-map.js";
import { getIssuePanels } from "./registry.js";

const alertStyle = { border: "1px solid var(--destructive)", borderRadius: "var(--radius)", padding: "0.75rem" };

export function CrewIssueTab({ context }: PluginDetailTabProps) {
  const { data, loading, error } = usePluginData<CrewMap>("crew.map", { issueId: context.entityId });
  if (loading) return h("div", { role: "status" }, h(Spinner, null), " Đang tải bản đồ Crew…");
  if (error) return h("div", { role: "alert", style: alertStyle }, `Không tải được bản đồ Crew: ${error.message}`);
  if (!data) return h("div", { role: "status" }, "Chưa có dữ liệu Crew.");
  if (data.diagnostics.includes("not_crew_root")) return h("div", { role: "status" }, "Issue này chưa có quy trình Crew.");
  const current = data.nodes.find((node) => node.id === context.entityId);
  return h("section", { "aria-label": "Crew" },
    h("h2", null, "Bản đồ yêu cầu"),
    current && current.id !== data.root.id
      ? h("p", null, `Đang xem ${current.identifier} trong yêu cầu ${data.root.identifier}`) : null,
    h(TicketMap, { map: data, currentIssueId: context.entityId }),
    ...getIssuePanels().map((panel) => h("section", { key: panel.id, "aria-label": panel.id },
      h(ErrorBoundary, { fallback: h("div", { role: "alert", style: alertStyle }, "Không hiển thị được phần thông tin Crew."), children: h(panel.component, { issueId: data.root.id, companyId: context.companyId ?? "" }) }))),
  );
}
