import { createElement as h, useEffect } from "react";
import { Spinner, StatusBadge, usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { registerPageSection } from "../registry.js";
import type { CrewMachine } from "../../machines/data.js";
import { appLine, machineCardModel } from "./model.js";

export { appLine };

function useMachines(companyId: string) {
  const state = usePluginData<CrewMachine[]>("crew.machines", { companyId });
  useEffect(() => { const timer = setInterval(() => state.refresh(), 30_000); return () => clearInterval(timer); }, [state.refresh]);
  return state;
}

function chart(points: CrewMachine["load24h"]) {
  const known = points.filter((point): point is typeof point & { load1: number } => point.load1 !== null);
  if (!known.length) return h("p", null, "Chưa có dữ liệu tải 24 giờ.");
  const peak = Math.max(1, ...known.map((point) => point.load1));
  const coords = known.map((point, index) => `${(index / Math.max(1, known.length - 1)) * 100},${30 - (point.load1 / peak) * 28}`).join(" ");
  return h("svg", { viewBox: "0 0 100 32", role: "img", "aria-label": `Biểu đồ tải 24 giờ, lớn nhất ${peak}`, style: { width: "100%", height: "5rem" } },
    h("text", { x: "1", y: "8", fill: "currentColor", fontSize: "6" }, `Max ${peak}`),
    h("polyline", { points: coords, fill: "none", stroke: "currentColor", strokeWidth: "1.5" }));
}

export function MachineCard({ machine }: { machine: CrewMachine }) {
  const model = machineCardModel(machine);
  return h("article", { key: model.machineId, className: "rounded-lg border p-4 space-y-2" },
    h("h3", null, model.hostname),
    h(StatusBadge, { label: model.statusLabel, status: model.online ? "ok" : "error" }),
    h("p", null, model.lastSeenLine),
    h("p", null, model.loadLine),
    chart(model.load24h),
    model.tccPending.length ? h("div", { role: "alert", className: "rounded-md border border-warning p-3" },
      h("strong", null, "TCC đang chờ"),
      h("ul", null, ...model.tccPending.map((item, index) => h("li", { key: index }, item.text)))) : null,
    h("p", null, model.claudeLine),
    h("p", null, model.appLine),
    h("p", null, model.superpowersLine),
    model.alerts.length ? h("ul", null, ...model.alerts.map((alert) => h("li", { key: alert.id }, alert.text))) : null,
  );
}

export function MachinesSection({ companyId }: { companyId: string }) {
  const { data, loading, error } = useMachines(companyId);
  if (loading && !data) return h("div", { role: "status" }, h(Spinner, null), " Đang tải trạng thái máy…");
  if (error) return h("div", { role: "alert" }, `Không tải được trạng thái máy: ${error.message}`);
  return h("div", { className: "space-y-4" },
    ...(data?.length ? data.map(machine => h(MachineCard, { key: machine.machineId, machine })) : [h("p", { key: "empty" }, "Chưa có máy gửi bản tin.")]));
}

function MachinesWidgetContent({ companyId }: { companyId: string }) {
  const { data, loading, error } = useMachines(companyId);
  if (loading && !data) return h("div", { role: "status" }, "Đang tải máy…");
  if (error) return h("div", { role: "alert" }, "Không tải được trạng thái máy.");
  return h("section", { "aria-label": "Máy Crew" }, h("h3", null, "Máy Crew"),
    data?.length ? h("ul", null, ...data.map((machine) => h("li", { key: machine.machineId },
      `${machine.hostname}: ${machine.online ? "trực tuyến" : "mất liên lạc"} · tải ${machine.latest.load1 ?? "Không rõ"}/${machine.latest.cpuCount ?? "Không rõ"}${machine.latest.tccPending.length ? ` · TCC ${machine.latest.tccPending.length} đang chờ` : ""}`)))
      : h("p", null, "Chưa có máy."));
}

export function MachinesWidget({ context }: PluginWidgetProps) {
  return h(MachinesWidgetContent, { companyId: context.companyId ?? "" });
}

registerPageSection({ id: "machines", title: "Máy", order: 20, component: MachinesSection });
