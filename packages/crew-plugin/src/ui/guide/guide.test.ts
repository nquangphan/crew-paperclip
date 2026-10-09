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

import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { CrewGuidePage, CrewGuideSidebarLink, CrewSidebarLink, GUIDE_UI_BASE, guideHeadings, resolveGuideImages } from "./index.js";
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

it("rewrites image URLs to the plugin static path", () => {
  const html = renderToStaticMarkup(CrewGuidePage({ context: {} as never }) as ReactElement);
  expect(html).not.toContain("](img/");
  expect(html).toContain("](/_plugins/crew.core/ui/guide/img/01-dang-nhap.jpg)");
  expect(resolveGuideImages("![a](img/x.jpg)", GUIDE_UI_BASE)).toBe("![a](/_plugins/crew.core/ui/guide/img/x.jpg)");
});

it("drops images when there is no base", () => {
  const out = resolveGuideImages(guideText, null);
  expect(out).not.toContain("](img/");
  expect(out).toContain("## ");
});

it("every image the guide references exists as a source file, and the built bundle ships them", () => {
  const referenced = [...guideText.matchAll(/\]\(img\/([^)]+)\)/g)].map((m) => m[1]);
  const src = readdirSync(new URL("./img/", import.meta.url));
  for (const name of referenced) expect(src).toContain(name);
  expect(src.filter((f) => f.endsWith(".jpg")).length).toBe(12);
});

it("built output contains the images and a lean bundle (needs pnpm build first)", () => {
  const dist = new URL("../../../dist/ui/", import.meta.url);
  const imgs = readdirSync(new URL("guide/img/", dist)).filter((f) => f.endsWith(".jpg"));
  expect(imgs.length).toBe(12);
  const bundle = readFileSync(new URL("index.js", dist), "utf8");
  expect(bundle).not.toContain('require("react');
  expect(bundle).not.toContain("data:image/jpeg;base64");
  console.log("ui bundle gzip bytes:", gzipSync(bundle).length);
});
