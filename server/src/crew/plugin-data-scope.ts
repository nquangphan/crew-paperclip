import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { companyMemberships, type Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { hasCompanyAccess } from "../routes/authz.js";
import { loadCrewCompanyConfig } from "./issue-policy.js";
import { CREW_PLUGIN_KEY } from "./project-roles.js";
import { visibleProjectsFor } from "./project-access.js";

/**
 * Phạm vi company cho `POST /plugins/:pluginId/data/:key` khi viewer của company Crew đọc data plugin `crew.core`.
 *
 * Route data là POST nên `assertPluginBridgeScope` stock chặn viewer (`Viewer access is read-only`), làm UI Crew không
 * dùng được với viewer. Viewer được qua khi đủ mọi điều kiện:
 * - plugin là `crew.core` và data key nằm trong {@link CREW_VIEWER_DATA_KEYS};
 * - actor là board có `userId` (không phải `local_implicit`) và company nằm trong danh sách company của phiên;
 * - phiên ghi nhận membership `viewer` ở company đó (role khác thì stock đã cho qua, không cần tra thêm);
 * - company có trong cấu hình Crew và cấu hình đọc được (hỏng thì đóng);
 * - DB xác nhận membership `active`, `principal_type='user'`, `membership_role='viewer'`.
 *
 * Trả `companyId` khi được qua; trường hợp khác trả `undefined` để route chạy kiểm tra stock. Lỗi đọc DB cũng trả
 * `undefined` (đóng khi lỗi: viewer nhận 403 stock). Không dùng cho route ghi hay `bridge/*`, `actions/*`.
 */
/**
 * Data key `crew.core` mà UI Crew đọc ở những trang viewer vào được (tổng quan, project, issue, docs). Key mới của
 * plugin không tự mở cho viewer: phải thêm vào đây. Các key chỉ dùng ở trang Máy, Skill, wizard hay báo cáo chi phí
 * (`crew.machineJobs`, `crew.skillSync`, `crew.storage`, `crew.usage.*`, `crew.docs.graph`/`history`/`status`) giữ
 * kiểm tra stock.
 */
export const CREW_VIEWER_DATA_KEYS: ReadonlySet<string> = new Set([
  "crew.companies",
  "crew.roots",
  "crew.roadmap",
  "crew.map",
  "crew.docsCheck",
  "crew.runtimeDecisions",
  "crew.machines",
  "crew.setupRuns",
  "crew.docs.projects",
  "crew.docs.tree",
  "crew.docs.page",
  "crew.docs.search",
]);

export async function crewViewerPluginDataScope(
  db: Db,
  req: Request,
  pluginKey: string,
  dataKey: string,
  companyId: unknown,
): Promise<string | undefined> {
  if (pluginKey !== CREW_PLUGIN_KEY || !CREW_VIEWER_DATA_KEYS.has(dataKey)) return undefined;
  const actor = req.actor;
  if (actor.type !== "board" || actor.source === "local_implicit") return undefined;
  const userId = actor.userId?.trim();
  if (!userId) return undefined;
  if (typeof companyId !== "string" || companyId.trim().length === 0 || companyId !== companyId.trim()) return undefined;
  if (!hasCompanyAccess(req, companyId)) return undefined;
  const cached = actor.memberships?.find((item) => item.companyId === companyId);
  if (cached?.membershipRole !== "viewer") return undefined;

  try {
    const config = await loadCrewCompanyConfig(companyId);
    if (config.kind !== "ok") return undefined;
    const rows = await db
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId),
          eq(companyMemberships.status, "active"),
          eq(companyMemberships.membershipRole, "viewer"),
        ),
      )
      .limit(1);
    return rows.length > 0 ? companyId : undefined;
  } catch (error) {
    logger.warn({ err: error, companyId }, "Crew: không đọc được membership viewer, giữ kiểm tra stock cho data plugin");
    return undefined;
  }
}

/** Data key Roadmap một trang: cây mọi yêu cầu, lọc project được xem ở worker theo `params.viewer` server ghi. */
export const CREW_ROADMAP_DATA_KEY = "crew.roadmap";

export type RoadmapViewerScope = { all: true } | { all: false; projectIds: string[] };
type VisibleResolver = (companyId: string, userId: string) => Promise<{ all: boolean; projectIds: string[] }>;

const CLOSED: RoadmapViewerScope = { all: false, projectIds: [] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Đường dẫn router Crew gắn {@link crewRoadmapViewerScope}: đúng hai route data stock. Gắn trên `:key` chứ không trên
 * literal `data/crew.roadmap`: Express khớp route trên path CHƯA decode nhưng decode `req.params.key`, nên
 * `data/crew%2Eroadmap` không khớp literal mà route stock vẫn nhận `key = "crew.roadmap"`.
 */
export const CREW_ROADMAP_SCOPE_PATHS = ["/plugins/:pluginId/data/:key", "/plugins/:pluginId/bridge/data"];

/**
 * Worker plugin không biết ai đang xem, nên trước route data stock, router Crew tính phạm vi xem project của người gọi
 * cho `crew.roadmap` (`POST /plugins/:pluginId/data/:key` có key đã decode là `crew.roadmap`, với mọi cách viết như
 * `crew%2Eroadmap`; và `bridge/data` có `key: "crew.roadmap"`) rồi GHI ĐÈ `params.viewer` (giá trị client tự gửi bị
 * bỏ). Key so đúng giá trị route stock chuyển cho worker: `req.params.key` đã decode, hay `body.key` của `bridge/data`.
 * Cùng luật với `project-access/me`: chỉ actor board đăng nhập bằng phiên trình duyệt; owner `{ all: true }`, người
 * khác project được cấp. Actor khác, company không thuộc phiên hay uuid sai thì `{ all: false, projectIds: [] }`.
 * Lỗi đọc quyền thì trả 503 (route stock không chạy, worker không nhận gì) để client báo lỗi kèm Thử lại thay vì hiện
 * Roadmap rỗng như thể không có yêu cầu. Kiểm quyền company vẫn do route stock. Chỉ `crew.roadmap` đọc `params.viewer`;
 * key khác trong {@link CREW_VIEWER_DATA_KEYS} đi nguyên.
 */
export function crewRoadmapViewerScope(
  db: Db,
  visible: VisibleResolver = (companyId, userId) => visibleProjectsFor(db, companyId, userId),
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    // Route `data/:key`: key worker nhận là `req.params.key` đã decode; route `bridge/data`: `body.key`.
    const key = typeof req.params.key === "string" ? req.params.key : body.key;
    if (key !== CREW_ROADMAP_DATA_KEY) {
      next();
      return;
    }
    const write = (viewer: RoadmapViewerScope) => {
      const params = body.params && typeof body.params === "object" ? body.params as Record<string, unknown> : {};
      req.body = { ...body, params: { ...params, viewer } };
      next();
    };
    void roadmapViewerOf(req, body.companyId, visible).then(write, (error: unknown) => {
      // Lỗi tạm thời đã biết (DB chập chờn): log một lần ở đây và trả 503 thẳng, không qua errorHandler (nhánh 5xx của
      // nó báo crash mỗi request, nhân lên theo số lần client thử lại).
      logger.warn(
        { err: error, companyId: body.companyId },
        "Crew: không đọc được quyền xem project cho crew.roadmap, trả 503",
      );
      res.status(503).json({ error: ROADMAP_SCOPE_UNAVAILABLE_MESSAGE, code: ROADMAP_SCOPE_UNAVAILABLE_CODE });
    });
  };
}

const ROADMAP_SCOPE_UNAVAILABLE_MESSAGE = "Crew: tạm thời không đọc được quyền xem project, hãy thử lại.";
const ROADMAP_SCOPE_UNAVAILABLE_CODE = "crew_roadmap_scope_unavailable";

async function roadmapViewerOf(req: Request, companyId: unknown, visible: VisibleResolver): Promise<RoadmapViewerScope> {
  const actor = req.actor;
  if (actor?.type !== "board" || actor.source !== "session") return CLOSED;
  const userId = typeof actor.userId === "string" ? actor.userId.trim() : "";
  if (!userId || typeof companyId !== "string" || !UUID.test(companyId) || !hasCompanyAccess(req, companyId)) return CLOSED;
  const scope = await visible(companyId, userId);
  return scope.all ? { all: true } : { all: false, projectIds: [...scope.projectIds] };
}
