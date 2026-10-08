import { expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { TicketNode, stageLabel } from "./ticket-node.js";

it("renders the current issue card with Crew stage, assignee, bundle and review rounds", () => {
  const markup = renderToStaticMarkup(h(ReactFlowProvider, null,
    h(TicketNode, { data: {
      issue: {
        id: "CRE-36", identifier: "CRE-36", title: "Yêu cầu", status: "in_review", parentId: null,
        assignee: { id: "agent", name: "Người làm" },
        stage: { currentStageId: "stage-2", currentType: "review", completed: ["stage-1"], position: 1 },
        reviewRounds: 2, maxReviewRounds: 5, kind: "code", bundle: { id: "core", seq: 3 },
      }, highlighted: true, link: { href: "/CRE/issues/CRE-36" },
    } }),
  ));
  expect(markup).toContain("CRE-36");
  expect(markup).toContain("Đang duyệt");
  expect(markup).toContain("Giai đoạn: Integrator · merge + docs");
  expect(markup).toContain("Vòng sửa: 2/5");
  expect(markup).toContain("crew-map-node-current");
  expect(markup).toContain("href=\"/CRE/issues/CRE-36\"");
});

it("names each review stage by its position in the root template", () => {
  const issue = { id: "root", identifier: "CRE-1", title: "root", status: "todo", parentId: null, assignee: null, reviewRounds: 0, maxReviewRounds: 5, kind: "code" as const, bundle: null };
  expect([0, 1, 3].map(count => stageLabel({ ...issue, stage: { currentStageId: `s${count}`, currentType: "review", completed: [], position: count } })))
    .toEqual(["Reviewer", "Integrator · merge + docs", "Integrator · push"]);
  expect(stageLabel({ ...issue, kind: "research", stage: { currentStageId: "owner", currentType: "approval", completed: [], position: 1 } }))
    .toBe("Owner duyệt");
});
