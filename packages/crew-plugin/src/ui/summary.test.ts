import { createElement as h, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { CrewMap } from "../handlers/map.js";

const mockMap = vi.hoisted(() => ({ current: null as unknown }));
const mockDocs = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@paperclipai/plugin-sdk/ui", () => ({
  usePluginData: (key: string) => ({ data: key === "crew.map" ? mockMap.current : mockDocs.current }),
}));

import { CrewIssueSummary, CrewIssueSummaryContent } from "./summary.js";
import { DocsCheckPanel } from "./docs/index.js";
import { TicketMap } from "./map/ticket-map.js";
import { UsagePanel } from "./usage/index.js";

const fixture: CrewMap = {
  root: { id: "root", identifier: "CRE-36", title: "Yêu cầu", status: "in_progress", parentId: null, assignee: null,
    stage: { currentStageId: "integrator", currentType: "review", completed: ["reviewer"], position: 1 }, reviewRounds: 0, maxReviewRounds: 3, kind: "code", bundle: null },
  nodes: [
    { id: "root", identifier: "CRE-36", title: "Yêu cầu", status: "in_progress", parentId: null, assignee: null,
      stage: { currentStageId: "integrator", currentType: "review", completed: ["reviewer"], position: 1 }, reviewRounds: 0, maxReviewRounds: 3, kind: "code", bundle: null },
    { id: "child1", identifier: "CRE-37", title: "Một", status: "done", parentId: "root", assignee: null, stage: null, reviewRounds: 0, maxReviewRounds: 3, kind: "code", bundle: null },
    { id: "child2", identifier: "CRE-38", title: "Hai", status: "todo", parentId: "root", assignee: null, stage: null, reviewRounds: 0, maxReviewRounds: 3, kind: "code", bundle: null },
    { id: "child3", identifier: "CRE-39", title: "Ba", status: "done", parentId: "root", assignee: null, stage: null, reviewRounds: 0, maxReviewRounds: 3, kind: "code", bundle: null },
  ],
  edges: [], diagnostics: [],
};

function findElement(node: ReactNode, type: unknown): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findElement(child, type); if (found) return found; }
  } else if (node && typeof node === "object" && "type" in node) {
    const element = node as ReactElement;
    if (element.type === type) return element;
    return findElement((element.props as { children?: ReactNode }).children, type);
  }
  return undefined;
}

it("renders nothing for an issue outside a Crew tree", () => {
  mockMap.current = { ...fixture, nodes: [], diagnostics: ["not_crew_root"] };
  mockDocs.current = null;
  expect(renderToStaticMarkup(h(CrewIssueSummary, { context: { entityId: "ordinary", entityType: "issue", companyId: "company", companyPrefix: null, projectId: null, userId: null } }))).toBe("");
});

it("shows the CRE-36 summary from crew.map data and opens the map from the button", () => {
  mockMap.current = fixture;
  mockDocs.current = { exit: 0, invalid: false };
  const markup = renderToStaticMarkup(h(CrewIssueSummary, { context: { entityId: "root", entityType: "issue", companyId: "company", companyPrefix: null, projectId: null, userId: null } }));
  expect(markup).toContain("Crew · 2/3 con xong · Integrator · merge + docs · docs Đạt");
  expect(markup).toContain("Mở map");

  let expanded = false;
  const collapsed = CrewIssueSummaryContent({ map: fixture, issueId: "root", companyId: "company", docs: { exit: 0 }, expanded, onToggle: () => { expanded = !expanded; } });
  const button = findElement(collapsed, "button");
  expect(button).toBeDefined();
  (button!.props as { onClick: () => void }).onClick();
  const open = CrewIssueSummaryContent({ map: fixture, issueId: "root", companyId: "company", docs: { exit: 0 }, expanded, onToggle: () => {} });
  expect(findElement(open, TicketMap)).toBeDefined();
  expect(findElement(open, DocsCheckPanel)).toBeDefined();
  expect(findElement(open, UsagePanel)).toBeDefined();
});
