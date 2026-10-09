import { createElement as h, useRef, type MouseEvent } from "react";
import { ErrorBoundary, MarkdownBlock, useHostLocation, useHostNavigation, type PluginPageProps, type PluginSidebarProps } from "@paperclipai/plugin-sdk/ui";
import guideText from "./huong-dan.md";

export const GUIDE_ROUTE = "huong-dan";
export const CREW_ROUTE = "crew";

/** Mục lục lấy từ các heading `##` (bỏ qua dòng nằm trong khối code). */
export function guideHeadings(text: string): string[] {
  let fenced = false;
  const found: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    const match = !fenced && /^##\s+(.+?)\s*$/.exec(line);
    if (match) found.push(match[1].replace(/`/g, ""));
  }
  return found;
}

/**
 * Key of this plugin; the host serves plugin UI files at `/_plugins/<id-or-key>/ui/` and accepts the
 * plugin key there (server/src/routes/plugin-ui-static.ts). The bundle is loaded from a blob URL, so
 * `import.meta.url` cannot give the base.
 */
export const PLUGIN_KEY = "crew.core";
export const GUIDE_UI_BASE = `/_plugins/${PLUGIN_KEY}/ui/`;

/** Points `img/...` images at the plugin's static files; without a base the images are dropped. */
export function resolveGuideImages(text: string, base: string | null): string {
  if (base) return text.split("](img/").join(`](${base}guide/img/`);
  return text.replace(/^[ \t]*!\[[^\]]*\]\(img\/[^)]*\)[ \t]*\r?\n?/gm, "").replace(/!\[[^\]]*\]\(img\/[^)]*\)/g, "");
}

const imageCss = ".crew-guide-body img { display: block; max-width: 100%; height: auto; margin: 0.75rem 0; border: 1px solid var(--border, rgba(128,128,128,.35)); border-radius: var(--radius, 0.5rem); }";

const alertStyle = { border: "1px solid var(--destructive)", borderRadius: "var(--radius)", padding: "0.75rem" };

function Guide({ text }: { text: string }) {
  const body = useRef<HTMLDivElement | null>(null);
  const headings = guideHeadings(text);
  const jump = (title: string) => (event: MouseEvent) => {
    event.preventDefault();
    const target = Array.from(body.current?.querySelectorAll("h2") ?? []).find((el) => el.textContent?.trim() === title);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return h("div", { style: { maxWidth: 860, margin: "0 auto", padding: "1rem", lineHeight: 1.6 } },
    h("nav", { "aria-label": "Mục lục", style: { marginBottom: "1.5rem" } },
      h("strong", null, "Mục lục"),
      h("ol", { style: { margin: "0.5rem 0 0", paddingLeft: "1.25rem" } },
        ...headings.map((title) => h("li", { key: title },
          h("a", { href: "#", onClick: jump(title), style: { textDecoration: "underline" } }, title.replace(/^\d+\.\s*/, "")))))),
    h("style", null, imageCss),
    h("div", { ref: body, className: "crew-guide-body" }, h(MarkdownBlock, { content: text })));
}

export function CrewGuidePage(_props: PluginPageProps) {
  return h("main", { "aria-label": "Hướng dẫn Crew" },
    h(ErrorBoundary, { fallback: h("div", { role: "alert", style: alertStyle }, "Không hiển thị được hướng dẫn."), children: h(Guide, { text: resolveGuideImages(guideText, GUIDE_UI_BASE) }) }));
}

const linkClass = "flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 pointer-coarse:py-1 text-(length:--text-compact) font-medium text-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
const activeClass = "bg-sidebar-accent text-sidebar-accent-foreground";

function SidebarLink({ route, label }: { route: string; label: string }) {
  const navigation = useHostNavigation();
  const { pathname } = useHostLocation();
  const props = navigation.linkProps(`/${route}`);
  const active = pathname.split("/").filter(Boolean).at(-1) === route;
  return h("a", { ...props, className: active ? `${linkClass} ${activeClass}` : linkClass, "aria-current": active ? "page" : undefined }, label);
}

export function CrewGuideSidebarLink(_props: PluginSidebarProps) {
  return h(SidebarLink, { route: GUIDE_ROUTE, label: "Hướng dẫn" });
}

export function CrewSidebarLink(_props: PluginSidebarProps) {
  return h(SidebarLink, { route: CREW_ROUTE, label: "Crew" });
}
