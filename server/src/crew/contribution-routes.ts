import { Router, type Response } from "express";
import type { Db } from "@paperclipai/db";
import { badRequest } from "../errors.js";
import { logger } from "../middleware/logger.js";
import {
  approveContribution,
  assertCanRead,
  completeContribution,
  type Contribution,
  CONTRIBUTION_ERRORS,
  contributorUserIdSchema,
  countPending,
  createContribution,
  getContribution,
  grantContributor,
  listContributions,
  listContributors,
  listQuerySchema,
  parseCreateBody,
  rejectContribution,
  requireContributor,
  requireOwner,
  requireOwnerOrContributor,
  resolveContributionActor,
  revokeContributor,
  selfHeal,
  toContribution,
} from "./contributions.js";

const BASE = "/crew/companies/:companyId";
const BODY_LOCAL = "crewContributionBody";

/**
 * Body đã chuyển sang `res.locals` của request góp ý. Logger HTTP và error handler chép `req.body` vào log (mọi phản hồi
 * ≥ 400) và vào ngữ cảnh lỗi (5xx), mà body ở đây là nội dung chờ duyệt, agent không được thấy. Vì vậy router dời body
 * ra khỏi `req` trước mọi bước có thể lỗi, và handler chỉ đọc nó ở đây.
 */
function takeBody(res: Response): unknown {
  return res.locals[BODY_LOCAL];
}

/** 409 kèm mục góp ý hiện tại, để UI cập nhật ngay mà không cần đọc lại. */
function conflictWith(res: Response, code: string, error: string, contribution: Contribution): void {
  res.status(409).json({ error, code, contribution });
}

/**
 * Router Crew cho góp ý chờ duyệt của Phòng Marketing (spec §5). Gắn vào `createApp` bằng vá lõi C7.
 *
 * - Chỉ actor board đăng nhập bằng phiên trình duyệt; agent, board API key và `local_implicit` nhận
 *   `403 crew_contribution_forbidden`.
 * - Body không bao giờ nằm ở `req.body` khi handler chạy (xem {@link takeBody}), nên log và Sentry không có nội dung.
 * - Quyền xét theo role đọc từ DB (owner / viewer có dấu khách góp ý), không qua `assertCompanyAccess`.
 * - Không ghi `activity_log`, không phát live event hay event plugin; log chỉ ghi id.
 */
export function crewContributionRoutes(db: Db): Router {
  const router = Router();

  router.use([`${BASE}/contributions`, `${BASE}/contributors`], (req, res, next) => {
    res.locals[BODY_LOCAL] = req.body;
    req.body = {};
    next();
  });

  router.get(`${BASE}/access`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: false });
    res.json({
      userId: actor.userId,
      membershipRole: actor.membershipRole,
      contributor: actor.contributor,
      canApprove: actor.isOwner,
    });
  });

  router.get(`${BASE}/contributions`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: true });
    requireOwnerOrContributor(actor);
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw badRequest("Tham số lọc góp ý không hợp lệ.", { code: CONTRIBUTION_ERRORS.invalid, issues: query.error.issues });
    }
    await selfHeal(db, actor.companyId);
    const page = await listContributions(db, {
      companyId: actor.companyId,
      authorUserId: actor.isOwner ? null : actor.userId,
      query: query.data,
    });
    res.json(page);
  });

  router.get(`${BASE}/contributions/summary`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: true });
    requireOwnerOrContributor(actor);
    await selfHeal(db, actor.companyId);
    res.json({ pending: await countPending(db, actor.companyId, actor.isOwner ? null : actor.userId) });
  });

  router.get(`${BASE}/contributions/:id`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: true });
    requireOwnerOrContributor(actor);
    const record = assertCanRead(actor, await getContribution(db, actor.companyId, req.params.id));
    res.json(toContribution(record));
  });

  router.post(`${BASE}/contributions`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: true });
    requireContributor(actor);
    const data = parseCreateBody(takeBody(res));
    const contribution = await createContribution(db, { companyId: actor.companyId, authorUserId: actor.userId, data });
    logger.info({ companyId: actor.companyId, contributionId: contribution.id, kind: contribution.kind }, "crew contribution created");
    res.status(201).json(contribution);
  });

  router.post(`${BASE}/contributions/:id/approve`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: true });
    requireOwner(actor);
    const result = await approveContribution(db, { companyId: actor.companyId, id: req.params.id, userId: actor.userId });
    logger.info(
      { companyId: actor.companyId, contributionId: result.contribution.id, outcome: result.outcome },
      "crew contribution approve",
    );
    if (result.outcome === "decided") {
      conflictWith(res, CONTRIBUTION_ERRORS.decided, "Mục góp ý này đã được quyết định.", result.contribution);
      return;
    }
    if (result.outcome === "locked") {
      conflictWith(
        res,
        CONTRIBUTION_ERRORS.locked,
        "Owner khác đang duyệt mục này, hãy thử lại sau ít phút.",
        result.contribution,
      );
      return;
    }
    res.json({ contribution: result.contribution, materialize: result.materialize });
  });

  router.post(`${BASE}/contributions/:id/approve/complete`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: true });
    requireOwner(actor);
    const result = await completeContribution(db, { companyId: actor.companyId, id: req.params.id });
    logger.info(
      { companyId: actor.companyId, contributionId: result.contribution.id, outcome: result.outcome },
      "crew contribution approve complete",
    );
    if (result.outcome === "not_materialized") {
      conflictWith(
        res,
        CONTRIBUTION_ERRORS.notMaterialized,
        "Chưa thấy bản ghi đã đăng, hãy bấm Duyệt lại.",
        result.contribution,
      );
      return;
    }
    if (result.outcome === "not_approving") {
      conflictWith(res, CONTRIBUTION_ERRORS.notApproving, "Mục góp ý này không ở trạng thái đang duyệt.", result.contribution);
      return;
    }
    res.json(result.contribution);
  });

  router.post(`${BASE}/contributions/:id/reject`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: true });
    requireOwner(actor);
    const result = await rejectContribution(db, { companyId: actor.companyId, id: req.params.id, userId: actor.userId });
    logger.info(
      { companyId: actor.companyId, contributionId: result.contribution.id, outcome: result.outcome },
      "crew contribution reject",
    );
    if (result.outcome === "approved") {
      conflictWith(res, CONTRIBUTION_ERRORS.alreadyApproved, "Mục góp ý này đã được duyệt, không từ chối được.", result.contribution);
      return;
    }
    if (result.outcome === "locked") {
      conflictWith(
        res,
        CONTRIBUTION_ERRORS.locked,
        "Owner khác đang duyệt mục này, hãy thử lại sau ít phút.",
        result.contribution,
      );
      return;
    }
    res.json(result.contribution);
  });

  router.get(`${BASE}/contributors`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: true });
    requireOwner(actor);
    res.json({ items: await listContributors(db, actor.companyId) });
  });

  router.put(`${BASE}/contributors/:userId`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: true });
    requireOwner(actor);
    const userId = parseContributorUserId(req.params.userId);
    const granted = await grantContributor(db, { companyId: actor.companyId, userId, grantedByUserId: actor.userId });
    if (!granted) {
      res.status(409).json({
        error: "Chỉ bật góp ý cho thành viên viewer đang hoạt động.",
        code: CONTRIBUTION_ERRORS.requiresViewer,
      });
      return;
    }
    logger.info({ companyId: actor.companyId, userId }, "crew contributor granted");
    res.status(204).end();
  });

  router.delete(`${BASE}/contributors/:userId`, async (req, res) => {
    const actor = await resolveContributionActor(db, req, req.params.companyId, { requireTables: true });
    requireOwner(actor);
    const userId = parseContributorUserId(req.params.userId);
    await revokeContributor(db, { companyId: actor.companyId, userId });
    logger.info({ companyId: actor.companyId, userId }, "crew contributor revoked");
    res.status(204).end();
  });

  return router;
}

function parseContributorUserId(value: unknown): string {
  const parsed = contributorUserIdSchema.safeParse(value);
  if (!parsed.success) throw badRequest("userId không hợp lệ.", { code: CONTRIBUTION_ERRORS.invalid });
  return parsed.data;
}
