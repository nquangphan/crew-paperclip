import { describe, expect, it } from "vitest";
import { createTerminalTicketStore } from "../crew/terminal/ticket-store.js";
import { createTerminalUnlockStore } from "../crew/terminal/unlock-store.js";

const HOUR = 60 * 60_000;
const claims = { companyId: "c1", userId: "u1", sessionId: "s1", machineId: "m1", projectId: "p1" };

describe("kho mở khoá terminal", () => {
  it("mở khoá rồi thấy unlocked, quá 12 giờ thì khoá lại", () => {
    let now = 1_000_000;
    const store = createTerminalUnlockStore({ now: () => now });
    expect(store.status("s1")).toEqual({ unlocked: false, expiresAt: null });
    const { expiresAt } = store.unlock("s1");
    expect(expiresAt.getTime()).toBe(now + 12 * HOUR);
    expect(store.status("s1")).toEqual({ unlocked: true, expiresAt });
    expect(store.status("s2").unlocked).toBe(false);
    now += 12 * HOUR + 1;
    expect(store.status("s1")).toEqual({ unlocked: false, expiresAt: null });
  });
});

describe("kho vé terminal", () => {
  it("vé dùng một lần: consume đúng claims, lần hai trả null", () => {
    const store = createTerminalTicketStore();
    const { ticket } = store.issue(claims);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.consume(ticket)).toEqual(claims);
    expect(store.consume(ticket)).toBeNull();
  });

  it("vé hết hạn sau 60 giây và vé lạ trả null", () => {
    let now = 5_000;
    const store = createTerminalTicketStore({ now: () => now });
    const { ticket, expiresAt } = store.issue(claims);
    expect(expiresAt.getTime()).toBe(now + 60_000);
    expect(store.consume("khong-co-ve-nay")).toBeNull();
    now += 60_001;
    expect(store.consume(ticket)).toBeNull();
  });

  it("mỗi vé khác nhau", () => {
    const store = createTerminalTicketStore();
    expect(store.issue(claims).ticket).not.toBe(store.issue(claims).ticket);
  });
});
