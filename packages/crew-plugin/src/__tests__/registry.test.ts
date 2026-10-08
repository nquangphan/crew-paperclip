import { expect, it } from "vitest";
import { getIssuePanels, getPageSections, registerIssuePanel, registerPageSection } from "../ui/registry.js";

const Empty = () => null;

it("keeps sections ordered and replaces a section registered twice", () => {
  registerPageSection({ id: "docs", title: "Docs", order: 30, component: Empty });
  registerPageSection({ id: "machines", title: "Máy", order: 20, component: Empty });
  registerPageSection({ id: "docs", title: "Tài liệu", order: 30, component: Empty });
  expect(getPageSections().map((s) => [s.id, s.title])).toEqual([["machines", "Máy"], ["docs", "Tài liệu"]]);
});

it("orders issue panels", () => {
  registerIssuePanel({ id: "b", order: 2, component: Empty });
  registerIssuePanel({ id: "a", order: 1, component: Empty });
  expect(getIssuePanels().map((p) => p.id)).toEqual(["a", "b"]);
});
