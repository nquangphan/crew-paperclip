import { expect, it, vi } from "vitest";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { registerSecurityGuards } from "../security/index.js";

const CREW = "10000000-0000-4000-8000-00000000000a";
const OTHER = "10000000-0000-4000-8000-00000000000b";
const AGENT = "30000000-0000-4000-8000-000000000001";
const NEW_AGENT = "30000000-0000-4000-8000-000000000002";
const PROJECT = "40000000-0000-4000-8000-000000000001";
const GOAL = "50000000-0000-4000-8000-000000000001";
const ref = { type: "secret_ref", secretId: "20000000-0000-4000-8000-000000000001" };

function harness(agentRoles: Record<string, string> = {}) {
  const handlers = new Map<string, (event: PluginEvent) => Promise<void>>();
  const pause = vi.fn(async (agentId: string) => ({ id: agentId, status: "paused" }));
  const log = vi.fn(async () => undefined);
  const warn = vi.fn();
  const ctx = {
    events: {
      on: vi.fn((name: string, fn: (event: PluginEvent) => Promise<void>) => {
        handlers.set(name, fn);
        return () => undefined;
      }),
    },
    companies: { list: vi.fn(async () => [{ id: CREW, name: "TPS", status: "active" }, { id: OTHER, name: "Khác", status: "active" }]) },
    config: { get: vi.fn(async (companyId: string) => (companyId === CREW ? { companies: [{ companyId: CREW, webhookSecretRef: ref }] } : {})) },
    agents: {
      pause,
      get: vi.fn(async (agentId: string, companyId: string) =>
        agentRoles[agentId] ? { id: agentId, companyId, role: agentRoles[agentId], status: "idle" } : null),
    },
    activity: { log },
    logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as PluginContext;
  registerSecurityGuards(ctx);
  const emit = (eventType: string, over: Partial<PluginEvent>) =>
    handlers.get(eventType)!({
      eventId: "e1", eventType: eventType as PluginEvent["eventType"], occurredAt: "2026-10-10T00:00:00.000Z",
      companyId: CREW, payload: {}, ...over,
    });
  return { emit, pause, log, warn, handlers };
}

it("đăng ký đủ sự kiện agent, project, goal và run", () => {
  const { handlers } = harness();
  expect([...handlers.keys()].sort()).toEqual([
    "agent.created", "agent.run.started", "goal.created", "goal.updated", "project.created", "project.updated",
    "project.workspace_created", "project.workspace_deleted", "project.workspace_updated",
  ]);
});

it("agent mới không do board tạo trong company Crew bị pause và ghi log", async () => {
  const { emit, pause, log } = harness();
  await emit("agent.created", { actorType: "agent", actorId: AGENT, entityType: "agent", entityId: NEW_AGENT });
  expect(pause).toHaveBeenCalledWith(NEW_AGENT, CREW);
  expect(log).toHaveBeenCalledWith({
    companyId: CREW, message: "crew.security.agent_paused", entityType: "agent", entityId: NEW_AGENT,
    metadata: { agentId: NEW_AGENT, reason: "created_by_non_board", actorType: "agent", actorId: AGENT },
  });
});

it("agent do board tạo, hoặc company ngoài Crew: không làm gì", async () => {
  const { emit, pause, log } = harness();
  await emit("agent.created", { actorType: "user", actorId: "owner-1", entityType: "agent", entityId: NEW_AGENT });
  await emit("agent.created", { companyId: OTHER, actorType: "agent", actorId: AGENT, entityType: "agent", entityId: NEW_AGENT });
  expect(pause).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

it("run bắt đầu của agent role ceo trong company Crew (vd. onboarding seed): pause agent đó", async () => {
  const { emit, pause, log } = harness({ [NEW_AGENT]: "ceo", [AGENT]: "engineer" });
  await emit("agent.run.started", { actorType: "system", payload: { agentId: AGENT, runId: "r1" } });
  expect(pause).not.toHaveBeenCalled();
  await emit("agent.run.started", { actorType: "system", payload: { agentId: NEW_AGENT, runId: "r2" } });
  expect(pause).toHaveBeenCalledWith(NEW_AGENT, CREW);
  expect(log).toHaveBeenCalledWith(expect.objectContaining({
    message: "crew.security.agent_paused", entityId: NEW_AGENT, metadata: expect.objectContaining({ reason: "ceo_role", runId: "r2" }),
  }));
});

it.each(["project.created", "project.updated", "project.workspace_created", "project.workspace_updated", "project.workspace_deleted"])(
  "%s do agent: ghi log project_changed và pause agent đó",
  async (eventType) => {
    const { emit, pause, log } = harness();
    await emit(eventType, { actorType: "agent", actorId: AGENT, entityType: "project", entityId: PROJECT, payload: { agentId: AGENT } });
    expect(pause).toHaveBeenCalledWith(AGENT, CREW);
    expect(log).toHaveBeenCalledWith({
      companyId: CREW, message: "crew.security.project_changed", entityType: "project", entityId: PROJECT,
      metadata: { projectId: PROJECT, agentId: AGENT, eventType, agentPaused: true },
    });
  },
);

it("project do board sửa: không làm gì", async () => {
  const { emit, pause, log } = harness();
  await emit("project.updated", { actorType: "user", actorId: "owner-1", entityType: "project", entityId: PROJECT });
  expect(pause).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

it.each(["goal.created", "goal.updated"])("%s do agent: chỉ ghi log, không pause", async (eventType) => {
  const { emit, pause, log } = harness();
  await emit(eventType, { actorType: "agent", actorId: AGENT, entityType: "goal", entityId: GOAL });
  expect(pause).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith({
    companyId: CREW, message: "crew.security.goal_changed", entityType: "goal", entityId: GOAL,
    metadata: { goalId: GOAL, agentId: AGENT, eventType },
  });
});

it("pause lỗi (agent đã terminated) vẫn ghi log, agentPaused=false, cảnh báo server", async () => {
  const { emit, pause, log, warn } = harness();
  pause.mockRejectedValueOnce(new Error("Cannot pause terminated agent"));
  await emit("project.created", { actorType: "agent", actorId: AGENT, entityType: "project", entityId: PROJECT });
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ agentPaused: false }) }));
  expect(warn).toHaveBeenCalled();
});
