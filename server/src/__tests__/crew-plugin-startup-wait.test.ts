import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { crewContributionRoutes } from "../crew/contribution-routes.js";
import { crewPluginStartupWait } from "../crew/plugin-startup-wait.js";

/** App như `createApp`: router Crew gắn trước route plugin stock; route stock trả 502 khi worker chưa đăng ký. */
function appWithStartup(startup: Promise<unknown> | undefined, mount: (api: express.Router) => void) {
  const app = express();
  const worker = { registered: false };
  if (startup) app.locals.bundledPluginsStartup = startup;
  const api = express.Router();
  mount(api);
  api.post("/plugins/:pluginId/data/:key", (_req, res) => {
    if (!worker.registered) res.status(502).json({ code: "WORKER_UNAVAILABLE", message: "No worker registered" });
    else res.json({ data: "ok" });
  });
  api.get("/health", (_req, res) => { res.json({ status: "ok" }); });
  app.use("/api", api);
  return { app, worker };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("Crew: request plugin lúc vừa khởi động chờ worker đăng ký", () => {
  it("router Crew giữ request /plugins/... tới khi lượt nạp plugin xong rồi route stock trả 200 (trước đây 502)", async () => {
    const startup = deferred();
    const { app, worker } = appWithStartup(startup.promise, (api) => api.use(crewContributionRoutes({} as never)));
    const pending = request(app).post("/api/plugins/crew.core/data/crew.companies").send({});
    const response = pending.then((res) => res);
    await new Promise((r) => setTimeout(r, 100));
    worker.registered = true;
    startup.resolve();
    const res = await response;
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: "ok" });
    // Đã nạp xong: request sau đi thẳng.
    const started = Date.now();
    expect((await request(app).post("/api/plugins/crew.core/data/crew.roots").send({})).status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("request ngoài /plugins không chờ lượt nạp plugin", async () => {
    const { app } = appWithStartup(new Promise(() => {}), (api) => api.use(crewContributionRoutes({} as never)));
    const started = Date.now();
    expect((await request(app).get("/api/health")).status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("lượt nạp quá hạn chờ: đi tiếp tới route stock như cũ (không treo request)", async () => {
    const { app } = appWithStartup(new Promise(() => {}), (api) => api.use("/plugins", crewPluginStartupWait(50)));
    const res = await request(app).post("/api/plugins/crew.core/data/crew.companies").send({});
    expect(res.status).toBe(502);
  });

  it("không có promise khởi động (app không phải createApp): đi tiếp ngay", async () => {
    const { app, worker } = appWithStartup(undefined, (api) => api.use("/plugins", crewPluginStartupWait()));
    worker.registered = true;
    expect((await request(app).post("/api/plugins/crew.core/data/crew.companies").send({})).status).toBe(200);
  });
});
