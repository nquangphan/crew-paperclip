import type { Completeness, CrewRole, UsageTotals } from "../../usage/rollup.js";

const tokens = new Intl.NumberFormat("vi-VN");

export function formatTokens(n: number | null): string {
  return n === null ? "—" : tokens.format(n);
}

/** USD là ước tính của Claude Code; chưa có ước tính thì "—", không phải $0. */
export function formatUsd(n: number | null): string {
  return n === null ? "—" : `≈ $${n.toFixed(2)}`;
}

type UsdFields = Pick<UsageTotals, "runs" | "runsRunning" | "estimatedUsd" | "estimatedUsdRuns">;

/** Tổng USD chỉ cộng các lượt đã xong có ước tính; thiếu ở lượt nào thì ghi rõ là cận dưới và k/n lượt. */
export function formatUsdTotal(t: UsdFields): string {
  if (t.estimatedUsd === null) return "—";
  const done = t.runs - t.runsRunning;
  return t.estimatedUsdRuns < done
    ? `≥ $${t.estimatedUsd.toFixed(2)} (cận dưới: ${t.estimatedUsdRuns}/${done} lượt có ước tính)`
    : formatUsd(t.estimatedUsd);
}

export const COMPLETENESS_LABEL: Record<Completeness | "khong_co", string> = {
  day_du: "Đủ", mot_phan: "Một phần", thieu: "Thiếu", dang_chay: "Đang chạy", khong_co: "Không có số liệu",
};

export const ROLE_LABEL: Record<CrewRole, string> = {
  assistant: "Trợ Lý", executor: "Executor", reviewer: "Reviewer", integrator: "Integrator", khac: "Khác",
};
