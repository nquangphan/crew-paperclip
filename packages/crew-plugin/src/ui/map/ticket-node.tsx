import { createElement as h } from "react";
import { Handle, Position } from "@xyflow/react";
import type { CrewMapNode } from "../../handlers/map.js";

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    backlog: "Chưa lên lịch", todo: "Cần làm", in_progress: "Đang làm",
    in_review: "Đang duyệt", blocked: "Bị chặn", done: "Hoàn tất", cancelled: "Đã hủy",
  };
  return labels[status] ?? status;
}

export function stageLabel(node: CrewMapNode): string {
  if (!node.stage) return "Chưa có stage";
  return node.stage.currentType ?? (node.stage.completed.length ? "Đã xong" : "Chưa bắt đầu");
}

export function TicketNode({ data }: { data: { issue: CrewMapNode; highlighted: boolean; link: Record<string, unknown> } }) {
  const { issue, highlighted, link } = data;
  const kind = issue.kind === "fix" ? "Sửa" : issue.kind === "research" ? "Nghiên cứu" : "Code";
  const meta = [kind, statusLabel(issue.status), `Stage: ${stageLabel(issue)}`].join(" · ");
  return h("div", {
    className: `crew-map-node${highlighted ? " crew-map-node-current" : ""}`,
    "data-issue-id": issue.id,
  },
    h(Handle, { type: "target", position: Position.Left, isConnectable: false }),
    h("a", { ...link, className: "crew-map-node-link", "aria-label": `${issue.identifier}: ${issue.title}. ${meta}` },
      h("strong", null, `${issue.identifier} · ${issue.title}`),
      h("span", null, meta),
      h("span", null, `Người làm: ${issue.assignee?.name ?? "Chưa giao"} · Vòng sửa: ${issue.reviewRounds}/${issue.maxReviewRounds}${issue.bundle ? ` · Bundle ${issue.bundle.id} #${issue.bundle.seq}` : ""}`),
    ),
    h(Handle, { type: "source", position: Position.Right, isConnectable: false }),
  );
}
