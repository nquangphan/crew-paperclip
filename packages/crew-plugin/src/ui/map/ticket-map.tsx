import { createElement as h } from "react";
import { Background, Controls, MarkerType, ReactFlow } from "@xyflow/react";
import { useHostNavigation, ErrorBoundary } from "@paperclipai/plugin-sdk/ui";
import css from "@xyflow/react/dist/style.css";
import type { CrewMap } from "../../handlers/map.js";
import { layoutHierarchy } from "./layout.js";
import { projectCrewMap } from "./project.js";
import { ticketEdgeTypes, edgeKinds } from "./ticket-edge.js";
import { TicketNode } from "./ticket-node.js";

const crewCss = `
.crew-map { height: 34rem; min-height: 25rem; width: 100%; border: 1px solid var(--border); border-radius: var(--radius); background: var(--background); }
.crew-map .react-flow { --xy-background-color: var(--background); --xy-node-background-color: var(--card); --xy-node-color: var(--card-foreground); --xy-edge-stroke: var(--border); --xy-handle-background-color: var(--primary); --xy-handle-border-color: var(--card); }
.crew-map-node { width: 280px; min-height: 88px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); color: var(--card-foreground); box-shadow: var(--shadow-sm); }
.crew-map-node-current { outline: 3px solid var(--primary); outline-offset: 2px; }
.crew-map-node-link { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.5rem 0.75rem; color: inherit; text-decoration: none; }
.crew-map-node-link:hover { text-decoration: underline; }
.crew-map-node-link strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crew-map-node-link span { color: var(--muted-foreground); font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crew-map-edge-parent { stroke: var(--border); stroke-width: 2; }
.crew-map-edge-dependency { stroke: var(--primary); stroke-width: 2; stroke-dasharray: 5 4; }
.crew-map-edge-repair { stroke: var(--chart-4, var(--primary)); stroke-width: 2; stroke-dasharray: 2 4; }
.crew-map .react-flow__node { border: 0; background: transparent; padding: 0; }
`;

function readViewport(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      if ([v.x, v.y, v.zoom].every((number) => typeof number === "number" && Number.isFinite(number))
        && (v.zoom as number) > 0 && (v.zoom as number) <= 4) return v as { x: number; y: number; zoom: number };
    }
  } catch { /* Storage may be unavailable. */ }
  return { x: 24, y: 180, zoom: 1 };
}

function saveViewport(key: string, viewport: { x: number; y: number; zoom: number }) {
  try { localStorage.setItem(key, JSON.stringify(viewport)); } catch { /* Storage may be unavailable. */ }
}

function MapContent({ map, currentIssueId }: { map: CrewMap; currentIssueId: string }) {
  const navigation = useHostNavigation();
  const projection = projectCrewMap(map);
  const positions = layoutHierarchy(projection);
  const nodes = projection.nodes.map((issue) => ({
    id: issue.id, type: "ticket", position: positions[issue.id] ?? { x: 0, y: 0 },
    data: { issue, highlighted: issue.id === currentIssueId, link: navigation.linkProps(`/issues/${issue.id}`) },
    draggable: false, selectable: false,
  }));
  const edges = projection.edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, type: edge.kind,
    data: { label: edge.label ?? edgeKinds[edge.kind].label },
    markerEnd: edge.kind === "parent" ? undefined : { type: MarkerType.ArrowClosed },
    animated: false,
  }));
  const key = `crew-map-viewport:${map.root.id}`;
  return h("section", { "aria-label": "Bản đồ yêu cầu Crew" },
    h("style", null, css, crewCss),
    h("div", { className: "crew-map" },
      h(ReactFlow, {
        nodes, edges, nodeTypes: { ticket: TicketNode }, edgeTypes: ticketEdgeTypes,
        defaultViewport: readViewport(key), onMoveEnd: (_event: unknown, viewport: { x: number; y: number; zoom: number }) => saveViewport(key, viewport),
        nodesConnectable: false, nodesDraggable: false, elementsSelectable: false, zoomOnDoubleClick: false,
        minZoom: 0.3, maxZoom: 2,
      }, h(Background, null), h(Controls, { showInteractive: false })),
    ),
    projection.diagnostics.length ? h("div", { role: "status" }, ...projection.diagnostics.map((message) => h("p", { key: message }, message))) : null,
  );
}

export function TicketMap(props: { map: CrewMap; currentIssueId: string }) {
  return h(ErrorBoundary, { fallback: h("div", { role: "alert", style: { border: "1px solid var(--destructive)", borderRadius: "var(--radius)", padding: "0.75rem" } }, "Không hiển thị được bản đồ Crew."), children: h(MapContent, props) });
}
