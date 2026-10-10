import { describe, expect, it } from "vitest";
import { resolveMachineForWorkspace, workspaceOfEnvironment } from "../runtimes/machine.js";

const [mini, studio] = ["50000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000002"];
const path = "/Users/owner/crew-agents/repo-a/executor-codex";
const other = "/Users/owner/crew-agents/repo-a/executor";
const machine = (machineId: string, receivedAt: string, checkouts: string[]) => ({ machineId, receivedAt, checkouts });

// Bảng ca chung với server (`resolveAgentMachine`): cùng luật chọn máy của agent cho công tắc runtime.
const CASES: [string, string | null, ReturnType<typeof machine>[], string | null][] = [
  ["checkout khớp một máy trong hai máy", path, [machine(mini, "2026-10-10T05:00:00Z", [other]), machine(studio, "2026-10-10T05:00:00Z", [path])], studio],
  ["hai máy cùng có checkout: lấy bản tin mới nhất", path, [machine(mini, "2026-10-10T05:01:00Z", [path]), machine(studio, "2026-10-10T05:00:00Z", [path])], mini],
  ["không khớp, company một máy: lấy máy đó", path, [machine(mini, "2026-10-10T05:00:00Z", [other])], mini],
  ["không có workspace, company một máy: lấy máy đó", null, [machine(mini, "2026-10-10T05:00:00Z", [])], mini],
  ["không khớp, hai máy: không xác định", path, [machine(mini, "2026-10-10T05:00:00Z", [other]), machine(studio, "2026-10-10T05:00:00Z", [])], null],
  ["không có workspace, hai máy: không xác định", null, [machine(mini, "2026-10-10T05:00:00Z", [path]), machine(studio, "2026-10-10T05:00:00Z", [path])], null],
  ["chưa có máy nào", path, [], null],
];

describe("máy của agent", () => {
  it.each(CASES)("%s", (_name, workspace, machines, expected) => {
    expect(resolveMachineForWorkspace(workspace, machines)).toBe(expected);
  });

  it("workspace của environment lấy từ refs wizard (thêm project và thêm agent), bản mới nhất thắng", () => {
    const env = "80000000-0000-4000-8000-000000000001";
    expect(workspaceOfEnvironment(env, [
      { project: { refs: { project: "p" } }, environments: { refs: { [`environment_executor`]: env } }, checkouts: { refs: { checkout_executor: other } } },
    ])).toBe(other);
    expect(workspaceOfEnvironment(env.toUpperCase(), [
      { environment: { refs: { environment: env, checkout: path } } },
      { environments: { refs: { environment_executor: env } }, checkouts: { refs: { checkout_executor: other } } },
    ])).toBe(path);
    expect(workspaceOfEnvironment(env, [{ environment: { refs: { environment: "x", checkout: path } } }, {}, { bad: "x" }])).toBeNull();
    expect(workspaceOfEnvironment(env, [{ environments: { refs: { environment_executor: env } } }])).toBeNull();
    expect(workspaceOfEnvironment(null, [{ environment: { refs: { environment: env, checkout: path } } }])).toBeNull();
  });
});
