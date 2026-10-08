import { createElement as h, useEffect } from "react";
import { Spinner, StatusBadge, usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { registerPageSection } from "../registry.js";
import type { CrewMachine } from "../../machines/data.js";

const localTime = (value: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "medium" }).format(new Date(value));

function useMachines(companyId: string) {
  const state = usePluginData<CrewMachine[]>("crew.machines", { companyId });
  useEffect(() => { const timer = setInterval(() => state.refresh(), 30_000); return () => clearInterval(timer); }, [state.refresh]);
  return state;
}

function chart(points: CrewMachine["load24h"]) {
  if (!points.length) return h("p", null, "Chưa có dữ liệu tải 24 giờ.");
  const peak = Math.max(1, ...points.map((point) => point.load1));
  const coords = points.map((point, index) => `${(index / Math.max(1, points.length - 1)) * 100},${30 - (point.load1 / peak) * 28}`).join(" ");
  return h("svg", { viewBox: "0 0 100 32", role: "img", "aria-label": "Biểu đồ tải 24 giờ", style: { width: "100%", height: "var(--spacing-16)" } },
    h("polyline", { points: coords, fill: "none", stroke: "currentColor", strokeWidth: "1" }));
}

function card(machine: CrewMachine) {
  const report = machine.latest;
  const alerts = report.checks.filter((check) => check.status !== "ok");
  return h("article", { key: machine.machineId, className: "rounded-lg border p-4 space-y-2" },
    h("h3", null, machine.hostname),
    h(StatusBadge, { label: machine.online ? "Online" : "Mất liên lạc", status: machine.online ? "ok" : "error" }),
    h("p", null, `Lần cuối ${localTime(machine.lastSeenAt)}`),
    h("p", null, `Tải 1 phút: ${report.load1} / ${report.cpuCount} CPU · RAM trống: ${report.memFreePct}%`),
    chart(machine.load24h),
    report.tccPending.length ? h("div", { role: "alert", className: "rounded-md border border-warning p-3" },
      h("strong", null, "TCC đang chờ"),
      h("ul", null, ...report.tccPending.map((item, index) => h("li", { key: index }, `${item.service} · ${item.client} · từ ${localTime(item.since)}`)))) : null,
    h("p", null, `Claude ${report.claude.version} · ${report.claude.loggedIn ? "đã đăng nhập" : "chưa đăng nhập"} · gói ${report.claude.plan}`),
    h("p", null, `Superpowers: ghim ${report.superpowers.pinned} · owner ${report.superpowers.ownerInstalled}`),
    alerts.length ? h("ul", null, ...alerts.map((check) => h("li", { key: check.id }, `${check.status === "error" ? "Lỗi" : "Cảnh báo"}: ${check.title}`))) : null,
  );
}

export function MachinesSection({ companyId }: { companyId: string }) {
  const { data, loading, error } = useMachines(companyId);
  if (loading && !data) return h("div", { role: "status" }, h(Spinner, null), " Đang tải trạng thái máy…");
  if (error) return h("div", { role: "alert" }, `Không tải được trạng thái máy: ${error.message}`);
  return h("section", { "aria-label": "Máy", className: "space-y-4" }, h("h2", null, "Máy"),
    ...(data?.length ? data.map(card) : [h("p", { key: "empty" }, "Chưa có máy gửi bản tin.")]));
}

function MachinesWidgetContent({ companyId }: { companyId: string }) {
  const { data, loading, error } = useMachines(companyId);
  if (loading && !data) return h("div", { role: "status" }, "Đang tải máy…");
  if (error) return h("div", { role: "alert" }, "Không tải được trạng thái máy.");
  return h("section", { "aria-label": "Máy Crew" }, h("h3", null, "Máy Crew"),
    data?.length ? h("ul", null, ...data.map((machine) => h("li", { key: machine.machineId },
      `${machine.hostname}: ${machine.online ? "online" : "mất liên lạc"} · tải ${machine.latest.load1}/${machine.latest.cpuCount}${machine.latest.tccPending.length ? ` · TCC ${machine.latest.tccPending.length} đang chờ` : ""}`)))
      : h("p", null, "Chưa có máy."));
}

export function MachinesWidget({ context }: PluginWidgetProps) {
  return h(MachinesWidgetContent, { companyId: context.companyId });
}

registerPageSection({ id: "machines", title: "Máy", order: 20, component: MachinesSection });
