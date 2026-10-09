import { expect, it } from "vitest";
import { formatBytes, formatMeasured } from "./format.js";

it("formats bytes in vi-VN with 1024 steps", () => {
  expect(formatBytes(0)).toBe("0 B"); expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536)).toBe("1,5 KB"); expect(formatBytes(2 * 1024 ** 3)).toBe("2 GB");
  expect(formatBytes(1024 ** 4 * 3)).toBe("3 TB");
});
it("labels measured values and never shows 0 for unmeasured", () => {
  expect(formatMeasured({ kind: "logic", bytes: 1536 })).toBe("1,5 KB (logic)");
  expect(formatMeasured({ kind: "vat_ly", bytes: 0 })).toBe("0 B (vật lý)");
  expect(formatMeasured({ kind: "chua_do", reason: "x" })).toBe("Chưa đo");
});
it("labels a logical size as a lower bound when some items have no size yet", () => {
  expect(formatMeasured({ kind: "logic", bytes: 1536 }, { lowerBound: true })).toBe("≥ 1,5 KB (logic, cận dưới)");
  expect(formatMeasured({ kind: "logic", bytes: 1536 }, { lowerBound: false })).toBe("1,5 KB (logic)");
  expect(formatMeasured({ kind: "chua_do", reason: "x" }, { lowerBound: true })).toBe("Chưa đo");
});
