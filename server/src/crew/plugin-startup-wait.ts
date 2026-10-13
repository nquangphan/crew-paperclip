import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger } from "../middleware/logger.js";

/** Chờ lượt nạp plugin lúc khởi động tối đa chừng này; quá thì để route stock xử lý như cũ. */
export const CREW_PLUGIN_STARTUP_WAIT_MS = 10_000;

/**
 * Server mở cổng trước khi nạp xong plugin: `createApp` không chờ chuỗi `ensureBundledPlugins().then(loader.loadAll)`
 * mà chỉ gắn promise của nó vào `app.locals.bundledPluginsStartup` (không bao giờ reject). Trong ~2-3 giây đầu sau mỗi
 * lần deploy, request vào `/api/plugins/...` gặp lúc worker chưa đăng ký: route data trả 502 `No worker registered`,
 * route API của plugin trả 503 `Plugin worker is not running`. Middleware này giữ request `/plugins/...` lại tới khi lượt
 * nạp đó xong (tối đa `waitMs`), rồi cho đi tiếp tới route stock. Lượt nạp xong rồi thì không chờ gì nữa. Không có
 * promise (test, app khác) hay quá hạn thì đi tiếp ngay: hành vi stock giữ nguyên.
 */
export function crewPluginStartupWait(waitMs = CREW_PLUGIN_STARTUP_WAIT_MS): RequestHandler {
  let settled = false;
  return (req: Request, _res: Response, next: NextFunction) => {
    const startup = req.app?.locals?.bundledPluginsStartup as Promise<unknown> | undefined;
    if (settled || !startup || typeof startup.then !== "function") {
      next();
      return;
    }
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), waitMs); });
    void Promise.race([startup.then(() => "loaded" as const, () => "loaded" as const), timeout]).then((outcome) => {
      clearTimeout(timer);
      if (outcome === "loaded") settled = true;
      else logger.warn({ url: req.originalUrl, waitedMs: Date.now() - started }, "crew: plugin startup still loading, passing request through");
      next();
    });
  };
}
