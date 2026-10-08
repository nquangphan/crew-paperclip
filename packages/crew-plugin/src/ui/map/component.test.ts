import { expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { TicketNode } from "./ticket-node.js";

it("renders the current issue card with Crew stage, assignee, bundle and review rounds", () => {
  const markup = renderToStaticMarkup(h(ReactFlowProvider, null,
    h(TicketNode, { data: {
      issue: {
        id: "CRE-36", identifier: "CRE-36", title: "Yêu cầu", status: "in_review", parentId: null,
        assignee: { id: "agent", name: "Người làm" },
        stage: { currentStageId: "stage-2", currentType: "review", completed: ["stage-1"] },
        reviewRounds: 2, maxReviewRounds: 5, kind: "code", bundle: { id: "core", seq: 3 },
      }, highlighted: true, link: { href: "/CRE/issues/CRE-36" },
    } }),
  ));
  expect(markup).toContain("CRE-36");
  expect(markup).toContain("Đang duyệt");
  expect(markup).toContain("Stage: review");
  expect(markup).toContain("Vòng sửa: 2/5");
  expect(markup).toContain("crew-map-node-current");
  expect(markup).toContain("href=\"/CRE/issues/CRE-36\"");
});
