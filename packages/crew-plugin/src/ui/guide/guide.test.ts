import { createElement as h, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/PAP/crew" }));
vi.mock("@paperclipai/plugin-sdk/ui", () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => children,
  MarkdownBlock: ({ content }: { content: string }) => h("pre", null, content),
  useHostLocation: () => ({ pathname: pathname.current, search: "", hash: "" }),
  useHostNavigation: () => ({ linkProps: (to: string) => ({ href: `/PAP${to}`, onClick: () => undefined }) }),
}));

import { CrewGuidePage, CrewGuideSidebarLink, CrewSidebarLink, guideHeadings } from "./index.js";
import guideText from "./huong-dan.md";

it("renders the guide with a table of contents of at least 10 entries", () => {
  const html = renderToStaticMarkup(CrewGuidePage({ context: {} as never }) as ReactElement);
  expect(html).toContain("Hướng dẫn sử dụng 2P Crew");
  const toc = /<nav aria-label="Mục lục"[^>]*>(.*?)<\/nav>/s.exec(html)?.[1] ?? "";
  expect(toc.match(/<li>/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
  expect(guideHeadings(guideText).length).toBeGreaterThanOrEqual(10);
});

it("ignores ## lines inside fenced code", () => {
  expect(guideHeadings("## A\n```\n## B\n```\n## C")).toEqual(["A", "C"]);
});

it("sidebar links point at the company-prefixed routes", () => {
  const guide = renderToStaticMarkup(CrewGuideSidebarLink({ context: {} as never }) as ReactElement);
  expect(guide).toContain('href="/PAP/huong-dan"');
  expect(guide).toContain("Hướng dẫn");
  const crew = renderToStaticMarkup(CrewSidebarLink({ context: {} as never }) as ReactElement);
  expect(crew).toContain('href="/PAP/crew"');
  expect(crew).toContain('aria-current="page"');
});
