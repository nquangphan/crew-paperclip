import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

// Host SDK giả: dữ liệu rỗng nhưng đã tải xong, để từng mục dựng ra phần khung của nó.
vi.mock("@paperclipai/plugin-sdk/ui", () => ({
  usePluginData: () => ({ data: [], loading: false, error: null, refresh: () => undefined }),
  useHostNavigation: () => ({ linkProps: () => ({ href: "#" }) }),
  DataTable: () => null,
  Spinner: () => null,
  StatusBadge: () => null,
  ErrorBoundary: ({ children }: { children: unknown }) => children,
}));

it("mỗi mục trên trang Crew chỉ có một tiêu đề h2 do trang vẽ, mục con không tự thêm", async () => {
  await import("./docs/index.js");
  await import("./machines/index.js");
  const { CrewPage } = await import("./page.js");
  const html = renderToStaticMarkup(h(CrewPage, { context: { companyId: "company" } } as never));
  const headings = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1]);
  expect(headings).toEqual(["Yêu cầu", "Máy", "Docs"]);
  // Mỗi khung có nhãn riêng, không có hai khung cùng nhãn lồng nhau.
  expect(html.match(/aria-label="Docs"/g)).toHaveLength(1);
  expect(html.match(/aria-label="Máy"/g)).toHaveLength(1);
});
