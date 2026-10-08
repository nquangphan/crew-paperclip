import { createElement as h } from "react";
import { Handle, Position } from "@xyflow/react";
import type { CrewMapNode } from "../../handlers/map.js";

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    backlog: "Chưa lên lịch", todo: "Cần làm", in_progress: "Đang làm",
    in_review: "Đang duyệt", blocked: "Bị chặn", done: "Hoàn tất", cancelled: "Đã hủy",
  };
  return labels[status] ?? "Không rõ";
}

export function stageLabel(node: Pick<CrewMapNode, "stage" | "kind">): string {
  if (!node.stage) return "Chưa có stage";
  if (!node.stage.currentType) return node.stage.completed.length ? "Đã xong" : "Chưa bắt đầu";
  if (node.stage.position === null) return "Không rõ";
  const index = node.stage.position;
  const labels = node.kind === "research"
    ? ["Reviewer", "Owner duyệt"]
    : ["Reviewer", "Integrator · merge + docs", "Owner duyệt", "Integrator · push"];
  return labels[index] ?? (node.stage.currentType === "approval" ? "Owner duyệt" : "Đang duyệt");
}

export function TicketNode({ data }: { data: { issue: CrewMapNode; highlighted: boolean; link: Record<string, unknown> } }) {
  const { issue, highlighted, link } = data;
  const kind = issue.kind === "fix" ? "Sửa" : issue.kind === "research" ? "Nghiên cứu" : "Lập trình";
  const meta = [kind, statusLabel(issue.status), `Giai đoạn: ${stageLabel(issue)}`].join(" · ");
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
