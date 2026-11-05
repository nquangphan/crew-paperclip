import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { crewContributionRoutes } from "../crew/contribution-routes.js";
import { CREW_VIEWER_DATA_KEYS, crewRoadmapViewerScope } from "../crew/plugin-data-scope.js";

const COMPANY = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const GRANTED = "60000000-0000-4000-8000-000000000001";
const ALL = "60000000-0000-4000-8000-000000000009";

type Actor = Record<string, unknown>;
const session = (userId: string, companyIds = [COMPANY]): Actor => ({ type: "board", source: "session", userId, companyIds });

function app(actor: Actor, visible: (companyId: string, userId: string) => Promise<{ all: boolean; projectIds: string[] }>) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    (req as unknown as { actor: Actor }).actor = actor;
    next();
  });
  const scope = crewRoadmapViewerScope({} as Db, visible);
  server.post(["/plugins/:pluginId/data/crew.roadmap", "/plugins/:pluginId/bridge/data"], scope);
  // Route stock giả: trả lại body mà worker sẽ nhận.
  server.post("/plugins/:pluginId/data/:key", (req, res) => res.json(req.body));
  server.post("/plugins/:pluginId/bridge/data", (req, res) => res.json(req.body));
  return server;
}

const visibleFor = vi.fn(async (_companyId: string, userId: string) =>
  userId === "owner" ? { all: true, projectIds: [] } : { all: false, projectIds: [GRANTED] });

describe("crewRoadmapViewerScope: server ghi đè phạm vi xem của crew.roadmap", () => {
  it("crew.roadmap mở cho viewer như các key đọc khác", () => {
    expect(CREW_VIEWER_DATA_KEYS.has("crew.roadmap")).toBe(true);
  });

  it("thành viên bị giới hạn: params.viewer là project được cấp, viewer client tự gửi bị bỏ", async () => {
    const res = await request(app(session("member"), visibleFor))
      .post("/plugins/crew.core/data/crew.roadmap")
      .send({ companyId: COMPANY, params: { companyId: COMPANY, viewer: { all: true }, extra: 1 } });
    expect(res.body.params).toEqual({ companyId: COMPANY, extra: 1, viewer: { all: false, projectIds: [GRANTED] } });
    expect(visibleFor).toHaveBeenCalledWith(COMPANY, "member");
  });

  it("owner: thấy mọi project", async () => {
    const res = await request(app(session("owner"), visibleFor))
      .post("/plugins/crew.core/data/crew.roadmap")
      .send({ companyId: COMPANY, params: { viewer: { all: false, projectIds: [ALL] } } });
    expect(res.body.params.viewer).toEqual({ all: true });
  });

  it("bridge/data key crew.roadmap cũng bị ghi đè; key khác giữ nguyên", async () => {
    const server = app(session("member"), visibleFor);
    const scoped = await request(server).post("/plugins/crew.core/bridge/data")
      .send({ key: "crew.roadmap", companyId: COMPANY, params: { viewer: { all: true } } });
    expect(scoped.body.params.viewer).toEqual({ all: false, projectIds: [GRANTED] });
    const other = await request(server).post("/plugins/crew.core/bridge/data")
      .send({ key: "crew.roots", companyId: COMPANY, params: { viewer: { all: true } } });
    expect(other.body.params.viewer).toEqual({ all: true });
    const map = await request(server).post("/plugins/crew.core/data/crew.map")
      .send({ companyId: COMPANY, params: { viewer: { all: true } } });
    expect(map.body.params.viewer).toEqual({ all: true });
  });

  it("đóng khi lỗi: agent, API key, local_implicit, company không thuộc phiên, uuid sai, lỗi đọc quyền", async () => {
    const closed = { all: false, projectIds: [] };
    const cases: Array<[Actor, unknown]> = [
      [{ type: "agent", agentId: "a", companyId: COMPANY }, COMPANY],
      [{ type: "board", source: "board_key", userId: "member", companyIds: [COMPANY] }, COMPANY],
      [{ type: "board", source: "local_implicit" }, COMPANY],
      [{ type: "none" }, COMPANY],
      [session("member"), OTHER],
      [session("member"), "not-a-uuid"],
      [session("member"), undefined],
    ];
    for (const [actor, companyId] of cases) {
      const res = await request(app(actor, visibleFor))
        .post("/plugins/crew.core/data/crew.roadmap")
        .send({ companyId, params: { viewer: { all: true } } });
      expect(res.body.params.viewer).toEqual(closed);
    }
    const failing = await request(app(session("member"), async () => { throw new Error("db down"); }))
      .post("/plugins/crew.core/data/crew.roadmap")
      .send({ companyId: COMPANY });
    expect(failing.body.params).toEqual({ viewer: closed });
  });

  it("được gắn trong router Crew trước route plugin stock", async () => {
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      (req as unknown as { actor: Actor }).actor = session("member");
      next();
    });
    // DB giả không đọc được: phạm vi đóng, nhưng viewer client tự gửi vẫn bị ghi đè.
    server.use(crewContributionRoutes({ execute: async () => { throw new Error("no db"); } } as unknown as Db));
    server.post("/plugins/:pluginId/data/:key", (req, res) => res.json(req.body));
    const res = await request(server).post("/plugins/crew.core/data/crew.roadmap")
      .send({ companyId: COMPANY, params: { viewer: { all: true } } });
    expect(res.body.params.viewer).toEqual({ all: false, projectIds: [] });
  });
});
