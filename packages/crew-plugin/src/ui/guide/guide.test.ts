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
import { CrewGuidePage, CrewGuideSidebarLink, CrewSidebarLink, guideBaseFrom, guideHeadings, resolveGuideImages } from "./index.js";
import guideText from "./huong-dan.md";

it("renders the guide with a table of contents of at least 10 entries", () => {
  const html = renderToStaticMarkup(h(CrewGuidePage, { context: {} as never }));
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
  const html = renderToStaticMarkup(h(CrewGuidePage, { context: {} as never }));
  // Server render: the base is not known before the effect runs, so images are dropped, never left broken.
  expect(html).not.toContain("](img/");
  const base = guideBaseFrom([{ pluginKey: "other", pluginId: "11111111-1111-4111-8111-111111111111" }, { pluginKey: "crew.core", pluginId: "e29d3a17-f50b-4863-9005-ebf98119558d" }]);
  expect(base).toBe("/_plugins/e29d3a17-f50b-4863-9005-ebf98119558d/ui/");
  expect(guideBaseFrom([{ pluginKey: "crew.core", pluginId: "not-a-uuid" }])).toBeNull();
  expect(guideBaseFrom(null)).toBeNull();
  expect(resolveGuideImages("![a](img/x.jpg)", base)).toBe("![a](/_plugins/e29d3a17-f50b-4863-9005-ebf98119558d/ui/guide/img/x.jpg)");
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
