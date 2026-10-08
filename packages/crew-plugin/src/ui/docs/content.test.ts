import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DocsCheckContent } from "./index.js";

it("shows the author and an invalid newest marker", () => {
  const html = renderToStaticMarkup(h(DocsCheckContent, {
    result: { invalid: true, at: "2026-10-08T14:00:00Z", author: "integrator-id" },
  }));
  expect(html).toContain("Bằng chứng không hợp lệ");
  expect(html).toContain("integrator-id");
});
