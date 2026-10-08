import type { MapProjection } from "./project.js";

export type Point = { x: number; y: number };
export const cardWidth = 280;
export const cardHeight = 88;
export const columnGap = 56;
export const rowGap = 16;

/** v2 hierarchy layout: only parent edges affect position; dependency and repair are overlays. */
export function layoutHierarchy(input: MapProjection): Record<string, Point> {
  const ids = new Set(input.nodes.map((node) => node.id));
  const children = new Map<string, string[]>();
  const parent = new Map<string, string>();
  for (const edge of input.edges) {
    if (edge.kind !== "parent" || !ids.has(edge.source) || !ids.has(edge.target)) continue;
    parent.set(edge.target, edge.source);
    const list = children.get(edge.source) ?? [];
    list.push(edge.target);
    children.set(edge.source, list);
  }
  for (const list of children.values()) list.sort();
  const positions: Record<string, Point> = {};
  const visited = new Set<string>();
  let cursor = 0;
  const place = (start: string, depth: number) => {
    type Frame = { id: string; depth: number; next: number; placed: string[] };
    const stack: Frame[] = [{ id: start, depth, next: 0, placed: [] }];
    visited.add(start);
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const list = children.get(frame.id) ?? [];
      if (frame.next < list.length) {
        const child = list[frame.next++]!;
        if (visited.has(child)) continue;
        visited.add(child);
        frame.placed.push(child);
        stack.push({ id: child, depth: frame.depth + 1, next: 0, placed: [] });
        continue;
      }
      stack.pop();
      const first = frame.placed[0];
      const last = frame.placed[frame.placed.length - 1];
      positions[frame.id] = {
        x: frame.depth * (cardWidth + columnGap),
        y: first && last ? ((positions[first]?.y ?? 0) + (positions[last]?.y ?? 0)) / 2 : cursor,
      };
      if (!first) cursor += cardHeight + rowGap;
    }
  };
  if (ids.has(input.rootId)) place(input.rootId, 0);
  if (visited.size < ids.size) cursor += cardHeight + rowGap;
  for (const node of input.nodes) {
    if (visited.has(node.id)) continue;
    const seen = new Set([node.id]);
    let top = node.id;
    for (let up = parent.get(top); up && !seen.has(up) && !visited.has(up); up = parent.get(up)) {
      seen.add(up);
      top = up;
    }
    place(top, 0);
  }
  return positions;
}
