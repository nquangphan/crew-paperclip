import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { badRequest, HttpError } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { contributorUserIdSchema, requireOwner, resolveContributionActor } from "./contributions.js";
import {
  grantedProjectIds,
  listProjectAccess,
  PROJECT_ACCESS_ERRORS,
  projectAccessTableReady,
  setProjectAccess,
  setProjectAccessSchema,
} from "./project-access.js";

function projectAccessUnavailable(): HttpError {
  return new HttpError(503, "Crew: chưa có bảng quyền xem project (plugin crew.core chưa nâng cấp), hãy thử lại sau.", {
    code: PROJECT_ACCESS_ERRORS.unavailable,
  });
}

const BASE = "/crew/companies/:companyId/project-access";

/**
 * Router quyền xem project, gắn bên trong router góp ý (vá lõi C7), nên không cần vá lõi mới. Cùng luật người gọi với
 * router góp ý: chỉ actor board đăng nhập bằng phiên trình duyệt, role đọc từ DB.
 *
 * - `GET  …/project-access/me`: project người gọi thấy (`all: true` với owner).
 * - `GET  …/project-access`: quyền của mọi thành viên (chỉ owner).
 * - `PUT  …/project-access/:userId` `{ projectIds }`: thay danh sách project của một thành viên (chỉ owner).
 */
export function crewProjectAccessRoutes(db: Db): Router {
  const router = Router();

  router.get(`${BASE}/me`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: false });
    if (actor.isOwner) {
      res.json({ all: true, projectIds: [] });
      return;
    }
    res.json({ all: false, projectIds: await grantedProjectIds(db, actor.companyId, actor.userId) });
  });

  router.get(BASE, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: false });
    requireOwner(actor);
    res.json({ items: await listProjectAccess(db, actor.companyId) });
  });

  router.put(`${BASE}/:userId`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: false });
    requireOwner(actor);
    const userId = contributorUserIdSchema.safeParse(req.params.userId);
    if (!userId.success) throw badRequest("userId không hợp lệ.", { code: PROJECT_ACCESS_ERRORS.invalid });
    const body = setProjectAccessSchema.safeParse(req.body);
    if (!body.success) {
      throw badRequest("Danh sách project không hợp lệ.", { code: PROJECT_ACCESS_ERRORS.invalid, issues: body.error.issues });
    }
    if (!(await projectAccessTableReady(db))) throw projectAccessUnavailable();
    const result = await setProjectAccess(db, {
      companyId: actor.companyId,
      userId: userId.data,
      projectIds: body.data.projectIds,
      grantedByUserId: actor.userId,
    });
    if (result.outcome === "not_member" || result.outcome === "owner") {
      res.status(409).json({
        error: "Chỉ đặt quyền xem project cho thành viên đang hoạt động không phải owner.",
        code: PROJECT_ACCESS_ERRORS.notMember,
      });
      return;
    }
    if (result.outcome === "unknown_projects") {
      res.status(422).json({
        error: "Có project không thuộc company.",
        code: PROJECT_ACCESS_ERRORS.invalid,
        projectIds: result.projectIds,
      });
      return;
    }
    logger.info(
      { companyId: actor.companyId, userId: userId.data, projects: result.projectIds.length },
      "crew project access set",
    );
    res.json({ userId: userId.data, all: false, projectIds: result.projectIds });
  });

  return router;
}
