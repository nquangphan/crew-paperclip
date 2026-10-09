import { createElement as h, useRef, useState } from "react";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import { ErrorBoundary, Spinner, useHostNavigation, usePluginData } from "@paperclipai/plugin-sdk/ui";
import css from "@xyflow/react/dist/style.css";
import type { DocsGraph, GraphNodeKind } from "../../docs/graph.js";
import { EDGE_KIND_LABEL, filterGraph, type FlowOptions, flowOptions, flowsOfFile, layoutGraph, manifestNotice, NODE_KIND_LABEL, nodeLabel, TRUNCATED_NOTICE } from "./model.js";

const KINDS = Object.keys(NODE_KIND_LABEL) as GraphNodeKind[];
const graphCss = `
.crew-docs-graph { height: 30rem; width: 100%; border: 1px solid var(--border); border-radius: var(--radius); background: var(--background); }
.crew-docs-graph .react-flow { --xy-background-color: var(--background); --xy-node-background-color: var(--card); --xy-node-color: var(--card-foreground); --xy-edge-stroke: var(--border); }
.crew-docs-graph .react-flow__node { font-size: 0.75rem; width: 220px; }
`;
const alertStyle = { border: "1px solid var(--destructive)", borderRadius: "var(--radius)", padding: "0.75rem" };

function GraphContent({ projectId, snapshotId, onOpenPage }: { projectId: string; snapshotId?: string; onOpenPage: (path: string) => void }) {
  const navigation = useHostNavigation();
  const [flowId, setFlowId] = useState<string>("");
  const [kinds, setKinds] = useState<ReadonlySet<GraphNodeKind>>(new Set(KINDS));
  const [fileId, setFileId] = useState<string | null>(null);
  const knownFlows = useRef<FlowOptions | null>(null);
  const result = usePluginData<DocsGraph | null>("crew.docs.graph", { projectId, snapshotId, flowId: flowId || undefined });
  if (result.loading) return h("p", { role: "status" }, h(Spinner, null), " Đang tải đồ thị docs…");
  if (result.error) return h("p", { role: "alert" }, `Không tải được đồ thị docs: ${result.error.message}`);
  const graph = result.data;
  if (!graph) return h("p", { role: "status" }, "Dự án chưa có đồ thị docs.");

  const visible = filterGraph(graph, kinds);
  const laidOut = layoutGraph(visible.nodes, visible.edges);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes = laidOut.map((node) => ({
    id: node.id, position: { x: node.x, y: node.y }, data: { label: nodeLabel(node) },
    draggable: false, selectable: true, style: node.missing ? { borderStyle: "dashed", opacity: 0.7 } : undefined,
  }));
  const edges = visible.edges.map((edge) => ({
    id: edge.id, source: edge.from, target: edge.to,
    label: edge.kind === "ticket-flow" && edge.files ? `${EDGE_KIND_LABEL[edge.kind]} (${edge.files} file)` : EDGE_KIND_LABEL[edge.kind],
  }));
  knownFlows.current = flowOptions(knownFlows.current, graph);
  const flows = knownFlows.current.options;
  const notice = manifestNotice(graph.snapshot.manifestState);
  const picked = fileId ? byId.get(fileId) : undefined;

  const onNodeClick = (_event: unknown, flowNode: { id: string }) => {
    const node = byId.get(flowNode.id);
    if (!node) return;
    setFileId(node.kind === "file" ? node.id : null);
    if (node.kind === "page" && node.ref.path) onOpenPage(node.ref.path);
    else if (node.kind === "flow" && node.ref.flowId) setFlowId(node.ref.flowId);
    else if (node.kind === "ticket") {
      const target = node.ref.identifier || node.ref.issueId;
      if (target) navigation.navigate(`/issues/${target}`);
    }
  };

  return h("section", { "aria-label": "Đồ thị docs" },
    h("style", null, css, graphCss),
    h("fieldset", null, h("legend", null, "Loại node"),
      ...KINDS.map((kind) => h("label", { key: kind, style: { marginRight: "0.75rem" } },
        h("input", { type: "checkbox", checked: kinds.has(kind), onChange: () => {
          const next = new Set(kinds); if (next.has(kind)) next.delete(kind); else next.add(kind); setKinds(next);
        } }), ` ${NODE_KIND_LABEL[kind]}`))),
    h("label", null, "Flow ", h("select", { value: flowId, onChange: (e: { target: { value: string } }) => { setFlowId(e.target.value); setFileId(null); } },
      h("option", { value: "" }, "Tất cả flow"),
      ...flows.map((flow) => h("option", { key: flow.flowId, value: flow.flowId }, flow.label)))),
    notice ? h("p", { role: "status" }, notice) : null,
    h("div", { className: "crew-docs-graph" },
      h(ReactFlow, { nodes, edges, onNodeClick, nodesConnectable: false, nodesDraggable: false, zoomOnDoubleClick: false, minZoom: 0.2, maxZoom: 2, fitView: true },
        h(Background, null), h(Controls, { showInteractive: false }))),
    picked ? h("p", { role: "status" }, `${picked.label} thuộc flow: ${flowsOfFile(graph, picked.id).join(", ") || "không có"}`) : null,
    graph.truncated === "files" ? h("p", { role: "status" }, TRUNCATED_NOTICE) : null,
    h("p", null, graph.notice));
}

export function DocsGraphView(props: { projectId: string; snapshotId?: string; onOpenPage: (path: string) => void }) {
  return h(ErrorBoundary, { fallback: h("div", { role: "alert", style: alertStyle }, "Không hiển thị được đồ thị docs."), children: h(GraphContent, props) });
}
