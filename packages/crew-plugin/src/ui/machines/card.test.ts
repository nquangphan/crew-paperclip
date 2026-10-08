import { expect, it } from "vitest";
import { MachineCard } from "./index.js";
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
