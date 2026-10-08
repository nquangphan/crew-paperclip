import type { CrewMap, CrewMapNode } from "../../handlers/map.js";

export type MapEdge = { id: string; source: string; target: string; kind: "parent" | "dependency" | "repair"; label?: string };
export type MapProjection = { rootId: string; nodes: CrewMapNode[]; edges: MapEdge[]; diagnostics: string[] };

/** The worker supplies every relation. This projection only checks endpoints and gives edges stable IDs. */
export function projectCrewMap(input: CrewMap): MapProjection {
  const nodes = [...input.nodes].sort((a, b) => a.identifier.localeCompare(b.identifier, "vi") || a.id.localeCompare(b.id));
  const ids = new Set(nodes.map((node) => node.id));
  const diagnostics = [...input.diagnostics];
  const counts = new Map<string, number>();
  const edges: MapEdge[] = [];
  for (const edge of input.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      diagnostics.push(`Quan hệ ${edge.kind} thiếu issue: ${edge.from} → ${edge.to}`);
      continue;
    }
    const base = `${edge.kind}:${edge.from}:${edge.to}`;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    edges.push({ id: count ? `${base}:${count}` : base, source: edge.from, target: edge.to, kind: edge.kind, label: edge.label });
  }
  return { rootId: input.root.id, nodes, edges, diagnostics };
}
