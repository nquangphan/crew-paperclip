import { expect, it } from "vitest";
import { appLine, MachineCard } from "./index.js";
import type { CrewMachine } from "../../machines/data.js";

it("shows unknown probe values without treating a failed login probe as logout", () => {
  const machine = {
    machineId: "machine", hostname: "mini", lastSeenAt: "2026-10-08T14:00:00Z", online: true,
    load24h: [], latest: { version: 1, companyId: "company", machineId: "machine", hostname: "mini",
      sentAt: "2026-10-08T14:00:00Z", load1: null, cpuCount: null, memFreePct: null, tccPending: [], checks: [],
      claude: { version: null, loggedIn: null, plan: null },
      superpowers: { pinned: null, ownerInstalled: null } },
  } as CrewMachine;
  const html = JSON.stringify(MachineCard({ machine }));
  expect(html).toContain("Không rõ");
  expect(html).not.toContain("chưa đăng nhập");
  expect(html).toContain("Trực tuyến");
});

it("hiện dòng app 2P Crew hoặc Chạy bằng CLI", () => {
  expect(appLine(undefined)).toBe("Chạy bằng CLI");
  expect(appLine({ version: "0.1.0", sshdOwner: "app", updateState: "waiting-idle" })).toBe("App 2P Crew 0.1.0 · sshd do app giữ · Chờ máy rảnh để cài");
  expect(appLine({ version: "0.2.0", sshdOwner: "launchd", updateState: "rolled-back" })).toBe("App 2P Crew 0.2.0 · sshd do LaunchAgent giữ · Đã quay về bản trước");
});
