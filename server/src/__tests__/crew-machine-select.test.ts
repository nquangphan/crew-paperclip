import { describe, expect, it } from "vitest";
import { choiceReason, chooseMachine, type MachineCandidate } from "../crew/machine-select.ts";

const NOW = new Date("2026-10-24T02:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const machine = (over: Partial<MachineCandidate> & { hostname: string }): MachineCandidate => ({
  machineId: `m-${over.hostname}`,
  projectStatus: "ready",
  receivedAt: ago(1),
  jobsPollAt: ago(1),
  load1: 2,
  cpuCount: 10,
  memFreePct: 50,
  running: 0,
  maxLoad1: 8,
  ...over,
});

describe("chọn máy cho cây yêu cầu", () => {
  it("máy ready có ít run running nhất thắng", () => {
    const book = machine({ hostname: "book", running: 2 });
    const mini = machine({ hostname: "mini", running: 1 });
    expect(chooseMachine([book, mini], NOW, true)).toEqual({ kind: "ready", candidate: mini });
  });

  it("hòa số run thì máy có load1/cpu thấp hơn thắng", () => {
    const book = machine({ hostname: "book", load1: 6, cpuCount: 12 });
    const mini = machine({ hostname: "mini", load1: 4, cpuCount: 4 });
    expect(chooseMachine([mini, book], NOW, true)).toEqual({ kind: "ready", candidate: book });
  });

  it("hòa cả số run lẫn tải thì theo tên máy để kết quả ổn định", () => {
    const b = machine({ hostname: "b-mac" });
    const a = machine({ hostname: "a-mac" });
    expect(chooseMachine([b, a], NOW, true)).toEqual({ kind: "ready", candidate: a });
  });

  it("loại máy có load1 vượt maxLoad1, RAM trống dưới 10% hay bản tin cũ hơn 5 phút", () => {
    const hot = machine({ hostname: "hot", load1: 9 });
    const full = machine({ hostname: "full", memFreePct: 9 });
    const stale = machine({ hostname: "stale", receivedAt: ago(6) });
    const ok = machine({ hostname: "ok", running: 3 });
    expect(chooseMachine([hot, full, stale, ok], NOW, true)).toEqual({ kind: "ready", candidate: ok });
  });

  it("máy chưa dựng chỉ được chọn khi mọi máy ready đều bị loại, và app trên máy phải đang nhận việc", () => {
    const hot = machine({ hostname: "book", load1: 9 });
    const fresh = machine({ hostname: "mini", projectStatus: null });
    expect(chooseMachine([hot, fresh], NOW, true)).toEqual({ kind: "provision", candidate: fresh });
    const appIdle = machine({ hostname: "mini", projectStatus: null, jobsPollAt: ago(6) });
    expect(chooseMachine([hot, appIdle], NOW, true)).toEqual({ kind: "overloaded", candidate: hot });
    const ready = machine({ hostname: "book" });
    expect(chooseMachine([ready, fresh], NOW, true)).toEqual({ kind: "ready", candidate: ready });
  });

  it("máy đang dựng dở được chọn như máy chưa dựng, máy dựng hỏng thì không", () => {
    const building = machine({ hostname: "mini", projectStatus: "provisioning" });
    expect(chooseMachine([building], NOW, true)).toEqual({ kind: "provision", candidate: building });
    expect(chooseMachine([machine({ hostname: "mini", projectStatus: "failed" })], NOW, true)).toEqual({ kind: "none" });
  });

  it("project chưa dựng được (thiếu repo hoặc checkout vai trò) thì không chọn máy chưa dựng để dựng, rơi về máy ready quá tải", () => {
    const hot = machine({ hostname: "book", load1: 9 });
    const fresh = machine({ hostname: "mini", projectStatus: null });
    expect(chooseMachine([hot, fresh], NOW, false)).toEqual({ kind: "overloaded", candidate: hot });
    expect(chooseMachine([fresh], NOW, false)).toEqual({ kind: "none" });
    const building = machine({ hostname: "mini", projectStatus: "provisioning" });
    expect(chooseMachine([building], NOW, false)).toEqual({ kind: "none" });
    expect(chooseMachine([hot, fresh], NOW, true)).toEqual({ kind: "provision", candidate: fresh });
  });

  it("không máy nào đạt ngưỡng: chọn máy ready online điểm thấp nhất để cổng tải giữ run", () => {
    const a = machine({ hostname: "book", load1: 12, running: 2 });
    const b = machine({ hostname: "mini", load1: 10, running: 1 });
    expect(chooseMachine([a, b], NOW, true)).toEqual({ kind: "overloaded", candidate: b });
  });

  it("không có máy ready nào online thì không chọn", () => {
    expect(chooseMachine([machine({ hostname: "book", receivedAt: ago(10) })], NOW, true)).toEqual({ kind: "none" });
    expect(chooseMachine([], NOW, true)).toEqual({ kind: "none" });
  });

  it("lý do ghi các số lúc chọn", () => {
    const mini = machine({ hostname: "mini", running: 1, load1: 3.9, memFreePct: 54, receivedAt: ago(2) });
    expect(choiceReason({ kind: "ready", candidate: mini }, NOW)).toEqual({
      rule: "ready", running: 1, load1: 3.9, cpuCount: 10, memFreePct: 54, reportAgeSec: 120,
    });
  });
});
