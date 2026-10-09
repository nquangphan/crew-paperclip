import { expect, it } from "vitest";
import { COMPLETENESS_LABEL, formatTokens, formatUsd, formatUsdTotal, ROLE_LABEL } from "./format.js";

it("formats tokens and estimates", () => {
  expect(formatTokens(null)).toBe("—"); expect(formatTokens(1234567)).toBe("1.234.567");
  expect(formatUsd(null)).toBe("—"); expect(formatUsd(1.234)).toBe("≈ $1.23"); expect(formatUsd(0)).toBe("≈ $0.00");
});
it("has fixed labels", () => {
  expect(COMPLETENESS_LABEL).toEqual({ day_du: "Đủ", mot_phan: "Một phần", thieu: "Thiếu", dang_chay: "Đang chạy", khong_co: "Không có số liệu" });
  expect(ROLE_LABEL).toEqual({ assistant: "Trợ Lý", executor: "Executor", reviewer: "Reviewer", integrator: "Integrator", khac: "Khác" });
});
it("marks a USD estimate as a lower bound when some finished runs have no estimate", () => {
  const t = { runs: 4, runsWithUsage: 3, runsMissing: 1, runsRunning: 1, estimatedUsdRuns: 2 };
  expect(formatUsdTotal({ ...t, estimatedUsd: 1.5 })).toBe("≥ $1.50 (cận dưới: 2/3 lượt có ước tính)");
  expect(formatUsdTotal({ ...t, estimatedUsd: 1.5, estimatedUsdRuns: 3 })).toBe("≈ $1.50");
  expect(formatUsdTotal({ ...t, estimatedUsd: null, estimatedUsdRuns: 0 })).toBe("—");
});
