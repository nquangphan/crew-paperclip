import { describe, expect, it } from "vitest";
import { buildDocsGraph, GRAPH_NOTICE } from "../docs/graph.js";

const manifest = { state: "ok" as const,
  flows: [
    { id: "core", title: "Core", doc: "docs/flows/core.md", entrypoints: ["src/main.ts"], files: ["src/a.ts"], tests: ["test/a.test.ts"] },
    { id: "ui", title: "UI", doc: "docs/flows/ui-missing.md", entrypoints: [], files: ["src/ui.ts"], tests: [] },
  ],
  shared: [{ path: "src/shared.ts", flows: ["core", "ui"] }] };
const input = {
  projectId: "p1", projectName: "Repo A",
  pages: [{ path: "docs/index.md", title: "Mục lục" }, { path: "docs/flows/core.md", title: "Core" }],
  links: [{ fromPath: "docs/index.md", toPath: "docs/flows/core.md", status: "ok" }, { fromPath: "docs/index.md", toPath: "docs/x.md", status: "missing" }],
  manifest,
  tickets: [{ issueId: "i1", identifier: "TPS-1", title: "Sửa core", status: "done", paths: ["src/a.ts", "src/ui.ts", "README.md"] },
            { issueId: "i2", identifier: "TPS-2", title: "Không chạm", status: "done", paths: ["README.md"] }],
  flowId: null, maxNodes: 3000 };

describe("buildDocsGraph", () => {
  it("builds nodes and edges from manifest, links and ticket commits only", () => {
    const g = buildDocsGraph(input);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
    expect(g.nodes.find((n) => n.id === "page:docs/flows/ui-missing.md")).toMatchObject({ kind: "page", missing: true });
    expect(g.edges.map((e) => e.id)).toEqual(expect.arrayContaining([
      "project-flow:project:p1->flow:core", "flow-doc:flow:core->page:docs/flows/core.md",
      "flow-entrypoint:flow:core->file:src/main.ts", "flow-file:flow:core->file:src/a.ts", "flow-test:flow:core->file:test/a.test.ts",
      "shared-file:file:src/shared.ts->flow:ui", "page-link:page:docs/index.md->page:docs/flows/core.md",
    ]));
    expect(g.edges.filter((e) => e.kind === "ticket-flow")).toEqual([
      { id: "ticket-flow:ticket:i1->flow:core", kind: "ticket-flow", from: "ticket:i1", to: "flow:core", files: 1 },
      { id: "ticket-flow:ticket:i1->flow:ui", kind: "ticket-flow", from: "ticket:i1", to: "flow:ui", files: 1 },
    ]);
    expect(g.nodes.some((n) => n.id === "ticket:i2")).toBe(false);
    expect(g.edges.some((e) => e.to === "page:docs/x.md")).toBe(false);
    expect(g.notice).toBe(GRAPH_NOTICE);
  });
  it("without a manifest keeps only project, pages and page links", () => {
    const g = buildDocsGraph({ ...input, manifest: null });
    expect(new Set(g.nodes.map((n) => n.kind))).toEqual(new Set(["project", "page"]));
    expect(g.edges.every((e) => e.kind === "page-link")).toBe(true);
  });
  it("filters to one flow neighbourhood", () => {
    const g = buildDocsGraph({ ...input, flowId: "ui" });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(
      ["file:src/shared.ts", "file:src/ui.ts", "flow:ui", "page:docs/flows/ui-missing.md", "project:p1", "ticket:i1"].sort());
  });
  it("drops file nodes when over the node limit", () => {
    const g = buildDocsGraph({ ...input, maxNodes: 6 });
    expect(g.truncated).toBe("files");
    expect(g.nodes.some((n) => n.kind === "file")).toBe(false);
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
  });
  it("unknown flowId yields only the project node", () => {
    expect(buildDocsGraph({ ...input, flowId: "nope" }).nodes.map((n) => n.id)).toEqual(["project:p1"]);
  });
});
