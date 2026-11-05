import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import * as projectAccess from "../crew/project-access.js";
import { crewContributionRoutes } from "../crew/contribution-routes.js";
import { CREW_ROADMAP_SCOPE_PATHS, CREW_VIEWER_DATA_KEYS, crewRoadmapViewerScope } from "../crew/plugin-data-scope.js";

const COMPANY = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const GRANTED = "60000000-0000-4000-8000-000000000001";
const ALL = "60000000-0000-4000-8000-000000000009";

// Người được cấp đúng một project: router Crew thật đọc quyền qua `visibleProjectsFor`; user khác giữ hàm thật.
vi.mock("../crew/project-access.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../crew/project-access.js")>();
  return {
    ...actual,
    visibleProjectsFor: vi.fn((db: Db, companyId: string, userId: string) =>
      userId === "one-project"
        ? Promise.resolve({ all: false, projectIds: ["60000000-0000-4000-8000-000000000001"] })
        : actual.visibleProjectsFor(db, companyId, userId)),
  };
});

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
  server.post(CREW_ROADMAP_SCOPE_PATHS, scope);
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

  it("đóng khi lỗi: agent, API key, local_implicit, company không thuộc phiên, uuid sai", async () => {
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
  });

  it("lỗi đọc quyền: trả 503 có mã lỗi, route stock không chạy (không phải Roadmap rỗng 200)", async () => {
    const server = app(session("member"), async () => { throw new Error("db down"); });
    // Trả thẳng trong middleware, không qua errorHandler (nhánh 5xx của nó báo crash): handler lỗi gắn sau không được gọi.
    const crashPath = vi.fn((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).end();
    });
    server.use(crashPath);
    for (const path of ["/plugins/crew.core/data/crew.roadmap", "/plugins/crew.core/data/crew%2Eroadmap"]) {
      const res = await request(server).post(path).send({ companyId: COMPANY, params: { viewer: { all: true } } });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: "Crew: tạm thời không đọc được quyền xem project, hãy thử lại.",
        code: "crew_roadmap_scope_unavailable",
      });
    }
    expect(crashPath).not.toHaveBeenCalled();
    const bridge = await request(server).post("/plugins/crew.core/bridge/data")
      .send({ key: "crew.roadmap", companyId: COMPANY, params: { viewer: { all: true } } });
    expect(bridge.status).toBe(503);
    // Không được cấp project nào (đọc quyền thành công) vẫn là Roadmap rỗng 200.
    const none = await request(app(session("member"), async () => ({ all: false, projectIds: [] })))
      .post("/plugins/crew.core/data/crew.roadmap")
      .send({ companyId: COMPANY });
    expect(none.status).toBe(200);
    expect(none.body.params.viewer).toEqual({ all: false, projectIds: [] });
  });

  it("được gắn trong router Crew trước route plugin stock", async () => {
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      (req as unknown as { actor: Actor }).actor = session("member");
      next();
    });
    // DB giả không đọc được: middleware chặn bằng 503 trước route stock, viewer client tự gửi không tới worker.
    server.use(crewContributionRoutes({ execute: async () => { throw new Error("no db"); } } as unknown as Db));
    const stock = vi.fn((req: express.Request, res: express.Response) => res.json(req.body));
    server.post("/plugins/:pluginId/data/:key", stock);
    const res = await request(server).post("/plugins/crew.core/data/crew.roadmap")
      .send({ companyId: COMPANY, params: { viewer: { all: true } } });
    expect(res.status).toBe(503);
    expect(stock).not.toHaveBeenCalled();
  });
});

describe("router Crew: viewer client gửi không tới worker với mọi cách viết key crew.roadmap", () => {
  /** Router Crew thật trước route stock giả; route stock giả trả lại key đã decode và body worker sẽ nhận. */
  function crewApp(userId: string) {
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => {
      (req as unknown as { actor: Actor }).actor = session(userId);
      next();
    });
    server.use(crewContributionRoutes({ execute: async () => { throw new Error("no db"); } } as unknown as Db));
    server.post("/plugins/:pluginId/data/:key", (req, res) => res.json({ key: req.params.key, body: req.body }));
    server.post("/plugins/:pluginId/bridge/data", (req, res) => res.json({ key: req.body.key, body: req.body }));
    return server;
  }

  const KEY_SPELLINGS = ["crew.roadmap", "crew%2Eroadmap", "crew%2eroadmap", "%63rew.roadmap", "crew.roadmap/"];

  it.each(KEY_SPELLINGS)("data/%s: params.viewer={all:true} client gửi bị ghi đè bằng viewer server", async (spelling) => {
    const res = await request(crewApp("one-project")).post(`/plugins/crew.core/data/${spelling}`)
      .send({ companyId: COMPANY, params: { companyId: COMPANY, viewer: { all: true } } });
    expect(res.status).toBe(200);
    expect(res.body.key).toBe("crew.roadmap");
    expect(res.body.body.params).toEqual({ companyId: COMPANY, viewer: { all: false, projectIds: [GRANTED] } });
    expect(vi.mocked(projectAccess.visibleProjectsFor)).toHaveBeenCalledWith(expect.anything(), COMPANY, "one-project");
  });

  it.each(KEY_SPELLINGS)("data/%s: lỗi đọc quyền thì 503, viewer client không tới worker", async (spelling) => {
    const res = await request(crewApp("member")).post(`/plugins/crew.core/data/${spelling}`)
      .send({ companyId: COMPANY, params: { viewer: { all: true } } });
    expect(res.status).toBe(503);
    expect(res.body.key).toBeUndefined();
  });

  it("bridge/data key crew.roadmap: viewer client bị ghi đè", async () => {
    const res = await request(crewApp("one-project")).post("/plugins/crew.core/bridge/data")
      .send({ key: "crew.roadmap", companyId: COMPANY, params: { viewer: { all: true } } });
    expect(res.body.body.params.viewer).toEqual({ all: false, projectIds: [GRANTED] });
  });

  it("key khác (kể cả viết mã hóa) không bị đụng tới", async () => {
    const server = crewApp("one-project");
    for (const spelling of ["crew.map", "crew%2Emap", "crew.roots"]) {
      const res = await request(server).post(`/plugins/crew.core/data/${spelling}`)
        .send({ companyId: COMPANY, params: { viewer: { all: true } } });
      expect(res.body.body.params.viewer).toEqual({ all: true });
    }
    const bridge = await request(server).post("/plugins/crew.core/bridge/data")
      .send({ key: "crew.roots", companyId: COMPANY, params: { viewer: { all: true } } });
    expect(bridge.body.body.params.viewer).toEqual({ all: true });
  });
});
