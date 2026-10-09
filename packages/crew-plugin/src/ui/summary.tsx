import { createElement as h, useState } from "react";
import { usePluginData, type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import type { CrewMap, CrewMapNode } from "../handlers/map.js";
import { DocsCheckPanel } from "./docs/index.js";
import { stageLabel, statusLabel } from "./map/ticket-node.js";
import { TicketMap } from "./map/ticket-map.js";
import { UsagePanel } from "./usage/index.js";

type DocsCheck = { invalid: true } | { invalid?: false; exit: number };

export function docsSummary(result: DocsCheck | null | undefined): string {
  if (!result) return "Chưa có";
  if (result.invalid) return "Không hợp lệ";
  return result.exit === 0 ? "Đạt" : "Lỗi";
}

export function crewSummaryLine(map: CrewMap, issueId: string, docs: DocsCheck | null | undefined): string {
  const children = map.nodes.filter((node) => node.parentId === map.root.id);
  const done = children.filter((node) => node.status === "done").length;
  const current = map.nodes.find((node) => node.id === issueId) ?? map.root;
  const stage = current.stage ? stageLabel(current as CrewMapNode) : statusLabel(current.status);
  return `Crew · ${done}/${children.length} con xong · ${stage || statusLabel(current.status)} · docs ${docsSummary(docs)}`;
}

export function CrewIssueSummaryContent({ map, issueId, companyId, docs, expanded, onToggle }: {
  map: CrewMap;
  issueId: string;
  companyId: string;
  docs: DocsCheck | null | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  return h("section", { "aria-label": "Tóm tắt Crew", className: "space-y-2" },
    h("div", { className: "flex flex-wrap items-center gap-2" },
      h("p", null, crewSummaryLine(map, issueId, docs)),
      h("button", { type: "button", "aria-expanded": expanded, onClick: onToggle }, expanded ? "Đóng map" : "Mở map")),
    expanded ? h("div", { className: "space-y-3" },
      h(TicketMap, { map, currentIssueId: issueId }),
      h(DocsCheckPanel, { issueId: map.root.id, companyId }),
      h(UsagePanel, { issueId: map.root.id, companyId })) : null,
  );
}

export function CrewIssueSummary({ context }: PluginDetailTabProps) {
  const [expanded, setExpanded] = useState(false);
  const { data } = usePluginData<CrewMap>("crew.map", { issueId: context.entityId, companyId: context.companyId });
  const docs = usePluginData<DocsCheck | null>("crew.docsCheck", { issueId: data?.root.id ?? "", companyId: context.companyId ?? "" });
  if (!data || data.diagnostics.includes("not_crew_root")) return null;
  return h(CrewIssueSummaryContent, {
    map: data,
    issueId: context.entityId,
    companyId: context.companyId ?? "",
    docs: docs.error ? { exit: 1 } : docs.data,
    expanded,
    onToggle: () => setExpanded((value) => !value),
  });
}
