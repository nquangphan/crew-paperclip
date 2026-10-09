import { createElement as h } from "react";
import { DataTable, Spinner, usePluginData } from "@paperclipai/plugin-sdk/ui";
import { registerIssuePanel } from "../registry.js";
import type { IssueUsage } from "../../usage/data.js";
import type { UsageTotals } from "../../usage/rollup.js";
import { COMPLETENESS_LABEL, formatTokens, formatUsd, formatUsdTotal, ROLE_LABEL } from "./format.js";

const time = (value: string | null) => value ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
const SOURCE_LABEL = { model_usage: "theo model", run_model: "model chính của lượt" } as const;
type Row = Record<string, unknown>;
const cast = <T>(r: Row) => r as unknown as T;
type Column = { key: string; header: string; render: (_: unknown, r: Row) => string };
const col = <T>(key: string, header: string, render: (r: T) => string): Column => ({ key, header, render: (_, r) => render(cast<T>(r)) });

function totalsCard(title: string, t: UsageTotals) {
  return h("article", { key: title, "aria-label": title, className: "rounded-lg border p-4 space-y-1" },
    h("h4", null, title),
    h("p", null, `Input: ${formatTokens(t.inputTokens)} · Cache đọc: ${formatTokens(t.cachedInputTokens)} · Output: ${formatTokens(t.outputTokens)}`),
    h("p", null, `USD ước tính, không phải hóa đơn: ${formatUsdTotal(t)}`),
    h("p", null, `Mức đầy đủ: ${COMPLETENESS_LABEL[t.completeness]} · ${t.runsWithUsage}/${t.runs} lượt có số liệu${t.runsMissing ? ` · ${t.runsMissing} lượt thiếu` : ""}${t.runsRunning ? ` · ${t.runsRunning} lượt đang chạy` : ""}`));
}

const totalsColumns = (get: (r: never) => UsageTotals): Column[] => [
  { key: "in", header: "Input", render: (_, r) => formatTokens(get(r as never).inputTokens) },
  { key: "out", header: "Output", render: (_, r) => formatTokens(get(r as never).outputTokens) },
  { key: "usd", header: "USD ước tính", render: (_, r) => formatUsdTotal(get(r as never)) },
  { key: "c", header: "Mức đầy đủ", render: (_, r) => COMPLETENESS_LABEL[get(r as never).completeness] },
];

export function UsagePanel({ issueId }: { issueId: string; companyId: string }) {
  const { data, loading, error } = usePluginData<IssueUsage | null>("crew.usage.issue", { issueId });
  if (loading) return h("p", { role: "status" }, h(Spinner, null), " Đang tải usage…");
  if (error) return h("p", { role: "alert" }, `Không tải được usage: ${error.message}`);
  if (!data) return h("p", { role: "status" }, "Chưa có dữ liệu usage.");
  return h("section", { "aria-label": "Usage" },
    h("h3", null, "Usage"),
    h("p", null, `Đang xem: ${data.issue.identifier}`),
    h("div", { style: { display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))" } },
      totalsCard("Chỉ issue này", data.direct), data.tree ? totalsCard("Gồm issue con", data.tree) : null),
    data.children.length ? h("div", null, h("h4", null, "Issue con"),
      h(DataTable, { rows: data.children as unknown as Row[], columns: [
        col<IssueUsage["children"][number]>("issue", "Issue", (c) => `${c.identifier} · ${c.title}`),
        ...totalsColumns((r: IssueUsage["children"][number]) => r.tree),
      ] })) : null,
    h("h4", null, "Theo vai trò"),
    h(DataTable, { rows: data.byRole as unknown as Row[], emptyMessage: "Chưa có lượt chạy.", columns: [
      col<IssueUsage["byRole"][number]>("role", "Vai trò", (r) => ROLE_LABEL[r.role]),
      ...totalsColumns((r: IssueUsage["byRole"][number]) => r.totals),
    ] }),
    h("h4", null, "Theo model"),
    h(DataTable, { rows: data.byModel as unknown as Row[], emptyMessage: "Chưa có model nào.", columns: [
      col<IssueUsage["byModel"][number]>("model", "Model", (m) => m.model),
      col<IssueUsage["byModel"][number]>("source", "Nguồn", (m) => SOURCE_LABEL[m.source]),
      col<IssueUsage["byModel"][number]>("in", "Input", (m) => formatTokens(m.inputTokens)),
      col<IssueUsage["byModel"][number]>("out", "Output", (m) => formatTokens(m.outputTokens)),
      col<IssueUsage["byModel"][number]>("usd", "USD ước tính", (m) => formatUsd(m.estimatedUsd)),
    ] }),
    h("details", null, h("summary", null, `Các lượt chạy (${data.runs.length}${data.runsTruncated ? ", đã cắt bớt" : ""})`),
      h(DataTable, { rows: data.runs as unknown as Row[], emptyMessage: "Chưa có lượt chạy.", columns: [
        col<IssueUsage["runs"][number]>("at", "Bắt đầu", (r) => time(r.startedAt)),
        col<IssueUsage["runs"][number]>("agent", "Agent", (r) => `${r.agentName} (${ROLE_LABEL[r.role]})`),
        col<IssueUsage["runs"][number]>("model", "Model", (r) => r.model ?? "—"),
        col<IssueUsage["runs"][number]>("in", "Input", (r) => formatTokens(r.inputTokens)),
        col<IssueUsage["runs"][number]>("out", "Output", (r) => formatTokens(r.outputTokens)),
        col<IssueUsage["runs"][number]>("usd", "USD ước tính", (r) => formatUsd(r.estimatedUsd)),
        col<IssueUsage["runs"][number]>("c", "Mức đầy đủ", (r) => COMPLETENESS_LABEL[r.completeness]),
      ] })),
    h("p", null, `Phiên mới: ${data.reuse.fresh} · Dùng lại phiên: ${data.reuse.reused} · Không rõ: ${data.reuse.unknown}`),
    h("ul", null, ...data.notes.map((note) => h("li", { key: note }, note))));
}

registerIssuePanel({ id: "usage", order: 30, component: UsagePanel });
