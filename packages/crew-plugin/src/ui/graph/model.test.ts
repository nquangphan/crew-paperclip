import { expect, it } from "vitest";
import { DOCS_STATE_LABEL, filterGraph, flowOptions, flowsOfFile, layoutGraph, manifestNotice, nodeLabel } from "./model.js";

const graph = { nodes: [
  { id: "project:p", kind: "project", label: "P", ref: {} }, { id: "flow:a", kind: "flow", label: "A", ref: {} },
  { id: "page:x", kind: "page", label: "X", ref: {} }, { id: "file:f", kind: "file", label: "f", ref: {} },
  { id: "ticket:t", kind: "ticket", label: "T", ref: {} }, { id: "flow:b", kind: "flow", label: "B", ref: {} } ],
  edges: [{ id: "e1", kind: "project-flow", from: "project:p", to: "flow:a" }, { id: "e2", kind: "flow-file", from: "flow:a", to: "file:f" },
          { id: "e3", kind: "ticket-flow", from: "ticket:t", to: "flow:a", files: 1 }] } as never as Parameters<typeof filterGraph>[0];

it("filters by kind without dangling edges", () => {
  const out = filterGraph(graph, new Set(["project", "flow", "ticket"]));
  expect(out.nodes.map((n) => n.id)).toEqual(["project:p", "flow:a", "ticket:t", "flow:b"]);
  expect(out.edges.map((e) => e.id)).toEqual(["e1", "e3"]);
});
it("lays out columns by kind, rows by order", () => {
  const pos = Object.fromEntries(layoutGraph(graph.nodes, graph.edges).map((n) => [n.id, [n.x, n.y]]));
  expect(pos["project:p"]).toEqual([0, 0]); expect(pos["flow:a"]).toEqual([260, 0]); expect(pos["flow:b"]).toEqual([260, 64]);
  expect(pos["page:x"]).toEqual([520, 0]); expect(pos["file:f"]).toEqual([780, 0]); expect(pos["ticket:t"]).toEqual([1040, 0]);
});
it("state labels", () => {
  expect(DOCS_STATE_LABEL).toEqual({ missing: "Chưa có docs", unverified: "Chưa xác minh", invalid: "Không hợp lệ", stale: "Cũ hơn code", current: "Đúng với code" });
});
it("falls back to title when a ticket label lacks an identifier", () => {
  expect(nodeLabel({ id: "t", kind: "ticket", label: " · Sửa lỗi", ref: {} })).toBe("Sửa lỗi");
  expect(nodeLabel({ id: "t", kind: "ticket", label: "TPS-1 · Sửa lỗi", ref: {} })).toBe("TPS-1 · Sửa lỗi");
  expect(nodeLabel({ id: "f", kind: "flow", label: "A", ref: {} })).toBe("A");
});

it("explains each manifest state except ok", () => {
  expect(manifestNotice("ok")).toBeNull();
  expect(manifestNotice("not_sent")).toBe("Máy chưa gửi docs/flows.yaml (cần crew-mac mới).");
  expect(manifestNotice("absent")).toBe("Repo không có docs/flows.yaml.");
  expect(manifestNotice("invalid")).toBe("docs/flows.yaml không hợp lệ.");
  expect(manifestNotice("dropped")).toBe("docs/flows.yaml bị bỏ do secret-scan hoặc quá lớn.");
});
it("lists the flows a file belongs to", () => {
  expect(flowsOfFile(graph, "file:f")).toEqual(["A"]);
  expect(flowsOfFile(graph, "file:none")).toEqual([]);
});

it("keeps every flow of the snapshot in the picker after narrowing to one flow", () => {
  const flow = (id: string, label: string) => ({ id: `flow:${id}`, kind: "flow", label, ref: { flowId: id } });
  const view = (snapshotId: string, flowId: string | null, flows: ReturnType<typeof flow>[]) =>
    ({ snapshot: { snapshotId }, flowId, nodes: [{ id: "project:p", kind: "project", label: "P", ref: {} }, ...flows] }) as never;
  const all = flowOptions(null, view("s1", null, [flow("a", "A"), flow("b", "B")]));
  expect(all.options).toEqual([{ flowId: "a", label: "A" }, { flowId: "b", label: "B" }]);
  const narrowed = flowOptions(all, view("s1", "a", [flow("a", "A")]));
  expect(narrowed.options.map((o) => o.flowId)).toEqual(["a", "b"]);
  // Another snapshot, or a narrowed first load, only knows what the server sent.
  expect(flowOptions(all, view("s2", "a", [flow("a", "A")])).options.map((o) => o.flowId)).toEqual(["a"]);
  expect(flowOptions(null, view("s1", "c", [flow("c", "C")])).options.map((o) => o.flowId)).toEqual(["c"]);
  expect(flowOptions(narrowed, view("s1", "c", [flow("c", "C")])).options.map((o) => o.flowId)).toEqual(["a", "b", "c"]);
});
