import type { CrewMachine } from "../../machines/data.js";

export const localTime = (value: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "medium" }).format(new Date(value));

const UPDATE_LABELS: Record<string, string> = {
  idle: "Đã cập nhật", downloading: "Đang tải bản mới", "waiting-idle": "Chờ máy rảnh để cài",
  installing: "Đang cài", probation: "Đang thử bản mới", "rolled-back": "Đã quay về bản trước",
};

export function appLine(app: CrewMachine["latest"]["app"]): string {
  if (!app) return "Chạy bằng CLI";
  return `App 2P Crew ${app.version} · ${app.sshdOwner === "app" ? "sshd do app giữ" : "sshd do LaunchAgent giữ"} · ${UPDATE_LABELS[app.updateState] ?? "Không rõ"}`;
}

export type MachineCardModel = {
  machineId: string;
  hostname: string;
  online: boolean;
  statusLabel: string;
  lastSeenLine: string;
  loadLine: string;
  tccPending: Array<{ text: string }>;
  claudeLine: string;
  appLine: string;
  superpowersLine: string;
  alerts: Array<{ id: string; text: string }>;
  load24h: CrewMachine["load24h"];
};

/** Dòng chữ của một thẻ máy; giá trị dò chưa biết hiện "Không rõ", không coi là đã đăng xuất. */
export function machineCardModel(machine: CrewMachine): MachineCardModel {
  const report = machine.latest;
  const login = report.claude.loggedIn === null ? "Không rõ" : report.claude.loggedIn ? "đã đăng nhập" : "chưa đăng nhập";
  return {
    machineId: machine.machineId,
    hostname: machine.hostname,
    online: machine.online,
    statusLabel: machine.online ? "Trực tuyến" : "Mất liên lạc",
    lastSeenLine: `Lần cuối ${localTime(machine.lastSeenAt)}`,
    loadLine: `Tải 1 phút: ${report.load1 ?? "Không rõ"} / ${report.cpuCount ?? "Không rõ"} CPU · RAM trống: ${report.memFreePct === null ? "Không rõ" : `${report.memFreePct}%`}`,
    tccPending: report.tccPending.map((item) => ({ text: `${item.service} · ${item.client} · từ ${localTime(item.since)}` })),
    claudeLine: `Claude ${report.claude.version ?? "Không rõ"} · ${login} · gói ${report.claude.plan ?? "Không rõ"}`,
    appLine: appLine(report.app),
    superpowersLine: `Superpowers: ghim ${report.superpowers.pinned ?? "Không rõ"} · owner ${report.superpowers.ownerInstalled ?? "Không rõ"}`,
    alerts: report.checks.filter((check) => check.status !== "ok").map((check) => ({ id: check.id, text: `${check.status === "error" ? "Lỗi" : "Cảnh báo"}: ${check.title}` })),
    load24h: machine.load24h,
  };
}
