import { expect, it } from "vitest";
import { buildDocsTree } from "./tree.js";

it("builds directory nodes for a nested snapshot", () => {
  const tree = buildDocsTree([
    { path: "docs/flows/a.md", title: "A" },
    { path: "docs/guide/sub/b.md", title: "B" },
    { path: "docs/index.md", title: "Index" },
  ]);
  expect(tree).toMatchObject([{
    path: "docs", type: "directory", children: [
      { path: "docs/flows", type: "directory", children: [{ path: "docs/flows/a.md", type: "page" }] },
      { path: "docs/guide", type: "directory", children: [{ path: "docs/guide/sub", type: "directory", children: [{ path: "docs/guide/sub/b.md", type: "page" }] }] },
      { path: "docs/index.md", type: "page" },
    ],
  }]);
});
