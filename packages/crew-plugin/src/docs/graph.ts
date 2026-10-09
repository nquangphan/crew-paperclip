import type { FlowsManifestOk } from "./manifest.js";
import type { ManifestState } from "./webhook.js";

export type GraphNodeKind = "project" | "flow" | "page" | "file" | "ticket";
export type GraphEdgeKind = "project-flow" | "flow-doc" | "flow-entrypoint" | "flow-file" | "flow-test" | "shared-file" | "page-link" | "ticket-flow";
export interface GraphNode { id: string; kind: GraphNodeKind; label: string;
  ref: { path?: string; flowId?: string; issueId?: string; identifier?: string; status?: string; projectId?: string }; missing?: true }
export interface GraphEdge { id: string; kind: GraphEdgeKind; from: string; to: string; files?: number }
export const GRAPH_NOTICE = "Đồ thị lấy từ docs/flows.yaml, liên kết Markdown và commit của ticket; không phải call graph hay bằng chứng hành vi khi chạy." as const;
export interface GraphInput {
  projectId: string; projectName: string;
  pages: Array<{ path: string; title: string }>;
  links: Array<{ fromPath: string; toPath: string | null; status: string }>;
  manifest: FlowsManifestOk | null;
  tickets: Array<{ issueId: string; identifier: string; title: string; status: string; paths: string[] }>;
  flowId: string | null; maxNodes: number;
}

export interface DocsGraph {
  snapshot: { snapshotId: string; commit: string; receivedAt: string; auditState: string; manifestState: ManifestState };
  nodes: GraphNode[]; edges: GraphEdge[]; truncated: null | "files"; flowId: string | null; notice: typeof GRAPH_NOTICE;
}

export function buildDocsGraph(input: GraphInput) {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const node = (n: GraphNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id; };
  const edge = (kind: GraphEdgeKind, from: string, to: string, files?: number) => {
    const id = `${kind}:${from}->${to}`;
    edges.set(id, files === undefined ? { id, kind, from, to } : { id, kind, from, to, files });
  };
  const pageTitles = new Map(input.pages.map((p) => [p.path, p.title]));
  const pageNode = (path: string) => node(pageTitles.has(path)
    ? { id: `page:${path}`, kind: "page", label: pageTitles.get(path)!, ref: { path } }
    : { id: `page:${path}`, kind: "page", label: path, ref: { path }, missing: true });
  const fileNode = (path: string) => node({ id: `file:${path}`, kind: "file", label: path, ref: { path } });
  const project = node({ id: `project:${input.projectId}`, kind: "project", label: input.projectName, ref: { projectId: input.projectId } });

  const flows = (input.manifest?.flows ?? []).filter((f) => input.flowId === null || f.id === input.flowId);
  const keepFlow = new Set(flows.map((f) => f.id));
  const fileFlows = new Map<string, Set<string>>();
  const own = (path: string, flowId: string) => { if (!fileFlows.has(path)) fileFlows.set(path, new Set()); fileFlows.get(path)!.add(flowId); };
  for (const flow of flows) {
    const id = node({ id: `flow:${flow.id}`, kind: "flow", label: flow.title, ref: { flowId: flow.id } });
    edge("project-flow", project, id);
    edge("flow-doc", id, pageNode(flow.doc));
    for (const [kind, list] of [["flow-entrypoint", flow.entrypoints], ["flow-file", flow.files], ["flow-test", flow.tests]] as const) {
      for (const path of list) { edge(kind, id, fileNode(path)); own(path, flow.id); }
    }
  }
  for (const item of input.manifest?.shared ?? []) {
    for (const flowId of item.flows) if (keepFlow.has(flowId)) { edge("shared-file", fileNode(item.path), `flow:${flowId}`); own(item.path, flowId); }
  }
  if (input.flowId === null) for (const page of input.pages) pageNode(page.path);
  const docPages = new Set(flows.map((f) => `page:${f.doc}`));
  for (const link of input.links) {
    if (link.status !== "ok" || !link.toPath) continue;
    const from = `page:${link.fromPath}`;
    if (input.flowId !== null && !docPages.has(from)) continue;
    edge("page-link", pageNode(link.fromPath), pageNode(link.toPath));
  }
  if (input.manifest) for (const t of input.tickets) {
    const counts = new Map<string, number>();
    for (const path of new Set(t.paths)) for (const flowId of fileFlows.get(path) ?? []) counts.set(flowId, (counts.get(flowId) ?? 0) + 1);
    if (counts.size === 0) continue;
    const id = node({ id: `ticket:${t.issueId}`, kind: "ticket", label: `${t.identifier} · ${t.title}`,
      ref: { issueId: t.issueId, identifier: t.identifier, status: t.status } });
    for (const [flowId, files] of [...counts].sort()) edge("ticket-flow", id, `flow:${flowId}`, files);
  }
  let truncated: null | "files" = null;
  let outNodes = [...nodes.values()];
  let outEdges = [...edges.values()];
  if (input.flowId === null && outNodes.length > input.maxNodes) {
    truncated = "files";
    outNodes = outNodes.filter((n) => n.kind !== "file");
    const ids = new Set(outNodes.map((n) => n.id));
    outEdges = outEdges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }
  return { nodes: outNodes, edges: outEdges, truncated, flowId: input.flowId, notice: GRAPH_NOTICE };
}
