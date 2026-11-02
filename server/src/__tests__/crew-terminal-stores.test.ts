import { describe, expect, it } from "vitest";
import { createUnlockThrottle } from "../crew/terminal/unlock-throttle.js";
import { createTerminalTicketStore } from "../crew/terminal/ticket-store.js";
import { createTerminalUnlockStore } from "../crew/terminal/unlock-store.js";

const HOUR = 60 * 60_000;
const claims = { companyId: "c1", userId: "u1", sessionId: "s1", machineId: "m1", projectId: "p1", slot: 3 };

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

describe("giới hạn thử mật khẩu mở khoá", () => {
  it("5 lần sai trong 15 phút thì chặn, hết cửa sổ thì cho thử lại", () => {
    let now = 0;
    const throttle = createUnlockThrottle({ now: () => now });
    for (let i = 0; i < 5; i++) expect(throttle.reserve("u1")).toBe(true);
    expect(throttle.reserve("u1")).toBe(false);
    expect(throttle.reserve("u2")).toBe(true);
    now += 15 * 60_000 + 1;
    expect(throttle.reserve("u1")).toBe(true);
  });

  it("giữ chỗ ngay khi thử: nhiều lần thử cùng lúc chưa xong vẫn không vượt quá 5", () => {
    const throttle = createUnlockThrottle({ now: () => 0 });
    // Mười yêu cầu cùng giữ chỗ trước khi kiểm mật khẩu xong.
    const granted = Array.from({ length: 10 }, () => throttle.reserve("u1")).filter(Boolean);
    expect(granted).toHaveLength(5);
  });

  it("mở khoá thành công xoá bộ đếm", () => {
    const throttle = createUnlockThrottle({ now: () => 0 });
    for (let i = 0; i < 5; i++) throttle.reserve("u1");
    throttle.clear("u1");
    expect(throttle.reserve("u1")).toBe(true);
  });
});
