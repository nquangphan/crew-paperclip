import { expect, it } from "vitest";
import { COMPLETENESS_LABEL, formatTokens, formatUsd, ROLE_LABEL } from "./format.js";

it("formats tokens and estimates", () => {
  expect(formatTokens(null)).toBe("—"); expect(formatTokens(1234567)).toBe("1.234.567");
  expect(formatUsd(null)).toBe("—"); expect(formatUsd(1.234)).toBe("≈ $1.23"); expect(formatUsd(0)).toBe("≈ $0.00");
});
it("has fixed labels", () => {
  expect(COMPLETENESS_LABEL).toEqual({ day_du: "Đủ", mot_phan: "Một phần", thieu: "Thiếu", dang_chay: "Đang chạy", khong_co: "Không có số liệu" });
  expect(ROLE_LABEL).toEqual({ assistant: "Trợ Lý", executor: "Executor", reviewer: "Reviewer", integrator: "Integrator", khac: "Khác" });
});
