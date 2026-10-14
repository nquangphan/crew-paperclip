// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../context/ThemeContext";
import { MarkdownBody } from "./MarkdownBody";
import { StoredImage } from "./StoredImage";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string } & React.ComponentProps<"a">) => (
    <a href={to} {...props}>{children}</a>
  ),
  useCaseHref: () => (path: string) => path,
}));

vi.mock("../api/issues", () => ({ issuesApi: { get: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container;
}

async function failImage(host: HTMLElement) {
  const img = host.querySelector("img");
  expect(img).not.toBeNull();
  await act(async () => {
    img?.dispatchEvent(new Event("error"));
  });
}

describe("StoredImage", () => {
  it("renders the image while its file loads", async () => {
    const host = await render(<StoredImage src="/api/attachments/a/content" alt="shot" className="h-full w-full" />);
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/api/attachments/a/content");
    expect(host.querySelector("[data-missing-file]")).toBeNull();
  });

  it("swaps a missing file for a placeholder that keeps the thumbnail box", async () => {
    const onError = vi.fn();
    const host = await render(
      <StoredImage src="/api/attachments/gone/content" alt="shot" className="h-full w-full" onError={onError} />,
    );
    await failImage(host);

    const placeholder = host.querySelector("[data-missing-file]");
    expect(host.querySelector("img")).toBeNull();
    expect(placeholder?.textContent).toBe("File không còn");
    expect(placeholder?.getAttribute("role")).toBe("img");
    expect(placeholder?.className).toContain("h-full w-full");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("tries again when the source changes", async () => {
    const host = await render(<StoredImage src="/api/attachments/gone/content" alt="" />);
    await failImage(host);
    expect(host.querySelector("[data-missing-file]")).not.toBeNull();

    await act(async () => root?.render(<StoredImage src="/api/attachments/next/content" alt="" />));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/api/attachments/next/content");
  });

  it("keeps a comment readable when an inline image file was deleted", async () => {
    const host = await render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider>
          <MarkdownBody>{"Before ![screenshot](/api/assets/old/content) after"}</MarkdownBody>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await failImage(host);

    const paragraph = host.querySelector("p");
    expect(paragraph?.textContent).toBe("Before File không còn after");
    expect(paragraph?.querySelector("[data-missing-file]")).not.toBeNull();
    expect(host.querySelector("img")).toBeNull();
  });
});
