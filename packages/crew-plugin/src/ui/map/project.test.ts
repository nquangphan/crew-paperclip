import { expect, it } from "vitest";
import type { CrewMap, CrewMapNode } from "../../handlers/map.js";
import { projectCrewMap } from "./project.js";
import { layoutHierarchy } from "./layout.js";

const node = (id: string, parentId: string | null, status = "todo"): CrewMapNode => ({
  id, identifier: id, title: `${id} title`, status, parentId, assignee: null,
  stage: { currentStageId: "review", currentType: "review", completed: [], position: 0 },
  reviewRounds: 0, maxReviewRounds: 5, kind: "code", bundle: null,
});

it("projects the CRE-36 tree with dependency and repair edges without inventing relations", () => {
  const root = node("CRE-36", null, "done");
  const input: CrewMap = {
    root, nodes: [root, node("CRE-37", root.id, "done"), node("CRE-38", root.id), node("CRE-39", root.id)],
    edges: [
      { kind: "parent", from: root.id, to: "CRE-37" },
      { kind: "parent", from: root.id, to: "CRE-38" },
      { kind: "parent", from: root.id, to: "CRE-39" },
      { kind: "dependency", from: "CRE-37", to: "CRE-38" },
      { kind: "repair", from: "CRE-38", to: "CRE-39", label: "1 vòng sửa" },
    ], diagnostics: [],
  };
  const projection = projectCrewMap(input);
  expect(projection.nodes).toHaveLength(4);
  expect(projection.edges).toHaveLength(5);
  expect(projection.edges.find((edge) => edge.kind === "dependency")).toMatchObject({ source: "CRE-37", target: "CRE-38" });
  expect(projection.edges.find((edge) => edge.kind === "repair")).toMatchObject({ source: "CRE-38", target: "CRE-39" });
  const positions = layoutHierarchy(projection);
  expect(positions[root.id]?.x).toBe(0);
  expect(positions["CRE-37"]?.x).toBeGreaterThan(positions[root.id]?.x ?? 0);
  expect(positions["CRE-37"]?.y).toBeLessThan(positions["CRE-38"]?.y ?? 0);
  expect(positions["CRE-38"]?.y).toBeLessThan(positions["CRE-39"]?.y ?? 0);
});
