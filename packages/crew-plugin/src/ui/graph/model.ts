import type { DocsGraph, GraphEdge, GraphEdgeKind, GraphNode, GraphNodeKind } from "../../docs/graph.js";
import type { DocsState } from "../../docs/status.js";
import type { ManifestState } from "../../docs/webhook.js";

const COLUMN: Record<GraphNodeKind, number> = { project: 0, flow: 1, page: 2, file: 3, ticket: 4 };
const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 64;

export const NODE_KIND_LABEL: Record<GraphNodeKind, string> = {
  project: "Dự án", flow: "Flow", page: "Trang", file: "File", ticket: "Ticket",
};
export const EDGE_KIND_LABEL: Record<GraphEdgeKind, string> = {
  "project-flow": "Dự án có flow", "flow-doc": "Flow có tài liệu", "flow-entrypoint": "Điểm vào của flow",
  "flow-file": "Flow có file", "flow-test": "Test của flow", "shared-file": "File dùng chung",
  "page-link": "Liên kết trang", "ticket-flow": "Ticket chạm flow",
};
export const DOCS_STATE_LABEL: Record<DocsState, string> = {
  missing: "Chưa có docs", unverified: "Chưa xác minh", invalid: "Không hợp lệ", stale: "Cũ hơn code", current: "Đúng với code",
};

/** Nhãn ticket là `<identifier> · <title>`; thiếu identifier thì chỉ hiện title. */
export function nodeLabel(node: GraphNode): string {
  return node.kind === "ticket" && node.label.startsWith(" · ") ? node.label.slice(3) : node.label;
}

export function filterGraph(graph: Pick<DocsGraph, "nodes" | "edges">, kinds: ReadonlySet<GraphNodeKind>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = graph.nodes.filter((node) => kinds.has(node.kind));
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) };
}

export function layoutGraph(nodes: GraphNode[], _edges: GraphEdge[]): Array<GraphNode & { x: number; y: number }> {
  const rows = new Map<GraphNodeKind, number>();
  return nodes.map((node) => {
    const row = rows.get(node.kind) ?? 0;
    rows.set(node.kind, row + 1);
    return { ...node, x: COLUMN[node.kind] * COLUMN_WIDTH, y: row * ROW_HEIGHT };
  });
}

export const TRUNCATED_NOTICE = "Quá nhiều node, đã ẩn file; chọn một flow để xem file.";

const MANIFEST_NOTICE: Record<Exclude<ManifestState, "ok">, string> = {
  not_sent: "Máy chưa gửi docs/flows.yaml (cần crew-mac mới).",
  absent: "Repo không có docs/flows.yaml.",
  invalid: "docs/flows.yaml không hợp lệ.",
  dropped: "docs/flows.yaml bị bỏ do secret-scan hoặc quá lớn.",
};

export function manifestNotice(state: ManifestState): string | null {
  return state === "ok" ? null : MANIFEST_NOTICE[state];
}

/** Nhãn các flow có cạnh tới file (cạnh flow-file, flow-test, shared-file...). */
export function flowsOfFile(graph: Pick<DocsGraph, "nodes" | "edges">, fileId: string): string[] {
  const flows = new Map(graph.nodes.filter((node) => node.kind === "flow").map((node) => [node.id, node.label]));
  return graph.edges.filter((edge) => edge.to === fileId && flows.has(edge.from)).map((edge) => flows.get(edge.from) as string);
}

export interface FlowOption { flowId: string; label: string }
export interface FlowOptions { snapshotId: string; options: FlowOption[] }

/**
 * Lựa chọn của ô Flow. Server chỉ trả flow đang chọn khi đã thu hẹp, nên giữ danh sách của lần xem "Tất cả flow"
 * cùng ảnh chụp; đổi ảnh chụp thì chỉ tin những gì server vừa trả.
 */
export function flowOptions(previous: FlowOptions | null, graph: Pick<DocsGraph, "snapshot" | "flowId" | "nodes">): FlowOptions {
  const current = graph.nodes.filter((node) => node.kind === "flow" && node.ref.flowId)
    .map((node) => ({ flowId: node.ref.flowId as string, label: node.label }));
  const snapshotId = graph.snapshot.snapshotId;
  if (graph.flowId === null || !previous || previous.snapshotId !== snapshotId) return { snapshotId, options: current };
  const known = new Set(previous.options.map((option) => option.flowId));
  return { snapshotId, options: [...previous.options, ...current.filter((option) => !known.has(option.flowId))] };
}
